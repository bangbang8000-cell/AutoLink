"""预置模型档案（V3.1.3-T7-4 / V3.2.0-T9-1 自定义档案）

参数量为浮点（B 数级），供通信量估算使用；数据来源公开模型配置
（HuggingFace / 各厂商技术报告），属预估值。

V3.2.0-T9-1：新增 register_preset / load_user_presets —— 用户自定义档案
（name/params/hidden/layers/type 等）可追加到内置档案，容量推荐可引用。
"""
import json
import os
from typing import Optional


def _model(name: str, model_type: str, params_b: float, hidden: int, layers: int,
           context: int, precision: str, experts: int = 0, vocab: int = 32000,
           source: str = '内置', vendor: str = '') -> dict:
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
        'source': source,   # V3.2.0-T9-5: 档案来源标注（内置/国产）
        'vendor': vendor,   # V3.2.0-T9-5: 芯片/厂商（国产场景）
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
    # ---- V3.2.0-T9-5: 国产场景档案（昇腾 910B/910C、寒武纪、海光、昆仑芯）----
    'ascend-910b-llama2-70b': _model('昇腾 910B · Llama 2 70B', 'dense', 70, 8192, 80, 8192, 'bf16',
                                     source='国产', vendor='华为昇腾'),
    'ascend-910c-llama3-70b': _model('昇腾 910C · Llama 3 70B', 'dense', 70, 8192, 80, 8192, 'bf16',
                                     source='国产', vendor='华为昇腾'),
    'cambricon-mlu590-llama2-70b': _model('寒武纪思元 590 · Llama 2 70B', 'dense', 70, 8192, 80, 8192, 'bf16',
                                          source='国产', vendor='寒武纪'),
    'hygon-dcu1-qwen2-72b': _model('海光 DCU · Qwen2 72B', 'dense', 72, 8192, 80, 131072, 'bf16',
                                   source='国产', vendor='海光'),
    'kunlunxin-p800-llama2-70b': _model('昆仑芯 P800 · Llama 2 70B', 'dense', 70, 8192, 80, 8192, 'bf16',
                                        source='国产', vendor='昆仑芯'),
}

_PRECISION_LABELS = {'fp8': 'FP8', 'fp16': 'FP16', 'bf16': 'BF16'}


def register_preset(key: str, model: dict) -> str:
    """注册/覆盖自定义模型档案（V3.2.0-T9-1）

    model 字段：name/model_type/num_params/hidden_size/num_layers/context_length/
    precision/num_experts/vocab_size；id 自动取 key（空格/大写归一）。
    返回归一化 key。
    """
    key = str(key).strip().lower().replace(' ', '-')
    if not key:
        raise ValueError('档案 key 不能为空')
    entry = dict(model)
    entry['id'] = key
    entry.setdefault('name', key)
    entry.setdefault('model_type', 'dense')
    entry.setdefault('precision', 'bf16')
    entry.setdefault('context_length', 8192)
    entry.setdefault('num_experts', 0)
    entry.setdefault('vocab_size', 32000)
    for field in ('num_params', 'hidden_size', 'num_layers'):
        if field not in entry:
            raise ValueError(f'自定义档案 {key} 缺少 {field}')
    MODEL_PRESETS[key] = entry
    return key


def load_user_presets(path: Optional[str] = None) -> int:
    """从 JSON 文件加载用户自定义档案（V3.2.0-T9-1）

    JSON 格式：{"key": {name/model_type/num_params/...}, ...}
    缺省路径：工作区 capacity_presets.json。返回加载条数（0 = 无文件/空）。
    """
    if not path:
        try:
            from manage import workspace_dir
            path = os.path.join(workspace_dir(), 'capacity_presets.json')
        except ImportError:
            return 0
    if not os.path.exists(path):
        return 0
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return 0
    if not isinstance(data, dict):
        return 0
    count = 0
    for key, model in data.items():
        try:
            register_preset(key, model if isinstance(model, dict) else {})
            count += 1
        except (ValueError, TypeError):
            continue
    return count


def get_presets() -> list[dict]:
    """预设档案清单（前端选择器用，id = 档案 key；含用户自定义档案）

    V3.2.0-T9-5: 每项带来源标注 source（内置/国产）与 vendor（芯片/厂商），
    供 capacity:list-presets 前端下拉区分国产场景。
    """
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
            'source': item.get('source', '内置'),
            'vendor': item.get('vendor', ''),
        })
    # 确定性排序：先 MoE 后 Dense，同型按参数量（国产/内置混排）
    presets.sort(key=lambda p: (0 if p['model_type'] == 'moe' else 1, -p['num_params']))
    return presets


def resolve_preset(model_id: str) -> Optional[dict]:
    """按 id 查预设档案（支持大小写/短名/名称子串模糊匹配）

    V3.2.0-T9-5: 国产档案可按名称子串匹配（如 '昇腾 910B' → ascend-910b-*）。
    """
    if model_id in MODEL_PRESETS:
        return MODEL_PRESETS[model_id]
    lower = model_id.lower()
    for key, item in MODEL_PRESETS.items():
        name_lower = item['name'].lower()
        if key in lower or lower in key or name_lower in lower or lower in name_lower:
            return item
    return None
