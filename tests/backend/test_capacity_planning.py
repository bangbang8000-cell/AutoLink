"""V3.1.3-T7-4: 容量规划内核测试（presets/解析/通信/拓扑推荐/规则）
V3.2.0-T9-1: FP8 精确计算 / Pipeline 显存 / TCO 成本 / 自定义档案
"""
import json

import pytest

from capacity_planning import (
    recommend, get_presets, parse_model_config, calculate_comm, calculate_comm_exact,
    estimate_pipeline_memory, estimate_tco, recommend_topology, register_preset,
    load_user_presets,
)
from capacity_planning.presets import MODEL_PRESETS, resolve_preset


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


class TestDomesticPresets:
    """V3.2.0-T9-5: 国产场景档案（昇腾 910B/910C、寒武纪、海光、昆仑芯）"""

    DOMESTIC_IDS = {
        'ascend-910b-llama2-70b', 'ascend-910c-llama3-70b',
        'cambricon-mlu590-llama2-70b', 'hygon-dcu1-qwen2-72b',
        'kunlunxin-p800-llama2-70b',
    }

    def test_total_presets_ge_16(self):
        """内置档案 12 + 国产 5 → ≥16"""
        assert len(MODEL_PRESETS) >= 16

    def test_domestic_presets_ge_4(self):
        """国产场景档案 ≥4"""
        domestic = [p for p in get_presets() if p.get('source') == '国产']
        assert len(domestic) >= 4

    def test_domestic_ids_present(self):
        """昇腾 910B/910C、寒武纪、海光、昆仑芯档案均可解析"""
        for pid in self.DOMESTIC_IDS:
            assert pid in MODEL_PRESETS, f'缺少国产档案 {pid}'
            assert resolve_preset(pid) is not None

    def test_list_presets_with_source_label(self):
        """capacity:list-presets 返回带来源标注 + 国产数统计"""
        from engine import list_registered_actions
        assert 'capacity:list-presets' in list_registered_actions()
        from cli import execute
        r = execute('capacity:list-presets', {})
        assert r['total'] >= 16
        assert r['domesticCount'] >= 4
        for p in r['presets']:
            assert p['source'] in ('内置', '国产')
        domestic = [p for p in r['presets'] if p['source'] == '国产']
        assert all(p['vendor'] for p in domestic), '国产档案应带芯片厂商标注'

    def test_domestic_preset_recommendable(self):
        """国产档案可被容量推荐引用（recommend 全链路成功）"""
        for pid in self.DOMESTIC_IDS:
            r = recommend({'model': pid, 'num_gpus': 128})
            assert r['success'] is True, f'{pid} 推荐失败: {r.get("error")}'
            assert r['model']['name'] == MODEL_PRESETS[pid]['name']

    def test_domestic_resolve_shortname(self):
        """国产档案支持名称模糊匹配"""
        m = resolve_preset('昇腾 910B')
        assert m is not None and m['vendor'] == '华为昇腾'


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


# ================================================================
# V3.2.0-T9-1: FP8 精确计算 / Pipeline / TCO / 自定义档案
# ================================================================

class TestExactComm:
    def test_exact_fp8_grad_bpp(self):
        moe = parse_model_config({'preset': 'deepseek-v3'})
        e = calculate_comm_exact(moe, {'tp': 8}, 1024)
        assert e.grad_bpp == 1  # FP8 梯度 1B/参数
        assert e.total_bytes > 0
        assert e.comm_ratio > 0

    def test_exact_error_within_budget(self):
        """精确版与解析法对照误差 < 15%（Ring 系数 2*(N-1)/N 引入差异）"""
        dense = parse_model_config({'preset': 'llama3-70b'})
        e = calculate_comm_exact(dense, {'tp': 8}, 256)
        assert e.analytic_error_pct < 15.0

    def test_exact_ring_factor(self):
        """Ring 精确系数：tp=1 时 2*(N-1)/N 与解析法 2 差异最大（N 小）"""
        dense = parse_model_config({'preset': 'llama3-8b'})
        e1 = calculate_comm_exact(dense, {'tp': 2}, 8)
        e2 = calculate_comm_exact(dense, {'tp': 16}, 256)
        assert e1.analytic_error_pct > e2.analytic_error_pct

    def test_exact_memory_struct(self):
        dense = parse_model_config({'preset': 'llama3-70b'})
        e = calculate_comm_exact(dense, {'tp': 8, 'pp': 4}, 256)
        d = e.to_dict()
        assert d['memory_gib'] > 0
        assert d['pipeline_peak_gib'] > 0
        assert 'analytic_error_pct' in d and 'grad_bpp' in d


class TestPipeline:
    def test_pipeline_stage_split(self):
        dense = parse_model_config({'preset': 'llama3-70b'})
        p = estimate_pipeline_memory(dense, {'tp': 8, 'pp': 4}, 256)
        assert p['pp_size'] == 4
        assert p['stages'] == 4
        assert p['params_per_stage_b'] == pytest.approx(17.5, rel=0.01)  # 70/4
        assert p['peak_per_stage_gib'] > 0

    def test_pipeline_pp1_single_stage(self):
        dense = parse_model_config({'preset': 'llama3-70b'})
        p = estimate_pipeline_memory(dense, {'tp': 8}, 256)
        assert p['stages'] == 1
        assert p['params_per_stage_b'] == pytest.approx(70, rel=0.01)


class TestCost:
    def test_tco_structure(self):
        dense = parse_model_config({'preset': 'llama3-70b'})
        comm = calculate_comm(dense, {}, 512)
        rec = recommend_topology(dense, comm, 512, 'standard')
        cost = estimate_tco(dense, comm, rec, 512)
        assert cost['total_usd'] > 0
        assert cost['hardware']['switches'] > 0
        assert cost['hardware']['nic'] == 512 * 2
        assert cost['power']['kwh_per_year'] > 0
        assert cost['space']['racks'] > 0
        # 分项 = 硬件 + 电力 + 空间
        assert (cost['hardware']['subtotal_usd'] + cost['power']['subtotal_usd']
                + cost['space']['subtotal_usd']) == pytest.approx(cost['total_usd'])
        assert len(cost['breakdown']) >= 4

    def test_tco_cost_params_override(self):
        dense = parse_model_config({'preset': 'llama3-70b'})
        comm = calculate_comm(dense, {}, 512)
        rec = recommend_topology(dense, comm, 512, 'standard')
        cost = estimate_tco(dense, comm, rec, 512, {'gpu_watts': 1000, 'years': 5})
        assert cost['power']['kwh_per_year'] > 0
        # 功耗提高 → 电费提升（相对默认 700W）
        base = estimate_tco(dense, comm, rec, 512)
        assert cost['power']['subtotal_usd'] > base['power']['subtotal_usd']


class TestCustomPreset:
    def test_register_and_resolve(self):
        key = register_preset('my-llm', {'name': 'My LLM 40B', 'model_type': 'dense',
                                         'num_params': 40e9, 'hidden_size': 8192,
                                         'num_layers': 48})
        assert key == 'my-llm'
        assert MODEL_PRESETS['my-llm']['num_params'] == 40e9
        assert resolve_preset('my-llm') is not None

    def test_register_normalizes_key(self):
        key = register_preset('My Model', {'num_params': 10e9, 'hidden_size': 4096,
                                           'num_layers': 32})
        assert key == 'my-model'
        assert 'my-model' in MODEL_PRESETS

    def test_register_missing_fields_rejected(self):
        with pytest.raises(ValueError):
            register_preset('bad', {'num_params': 1e9})

    def test_load_user_presets_from_file(self, tmp_path):
        f = tmp_path / 'capacity_presets.json'
        f.write_text(json.dumps({
            'ascend-910b': {'name': 'Ascend 910B', 'model_type': 'dense',
                            'num_params': 30e9, 'hidden_size': 6144, 'num_layers': 40},
            'broken': {'num_params': 1e9},  # 缺字段 → 跳过
        }), encoding='utf-8')
        n = load_user_presets(str(f))
        assert n == 1
        assert MODEL_PRESETS['ascend-910b']['name'] == 'Ascend 910B'

    def test_load_missing_file_returns_zero(self, tmp_path):
        assert load_user_presets(str(tmp_path / 'no.json')) == 0

    def test_recommend_uses_custom_preset(self, tmp_path):
        f = tmp_path / 'capacity_presets.json'
        f.write_text(json.dumps({
            'ascend-910c': {'name': 'Ascend 910C', 'model_type': 'dense',
                            'num_params': 40e9, 'hidden_size': 8192, 'num_layers': 56},
        }), encoding='utf-8')
        load_user_presets(str(f))
        r = recommend({'model': 'ascend-910c', 'num_gpus': 256})
        assert r['success'] is True
        assert r['model']['name'] == 'Ascend 910C'


class TestRecommendV2:
    def test_recommend_returns_exact_pipeline_cost(self):
        r = recommend({'model': 'deepseek-v3', 'num_gpus': 1024, 'pp': 4})
        assert r['success'] is True
        assert 'exact' in r and 'analytic_error_pct' in r['exact']
        assert 'pipeline' in r and r['pipeline']['stages'] == 4
        assert 'cost' in r and r['cost']['total_usd'] > 0
        # 既有字段不回归
        assert r['estimated'] is True
        assert 'recommendation' in r and 'comm' in r
