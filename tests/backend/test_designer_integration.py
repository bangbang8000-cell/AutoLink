"""
AutoLink V2.1 - Designer 集成测试
测试完整的设计流水线：配置加载 → 拓扑设计 → 连接生成 → 验证
"""
import pytest
import sys, os, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from designer import NetworkDesignerV2


class TestDesignerINIConfig:
    """INI 配置格式测试"""

    def _create_ini(self, tmpdir, content):
        """创建临时INI配置文件"""
        ini_path = os.path.join(tmpdir, 'network_config.ini')
        with open(ini_path, 'w') as f:
            f.write(content)
        return ini_path

    def test_minimal_ini(self):
        """最小INI配置"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 4
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
            assert designer.num_servers == 4
            assert designer.total_servers == 4
            assert designer.param_enabled is True
            assert designer.storage_enabled is True
            assert designer.oob_enabled is False
            assert designer.biz_enabled is False
            # 应该有服务器和交换机
            assert len(designer.servers) > 0
            assert len(designer.param_leaves) > 0

    def test_full_mode_ini(self):
        """满接模式INI"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 100
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
downlink_mode = full
oob_enabled = True
biz_enabled = True
""")
            designer = NetworkDesignerV2(ini)
            assert designer.downlink_mode == 'full'
            assert designer.oob_enabled is True
            assert designer.biz_enabled is True
            assert len(designer.servers) == 100

    def test_custom_downlink_ini(self):
        """自定义下行口数INI"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 16
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
downlink_mode = custom
param_downlink_limit = 20
storage_downlink_limit = 16
oob_enabled = False
biz_enabled = False
""")
            designer = NetworkDesignerV2(ini)
            assert designer.downlink_mode == 'custom'
            assert designer.param_dl == 20
            assert designer.storage_dl == 16

    def test_with_additional_servers(self):
        """额外存储和通算服务器"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 100
additional_storage_servers = 14
additional_compute_servers = 20
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
            assert designer.total_servers == 134
            assert designer.additional_storage == 14
            assert designer.additional_compute == 20

    def test_large_scale_3tier(self):
        """大规模3层组网"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 512
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
            assert len(designer.servers) == 512
            assert len(designer.param_leaves) > 0
            assert len(designer.param_spines) > 0
            # 512台服务器，64口交换机，8网卡/服务器 → 2层最大128台 → 需要3层
            assert designer.param_3tier_needed is True


class TestDesignerProjectConfig:
    """project_config.json 格式测试"""

    def _create_project_config(self, tmpdir, config):
        """创建临时project_config.json"""
        config_path = os.path.join(tmpdir, 'project_config.json')
        with open(config_path, 'w') as f:
            json.dump(config, f)
        return config_path

    def _default_config(self, **overrides):
        """默认project_config"""
        config = {
            "meta": {"name": "test", "description": "", "version": 1,
                     "created_at": "2024-01-01", "updated_at": "2024-01-01"},
            "networks": {
                "param_network": True,
                "storage_network": True,
                "biz_network": False,
                "oob_network": False,
            },
            "topology": {
                "downlink_mode": "custom",
                "num_gpu_servers": 10,
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
        config.update(overrides)
        return config

    def test_basic_project_config(self):
        """基本project_config"""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = self._create_project_config(tmpdir, self._default_config())
            designer = NetworkDesignerV2(config_path)
            assert designer.num_servers == 10
            assert designer.rack_type == 42
            assert designer.power_limit_per_rack == 8000
            assert len(designer.servers) == 10

    def test_49u_rack(self):
        """49U机柜"""
        with tempfile.TemporaryDirectory() as tmpdir:
            config = self._default_config()
            config['rack_config'] = {"rack_type": 49, "power_limit_per_rack": 12000}
            config_path = self._create_project_config(tmpdir, config)
            designer = NetworkDesignerV2(config_path)
            assert designer.rack_type == 49
            assert designer.power_limit_per_rack == 12000

    def test_network_toggles(self):
        """网络开关"""
        with tempfile.TemporaryDirectory() as tmpdir:
            config = self._default_config()
            config['networks'] = {
                "param_network": True,
                "storage_network": False,
                "biz_network": True,
                "oob_network": True,
            }
            config_path = self._create_project_config(tmpdir, config)
            designer = NetworkDesignerV2(config_path)
            assert designer.param_enabled is True
            assert designer.storage_enabled is False
            assert designer.biz_enabled is True
            assert designer.oob_enabled is True

    def test_full_mode_project_config(self):
        """满接模式 project_config"""
        with tempfile.TemporaryDirectory() as tmpdir:
            config = self._default_config()
            config['topology']['downlink_mode'] = 'full'
            config_path = self._create_project_config(tmpdir, config)
            designer = NetworkDesignerV2(config_path)
            assert designer.downlink_mode == 'full'
            assert designer.param_dl == 32  # 64 // 2

    def test_missing_config_file(self):
        """配置文件不存在 - 使用默认值"""
        designer = NetworkDesignerV2("/nonexistent/config.ini")
        # 使用默认值 (num_servers fallback=100)，不崩溃
        assert designer.total_servers == 100
        assert designer.num_servers == 100
        assert designer.rack_type == 42

    def test_invalid_json_config(self):
        """无效JSON配置"""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'project_config.json')
            with open(config_path, 'w') as f:
                f.write("invalid json")
            # 应该抛出异常
            with pytest.raises(Exception):
                NetworkDesignerV2(config_path)


class TestDesignerValidation:
    """拓扑验证测试"""

    def _create_ini(self, tmpdir, content):
        ini_path = os.path.join(tmpdir, 'network_config.ini')
        with open(ini_path, 'w') as f:
            f.write(content)
        return ini_path

    def test_validate_small_design(self):
        """小规模设计验证"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 4
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
            result = designer.validate_topology()
            # validate_topology 返回布尔值
            assert result is True

    def test_validate_large_design(self):
        """大规模设计验证 (2层)"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 100
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
            result = designer.validate_topology()
            assert result is True


class TestDesignerOOB:
    """OOB网络设计测试"""

    def _create_ini(self, tmpdir, content):
        ini_path = os.path.join(tmpdir, 'network_config.ini')
        with open(ini_path, 'w') as f:
            f.write(content)
        return ini_path

    def test_oob_design(self):
        """OOB网络设计"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 50
additional_storage_servers = 10
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
oob_enabled = True
biz_enabled = False
oob_access_ports = 48
oob_access_uplinks = 2
oob_agg_ports = 48
""")
            designer = NetworkDesignerV2(ini)
            assert designer.oob_enabled is True
            assert len(designer.oob_access) > 0
            assert len(designer.oob_agg) > 0

    def test_oob_disabled(self):
        """OOB网络禁用"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 50
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
            assert len(designer.oob_access) == 0
            assert len(designer.oob_agg) == 0


class TestDesignerBiz:
    """业务网络设计测试"""

    def _create_ini(self, tmpdir, content):
        ini_path = os.path.join(tmpdir, 'network_config.ini')
        with open(ini_path, 'w') as f:
            f.write(content)
        return ini_path

    def test_biz_design(self):
        """业务网络设计"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = self._create_ini(tmpdir, """[DEFAULT]
num_servers = 50
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
oob_enabled = False
biz_enabled = True
biz_access_ports = 48
biz_access_uplinks = 8
biz_agg_box_ports = 32
""")
            designer = NetworkDesignerV2(ini)
            assert designer.biz_enabled is True
            assert len(designer.biz_access) > 0
            assert len(designer.biz_agg) > 0