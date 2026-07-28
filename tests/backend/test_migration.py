"""
AutoLink V2.1 - 配置迁移测试
测试 V2.0 network_config.ini → V2.1 project_config.json 迁移
"""
import pytest
import sys, os, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from designer import NetworkDesignerV2


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