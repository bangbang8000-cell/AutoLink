"""V3.1.3-T7-6: 共享设备选型规则测试（device_defaults.py）

校验：
  - 双端共享映射（IB 按 GPU 世代 / RoCE H3C / 存储按协议 / 业务带外固定）
  - resolve_ib_defaults / get_device_defaults / defaults 主入口
  - action 注册（cli.execute('device:defaults', ...)）
  - 默认设备 id 全部存在于设备库（防悬空引用）
"""
import pytest

from cli import execute
from device_defaults import (
    IB_DEFAULTS_BY_GPU, ROCE_DEFAULTS, IB_DEFAULTS_FALLBACK,
    STORAGE_DEFAULTS_BY_PROTOCOL, BIZ_DEFAULTS, OOB_DEFAULTS,
    REF_KEY_GROUPS, resolve_ib_defaults, get_device_defaults, defaults,
)
from device_library import get_device_library


class TestMapping:
    def test_ib_gpu_generations(self):
        # h100_and_below → MQM9700(400G)；b300/gb300 → Q3400(800G)
        assert IB_DEFAULTS_BY_GPU['h100_and_below']['param_leaf_switch'] == 'nvidia_mqm9700_64_400g_ib'
        assert IB_DEFAULTS_BY_GPU['b300']['param_leaf_switch'] == 'nvidia_q3400_144_800g_ib'
        assert IB_DEFAULTS_BY_GPU['gb300']['param_leaf_switch'] == 'nvidia_q3400_144_800g_ib'

    def test_roce_h3c(self):
        assert ROCE_DEFAULTS['param_leaf_switch'] == 'h3c_s9850_64h'
        assert ROCE_DEFAULTS['param_spine_switch'] == 'h3c_s9820_64h'
        assert ROCE_DEFAULTS['param_core_switch'] == 'h3c_s9820_8c'

    def test_storage_by_protocol(self):
        assert STORAGE_DEFAULTS_BY_PROTOCOL['IB']['storage_leaf_switch'] == 'nvidia_mqm8700_40_200g_ib'
        assert STORAGE_DEFAULTS_BY_PROTOCOL['RoCE']['storage_leaf_switch'] == 'huawei_ce6881_48s6cq'
        assert STORAGE_DEFAULTS_BY_PROTOCOL['UEC'] == STORAGE_DEFAULTS_BY_PROTOCOL['RoCE']

    def test_biz_oob_fixed(self):
        assert BIZ_DEFAULTS['biz_access_switch'] == 'h3c_s6850_56hf'
        assert OOB_DEFAULTS['oob_access_switch'] == 'h3c_s5130s_52p_ei'

    def test_fallback_equals_h100(self):
        assert IB_DEFAULTS_FALLBACK == IB_DEFAULTS_BY_GPU['h100_and_below']


class TestResolve:
    def test_unknown_gpu_falls_back(self):
        assert resolve_ib_defaults(None) == IB_DEFAULTS_FALLBACK
        assert resolve_ib_defaults('') == IB_DEFAULTS_FALLBACK

    def test_gb300_and_nvl72(self):
        for gpu in ['nvidia_gb300_nvl72', 'GB300_108', 'gb300_nvl72_4u']:
            assert resolve_ib_defaults(gpu) == IB_DEFAULTS_BY_GPU['gb300']

    def test_b200_b300(self):
        for gpu in ['nvidia_b200_8s', 'b300_10u']:
            assert resolve_ib_defaults(gpu) == IB_DEFAULTS_BY_GPU['b300']

    def test_h100_h200(self):
        for gpu in ['nvidia_h100_8s', 'h200_7u', 'l20_8s']:
            assert resolve_ib_defaults(gpu) == IB_DEFAULTS_BY_GPU['h100_and_below']


class TestGetDefaults:
    def test_ib_refs_complete(self):
        refs = get_device_defaults('IB', 'nvidia_gb300_nvl72')
        expected_keys = set(REF_KEY_GROUPS['param_network']) | set(REF_KEY_GROUPS['storage_network']) \
            | set(REF_KEY_GROUPS['biz_network']) | set(REF_KEY_GROUPS['oob_network'])
        assert set(refs.keys()) == expected_keys
        assert refs['param_leaf_switch'] == 'nvidia_q3400_144_800g_ib'
        assert refs['storage_leaf_switch'] == 'nvidia_mqm8700_40_200g_ib'

    def test_roce_refs(self):
        refs = get_device_defaults('roce')  # 大小写不敏感
        assert refs['param_leaf_switch'] == 'h3c_s9850_64h'
        assert refs['storage_leaf_switch'] == 'huawei_ce6881_48s6cq'

    def test_unknown_protocol_falls_back_ib(self):
        refs = get_device_defaults('nope')
        assert refs['param_leaf_switch'] == IB_DEFAULTS_FALLBACK['param_leaf_switch']

    def test_defaults_entry_shape(self):
        out = defaults({'protocol': 'IB', 'gpu_library_id': 'nvidia_gb300_nvl72'})
        assert out['success'] is True
        assert out['protocol'] == 'IB'
        assert out['shared_with_wizard'] is True
        assert out['device_refs']['param_leaf_switch'] == 'nvidia_q3400_144_800g_ib'
        assert out['by_network']['storage_network']['storage_leaf_switch'] == 'nvidia_mqm8700_40_200g_ib'


class TestActionAndLibrary:
    def test_action_registered(self):
        out = execute('device:defaults', {'protocol': 'IB'})
        assert out['success'] is True
        assert out['protocol'] == 'IB'

    def test_all_default_ids_exist_in_library(self):
        """共享规则引用的设备 id 必须全部存在于设备库（防悬空引用）"""
        lib = get_device_library()
        ids = {d.id for d in lib.get_all()}

        refs = get_device_defaults('IB')
        refs.update(get_device_defaults('RoCE'))
        missing = [v for v in refs.values() if v not in ids]
        assert not missing, f'默认设备 id 不在设备库: {missing}'
