"""AutoLink 容量规划内核（V3.1.3-T7-4 基础版）

基于训练负载特征（模型类型/参数量/上下文/精度/并行策略 + 目标 GPU 规模）
反推 Scale-Up / Scale-Out 网络参数推荐：
  模型档案解析（presets.py）→ 通信量估算（comm_calculator.py）→
  拓扑推荐（topology_recommender.py）+ 经验规则修正（rules.py）。

设计依据：docs/v2.7/ai_capacity_planning_research.md（公式/规则/误差 ±15-20%，
推荐结果属预估值，标注供用户确认）。
"""
from .model_parser import ModelProfile, parse_model_config
from .presets import MODEL_PRESETS, get_presets
from .comm_calculator import CommRequirement, calculate_comm
from .topology_recommender import TopologyRecommendation, recommend_topology
from .rules import apply_rules

__all__ = [
    'ModelProfile', 'parse_model_config', 'MODEL_PRESETS', 'get_presets',
    'CommRequirement', 'calculate_comm', 'TopologyRecommendation',
    'recommend_topology', 'apply_rules', 'recommend',
]


def recommend(params: dict) -> dict:
    """容量规划推荐主入口（供 capacity:recommend action / AIHUB 工具调用）

    参数: model（预设 id 或自定义模型名）/ num_gpus（目标 GPU 数，必填）/
          budget（economy|standard|premium，默认 standard）/
          可选模型覆盖: model_type/num_params/hidden_size/num_layers/num_experts/
                      context_length/precision/vocab_size/
          可选并行策略: tp/dp/pp（默认 8/1/1）
    返回: {success, model, comm, recommendation, notes}
    """
    model_id = params.get('model') or ''
    num_gpus = int(params.get('num_gpus') or 0)
    if not model_id:
        return {'success': False, 'error': '缺少模型参数（model 必填）'}
    if num_gpus <= 0:
        return {'success': False, 'error': 'GPU 数量必须为正数'}

    try:
        model = parse_model_config({
            'preset': model_id,
            'model_type': params.get('model_type'),
            'num_params': params.get('num_params'),
            'hidden_size': params.get('hidden_size'),
            'num_layers': params.get('num_layers'),
            'num_experts': params.get('num_experts'),
            'context_length': params.get('context_length'),
            'precision': params.get('precision'),
            'vocab_size': params.get('vocab_size'),
        })
    except ValueError as e:
        return {'success': False, 'error': str(e)}

    parallel = {
        'tp': int(params.get('tp') or 8),
        'dp': int(params.get('dp') or 1),
        'pp': int(params.get('pp') or 1),
    }
    budget = params.get('budget') or 'standard'

    comm = calculate_comm(model, parallel, num_gpus)
    rec = recommend_topology(model, comm, num_gpus, budget)
    notes = apply_rules(model, comm, num_gpus, budget, rec)

    return {
        'success': True,
        # V3.1.3-T7-5: 预估值标注——解析法结果（误差 ±15-20%），非实测
        'estimated': True,
        'estimation': {
            'label': '预估值',
            'method': '解析法（通信量公式 + 经验规则）',
            'accuracy': '±15-20%',
            'note': '推荐结果为预估值，最终以实测/厂商规格为准',
        },
        'model': model.to_dict(),
        'comm': comm.to_dict(),
        'recommendation': rec.to_dict(),
        'notes': notes,
    }
