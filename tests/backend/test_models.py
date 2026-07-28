"""
测试 backend/models.py - NetworkObject 和 Connection 数据模型
"""
import pytest

from models import NetworkObject, Connection


class TestNetworkObject:
    """NetworkObject 测试"""

    def test_leaf_initialization(self):
        """Leaf交换机初始化 - 端口计数器正确分配"""
        leaf = NetworkObject(name="参数Leaf_1", obj_type="param_leaf", max_ports=64)
        assert leaf.downlink_counter == 1
        assert leaf.downlink_limit == 32
        assert leaf.uplink_counter == 33
        assert leaf.uplink_limit == 64

    def test_spine_initialization(self):
        """Spine交换机初始化"""
        spine = NetworkObject(name="参数Spine_1", obj_type="param_spine", max_ports=64)
        assert spine.downlink_counter == 1
        assert spine.downlink_limit == 32
        assert spine.uplink_counter == 33
        assert spine.uplink_limit == 64

    def test_core_initialization(self):
        """Core交换机初始化"""
        core = NetworkObject(name="参数Core_1", obj_type="param_core", max_ports=64)
        assert core.core_counter == 1
        assert core.core_limit == 64

    def test_server_initialization(self):
        """服务器初始化"""
        server = NetworkObject(name="GPU服务器_1", obj_type="server", max_ports=8)
        assert server.port_counter == 1
        assert server.port_limit == 8

    def test_get_downlink_port(self):
        """获取下联端口"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=64)
        port = leaf.get_downlink_port()
        assert port == "端口1"
        assert leaf.downlink_counter == 2

    def test_get_downlink_port_with_prefix(self):
        """获取带前缀的下联端口"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=64)
        leaf.downlink_prefix = "Eth"
        port = leaf.get_downlink_port()
        assert port == "Eth1"

    def test_downlink_port_limit_exceeded(self):
        """下联端口超限"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=64)
        leaf.downlink_limit = 2
        leaf.get_downlink_port()  # 1
        leaf.get_downlink_port()  # 2
        with pytest.raises(ValueError, match="下联端口数量超过限制"):
            leaf.get_downlink_port()  # 3 - 超出

    def test_downlink_limit_zero(self):
        """下联端口限制为0"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=64)
        leaf.downlink_limit = 0
        with pytest.raises(ValueError, match="下联端口限制为0"):
            leaf.get_downlink_port()

    def test_get_uplink_port(self):
        """获取上联端口"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=64)
        leaf.uplink_prefix = "Up"
        port = leaf.get_uplink_port()
        assert port == "Up33"
        assert leaf.uplink_counter == 34

    def test_get_core_port(self):
        """获取Core端口"""
        core = NetworkObject(name="Core", obj_type="param_core", max_ports=64)
        core.port_prefix = "Core"
        port = core.get_core_port()
        assert port == "Core1"

    def test_core_limit_zero(self):
        """Core端口限制为0"""
        core = NetworkObject(name="Core", obj_type="param_core", max_ports=64)
        core.core_limit = 0
        with pytest.raises(ValueError, match="Core端口限制为0"):
            core.get_core_port()

    def test_add_connection(self):
        """添加连接"""
        obj = NetworkObject(name="Server", obj_type="server", max_ports=8)
        conn = Connection("Server", "端口1", "400G", "Leaf", "端口1", "400G", "MPO", "测试")
        obj.add_connection(conn)
        assert len(obj.connections) == 1

    def test_cabinet_fields(self):
        """机柜字段默认值"""
        obj = NetworkObject(name="Server", obj_type="server")
        assert obj.cabinet_id is None
        assert obj.cabinet_name == ""
        assert obj.start_u is None
        assert obj.end_u is None


class TestConnection:
    """Connection 测试"""

    def test_connection_creation(self):
        """创建连接"""
        conn = Connection(
            a_device="Server1", a_port="端口1", a_module="400G",
            z_device="Leaf1", z_port="端口1", z_module="400G",
            cable_type="MPO", description="服务器到Leaf",
            a_cabinet_id=1, a_cabinet_name="机柜1",
            a_start_u=1, a_end_u=2,
            z_cabinet_id=2, z_cabinet_name="机柜2",
            z_start_u=3, z_end_u=4,
        )
        assert conn.a_device == "Server1"
        assert conn.a_port == "端口1"
        assert conn.a_module == "400G"
        assert conn.z_device == "Leaf1"
        assert conn.cable_type == "MPO"
        assert conn.a_cabinet_id == 1
        assert conn.a_cabinet_name == "机柜1"
        assert conn.a_start_u == 1
        assert conn.a_end_u == 2

    def test_connection_defaults(self):
        """连接默认值"""
        conn = Connection("S", "P1", "400G", "L", "P2", "400G", "MPO", "test")
        assert conn.a_cabinet_id is None
        assert conn.a_cabinet_name == ""
        assert conn.a_start_u is None