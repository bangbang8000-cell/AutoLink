"""V3.2.0-T9-3: 批量优化测试（收敛比/成本/散热建议生成 + 批量应用闭环）

覆盖：
  - 建议结构化产出（category/title/description/patch/impact）
  - 三类建议触发（收敛比阻塞 / 小规模成本降档 / 散热匹配）
  - 批量应用：patch 合并 → 配置落盘 → 重新设计后指标改善（闭环）
  - action 注册 + cli.execute

收敛比建议的现状（5.2.x）：
  V5.0.11 起 `designer._resolve_downlink_limits` 把 custom 模式的下联口数钳制到
  `switch_ports // 2`（保证至少留一半上联口），Leaf 收敛比因此恒 ≤ 1:1。参数网目标
  即 1.0（无阻塞）、存储网目标 2.0，故端到端 `suggest()` **不再**产出 convergence
  类建议（规则在端到端不可达）：
    - 端到端不可达性由 TestSuggestionRules::test_convergence_rule_inactive_* 固化；
    - `optimization._convergence_suggestions` 的规则逻辑本身仍由
      TestConvergenceRuleLogic 以「未钳制」的 duck-typed designer 直接覆盖，
      避免该规则退化为无测试的死代码。
  若产品要恢复端到端收敛比建议，需先放开钳制、或在规则内改用「配置意图值」
  （topology.param_downlink_limit）而非 designer 的钳制值。
"""
import json
import types

import pytest

from project_config import create_default_config
from designer import NetworkDesignerV2
from optimization import suggest, apply, _convergence_suggestions


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
        # 配置意图是 55 口下联（≈6:1 阻塞），但 V5.0.11 起 designer 会把它钳制到
        # param_switch_ports // 2 = 32（至少留一半上联口）→ 端到端恒 1:1 无阻塞。
        'param_downlink_limit': 55,
        'storage_downlink_limit': 30,
    })
    return cfg


def _custom_downlink_config(tmp_path, **kw):
    """自定义下联上限配置（原 _convergence_blocking_config）

    注意：受 V5.0.11 下联钳制影响，该配置在端到端 `suggest()` 中**不会**触发
    收敛比建议；用于建议结构化 / 成本 / 散热 / 应用闭环等通用场景。
    """
    cfg = _base_config()
    cfg['topology'].update(kw)
    return _write(tmp_path, cfg)


def _low_power_limit_config(tmp_path):
    """机柜功率上限过低（100W）→ 必定产出 thermal「机柜功率上限调整」建议"""
    cfg = _base_config()
    cfg['rack_config']['power_limit_per_rack'] = 100
    return _write(tmp_path, cfg)


def _thermal_power_suggestions(result):
    """从 suggest() 结果中取出「机柜功率上限」类建议"""
    return [s for s in result['suggestions']
            if s['category'] == 'thermal'
            and 'power_limit_per_rack' in (s['patch'].get('rack_config') or {})]


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
        path = _low_power_limit_config(tmp_path)
        r = suggest({'configFile': str(path)})
        assert r['success'] is True
        assert isinstance(r['suggestions'], list)
        assert r['total'] >= 1, '低功率上限配置应至少产出 1 条建议'
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
    def test_convergence_rule_inactive_under_clamped_downlink(self, tmp_path):
        """V5.0.11 下联钳制 → 参数/存储网恒 ≤1:1，端到端不再产出收敛比建议

        配置声明 `param_downlink_limit=55`，但 `designer._resolve_downlink_limits`
        将其钳制到 `param_switch_ports // 2 = 32`（保证至少留一半上联口）：
            收敛比 = 32 / (64 - 32) = 1.0 ≤ 参数网目标 1.0 → 规则不可达
        存储网同理（40 口 → 下联 20 / 上联 20 = 1.0 ≤ 目标 2.0）。

        本用例固化该现状（与 test_fixit 的 V010 不可达用例同源）；规则逻辑本身由
        TestConvergenceRuleLogic 直接覆盖，避免退化为无测试的死代码。
        """
        path = _custom_downlink_config(tmp_path)
        r = suggest({'configFile': str(path)})
        assert r['success'] is True
        assert [s for s in r['suggestions'] if s['category'] == 'convergence'] == []

        # 固化钳制事实本身：下联被压到 switch_ports // 2
        d = NetworkDesignerV2(str(path))
        assert d.param_dl == d.param_switch_ports // 2
        assert d.storage_dl == d.storage_switch_ports // 2

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
        path = _low_power_limit_config(tmp_path)
        r = suggest({'configFile': str(path)})
        thermal = [s for s in r['suggestions'] if s['category'] == 'thermal']
        assert any('功率上限' in s['title'] for s in thermal)


class TestConvergenceRuleLogic:
    """直接覆盖 `optimization._convergence_suggestions` 的规则逻辑（绕过 designer 钳制）

    端到端路径因下联钳制恒为无阻塞（见 TestSuggestionRules），若只保留端到端断言，
    该规则会退化为无测试的死代码。此处用 duck-typed designer 喂入「未钳制」的
    下联/端口组合，验证两条修复路径仍然正确：
      A. 容量允许 → 降低 Leaf 下联端口数；
      B. 容量约束（下联已是最低必需）→ 提升交换机端口数。
    """

    @staticmethod
    def _fake_designer(**over):
        base = dict(
            param_network_mode='standard',
            param_leaf_count=128, param_dl=55, param_switch_ports=64,
            param_speed='400G',
            storage_leaf_count=0, storage_dl=0, storage_switch_ports=0,
            storage_speed='200G',
            num_servers=100, total_servers=100,
            param_ports_per_server=8, storage_ports_per_server=1,
        )
        base.update(over)
        return types.SimpleNamespace(**base)

    def test_path_a_lower_downlink(self):
        """容量允许（min_dl < 上联口）→ 建议降低下联端口至目标收敛比"""
        d = self._fake_designer(param_dl=55, param_switch_ports=64, param_leaf_count=128)
        out = _convergence_suggestions(d, {})
        assert len(out) == 1
        s = out[0]
        assert s['category'] == 'convergence'
        assert '参数网' in s['title']
        # 55 口下联 / 9 口上联 = 6.11:1 → 降至 9 口下联即 1:1
        assert s['patch']['topology']['param_downlink_limit'] == 9

    def test_path_b_raise_switch_ports(self):
        """容量约束（下联已是最低必需）→ 建议提升交换机端口以增大上行带宽"""
        d = self._fake_designer(param_dl=56, param_switch_ports=64, param_leaf_count=100)
        out = _convergence_suggestions(d, {})
        assert len(out) == 1
        s = out[0]
        assert '参数网' in s['title']
        assert '提升交换机端口' in s['title']
        # ceil(56 * (1 + 1/1.0)) = 112 → 上取整到常用档位 128
        assert s['patch']['topology']['param_switch_ports'] == 128

    def test_storage_network_blocking(self):
        """存储网目标 2:1 → 超过目标时同样产出建议（30 下联 / 10 上联 = 3:1）"""
        d = self._fake_designer(
            param_leaf_count=0,
            storage_leaf_count=8, storage_dl=30, storage_switch_ports=40,
            total_servers=14)
        out = _convergence_suggestions(d, {})
        assert len(out) == 1
        assert '存储网' in out[0]['title']
        assert out[0]['patch']['topology']['storage_downlink_limit'] == 20

    def test_no_suggestion_when_meets_target(self):
        """达标（≤ 目标收敛比）→ 不产出建议"""
        d = self._fake_designer(param_dl=32, param_switch_ports=64, param_leaf_count=32)
        assert _convergence_suggestions(d, {}) == []


class TestApply:
    def test_apply_patch_updates_config(self, tmp_path):
        """批量应用：patch 合并 → 配置字段更新 + 宽松校验通过 + 落盘可重读

        原用例以 convergence 建议为例；V5.0.11 下联钳制后该类别端到端不再产出
        （见 TestSuggestionRules::test_convergence_rule_inactive_under_clamped_downlink），
        故改用同属可应用的 thermal「机柜功率上限调整」建议验证同一条链路。
        """
        path = _low_power_limit_config(tmp_path)
        r = suggest({'configFile': str(path)})
        selected = _thermal_power_suggestions(r)[:1]
        assert selected
        res = apply({'configFile': str(path), 'suggestions': selected})
        assert res['success'] is True
        assert res['applied']
        # patch 中的键已更新到配置
        patch_rack = selected[0]['patch']['rack_config']
        key = next(iter(patch_rack))
        assert res['config']['rack_config'][key] == patch_rack[key]
        # 落盘可重读
        import project_config
        reloaded, err = project_config.load_project_config(str(path))
        assert not err
        assert reloaded['rack_config'][key] == patch_rack[key]

    def test_apply_closure_raises_power_limit(self, tmp_path):
        """闭环：suggest → apply → 重新设计 → 机柜功率上限覆盖实测密度

        原用例验证「应用收敛比建议 → 收敛比达标」；V5.0.11 下联钳制后收敛比建议
        端到端不可达，改为验证可达的 thermal 闭环：
        应用功率上限建议后，designer 读回的新上限应 ≥ 实测平均机柜功率（消除过载）。
        """
        path = _low_power_limit_config(tmp_path)
        r = suggest({'configFile': str(path)})
        selected = _thermal_power_suggestions(r)
        assert selected
        new_limit = selected[0]['patch']['rack_config']['power_limit_per_rack']
        res = apply({'configFile': str(path), 'suggestions': selected})
        assert res['success'] is True

        from estimation import estimate_cabinet_power_density
        d = NetworkDesignerV2(str(path))
        assert d.power_limit_per_rack == new_limit, '新上限应落盘并被 designer 读回'

        all_switches = (getattr(d, 'param_leaves', []) + getattr(d, 'param_spines', [])
                        + getattr(d, 'storage_leaves', []) + getattr(d, 'storage_spines', [])
                        + getattr(d, 'oob_access', []) + getattr(d, 'oob_agg', [])
                        + getattr(d, 'biz_access', []) + getattr(d, 'biz_agg', []))
        it_power_w = (sum(s.power_watts or 0 for s in d.servers)
                      + sum(sw.power_watts or 0 for sw in all_switches))
        density = estimate_cabinet_power_density(it_power_w / 1000.0, max(1, d.num_servers))
        assert density['power_per_cabinet_w'] <= d.power_limit_per_rack, \
            f"应用后功率上限应覆盖实测密度，实际 {density['power_per_cabinet_w']}W > {d.power_limit_per_rack}W"

    def test_apply_empty_suggestions(self, tmp_path):
        path = _custom_downlink_config(tmp_path)
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
        path = _low_power_limit_config(tmp_path)
        r = execute('optimize:suggest', {'configFile': str(path)})
        assert r['success'] is True
        selected = [s for s in r['suggestions'] if s['category'] == 'thermal'][:1]
        assert selected, '低功率上限配置应产出可应用的散热建议'
        res = execute('optimize:apply',
                      {'configFile': str(path), 'suggestions': selected})
        assert res['success'] is True
