"""拓扑推荐器（V3.1.3-T7-4 基础版）

基于通信需求 + 目标 GPU 规模 + 预算档位，推荐 Scale-Up/Scale-Out 网络参数。
"""
from dataclasses import dataclass

from .model_parser import ModelProfile
from .comm_calculator import CommRequirement

# 预算档位：收敛比放宽系数
_BUDGET_CONV = {'economy': 1.5, 'standard': 1.2, 'premium': 1.0}
# 各负载类型的目标收敛比（预研 §2.1）
_CONV_TARGET = {'moe': 1.2, 'multimodal': 1.5, 'dense': 1.5}
# Scale-Up 域大小候选（NVL72 / UALink 32 / 16 / 不启用）
_SCALE_UP_CANDIDATES = (72, 32, 16, 0)


@dataclass
class TopologyRecommendation:
    scale_up_protocol: str   # 'NVLink' | 'UALink' | 'UB' | 'none'
    scale_up_domain: int     # 推荐 Scale-Up 域大小（0 = 不启用）
    scale_out_protocol: str  # 'IB' | 'RoCE' | 'UEC'
    scale_out_speed: str     # '800G' | '400G' | '200G'
    convergence_ratio: float # 推荐参数网收敛比
    tier_count: int          # 2 或 3 层
    estimated_comm_overhead: float  # 预估通信开销占比

    def to_dict(self) -> dict:
        return {
            'scale_up_protocol': self.scale_up_protocol,
            'scale_up_domain': self.scale_up_domain,
            'scale_out_protocol': self.scale_out_protocol,
            'scale_out_speed': self.scale_out_speed,
            'convergence_ratio': self.convergence_ratio,
            'tier_count': self.tier_count,
            'estimated_comm_overhead': self.estimated_comm_overhead,
        }


def _pick_scale_up(model: ModelProfile, target_gpus: int, budget: str) -> tuple:
    """Scale-Up 域选择：长上下文/高预算/大模型优先 NVLink 大域"""
    long_ctx = model.context_length > 32768
    big_model = model.num_params >= 100e9
    if budget == 'premium' or (long_ctx and big_model):
        return 'NVLink', 72
    if model.num_params >= 40e9 or model.context_length > 8192:
        return 'UALink', 32
    if target_gpus >= 128:
        return 'UALink', 16
    return 'none', 0


def _pick_scale_out(model: ModelProfile, comm: CommRequirement, target_gpus: int,
                    budget: str) -> tuple:
    """Scale-Out 协议 + 速率：MoE/FP8 高敏感 → UEC/800G"""
    high_comm = comm.comm_ratio >= 0.3
    if model.model_type == 'moe' or high_comm or budget == 'premium':
        protocol = 'UEC' if model.model_type == 'moe' else ('UEC' if high_comm else 'IB')
    elif target_gpus > 1024:
        protocol = 'IB'
    else:
        protocol = 'RoCE'

    if model.precision == 'fp8' or high_comm or model.context_length > 32768:
        speed = '800G'
    elif model.num_params >= 70e9:
        speed = '400G'
    else:
        speed = '400G'
    if budget == 'economy' and speed == '800G' and comm.comm_ratio < 0.3:
        speed = '400G'
    return protocol, speed


def recommend_topology(model: ModelProfile, comm: CommRequirement, target_gpus: int,
                       budget: str = 'standard') -> TopologyRecommendation:
    """基于通信需求推荐拓扑"""
    budget = budget if budget in _BUDGET_CONV else 'standard'

    su_protocol, su_domain = _pick_scale_up(model, target_gpus, budget)
    so_protocol, so_speed = _pick_scale_out(model, comm, target_gpus, budget)

    conv = _CONV_TARGET.get(model.model_type, 1.5) * _BUDGET_CONV.get(budget, 1.2)
    # MoE 最严格：≤1.2（预研规则 1）
    if model.model_type == 'moe':
        conv = min(conv, 1.2)
    conv = round(min(conv, 1.5), 1)

    tier_count = 3 if target_gpus > 1024 else 2

    return TopologyRecommendation(
        scale_up_protocol=su_protocol,
        scale_up_domain=su_domain,
        scale_out_protocol=so_protocol,
        scale_out_speed=so_speed,
        convergence_ratio=conv,
        tier_count=tier_count,
        estimated_comm_overhead=comm.comm_ratio,
    )
