"""训练通信量估算（V3.1.3-T7-4 基础版 / V3.2.0-T9-1 精确版）

基于预研文档公式（docs/v2.7/ai_capacity_planning_research.md §2.2）：
  - Ring-AllReduce: 2*(N-1)/N * M（M = 梯度大小）
  - MoE All-to-All: 2*B*S*H*dtype
  - Pipeline P2P: 每 stage 边界 2*H*dtype*L_pp

V3.2.0-T9-1 新增：
  - FP8 分块精度模型（calculate_comm_exact）：按块（权重/梯度/优化器/激活）精确估算，
    梯度按 fp8=1B/fp16-2B，AllReduce 用 Ring 精确系数 2*(N-1)/N，输出与解析法误差对照
  - Pipeline 显存建模（estimate_pipeline_memory）：每 stage 参数 1/pp + 激活分段峰值
"""
from dataclasses import dataclass
from typing import Optional

from .model_parser import ModelProfile

# 每参数通信字节（fp8 梯度压缩 ≈ 1B；fp16/bf16 ≈ 2B）
_BYTES = {'fp8': 1, 'fp16': 2, 'bf16': 2}
# 模型类型通信占比基线（预研 §2.1 表格中值）
_BASE_RATIO = {'dense': 0.20, 'moe': 0.35, 'multimodal': 0.18}
# 长上下文阈值（token），超过则追加通信占比
_LONG_CONTEXT = 32768


@dataclass
class CommRequirement:
    allreduce_bytes: float
    alltoall_bytes: float
    p2p_bytes: float
    total_bytes: float
    comm_ratio: float  # 通信占比（0~0.5）

    def to_dict(self) -> dict:
        return {
            'allreduce_bytes': self.allreduce_bytes,
            'alltoall_bytes': self.alltoall_bytes,
            'p2p_bytes': self.p2p_bytes,
            'total_bytes': self.total_bytes,
            'total_gib': round(self.total_bytes / (1024 ** 3), 2),
            'comm_ratio': self.comm_ratio,
        }


def _bytes_per_param(precision: str) -> int:
    return _BYTES.get(precision, 2)


def _comm_ratio(model: ModelProfile) -> float:
    """通信占比：基线 + 修正（长上下文 / FP8 计算提速）"""
    ratio = _BASE_RATIO.get(model.model_type, 0.20)
    if model.context_length > _LONG_CONTEXT:
        ratio += 0.05
    if model.precision == 'fp8':
        ratio *= 1.25
    return max(0.10, min(0.50, ratio))


def calculate_comm(model: ModelProfile, parallel: Optional[dict] = None,
                   num_gpus: int = 1, batch_per_gpu: int = 2) -> CommRequirement:
    """估算每训练步的通信量（bytes）与通信占比（解析法，预估值）

    parallel: {tp, dp, pp}；缺省 tp=8, dp=1, pp=1。
    """
    parallel = parallel or {}
    tp = int(parallel.get('tp') or 8)
    pp = int(parallel.get('pp') or 1)
    dp = int(parallel.get('dp') or 1)

    bpp = _bytes_per_param(model.precision)

    # AllReduce：梯度同步（TP + DP 域），Ring 每步 2*(N-1)/N*M，N 大时 ≈ 2M
    grad_bytes = model.num_params * bpp
    allreduce_bytes = 2 * grad_bytes

    # All-to-All（MoE EP）：2*B*S*H*dtype
    alltoall_bytes = 0.0
    if model.model_type == 'moe' and model.num_experts > 0:
        alltoall_bytes = 2 * batch_per_gpu * model.context_length * model.hidden_size * bpp

    # Pipeline P2P：每 stage 边界 2*H*dtype*L_pp（L_pp = 每 stage 层数）
    p2p_bytes = 0.0
    if pp > 1:
        layers_per_pp = max(1, model.num_layers // pp)
        p2p_bytes = 2 * model.hidden_size * bpp * layers_per_pp * (pp - 1)

    total_bytes = allreduce_bytes + alltoall_bytes + p2p_bytes

    return CommRequirement(
        allreduce_bytes=allreduce_bytes,
        alltoall_bytes=alltoall_bytes,
        p2p_bytes=p2p_bytes,
        total_bytes=total_bytes,
        comm_ratio=round(_comm_ratio(model), 3),
    )


# ================================================================
# V3.2.0-T9-1: FP8 分块精度模型（精确版）
# ================================================================

@dataclass
class ExactComm:
    """FP8 分块精度通信量 + 显存（V3.2.0-T9-1）

    分块口径：主权重 FP32(4B) + 优化器 AdamW(2×4B) + 梯度（fp8=1B/fp16=2B）+
    激活（每层 2*B*S*H*dtype）。AllReduce 用 Ring 精确系数 2*(N-1)/N。
    """
    allreduce_bytes: float
    alltoall_bytes: float
    p2p_bytes: float
    total_bytes: float
    comm_ratio: float
    grad_bpp: int              # 梯度字节/参数
    memory_gib: float          # 单卡训练显存峰值（含 Pipeline 分段）
    pipeline_peak_gib: float   # Pipeline 每 stage 峰值显存
    analytic_error_pct: float  # 与解析法 total_bytes 对照误差（%）

    def to_dict(self) -> dict:
        return {
            'allreduce_bytes': self.allreduce_bytes,
            'alltoall_bytes': self.alltoall_bytes,
            'p2p_bytes': self.p2p_bytes,
            'total_bytes': self.total_bytes,
            'total_gib': round(self.total_bytes / (1024 ** 3), 2),
            'comm_ratio': self.comm_ratio,
            'grad_bpp': self.grad_bpp,
            'memory_gib': round(self.memory_gib, 2),
            'pipeline_peak_gib': round(self.pipeline_peak_gib, 2),
            'analytic_error_pct': round(self.analytic_error_pct, 1),
        }


def calculate_comm_exact(model: ModelProfile, parallel: Optional[dict] = None,
                         num_gpus: int = 1, batch_per_gpu: int = 2) -> ExactComm:
    """FP8 分块精度通信量 + 显存精确估算（V3.2.0-T9-1）

    与 calculate_comm 对照：梯度字节（fp8 1B vs fp16 2B）+ Ring 精确系数 → 误差对照输出。
    """
    parallel = parallel or {}
    tp = int(parallel.get('tp') or 8)
    pp = int(parallel.get('pp') or 1)
    dp = int(parallel.get('dp') or 1)

    # FP8 训练：梯度 fp8 压缩通信 1B/参数；fp16/bf16 2B/参数
    grad_bpp = _bytes_per_param(model.precision)
    act_bpp = 1 if model.precision == 'fp8' else 2

    grad_bytes = model.num_params * grad_bpp
    # Ring-AllReduce 精确系数 2*(N-1)/N：N = 梯度同步域（TP×DP，上限总卡数）
    ring_n = max(1, min(num_gpus, max(1, tp * dp)))
    allreduce_bytes = 2 * (ring_n - 1) / ring_n * grad_bytes

    alltoall_bytes = 0.0
    if model.model_type == 'moe' and model.num_experts > 0:
        alltoall_bytes = 2 * batch_per_gpu * model.context_length * model.hidden_size * act_bpp

    p2p_bytes = 0.0
    if pp > 1:
        layers_per_pp = max(1, model.num_layers // pp)
        p2p_bytes = 2 * model.hidden_size * act_bpp * layers_per_pp * (pp - 1)

    total_bytes = allreduce_bytes + alltoall_bytes + p2p_bytes

    # 显存：参数（主权重 4B + 优化器 2×4B + 梯度 grad_bpp）× (1/TP×DP) + 激活分段
    param_per_gpu = model.num_params / max(1, tp * dp)
    weight_bytes = param_per_gpu * 4.0
    optimizer_bytes = param_per_gpu * 8.0       # AdamW 2 份 FP32
    grad_gpu_bytes = param_per_gpu * grad_bpp
    layers_per_pp = max(1, model.num_layers // pp)
    activation_bytes = (2 * batch_per_gpu * model.context_length
                        * model.hidden_size * act_bpp * layers_per_pp)
    memory_gib = (weight_bytes + optimizer_bytes + grad_gpu_bytes + activation_bytes) / (1024 ** 3)
    pipeline_peak_gib = ((weight_bytes + optimizer_bytes + grad_gpu_bytes) / pp
                         + activation_bytes) / (1024 ** 3)

    # 与解析法对照误差（驱动"精确 vs 解析"展示）
    analytic = calculate_comm(model, parallel, num_gpus, batch_per_gpu)
    error_pct = (abs(total_bytes - analytic.total_bytes) / max(1e-9, analytic.total_bytes)) * 100

    return ExactComm(
        allreduce_bytes=allreduce_bytes,
        alltoall_bytes=alltoall_bytes,
        p2p_bytes=p2p_bytes,
        total_bytes=total_bytes,
        comm_ratio=round(_comm_ratio(model), 3),
        grad_bpp=grad_bpp,
        memory_gib=memory_gib,
        pipeline_peak_gib=pipeline_peak_gib,
        analytic_error_pct=error_pct,
    )


def estimate_pipeline_memory(model: ModelProfile, parallel: Optional[dict] = None,
                             num_gpus: int = 1, batch_per_gpu: int = 2) -> dict:
    """Pipeline 分段显存建模（V3.2.0-T9-1）

    返回 {pp_size, stages, params_per_stage_b, peak_per_stage_gib, activation_gib}
    """
    parallel = parallel or {}
    pp = max(1, int(parallel.get('pp') or 1))
    tp = int(parallel.get('tp') or 8)
    dp = int(parallel.get('dp') or 1)
    grad_bpp = _bytes_per_param(model.precision)
    act_bpp = 1 if model.precision == 'fp8' else 2

    params_per_stage = model.num_params / max(1, pp)
    layers_per_stage = max(1, model.num_layers // pp)
    activation_bytes = (2 * batch_per_gpu * model.context_length
                        * model.hidden_size * act_bpp * layers_per_stage)
    # 每 stage 单卡：主权重 + 优化器 + 梯度（再按 TP×DP 切分）
    param_per_gpu = params_per_stage / max(1, tp * dp)
    weights = param_per_gpu * 4.0
    optimizers = param_per_gpu * 8.0
    grads = param_per_gpu * grad_bpp
    peak_gib = (weights + optimizers + grads + activation_bytes) / (1024 ** 3)

    return {
        'pp_size': pp,
        'stages': pp,
        'params_per_stage_b': round(params_per_stage / 1e9, 2),
        'peak_per_stage_gib': round(peak_gib, 2),
        'activation_gib': round(activation_bytes / (1024 ** 3), 2),
    }
