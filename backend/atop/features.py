"""ATOP 模型通信特征提取（V3.2.0-T9-2）

依据《From ATOP to ZCube》（清华 SIGCOMM 2025）：
  模型训练通信可归类为 AllReduce（数据/张量并行梯度同步）、All-to-All
  （MoE 专家分发/序列并行）、P2P（流水线 stage 间激活传递）三类；
  ATOP 依据通信模式主导占比驱动拓扑选型（ZCube 扁平二部图 + 网卡数/速率）。

特征提取规则（预估值，供拓扑推荐）：
  - 显式提供 communication_pattern / comm_ratio / traffic 时直接采用（用户覆盖）
  - MoE（num_experts > 0）→ alltoall 主导（专家并行全交换），comm_ratio 默认 0.7
  - 稠密模型 → allreduce 主导（梯度同步），comm_ratio 默认 0.5
  - pp > 1 → traffic_breakdown 计入 p2p 分量（每多一段 +0.05，上限 0.3）
  - nics_per_gpu 建议：comm_ratio ≥ 0.6 → 4 口（高通信密度）；≥ 0.4 → 2 口；否则 2 口
"""
from dataclasses import dataclass, field
from typing import Dict

COMM_PATTERN_ALLREDUCE = 'allreduce'
COMM_PATTERN_ALLTOALL = 'alltoall'
COMM_PATTERN_P2P = 'p2p'
COMM_PATTERNS = (COMM_PATTERN_ALLREDUCE, COMM_PATTERN_ALLTOALL, COMM_PATTERN_P2P)


@dataclass
class AtopFeature:
    """模型通信特征（驱动 ATOP 拓扑推荐）

    字段：
        model_name / model_type: 模型标识
        communication_pattern: 主导通信模式（allreduce/alltoall/p2p）
        comm_ratio: 通信占比 0~1（训练总时长中通信耗时占比预估值）
        precision: 训练精度（fp8/fp16/bf16）
        num_experts: MoE 专家数（稠密 = 0）
        traffic_breakdown: 三类模式流量占比 {allreduce, alltoall, p2p}（和 = 1）
        tp / dp / pp: 并行策略（pp>1 引入流水线 p2p）
        nics_per_gpu: 建议网卡数（双口/四口混合接入）
    """
    model_name: str
    model_type: str
    communication_pattern: str
    comm_ratio: float
    precision: str
    num_experts: int = 0
    traffic_breakdown: Dict[str, float] = field(
        default_factory=lambda: {'allreduce': 1.0, 'alltoall': 0.0, 'p2p': 0.0})
    tp: int = 8
    dp: int = 1
    pp: int = 1
    nics_per_gpu: int = 2

    def to_dict(self) -> dict:
        return {
            'modelName': self.model_name,
            'modelType': self.model_type,
            'communicationPattern': self.communication_pattern,
            'commRatio': self.comm_ratio,
            'precision': self.precision,
            'numExperts': self.num_experts,
            'trafficBreakdown': dict(self.traffic_breakdown),
            'parallel': {'tp': self.tp, 'dp': self.dp, 'pp': self.pp},
            'nicsPerGpu': self.nics_per_gpu,
        }


def extract_features(config: dict) -> AtopFeature:
    """从模型配置（preset id / 自定义字段 / 用户覆盖）提取通信特征

    Args:
        config: {model, num_gpus, model_type, num_params, hidden_size, num_layers,
                 num_experts, precision, tp, dp, pp,
                 communication_pattern?, comm_ratio?, traffic?}
    Returns:
        AtopFeature
    Raises:
        ValueError: 模型解析失败 / 参数非法
    """
    from capacity_planning.model_parser import parse_model_config

    profile = parse_model_config({
        'preset': config.get('model') or '',
        'model_type': config.get('model_type'),
        'num_params': config.get('num_params'),
        'hidden_size': config.get('hidden_size'),
        'num_layers': config.get('num_layers'),
        'num_experts': config.get('num_experts'),
        'context_length': config.get('context_length'),
        'precision': config.get('precision'),
        'vocab_size': config.get('vocab_size'),
    })

    tp = int(config.get('tp') or 8)
    dp = int(config.get('dp') or 1)
    pp = int(config.get('pp') or 1)
    if tp <= 0 or dp <= 0 or pp <= 0:
        raise ValueError('tp/dp/pp 必须为正数')

    # --- 主导通信模式 ---
    pattern = str(config.get('communication_pattern') or '').strip().lower()
    explicit_traffic = config.get('traffic')
    if pattern not in COMM_PATTERNS:
        if explicit_traffic:
            # 由流量占比推导主导模式
            t = explicit_traffic
            if not isinstance(t, dict):
                raise ValueError('traffic 必须是 JSON 对象 {allreduce, alltoall, p2p}')
            pattern = max(COMM_PATTERNS, key=lambda k: float(t.get(k, 0) or 0))
        elif profile.num_experts > 0:
            pattern = COMM_PATTERN_ALLTOALL  # MoE 专家分发全交换
        elif pp > 1:
            pattern = COMM_PATTERN_P2P       # 流水线 stage 间激活传递
        else:
            pattern = COMM_PATTERN_ALLREDUCE

    # --- 通信占比（用户覆盖优先） ---
    comm_ratio = config.get('comm_ratio')
    if comm_ratio in (None, ''):
        if pattern == COMM_PATTERN_ALLTOALL:
            comm_ratio = 0.7    # MoE 全交换显著
        elif pattern == COMM_PATTERN_P2P:
            comm_ratio = 0.6    # 深流水线 P2P 密集
        else:
            comm_ratio = 0.5
    comm_ratio = float(comm_ratio)
    if not 0.0 <= comm_ratio <= 1.0:
        raise ValueError('comm_ratio 必须在 0~1 之间')

    # --- 流量占比（显式覆盖 / 规则推导） ---
    if isinstance(explicit_traffic, dict):
        traffic = {
            'allreduce': float(explicit_traffic.get('allreduce', 0) or 0),
            'alltoall': float(explicit_traffic.get('alltoall', 0) or 0),
            'p2p': float(explicit_traffic.get('p2p', 0) or 0),
        }
    else:
        traffic = {'allreduce': 0.0, 'alltoall': 0.0, 'p2p': 0.0}
        if profile.num_experts > 0:
            traffic['alltoall'] = min(0.8, 0.4 + 0.1 * min(8, profile.num_experts // 32))
        elif pattern == COMM_PATTERN_P2P:
            traffic['p2p'] = min(0.3, 0.1 + 0.05 * (pp - 1))
        # 余量归主导模式，保证和 = 1
        main = pattern
        remaining = 1.0 - sum(traffic.values())
        traffic[main] = round(traffic[main] + remaining, 3)

    # --- 网卡数建议（高通信密度 → 四口混合接入） ---
    nics = int(config.get('nics_per_gpu') or 0)
    if nics <= 0:
        nics = 4 if comm_ratio >= 0.6 else 2

    return AtopFeature(
        model_name=profile.name,
        model_type=profile.model_type,
        communication_pattern=pattern,
        comm_ratio=round(comm_ratio, 3),
        precision=profile.precision,
        num_experts=profile.num_experts,
        traffic_breakdown=traffic,
        tp=tp, dp=dp, pp=pp,
        nics_per_gpu=nics,
    )
