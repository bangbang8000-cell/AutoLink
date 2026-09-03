"""5.0.1-501-b: 模板库门禁强化测试（rack_config 完整性 / 协议兼容性 / 参数合理性）

覆盖 backend/template_gate.py：
  - rack_config 完整性（cooling_method/gpu_dedicated 强制，合法枚举/布尔）
  - 协议兼容性（IB → IB 交换机；RoCE/UEC → 非 IB 专用交换机）
  - 参数合理性（param_speed 匹配、plan.json macro PFC/CNP/收敛比/rails）
  - 聚合 check_template_config 对 23 套内置模板全部通过
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

import pytest  # noqa: E402

from template_gate import (  # noqa: E402
    check_parameter_reasonableness,
    check_protocol_compatibility,
    check_rack_config_complete,
    check_template_config,
)
from project_config import create_default_config  # noqa: E402
from device_library import get_device_library  # noqa: E402

TEMPLATE_BASE = os.path.join(os.path.dirname(__file__), '..', '..', 'template')

VALID_COOLING = ('air', 'cold_plate', 'immersion')


def _config(**rack_extra):
    cfg = create_default_config('gate')
    cfg['rack_config'].update({'cooling_method': 'air', 'gpu_dedicated': True})
    cfg['rack_config'].update(rack_extra)
    return cfg


def _all_templates():
    """自动发现含 project_config.json 的模板目录"""
    for name in sorted(os.listdir(TEMPLATE_BASE)):
        tpl_dir = os.path.join(TEMPLATE_BASE, name)
        cfg_path = os.path.join(tpl_dir, 'project_config.json')
        if os.path.isfile(cfg_path):
            with open(cfg_path, encoding='utf-8') as f:
                yield name, tpl_dir, json.load(f)


class TestRackConfigCompleteness:
    def test_complete_passes(self):
        assert check_rack_config_complete(_config()) == []

    def test_missing_cooling_method(self):
        cfg = _config()
        del cfg['rack_config']['cooling_method']
        problems = check_rack_config_complete(cfg)
        assert any('cooling_method' in p for p in problems)

    def test_invalid_cooling_method(self):
        cfg = _config(cooling_method='water')
        problems = check_rack_config_complete(cfg)
        assert any('cooling_method' in p for p in problems)

    def test_missing_gpu_dedicated(self):
        cfg = _config()
        del cfg['rack_config']['gpu_dedicated']
        problems = check_rack_config_complete(cfg)
        assert any('gpu_dedicated' in p for p in problems)

    def test_non_bool_gpu_dedicated(self):
        cfg = _config(gpu_dedicated='yes')
        problems = check_rack_config_complete(cfg)
        assert any('gpu_dedicated' in p for p in problems)


class TestProtocolCompatibility:
    def _param_ref(self, library_id):
        cfg = _config()
        cfg['topology']['param_protocol'] = 'RoCE'
        for k in ('param_leaf_switch', 'param_spine_switch', 'param_core_switch', 'param_switch'):
            cfg['device_refs'][k] = {'library_id': library_id}
        return cfg

    def test_roce_with_roce_switch_passes(self):
        cfg = self._param_ref('h3c_s9825_64d')
        assert check_protocol_compatibility(cfg) == []

    def test_ib_with_ib_switch_passes(self):
        cfg = self._param_ref('nvidia_mqm9700_64_400g_ib')
        cfg['topology']['param_protocol'] = 'IB'
        assert check_protocol_compatibility(cfg) == []

    def test_ib_with_roce_switch_fails(self):
        cfg = self._param_ref('h3c_s9825_64d')
        cfg['topology']['param_protocol'] = 'IB'
        problems = check_protocol_compatibility(cfg)
        assert any('协议兼容性' in p and 'IB' in p for p in problems)

    def test_roce_with_ib_only_switch_fails(self):
        cfg = self._param_ref('nvidia_mqm9700_64_400g_ib')
        cfg['topology']['param_protocol'] = 'RoCE'
        problems = check_protocol_compatibility(cfg)
        assert any('协议兼容性' in p for p in problems)

    def test_roce_with_quantum_model_fails(self):
        cfg = _config()
        cfg['topology']['param_protocol'] = 'RoCE'
        cfg['device_refs']['param_leaf_switch'] = {'library_id': 'nvidia_q3200_72_800g_ib'}
        problems = check_protocol_compatibility(cfg)
        assert any('协议兼容性' in p for p in problems)


class TestParameterReasonableness:
    def test_param_speed_mismatch_flagged(self):
        cfg = _config()
        cfg['topology']['param_speed'] = '800G'
        cfg['device_refs']['param_leaf_switch'] = {'library_id': 'h3c_s9825_64d'}
        cfg['device_refs']['param_spine_switch'] = {'library_id': 'h3c_s9827'}
        problems = check_parameter_reasonableness(cfg)
        assert any('param_speed' in p and '不匹配' in p for p in problems)

    def test_param_speed_match_passes(self):
        cfg = _config()
        cfg['topology']['param_speed'] = '400G'
        cfg['device_refs']['param_leaf_switch'] = {'library_id': 'h3c_s9825_64d'}
        problems = check_parameter_reasonableness(cfg)
        assert not problems

    def test_plan_macro_pfc_out_of_range(self, tmp_path):
        cfg = _config()
        plan = {'macro': {'pfcQueue': 9, 'cnpQueue': 6, 'convergence': 2.0,
                          'rails': 8, 'gpuCount': 64, 'protocol': 'RoCE'}}
        (tmp_path / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False), encoding='utf-8')
        problems = check_parameter_reasonableness(cfg, tpl_dir=str(tmp_path))
        assert any('PFC' in p or 'pfcQueue' in p for p in problems)

    def test_plan_macro_cnp_out_of_range(self, tmp_path):
        cfg = _config()
        plan = {'macro': {'pfcQueue': 3, 'cnpQueue': 8, 'convergence': 2.0,
                          'rails': 8, 'gpuCount': 64, 'protocol': 'RoCE'}}
        (tmp_path / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False), encoding='utf-8')
        problems = check_parameter_reasonableness(cfg, tpl_dir=str(tmp_path))
        assert any('CNP' in p or 'cnpQueue' in p for p in problems)

    def test_plan_macro_invalid_convergence(self, tmp_path):
        cfg = _config()
        plan = {'macro': {'convergence': 8.0, 'gpuCount': 64, 'protocol': 'RoCE'}}
        (tmp_path / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False), encoding='utf-8')
        problems = check_parameter_reasonableness(cfg, tpl_dir=str(tmp_path))
        assert any('收敛比' in p or 'convergence' in p for p in problems)

    def test_plan_macro_valid_passes(self, tmp_path):
        cfg = _config()
        plan = {'macro': {'pfcQueue': 3, 'cnpQueue': 6, 'convergence': 2.0,
                          'rails': 8, 'gpuCount': 64, 'protocol': 'RoCE'}}
        (tmp_path / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False), encoding='utf-8')
        assert check_parameter_reasonableness(cfg, tpl_dir=str(tmp_path)) == []


class TestCheckTemplateConfig:
    def test_valid_config_passes(self):
        cfg = _config()
        cfg['device_refs']['param_leaf_switch'] = {'library_id': 'h3c_s9825_64d'}
        cfg['device_refs']['param_spine_switch'] = {'library_id': 'h3c_s9827'}
        assert check_template_config(cfg) == []

    def test_unresolvable_device_ref(self):
        cfg = _config()
        cfg['device_refs']['param_leaf_switch'] = {'library_id': 'no_such_device_xyz'}
        problems = check_template_config(cfg)
        assert any('device_refs 无法解析' in p for p in problems)

    def test_legacy_id_flagged(self):
        cfg = _config()
        cfg['device_refs']['param_leaf_switch'] = {'library_id': 'h3c_s9850_64h'}
        problems = check_template_config(cfg)
        assert any('旧设备 id' in p for p in problems)

    @pytest.mark.parametrize('cooling', VALID_COOLING)
    def test_all_valid_cooling_passes(self, cooling):
        cfg = _config(cooling_method=cooling)
        assert check_rack_config_complete(cfg) == []


class TestAllTemplatesPassGate:
    """23 套内置模板全部通过强化门禁（含 3 套本次补齐 rack_config 的模板）"""

    def test_every_template_passes_check_template_config(self):
        lib = get_device_library()
        templates = list(_all_templates())
        assert len(templates) >= 23, f'模板数量异常: {len(templates)}'
        failures = []
        for name, tpl_dir, cfg in templates:
            problems = check_template_config(cfg, lib, tpl_dir)
            if problems:
                failures.append(f'{name}: ' + '; '.join(problems))
        assert not failures, '\n'.join(failures)

    def test_every_template_has_rack_cooling_fields(self):
        for name, _tpl_dir, cfg in _all_templates():
            rack = cfg.get('rack_config') or {}
            assert rack.get('cooling_method') in VALID_COOLING, f'{name}: cooling_method 缺失/非法'
            assert isinstance(rack.get('gpu_dedicated'), bool), f'{name}: gpu_dedicated 缺失/非布尔'
