"""参数化经验规则（V3.1.3-T7-4）

在 topology_recommender 结果之上做规则修正与解释说明（预研 §3.4）：
  规则 1: MoE → 收敛比 ≤ 1.2（已并入 recommender，此处校验）
  规则 2: FP8 训练 → 带宽需求 ×1.5（提示）
  规则 3: 长上下文（>32K）→ 优先 NVLink Scale-Up（提示）
  规则 4: >1024 GPU → 自动升级 3-tier（校验）
  规则 5: 预算档位覆盖收敛比目标（校验）
"""
from typing import Optional

from .model_parser import ModelProfile
from .comm_calculator import CommRequirement
from .topology_recommender import TopologyRecommendation

_LONG_CONTEXT = 32768
_LARGE_SCALE = 1024


def apply_rules(model: ModelProfile, comm: CommRequirement, target_gpus: int,
                budget: str, rec: TopologyRecommendation) -> list:
    """校验推荐并返回解释性 notes（每条为 {level, message}）"""
    notes: list = []

    # 规则 1: MoE 收敛比校验
    if model.model_type == 'moe' and rec.convergence_ratio > 1.2:
        notes.append({'level': 'warn', 'message': f'MoE 模型收敛比应 ≤1.2，当前 {rec.convergence_ratio} 偏高'})

    # 规则 2: FP8 计算提速 → 通信占比相对提升
    if model.precision == 'fp8':
        notes.append({'level': 'info',
                      'message': f'FP8 训练计算密度 2x，通信占比相对提升（预估 {round(comm.comm_ratio * 100)}%），'
                                 f'已推荐 {rec.scale_out_speed} 参数网'})

    # 规则 3: 长上下文 → Scale-Up 优先
    if model.context_length > _LONG_CONTEXT:
        ctx_k = model.context_length // 1024
        su = rec.scale_up_protocol
        if su == 'NVLink':
            notes.append({'level': 'info', 'message': f'长上下文 {ctx_k}K token，'
                                                      f'已优先 NVLink Scale-Up（域 {rec.scale_up_domain}）'})
        else:
            notes.append({'level': 'warn', 'message': f'长上下文 {ctx_k}K token 建议 Scale-Up，'
                                                      f'当前推荐 {su}'})

    # 规则 4: 大规模 → 3-tier
    if target_gpus > _LARGE_SCALE:
        assert rec.tier_count == 3, '超过 1024 GPU 必须 3-tier'
        notes.append({'level': 'info', 'message': f'{target_gpus} GPU 超大规模，已自动升级 3-tier Fat-Tree'})

    # 规则 5: 预算说明
    if budget == 'economy':
        notes.append({'level': 'info', 'message': f'economy 档：收敛比放宽至 {rec.convergence_ratio}，'
                                                  f'速率 {rec.scale_out_speed}'})
    elif budget == 'premium':
        notes.append({'level': 'info', 'message': 'premium 档：优先低收敛比与高速率（Scale-Up 优先）'})

    # 通用提示：结果为预估值
    notes.append({'level': 'info', 'message': '以上为解析法预估值（误差 ±15-20%），最终以实测/厂商规格为准'})

    return notes


def max_scale_up_domain(model: ModelProfile, target_gpus: int) -> Optional[int]:
    """辅助：可容纳的最大 Scale-Up 域大小（不超过 GPU 总数）"""
    for domain in (72, 32, 16):
        if target_gpus >= domain:
            return domain
    return None
