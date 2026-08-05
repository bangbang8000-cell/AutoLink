"""V3.1.3-T7-4: 容量规划内核测试（presets/解析/通信/拓扑推荐/规则）"""
import pytest

from capacity_planning import (
    recommend, get_presets, parse_model_config, calculate_comm, recommend_topology,
)
from capacity_planning.presets import MODEL_PRESETS


class TestPresets:
    def test_presets_count(self):
        presets = get_presets()
        assert len(presets) >= 10
        ids = {p['id'] for p in presets}
        assert {'llama3-70b', 'deepseek-v3', 'qwen2.5-72b', 'mixtral-8x22b'} <= ids

    def test_preset_fields(self):
        deepseek = MODEL_PRESETS['deepseek-v3']
        assert deepseek['model_type'] == 'moe'
        assert deepseek['num_experts'] > 0
        assert deepseek['precision'] == 'fp8'


class TestModelParser:
    def test_parse_preset(self):
        m = parse_model_config({'preset': 'llama3-70b'})
        assert m.model_type == 'dense'
        assert m.num_params == 70e9

    def test_parse_custom_override(self):
        m = parse_model_config({'preset': 'llama3-8b', 'num_params': 16e9, 'precision': 'fp8'})
        assert m.num_params == 16e9
        assert m.precision == 'fp8'

    def test_parse_custom_model(self):
        m = parse_model_config({'preset': 'my-model', 'model_type': 'moe',
                                'num_params': 100e9, 'hidden_size': 8192,
                                'num_layers': 60, 'num_experts': 128})
        assert m.model_type == 'moe'
        assert m.name == 'my-model'

    def test_parse_unknown_model_error(self):
        with pytest.raises(ValueError):
            parse_model_config({'preset': 'no-such-model'})

    def test_parse_invalid_type(self):
        with pytest.raises(ValueError):
            parse_model_config({'preset': 'llama3-8b', 'model_type': 'quantum'})


class TestCommCalculator:
    def test_comm_ratio_baselines(self):
        # Dense 基线 0.20；MoE 基线 0.35 → fp8 ×1.25
        dense = parse_model_config({'preset': 'llama3-70b'})
        moe = parse_model_config({'preset': 'deepseek-v3'})
        assert calculate_comm(dense, {}, 128).comm_ratio == 0.20
        assert calculate_comm(moe, {}, 128).comm_ratio == pytest.approx(0.50, abs=0.001)

    def test_comm_alltoall_moe(self):
        moe = parse_model_config({'preset': 'deepseek-v3'})
        c = calculate_comm(moe, {'tp': 8}, 1024)
        assert c.alltoall_bytes > 0  # MoE 有 All-to-All
        assert c.total_bytes > 0

    def test_comm_p2p_pipeline(self):
        dense = parse_model_config({'preset': 'llama3-70b'})
        c = calculate_comm(dense, {'tp': 8, 'pp': 4}, 256)
        assert c.p2p_bytes > 0


class TestRecommend:
    def test_moe_deepseek_1024(self):
        r = recommend({'model': 'deepseek-v3', 'num_gpus': 1024})
        assert r['success'] is True
        rec = r['recommendation']
        # 规则 1: MoE 收敛比 ≤ 1.2
        assert rec['convergence_ratio'] <= 1.2
        # MoE 高敏感 → UEC + 800G
        assert rec['scale_out_protocol'] == 'UEC'
        assert rec['scale_out_speed'] == '800G'
        # 长上下文 + 大模型 → NVLink 72
        assert rec['scale_up_protocol'] == 'NVLink'
        assert rec['scale_up_domain'] == 72
        # 1024 GPU → 2-tier（>1024 才升级 3-tier）
        assert rec['tier_count'] == 2

    def test_estimated_marker(self):
        """V3.1.3-T7-5: 预估值标注（解析法，非实测）"""
        r = recommend({'model': 'llama3-70b', 'num_gpus': 512})
        assert r['estimated'] is True
        assert r['estimation']['accuracy'] == '±15-20%'
        assert r['estimation']['label'] == '预估值'
        # 前端可直接展示
        assert 'method' in r['estimation'] and 'note' in r['estimation']

    def test_dense_llama_economy(self):
        r = recommend({'model': 'llama3-70b', 'num_gpus': 512, 'budget': 'economy'})
        assert r['success'] is True
        rec = r['recommendation']
        assert rec['convergence_ratio'] <= 1.5
        assert rec['scale_out_protocol'] in ('IB', 'RoCE')
        assert rec['scale_out_speed'] == '400G'

    def test_large_scale_3tier(self):
        r = recommend({'model': 'llama3-405b', 'num_gpus': 2048})
        assert r['recommendation']['tier_count'] == 3

    def test_unknown_model_error(self):
        r = recommend({'model': 'no-such', 'num_gpus': 64})
        assert r['success'] is False
        assert '未知模型' in r['error']

    def test_zero_gpus_error(self):
        r = recommend({'model': 'llama3-8b', 'num_gpus': 0})
        assert r['success'] is False

    def test_notes_present(self):
        r = recommend({'model': 'deepseek-v3', 'num_gpus': 1024})
        assert len(r['notes']) >= 1
        assert any(n['level'] == 'info' for n in r['notes'])

    def test_custom_model(self):
        r = recommend({'model': 'custom-llm', 'model_type': 'dense', 'num_params': 50e9,
                       'hidden_size': 8192, 'num_layers': 48, 'num_gpus': 256})
        assert r['success'] is True
        assert r['model']['name'] == 'custom-llm'
