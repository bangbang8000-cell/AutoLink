"""模型档案解析（V3.1.3-T7-4）

支持：预设 id（MODEL_PRESETS）+ 自定义覆盖（model_type/num_params/hidden_size 等）。
数据字段为预估值，用于通信量/带宽推导。
"""
from dataclasses import dataclass

from .presets import resolve_preset

_PRECISIONS = ('fp8', 'fp16', 'bf16')
_TYPES = ('dense', 'moe', 'multimodal')


@dataclass
class ModelProfile:
    model_type: str          # 'dense' | 'moe' | 'multimodal'
    num_params: float        # 参数量（个）
    hidden_size: int
    num_layers: int
    num_experts: int         # MoE 专家数（dense = 0）
    context_length: int      # 上下文长度（token）
    precision: str           # 'fp8' | 'fp16' | 'bf16'
    vocab_size: int
    name: str = ''

    def to_dict(self) -> dict:
        return {
            'name': self.name,
            'model_type': self.model_type,
            'num_params': self.num_params,
            'num_params_b': round(self.num_params / 1e9, 2),
            'hidden_size': self.hidden_size,
            'num_layers': self.num_layers,
            'num_experts': self.num_experts,
            'context_length': self.context_length,
            'precision': self.precision,
            'vocab_size': self.vocab_size,
        }


def parse_model_config(config: dict) -> ModelProfile:
    """解析模型档案：preset id 或自定义字段

    自定义字段覆盖预设同名项；未知预设且无自定义字段时抛 ValueError。
    """
    preset_id = (config.get('preset') or '').strip()
    preset = resolve_preset(preset_id) if preset_id else None

    if preset is None and preset_id and not any(
            config.get(k) for k in ('model_type', 'num_params', 'hidden_size', 'num_layers')):
        raise ValueError(f'未知模型预设: {preset_id}（可用 capacity:list-presets 查看）')

    def _get(key, default):
        val = config.get(key)
        return default if val in (None, '') else val

    model_type = _get('model_type', preset.get('model_type') if preset else 'dense')
    num_params = float(_get('num_params', preset.get('num_params') if preset else 7e9))
    hidden = int(_get('hidden_size', preset.get('hidden_size') if preset else 4096))
    layers = int(_get('num_layers', preset.get('num_layers') if preset else 32))
    experts = int(_get('num_experts', preset.get('num_experts') if preset else 0))
    context = int(_get('context_length', preset.get('context_length') if preset else 8192))
    precision = str(_get('precision', preset.get('precision') if preset else 'bf16'))
    vocab = int(_get('vocab_size', preset.get('vocab_size') if preset else 32000))
    name = preset.get('name') if preset else preset_id or '自定义模型'

    if model_type not in _TYPES:
        raise ValueError(f'model_type 必须是 {" / ".join(_TYPES)}')
    if precision not in _PRECISIONS:
        raise ValueError(f'precision 必须是 {" / ".join(_PRECISIONS)}')
    if num_params <= 0 or hidden <= 0 or layers <= 0:
        raise ValueError('num_params/hidden_size/num_layers 必须为正数')

    return ModelProfile(
        model_type=model_type,
        num_params=num_params,
        hidden_size=hidden,
        num_layers=layers,
        num_experts=experts,
        context_length=context,
        precision=precision,
        vocab_size=vocab,
        name=name,
    )
