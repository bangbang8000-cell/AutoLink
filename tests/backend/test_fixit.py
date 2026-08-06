"""V3.2.0-T9-4: 智能修复闭环测试（校验错误 → 修复 patch → 复核 → 一键应用）

覆盖：
  - repair_plan 结构化产出（fixes 含 rule_id/severity/message/recommendation/patch）
  - 各 rule_id 修复器（V002 机柜功率 / V007 Rail / V010 收敛比 / V016 网卡容量 /
    V018 Scale-Up 域 / V019 供电 / V020 ZCube）
  - repair_apply 应用 + 复核闭环（重新校验 → remainingErrors 下降）
  - action 注册 + cli.execute
"""
import json

import pytest

from project_config import create_default_config
from fixit import repair_apply, repair_plan


def _write(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _base_config(name="fixit-test"):
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
        'param_downlink_limit': 55,   # V010 参数网收敛比阻塞
        'storage_downlink_limit': 30,
    })
    return cfg


def _dirty_config(tmp_path):
    """多规则错误配置：V010 收敛比 + V002 机柜功率 + V019 供电"""
    cfg = _base_config()
    cfg['rack_config']['power_limit_per_rack'] = 100  # 触发 V002/V019
    return _write(tmp_path, cfg)


def _power_only_config(tmp_path):
    """仅功率错误（无收敛比阻塞）：V002 机柜功率 + V019 供电"""
    cfg = create_default_config("fixit-power")
    cfg['rack_config']['power_limit_per_rack'] = 100
    return _write(tmp_path, cfg)


class TestRepairPlan:
    def test_plan_structure(self, tmp_path):
        """repair_plan 结构化：fixes 条目含 rule_id/severity/message/recommendation/patch"""
        path = _dirty_config(tmp_path)
        r = repair_plan({'configFile': str(path)})
        assert r['success'] is True
        assert isinstance(r['fixes'], list)
        for fx in r['fixes']:
            assert set(fx) >= {'rule_id', 'severity', 'message',
                               'recommendation', 'patch'}
            assert fx['severity'] == 'error'
            assert isinstance(fx['patch'], dict)
        assert r['fixable'] == len(r['fixes'])
        assert r['totalErrors'] >= r['fixable']
        assert r['valid'] is False

    def test_plan_includes_convergence_fix(self, tmp_path):
        """V010 收敛比阻塞 → 产出 topology 下联/交换机端口 patch"""
        path = _dirty_config(tmp_path)
        r = repair_plan({'configFile': str(path)})
        v010 = [fx for fx in r['fixes'] if fx['rule_id'] == 'V010']
        assert v010, '应产出 V010 修复项'
        patch = v010[0]['patch']['topology']
        assert 'param_downlink_limit' in patch or 'param_switch_ports' in patch

    def test_plan_includes_power_fixes(self, tmp_path):
        """V002 机柜功率 + V019 供电 → rack_config.power_limit_per_rack patch"""
        path = _dirty_config(tmp_path)
        r = repair_plan({'configFile': str(path)})
        v002 = [fx for fx in r['fixes'] if fx['rule_id'] == 'V002']
        v019 = [fx for fx in r['fixes'] if fx['rule_id'] == 'V019']
        assert v002 and v019
        assert all('power_limit_per_rack' in fx['patch']['rack_config']
                   for fx in v002 + v019)

    def test_plan_missing_file(self):
        r = repair_plan({'configFile': '/no/such/config.json'})
        assert r['success'] is False

    def test_plan_clean_config_no_errors(self, tmp_path):
        """无 error 配置 → fixes 为空、valid True"""
        path = _write(tmp_path, create_default_config("fixit-clean"))
        r = repair_plan({'configFile': str(path)})
        assert r['success'] is True
        assert r['fixable'] == 0


class TestV007V018Rules:
    def test_v007_rail_fix(self, tmp_path):
        """V007 Rail 端口不匹配 → 修复项 param_ports_per_server = rail 数"""
        cfg = _base_config()
        cfg['topology']['rail_mode'] = 'rail_optimized'
        cfg['topology']['rail_count'] = 16
        cfg['topology']['param_ports_per_server'] = 8  # 8 ≠ 16 → V007
        path = _write(tmp_path, cfg)
        r = repair_plan({'configFile': str(path)})
        v007 = [fx for fx in r['fixes'] if fx['rule_id'] == 'V007']
        assert v007, 'rail 不匹配应产出 V007 修复项'
        assert v007[0]['patch']['topology']['param_ports_per_server'] == 16

    def test_v018_scaleup_domain_fix(self, tmp_path):
        """V018 Scale-Up 域超协议上限 → domain_size 降至上限"""
        cfg = _base_config()
        cfg['scale_up'] = {'protocol': 'UB', 'num_gpus': 768, 'domain_size': 768}
        path = _write(tmp_path, cfg)
        r = repair_plan({'configFile': str(path)})
        v018 = [fx for fx in r['fixes'] if fx['rule_id'] == 'V018']
        assert v018, '域规模超限应产出 V018 修复项'
        assert v018[0]['patch']['scale_up']['domain_size'] == 384


class TestFixers:
    """修复器单元（合成 issue/config 输入，隔离全管线依赖）"""

    def test_fix_v002_rounds_up_to_1000w(self):
        from fixit import _fix_v002
        issue = {'message': '机柜 机柜1 功率 8500W 超过机柜上限 6000W'}
        cfg = {'rack_config': {'power_limit_per_rack': 6000}}
        assert _fix_v002(issue, cfg) == {'rack_config': {'power_limit_per_rack': 9000}}

    def test_fix_v002_no_op_when_within_limit(self):
        from fixit import _fix_v002
        issue = {'message': '机柜 机柜1 功率 5000W 超过机柜上限 6000W'}
        assert _fix_v002(issue, {'rack_config': {'power_limit_per_rack': 6000}}) is None

    def test_fix_v007_alignment(self):
        from fixit import _fix_v007
        cfg = {'topology': {'rail_count': 8, 'param_ports_per_server': 4}}
        assert _fix_v007({}, cfg) == {'topology': {'param_ports_per_server': 8}}

    def test_fix_v007_already_aligned(self):
        from fixit import _fix_v007
        cfg = {'topology': {'rail_count': 8, 'param_ports_per_server': 8}}
        assert _fix_v007({}, cfg) is None

    def test_fix_v016_standard_raises_downlink(self):
        """V016 传统四网：提升下联端口至容量必需值"""
        from fixit import _fix_v016
        cfg = {'topology': {'num_gpu_servers': 100, 'param_ports_per_server': 8,
                            'param_switch_ports': 64}}
        designer = type('D', (), {'param_leaf_count': 16})()
        assert _fix_v016({}, cfg, designer) == \
            {'topology': {'param_downlink_limit': 50}}  # ceil(800/16)

    def test_fix_v016_zcube_raises_switch_ports(self):
        from fixit import _fix_v016
        cfg = {'topology': {'param_network_mode': 'zcube',
                            'param_zcube': {'switch_ports': 144}}}
        assert _fix_v016({}, cfg, None) == \
            {'topology': {'param_zcube': {'switch_ports': 288}}}

    def test_fix_v018_lower_domain_size(self):
        from fixit import _fix_v018
        issue = {'message': 'Scale-Up 域规模 768 超过 UB 协议上限 384'}
        cfg = {'scale_up': {'domain_size': 768}}
        assert _fix_v018(issue, cfg) == {'scale_up': {'domain_size': 384}}

    def test_fix_v019_allocates_to_cabinets(self):
        from fixit import _fix_v019
        issue = {'message': '整机房总功率 40000W 超过供电容量 100W'}
        cfg = {'topology': {'num_gpu_servers': 4}, 'rack_config': {}}
        assert _fix_v019(issue, cfg) == \
            {'rack_config': {'power_limit_per_rack': 10000}}

    def test_fix_v020_raises_switch_ports(self):
        from fixit import _fix_v020
        cfg = {'topology': {'param_zcube': {'switch_ports': 144}}}
        assert _fix_v020({}, cfg) == \
            {'topology': {'param_zcube': {'switch_ports': 288}}}

    def test_fix_v010_reuses_convergence_logic(self, tmp_path):
        """V010 修复器复用 T9-3 收敛比建议（降下联/提升交换机端口）"""
        from designer import NetworkDesignerV2
        from fixit import _fix_v010
        path = _dirty_config(tmp_path)
        designer = NetworkDesignerV2(str(path))
        from project_config import load_project_config
        config, _ = load_project_config(str(path))
        patch = _fix_v010({'rule_id': 'V010'}, config, designer)
        assert patch is not None
        assert ('param_downlink_limit' in patch['topology']
                or 'param_switch_ports' in patch['topology'])


class TestRepairApply:
    def test_apply_updates_config_file(self, tmp_path):
        """应用 V010 修复 → patch 字段落盘"""
        path = _dirty_config(tmp_path)
        plan = repair_plan({'configFile': str(path)})
        v010 = [fx for fx in plan['fixes'] if fx['rule_id'] == 'V010']
        assert v010
        res = repair_apply({'configFile': str(path), 'fixes': v010})
        assert res['success'] is True
        assert res['applied']
        key = next(iter(v010[0]['patch']['topology']))
        assert res['validation'] is not None
        # 落盘可重读
        import project_config
        reloaded, err = project_config.load_project_config(str(path))
        assert not err
        assert reloaded['topology'][key] == v010[0]['patch']['topology'][key]

    def test_apply_closure_reduces_errors(self, tmp_path):
        """闭环：repair_plan → 应用全部修复 → 复核 remainingErrors 下降、V010 消除"""
        path = _dirty_config(tmp_path)
        plan = repair_plan({'configFile': str(path)})
        total_before = plan['totalErrors']
        assert total_before > 0
        res = repair_apply({'configFile': str(path), 'fixes': plan['fixes']})
        assert res['success'] is True
        review = res['validation']
        assert review['remainingErrors'] < total_before
        assert not any(i['rule_id'] == 'V010' for i in review['issues'])

    def test_apply_power_closure_clears_v002_v019(self, tmp_path):
        """功率闭环：V002 机柜功率 + V019 供电修复应用后复核 valid"""
        path = _power_only_config(tmp_path)
        plan = repair_plan({'configFile': str(path)})
        power_fixes = [fx for fx in plan['fixes']
                       if fx['rule_id'] in ('V002', 'V019')]
        assert power_fixes
        res = repair_apply({'configFile': str(path), 'fixes': power_fixes})
        review = res['validation']
        assert review['remainingErrors'] == 0
        assert review['valid'] is True

    def test_apply_empty_fixes(self, tmp_path):
        path = _dirty_config(tmp_path)
        res = repair_apply({'configFile': str(path), 'fixes': []})
        assert res['success'] is False
        assert 'fixes' in res['error']


class TestActions:
    def test_repair_actions_registered(self):
        from engine import list_registered_actions
        actions = list_registered_actions()
        assert 'repair:plan' in actions
        assert 'repair:apply' in actions

    def test_repair_actions_execute(self, tmp_path):
        """cli.execute 统一入口执行 repair:plan / repair:apply"""
        from cli import execute
        path = _dirty_config(tmp_path)
        r = execute('repair:plan', {'configFile': str(path)})
        assert r['success'] is True
        assert r['fixable'] > 0
        res = execute('repair:apply',
                      {'configFile': str(path), 'fixes': r['fixes'][:1]})
        assert res['success'] is True
        assert res['validation'] is not None
