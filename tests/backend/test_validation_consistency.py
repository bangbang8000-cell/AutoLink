"""4.5 D-1 一致性校验引擎测试（F5-1：规划↔设计 / 设计内部 / 设计→渲染）"""
import pytest

from validation_engine import (
    check_plan_design_consistency, check_design_internal_consistency,
    check_render_consistency, run_consistency_checks,
)


def _plan(gpu=64, roles=None):
    """构造最小 plan:table"""
    roles = roles or {'SPINE': 2, 'LEAF': 8}
    return {
        'meta': {'planHash': 'x', 'planVersion': 1},
        'macro': {'gpuCount': gpu, 'gpu_count': gpu},
        'topology': {'scale': {'gpuCount': gpu}},
        'deviceList': [
            {'role': role, 'name': f'{role}_{i}'}
            for role, n in roles.items() for i in range(1, n + 1)
        ],
        'connections': [], 'terminals': [],
    }


def _design(servers=64, nets=None, cabinets=None, unplaced=None, connections=None, mode='full'):
    nets = nets or {'param_leaves': 8, 'param_spines': 2}
    return {
        'servers': servers,
        'total_servers': servers,
        'mode': mode,
        'network_devices': nets,
        'cabinets': cabinets or [],
        'unplaced_devices': unplaced or [],
        'connections': connections or [],
    }


def _cabinet(name='C1', devices=(), total_u=42, power_limit=0):
    return {'name': name, 'total_u': total_u, 'power_limit': power_limit,
            'devices': [dict(dev) for dev in devices]}


class TestPlanDesignConsistency:
    """D-1.1 规划 ↔ 设计一致性（C001/C002）"""

    def test_matching_gpu_count_no_problem(self):
        issues = check_plan_design_consistency(_plan(64), _design(64))
        assert [i.rule_id for i in issues] == []

    def test_gpu_count_mismatch_c001(self):
        issues = check_plan_design_consistency(_plan(64), _design(128))
        c001 = [i for i in issues if i.rule_id == 'C001']
        assert len(c001) == 1
        assert c001[0].severity == 'error'
        assert '64' in c001[0].message and '128' in c001[0].message

    def test_network_device_count_mismatch_c002(self):
        plan = _plan(64, roles={'SPINE': 2, 'LEAF': 8})
        design = _design(64, nets={'param_leaves': 16, 'param_spines': 2})
        issues = check_plan_design_consistency(plan, design)
        c002 = [i for i in issues if i.rule_id == 'C002' and 'param_leaves' in i.location]
        assert len(c002) == 1
        assert c002[0].severity == 'error'
        assert '8' in c002[0].message and '16' in c002[0].message

    def test_missing_side_does_not_report(self):
        # 设计无网络设备数据时不误报
        issues = check_plan_design_consistency(_plan(64), {'servers': 64})
        assert issues == []


class TestDesignInternalConsistency:
    """D-1.2 设计内部一致性（C010-C015）"""

    def test_u_position_conflict_c010(self):
        cab = _cabinet('C1', [
            {'name': 'A', 'start_u': 1, 'end_u': 10},
            {'name': 'B', 'start_u': 8, 'end_u': 20},
        ])
        issues = check_design_internal_consistency(_design(cabinets=[cab]))
        c010 = [i for i in issues if i.rule_id == 'C010']
        assert len(c010) == 1
        assert c010[0].severity == 'error'

    def test_no_conflict_when_adjacent(self):
        cab = _cabinet('C1', [
            {'name': 'A', 'start_u': 1, 'end_u': 10},
            {'name': 'B', 'start_u': 11, 'end_u': 20},
        ])
        issues = check_design_internal_consistency(_design(cabinets=[cab]))
        assert not [i for i in issues if i.rule_id == 'C010']

    def test_u_out_of_range_c011(self):
        cab = _cabinet('C1', [{'name': 'A', 'start_u': 40, 'end_u': 50}], total_u=42)
        issues = check_design_internal_consistency(_design(cabinets=[cab]))
        c011 = [i for i in issues if i.rule_id == 'C011']
        assert len(c011) == 1
        assert c011[0].severity == 'error'

    def test_power_over_limit_c012(self):
        cab = _cabinet('C1', [
            {'name': 'A', 'power_watts': 4000},
            {'name': 'B', 'power_watts': 3000},
        ], power_limit=6000)
        issues = check_design_internal_consistency(_design(cabinets=[cab]))
        c012 = [i for i in issues if i.rule_id == 'C012']
        assert len(c012) == 1
        assert '7000' in c012[0].message

    def test_unplaced_devices_c013(self):
        issues = check_design_internal_consistency(
            _design(unplaced=[{'name': 'GPU_9', 'height': 4}]))
        c013 = [i for i in issues if i.rule_id == 'C013']
        assert len(c013) == 1
        assert c013[0].severity == 'warning'

    def test_missing_model_c014(self):
        cab = _cabinet('C1', [{'name': 'A', 'start_u': 1, 'end_u': 4, 'model': ''}])
        issues = check_design_internal_consistency(_design(cabinets=[cab]))
        c014 = [i for i in issues if i.rule_id == 'C014']
        assert len(c014) == 1
        assert c014[0].severity == 'info'

    def test_dangling_endpoint_c015(self):
        issues = check_design_internal_consistency(_design(connections=[
            {'source': 'GPU_1', 'target': '不存在的Leaf_9'},
        ]))
        c015 = [i for i in issues if i.rule_id == 'C015']
        assert len(c015) == 1
        assert c015[0].severity == 'error'


class TestRenderConsistency:
    """D-1.3 设计 → 渲染产物结构一致性（C020-C023）"""

    def test_missing_render_fields_c020(self):
        issues = check_render_consistency(_design(), {'connections': 10})
        c020 = [i for i in issues if i.rule_id == 'C020']
        assert len(c020) == 1
        assert 'file_names' in c020[0].message

    def test_connection_count_mismatch_c021(self):
        design = _design(connections=[{'source': 'a', 'target': 'b'}] * 10)
        issues = check_render_consistency(design, {'connections': 8, 'file_names': []})
        c021 = [i for i in issues if i.rule_id == 'C021']
        assert len(c021) == 1
        assert c021[0].severity == 'error'

    def test_zero_connection_warns_c021(self):
        issues = check_render_consistency(_design(servers=64), {'connections': 0, 'file_names': []})
        c021 = [i for i in issues if i.rule_id == 'C021']
        assert len(c021) == 1
        assert c021[0].severity == 'warning'

    def test_empty_device_list_c022(self):
        design = _design(nets={'param_leaves': 8, 'param_spines': 2})
        issues = check_render_consistency(design, {'connections': 10, 'file_names': [],
                                                   'device_list_entries': 0})
        c022 = [i for i in issues if i.rule_id == 'C022']
        assert len(c022) == 1
        assert c022[0].severity == 'error'

    def test_mode_mismatch_c023(self):
        issues = check_render_consistency(
            _design(mode='full'), {'connections': 10, 'file_names': [], 'mode': 'custom'})
        c023 = [i for i in issues if i.rule_id == 'C023']
        assert len(c023) == 1
        assert c023[0].severity == 'error'

    def test_filename_mode_mismatch_c023_warning(self):
        issues = check_render_consistency(
            _design(mode='full'),
            {'connections': 10, 'file_names': ['AI智算网络_custom模式_1.xlsx'], 'mode': 'full'})
        c023 = [i for i in issues if i.rule_id == 'C023']
        assert len(c023) == 1
        assert c023[0].severity == 'warning'


class TestRunConsistencyChecks:
    """D-1.4 组合执行"""

    def test_combines_all_dimensions(self):
        plan = _plan(64)
        design = _design(128)  # C001
        design['connections'] = [{'source': 'a', 'target': 'b'}] * 5
        render = {'connections': 3, 'file_names': [], 'mode': 'full'}  # C021
        issues = run_consistency_checks(plan, design, render)
        rule_ids = {i.rule_id for i in issues}
        assert 'C001' in rule_ids
        assert 'C021' in rule_ids

    def test_missing_inputs_is_safe(self):
        assert run_consistency_checks(None, None, None) == []
