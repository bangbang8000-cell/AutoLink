"""训练通信量估算（V3.1.3-T7-4 基础版）

基于预研文档公式（docs/v2.7/ai_capacity_planning_research.md §2.2）：
  - Ring-AllReduce: 2*(N-1)/N * M（M = 梯度大小）
  - MoE All-to-All: 2*B*S*H*dtype
  - Pipeline P2P: 每 stage 边界 2*H*dtype*L_pp

全部为预估值（解析法误差 ±15-20%），驱动拓扑推荐。
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


def calculate_comm(model: ModelProfile, parallel: Optional[dict] = None,
                   num_gpus: int = 1, batch_per_gpu: int = 2) -> CommRequirement:
    """估算每训练步的通信量（bytes）与通信占比

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

    # 通信占比：基线 + 修正（长上下文 / FP8 计算提速）
    ratio = _BASE_RATIO.get(model.model_type, 0.20)
    if model.context_length > _LONG_CONTEXT:
        ratio += 0.05
    if model.precision == 'fp8':
        ratio *= 1.25
    ratio = max(0.10, min(0.50, ratio))

    return CommRequirement(
        allreduce_bytes=allreduce_bytes,
        alltoall_bytes=alltoall_bytes,
        p2p_bytes=p2p_bytes,
        total_bytes=total_bytes,
        comm_ratio=round(ratio, 3),
    )
