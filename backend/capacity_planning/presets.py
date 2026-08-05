"""预置模型档案（V3.1.3-T7-4）

参数量为浮点（B 数级），供通信量估算使用；数据来源公开模型配置
（HuggingFace / 各厂商技术报告），属预估值。
"""
from typing import Optional


def _model(name: str, model_type: str, params_b: float, hidden: int, layers: int,
           context: int, precision: str, experts: int = 0, vocab: int = 32000) -> dict:
    return {
        'id': name,
        'name': name,
        'model_type': model_type,
        'num_params': params_b * 1e9,
        'hidden_size': hidden,
        'num_layers': layers,
        'context_length': context,
        'precision': precision,
        'num_experts': experts,
        'vocab_size': vocab,
    }


MODEL_PRESETS: dict[str, dict] = {
    'llama3-8b': _model('Llama 3 8B', 'dense', 8, 4096, 32, 8192, 'bf16'),
    'llama3-70b': _model('Llama 3 70B', 'dense', 70, 8192, 80, 8192, 'bf16'),
    'llama3-405b': _model('Llama 3 405B', 'dense', 405, 16384, 126, 131072, 'bf16'),
    'deepseek-v3': _model('DeepSeek-V3', 'moe', 671, 7168, 61, 131072, 'fp8', experts=256),
    'deepseek-r1-671b': _model('DeepSeek-R1 671B', 'moe', 671, 7168, 61, 131072, 'fp8', experts=256),
    'qwen2.5-32b': _model('Qwen2.5 32B', 'dense', 32, 5120, 64, 131072, 'bf16'),
    'qwen2.5-72b': _model('Qwen2.5 72B', 'dense', 72, 8192, 80, 131072, 'bf16'),
    'mixtral-8x22b': _model('Mixtral 8x22B', 'moe', 141, 6144, 56, 65536, 'bf16', experts=8),
    'gpt3-175b': _model('GPT-3 175B', 'dense', 175, 12288, 96, 2048, 'bf16'),
    'gpt4-class': _model('GPT-4 class', 'moe', 1800, 16384, 120, 131072, 'fp8', experts=16),
    'bert-large': _model('BERT-Large', 'dense', 0.336, 1024, 24, 512, 'fp16'),
    'llama2-13b': _model('Llama 2 13B', 'dense', 13, 5120, 40, 4096, 'fp16'),
}

_PRECISION_LABELS = {'fp8': 'FP8', 'fp16': 'FP16', 'bf16': 'BF16'}


def get_presets() -> list[dict]:
    """预设档案清单（前端选择器用，id = 档案 key）"""
    presets = []
    for key, item in MODEL_PRESETS.items():
        presets.append({
            'id': key,
            'name': item['name'],
            'model_type': item['model_type'],
            'num_params': item['num_params'],
            'context_length': item['context_length'],
            'precision': _PRECISION_LABELS.get(item['precision'], item['precision']),
            'num_experts': item['num_experts'],
        })
    # 确定性排序：先 MoE 后 Dense，同型按参数量
    presets.sort(key=lambda p: (0 if p['model_type'] == 'moe' else 1, -p['num_params']))
    return presets


def resolve_preset(model_id: str) -> Optional[dict]:
    """按 id 查预设档案（支持大小写/短名模糊匹配）"""
    if model_id in MODEL_PRESETS:
        return MODEL_PRESETS[model_id]
    lower = model_id.lower()
    for key, item in MODEL_PRESETS.items():
        if key in lower or lower in key or item['name'].lower() in lower:
            return item
    return None
