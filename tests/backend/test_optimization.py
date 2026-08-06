"""V3.2.0-T9-3: 批量优化测试（收敛比/成本/散热建议生成 + 批量应用闭环）

覆盖：
  - 建议结构化产出（category/title/description/patch/impact）
  - 三类建议触发（收敛比阻塞 / 小规模成本降档 / 散热匹配）
  - 批量应用：patch 合并 → 配置落盘 → 重新设计后指标改善（闭环）
  - action 注册 + cli.execute
"""
import json

import pytest

from project_config import create_default_config
from designer import NetworkDesignerV2
from optimization import suggest, apply


def _write(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _base_config(name="opt-test"):
    cfg = create_default_config(name)
    cfg['topology'].update({
        'downlink_mode': 'custom',
        'num_gpu_servers': 100,
        'num_all_flash_storage': 14,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 20,
        'param_protocol': 'IB',
        'param_speed': '800G',
        'param_ports_per_server': 8,
        'param_switch_ports': 64,
        'storage_switch_ports': 40,
        'storage_speed': '200G',
        'param_downlink_limit': 55,   # 参数网收敛比约 55:9 ≈ 6:1 → 阻塞
        'storage_downlink_limit': 30,
    })
    return cfg


def _convergence_blocking_config(tmp_path, **kw):
    cfg = _base_config()
    cfg['topology'].update(kw)
    return _write(tmp_path, cfg)


class TestSuggestStructure:
    def test_suggestion_schema(self):
        """建议条目结构化：category/title/description/patch/impact"""
        from optimization import _new_suggestion
        s = _new_suggestion('cost', '标题', '描述', {'topology': {'x': 1}}, '影响')
        assert s['category'] == 'cost'
        assert s['categoryLabel'] == '成本'
        assert s['title'] and s['description'] and s['impact']
        assert s['patch'] == {'topology': {'x': 1}}

    def test_suggest_returns_structured_list(self, tmp_path):
        path = _convergence_blocking_config(tmp_path)
        r = suggest({'configFile': str(path)})
        assert r['success'] is True
        assert isinstance(r['suggestions'], list)
        for s in r['suggestions']:
            assert set(s) >= {'category', 'categoryLabel', 'title', 'description', 'patch', 'impact'}
            assert isinstance(s['patch'], dict)
        assert r['total'] == len(r['suggestions'])
        assert r['counts'] == {'convergence': r['counts']['convergence'],
                               'cost': r['counts']['cost'], 'thermal': r['counts']['thermal']}

    def test_suggest_missing_file(self):
        r = suggest({'configFile': '/no/such/config.json'})
        assert r['success'] is False


class TestSuggestionRules:
    def test_convergence_blocking_suggestion(self, tmp_path):
        """参数网收敛比阻塞 → convergence 建议（降下联 或 提升交换机端口）"""
        path = _convergence_blocking_config(tmp_path)
        r = suggest({'configFile': str(path)})
        conv = [s for s in r['suggestions'] if s['category'] == 'convergence']
        assert conv, '应产出收敛比建议'
        assert '参数网' in conv[0]['title']
        patch = conv[0]['patch']['topology']
        # 两条路径之一：降低下联端口 或 提升交换机端口
        assert 'param_downlink_limit' in patch or 'param_switch_ports' in patch

    def test_cost_small_scale_downgrade(self, tmp_path):
        """小规模（8 GPU）IB+800G → 成本降档建议（RoCE/400G）"""
        cfg = _base_config()
        cfg['topology'].update({'num_gpu_servers': 8,
                                'num_compute_servers': 0,
                                'num_all_flash_storage': 0})
        path = _write(tmp_path, cfg)
        r = suggest({'configFile': str(path)})
        cost = [s for s in r['suggestions'] if s['category'] == 'cost']
        assert cost, '应产出成本建议'
        titles = ' '.join(s['title'] for s in cost)
        assert '协议降档' in titles and '速率降档' in titles

    def test_thermal_cooling_mismatch(self, tmp_path):
        """明确配置 immersion 而密度推荐风冷 → 散热一致性建议"""
        cfg = _base_config()
        cfg['rack_config']['cooling_method'] = 'immersion'
        path = _write(tmp_path, cfg)
        r = suggest({'configFile': str(path)})
        thermal = [s for s in r['suggestions'] if s['category'] == 'thermal']
        assert thermal, '应产出散热建议'
        assert '冷却方式' in thermal[0]['title']

    def test_thermal_power_limit(self, tmp_path):
        """机柜功率上限过低 → 功率上限调整建议"""
        cfg = _base_config()
        cfg['rack_config']['power_limit_per_rack'] = 100
        path = _write(tmp_path, cfg)
        r = suggest({'configFile': str(path)})
        thermal = [s for s in r['suggestions'] if s['category'] == 'thermal']
        assert any('功率上限' in s['title'] for s in thermal)


class TestApply:
    def test_apply_patch_updates_config(self, tmp_path):
        """批量应用：patch 合并 → 配置字段更新 + 宽松校验通过"""
        path = _convergence_blocking_config(tmp_path)
        r = suggest({'configFile': str(path)})
        selected = [s for s in r['suggestions'] if s['category'] == 'convergence'][:1]
        assert selected
        res = apply({'configFile': str(path), 'suggestions': selected})
        assert res['success'] is True
        assert res['applied']
        # patch 中的键已更新到配置
        patch_topo = selected[0]['patch']['topology']
        key = next(iter(patch_topo))
        assert res['config']['topology'][key] == patch_topo[key]
        # 落盘可重读
        import project_config
        reloaded, err = project_config.load_project_config(str(path))
        assert not err
        assert reloaded['topology'][key] == patch_topo[key]

    def test_apply_closure_improves_convergence(self, tmp_path):
        """闭环：suggest → apply → 重新设计 → 参数网收敛比达标（≤1）"""
        path = _convergence_blocking_config(tmp_path)
        r = suggest({'configFile': str(path)})
        selected = [s for s in r['suggestions'] if s['category'] == 'convergence'
                    and '参数网' in s['title']]
        assert selected
        res = apply({'configFile': str(path), 'suggestions': selected})
        assert res['success'] is True

        from estimation import calc_convergence_ratio
        from engine import _parse_speed_gbps
        d = NetworkDesignerV2(str(path))
        ul = max(d.param_switch_ports - d.param_dl, 0)
        cr = calc_convergence_ratio('param', d.param_dl, ul,
                                    _parse_speed_gbps(d.param_speed), d.param_leaf_count)
        assert cr.meets_target is True, f'应用后收敛比应达标，实际 {cr.convergence_ratio}:1'

    def test_apply_empty_suggestions(self, tmp_path):
        path = _convergence_blocking_config(tmp_path)
        res = apply({'configFile': str(path), 'suggestions': []})
        assert res['success'] is False
        assert 'suggestions' in res['error']


class TestActions:
    def test_optimize_actions_registered(self):
        from engine import list_registered_actions
        assert 'optimize:suggest' in list_registered_actions()
        assert 'optimize:apply' in list_registered_actions()

    def test_optimize_actions_execute(self, tmp_path):
        from cli import execute
        path = _convergence_blocking_config(tmp_path)
        r = execute('optimize:suggest', {'configFile': str(path)})
        assert r['success'] is True
        selected = [s for s in r['suggestions'] if s['category'] == 'convergence'][:1]
        if selected:
            res = execute('optimize:apply',
                          {'configFile': str(path), 'suggestions': selected})
            assert res['success'] is True
