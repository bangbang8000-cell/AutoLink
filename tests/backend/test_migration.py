"""
AutoLink V2.1 - 配置迁移测试
测试 V2.0 network_config.ini → V2.1 project_config.json 迁移
"""
import pytest
import sys, os, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from designer import NetworkDesignerV2
from migration import _get_default_device_refs


class TestINIToProjectConfigMigration:
    """INI → JSON 迁移测试"""

    def _create_ini(self, tmpdir, content):
        """创建临时INI配置文件"""
        ini_path = os.path.join(tmpdir, 'network_config.ini')
        with open(ini_path, 'w') as f:
            f.write(content)
        return ini_path

    def _create_project_config(self, tmpdir, config):
        """创建临时project_config.json"""
        config_path = os.path.join(tmpdir, 'project_config.json')
        with open(config_path, 'w') as f:
            json.dump(config, f)
        return config_path

    def test_ini_json_coexist_prefer_json(self):
        """INI和JSON共存时优先使用JSON"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建JSON
            json_config = {
                "meta": {"name": "json-project", "version": 1},
                "networks": {
                    "param_network": True, "storage_network": True,
                    "biz_network": False, "oob_network": False,
                },
                "topology": {
                    "downlink_mode": "custom",
                    "num_gpu_servers": 20,
                    "num_storage_servers": 0,
                    "num_compute_servers": 0,
                    "param_ports_per_server": 8,
                    "param_switch_ports": 64,
                    "param_speed": "400G",
                    "param_downlink_limit": 25,
                    "storage_ports_per_server": 1,
                    "storage_switch_ports": 48,
                    "storage_speed": "200G",
                    "storage_downlink_limit": 20,
                },
                "device_refs": {},
                "rack_config": {"rack_type": 42, "power_limit_per_rack": 8000},
            }
            json_path = self._create_project_config(tmpdir, json_config)
            ini_path = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 10
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
oob_enabled = False
biz_enabled = False
""")
            # 用INI路径打开，但应自动切换到JSON
            designer = NetworkDesignerV2(ini_path)
            assert designer.num_servers == 20  # JSON中的值
            assert designer.rack_type == 42

    def test_ini_only_backward_compat(self):
        """仅INI文件，向后兼容"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 100
additional_storage_servers = 14
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
downlink_mode = full
oob_enabled = True
biz_enabled = True
oob_access_ports = 48
oob_agg_ports = 48
biz_access_ports = 48
biz_agg_box_ports = 32
biz_access_uplinks = 8
""")
            designer = NetworkDesignerV2(ini)
            assert designer.num_servers == 100
            assert designer.additional_storage == 14
            assert designer.total_servers == 114
            assert designer.downlink_mode == 'full'
            assert designer.oob_enabled is True
            assert designer.biz_enabled is True
            # 验证服务器和交换机生成
            assert len(designer.servers) > 0
            assert len(designer.param_leaves) > 0
            assert len(designer.oob_access) > 0
            assert len(designer.biz_access) > 0

    def test_ini_default_values(self):
        """INI默认值"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 10
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
oob_enabled = False
biz_enabled = False
""")
            designer = NetworkDesignerV2(ini)
            # 默认值
            assert designer.rack_type == 42
            assert designer.power_limit_per_rack == 6000
            assert designer.naming_prefix == '机柜'

    def test_json_config_networks_all_on(self):
        """JSON配置-所有网络开启"""
        with tempfile.TemporaryDirectory() as tmpdir:
            config = {
                "meta": {"name": "all-networks", "version": 1},
                "networks": {
                    "param_network": True, "storage_network": True,
                    "biz_network": True, "oob_network": True,
                },
                "topology": {
                    "downlink_mode": "custom",
                    "num_gpu_servers": 10,
                    "num_storage_servers": 5,
                    "num_compute_servers": 3,
                    "param_ports_per_server": 8,
                    "param_switch_ports": 64,
                    "param_speed": "400G",
                    "param_downlink_limit": 25,
                    "storage_ports_per_server": 1,
                    "storage_switch_ports": 48,
                    "storage_speed": "200G",
                    "storage_downlink_limit": 20,
                    "oob_downlink_limit": 25,
                    "biz_downlink_limit": 25,
                },
                "device_refs": {},
                "rack_config": {"rack_type": 49, "power_limit_per_rack": 12000},
            }
            config_path = self._create_project_config(tmpdir, config)
            designer = NetworkDesignerV2(config_path)
            assert designer.num_servers == 10
            assert designer.additional_storage == 5
            assert designer.additional_compute == 3
            assert designer.total_servers == 18
            assert designer.oob_enabled is True
            assert designer.biz_enabled is True
            assert designer.rack_type == 49
            assert len(designer.servers) == 18

    def test_json_config_networks_param_only(self):
        """JSON配置-仅参数网络"""
        with tempfile.TemporaryDirectory() as tmpdir:
            config = {
                "meta": {"name": "param-only", "version": 1},
                "networks": {
                    "param_network": True, "storage_network": False,
                    "biz_network": False, "oob_network": False,
                },
                "topology": {
                    "downlink_mode": "full",
                    "num_gpu_servers": 32,
                    "num_storage_servers": 0,
                    "num_compute_servers": 0,
                    "param_ports_per_server": 8,
                    "param_switch_ports": 64,
                    "param_speed": "400G",
                    "param_downlink_limit": 32,
                    "storage_ports_per_server": 1,
                    "storage_switch_ports": 48,
                    "storage_speed": "200G",
                    "storage_downlink_limit": 24,
                },
                "device_refs": {},
                "rack_config": {"rack_type": 42, "power_limit_per_rack": 8000},
            }
            config_path = self._create_project_config(tmpdir, config)
            designer = NetworkDesignerV2(config_path)
            assert designer.param_enabled is True
            assert designer.storage_enabled is False
            assert designer.biz_enabled is False
            assert designer.oob_enabled is False
            assert len(designer.servers) == 32
            # 存储网络不应有交换机
            assert len(designer.storage_leaves) == 0


class TestProtocolBasedDeviceSelection:
    """T5/T9: 协议联动设备选型测试"""

    def _build_config(self, protocol='RoCE', storage=True, biz=True, oob=True, param=True):
        """构造测试用 config"""
        return {
            'networks': {
                'param_network': param,
                'storage_network': storage,
                'biz_network': biz,
                'oob_network': oob,
            },
            'topology': {
                'param_protocol': protocol,
            },
        }

    # ---------- T5: 存储交换机按协议分流 ----------

    def test_storage_switch_ib_protocol(self):
        """IB 协议下,存储交换机应选 NVIDIA Quantum HDR (mqm8700)"""
        config = self._build_config(protocol='IB', storage=True)
        refs = _get_default_device_refs(config)
        assert 'storage_leaf_switch' in refs
        assert 'storage_spine_switch' in refs
        assert refs['storage_leaf_switch']['library_id'] == 'nvidia_mqm8700_40_200g_ib'
        assert refs['storage_spine_switch']['library_id'] == 'nvidia_mqm8700_40_200g_ib'

    def test_storage_switch_roce_protocol(self):
        """RoCE 协议下,存储交换机应选华为 CE6881 (支持 RoCEv2/FC-NVMe)"""
        config = self._build_config(protocol='RoCE', storage=True)
        refs = _get_default_device_refs(config)
        assert refs['storage_leaf_switch']['library_id'] == 'huawei_ce6881_48s6cq'
        assert refs['storage_spine_switch']['library_id'] == 'huawei_ce6881_48s6cq'

    def test_storage_switch_default_roce_when_protocol_missing(self):
        """protocol 字段缺失时,默认按 RoCE 处理"""
        config = {
            'networks': {'param_network': True, 'storage_network': True,
                         'biz_network': False, 'oob_network': False},
            'topology': {},  # 无 param_protocol
        }
        refs = _get_default_device_refs(config)
        assert refs['storage_leaf_switch']['library_id'] == 'huawei_ce6881_48s6cq'

    def test_storage_switch_not_emitted_when_storage_disabled(self):
        """storage_network 关闭时,不应输出存储交换机引用"""
        config = self._build_config(protocol='IB', storage=False)
        refs = _get_default_device_refs(config)
        assert 'storage_leaf_switch' not in refs
        assert 'storage_spine_switch' not in refs
        assert 'all_flash_storage_server' not in refs

    def test_param_switch_ib_protocol(self):
        """IB 协议下,参数面交换机应选 NVIDIA Quantum 系列"""
        config = self._build_config(protocol='IB', param=True)
        refs = _get_default_device_refs(config)
        assert refs['param_leaf_switch']['library_id'] == 'nvidia_mqm9700_64_400g_ib'
        assert refs['param_spine_switch']['library_id'] == 'nvidia_q3200_72_800g_ib'
        assert refs['param_core_switch']['library_id'] == 'nvidia_q3400_144_800g_ib'

    def test_param_switch_roce_protocol(self):
        """RoCE 协议下,参数面交换机应选 H3C S9850/S9820 系列"""
        config = self._build_config(protocol='RoCE', param=True)
        refs = _get_default_device_refs(config)
        assert refs['param_leaf_switch']['library_id'] == 'h3c_s9850_64h'
        assert refs['param_spine_switch']['library_id'] == 'h3c_s9820_64h'
        assert refs['param_core_switch']['library_id'] == 'h3c_s9820_8c'

    def test_ib_storage_distinct_from_roce_storage(self):
        """IB 与 RoCE 两种协议下,存储交换机选型必须不同"""
        ib_refs = _get_default_device_refs(self._build_config(protocol='IB', storage=True))
        roce_refs = _get_default_device_refs(self._build_config(protocol='RoCE', storage=True))
        assert ib_refs['storage_leaf_switch']['library_id'] != roce_refs['storage_leaf_switch']['library_id']

    # ---------- T9: 业务交换机默认 25G ----------

    def test_biz_access_switch_is_25g_model(self):
        """业务接入交换机默认应为 h3c_s6850_56hf (25G)"""
        config = self._build_config(biz=True)
        refs = _get_default_device_refs(config)
        assert refs['biz_access_switch']['library_id'] == 'h3c_s6850_56hf'

    def test_biz_access_switch_not_legacy_10g_model(self):
        """业务接入交换机不应是旧的 10G 型号 (h3c_s5560x_54s_ei)"""
        config = self._build_config(biz=True)
        refs = _get_default_device_refs(config)
        assert refs['biz_access_switch']['library_id'] != 'h3c_s5560x_54s_ei'

    def test_biz_switches_not_emitted_when_biz_disabled(self):
        """biz_network 关闭时,不应输出业务交换机引用"""
        config = self._build_config(biz=False)
        refs = _get_default_device_refs(config)
        assert 'biz_access_switch' not in refs
        assert 'biz_agg_switch' not in refs
        assert 'compute_server' not in refs

    def test_oob_switches_emitted_when_oob_enabled(self):
        """OOB 网络启用时,应输出 OOB 交换机引用"""
        config = self._build_config(oob=True)
        refs = _get_default_device_refs(config)
        assert refs['oob_access_switch']['library_id'] == 'h3c_s5130s_52p_ei'
        assert refs['oob_agg_switch']['library_id'] == 'h3c_s5120v3_52p_ei'

    def test_all_networks_disabled_returns_empty_refs(self):
        """所有网络关闭时,设备引用应为空"""
        config = self._build_config(protocol='RoCE', storage=False, biz=False, oob=False, param=False)
        refs = _get_default_device_refs(config)
        assert refs == {}