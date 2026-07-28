"""
AutoLink V2.1 - Models 综合边界条件测试
覆盖 NetworkObject 和 Connection 的端口分配、状态转换等边界场景
"""
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from models import NetworkObject, Connection


class TestNetworkObjectComprehensive:
    """NetworkObject 综合边界测试"""

    # ---- 端口分配边界 ----

    def test_leaf_exhaust_all_ports(self):
        """Leaf交换机端口全部用尽"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=64)
        # 用尽所有下联端口
        for i in range(1, 33):
            port = leaf.get_downlink_port()
            assert port == f"端口{i}"
        assert leaf.downlink_counter == 33
        with pytest.raises(ValueError):
            leaf.get_downlink_port()

    def test_spine_exhaust_all_uplinks(self):
        """Spine交换机上联端口用尽"""
        spine = NetworkObject(name="Spine", obj_type="param_spine", max_ports=64)
        # 用尽所有上联端口
        for i in range(33, 65):
            port = spine.get_uplink_port()
            assert port == f"端口{i}"
        assert spine.uplink_counter == 65
        with pytest.raises(ValueError):
            spine.get_uplink_port()

    def test_core_exhaust_all_ports(self):
        """Core交换机端口用尽"""
        core = NetworkObject(name="Core", obj_type="param_core", max_ports=64)
        for i in range(1, 65):
            port = core.get_core_port()
            assert port == f"端口{i}"
        assert core.core_counter == 65
        with pytest.raises(ValueError):
            core.get_core_port()

    def test_server_exhaust_all_ports(self):
        """服务器端口用尽"""
        server = NetworkObject(name="Server", obj_type="server", max_ports=8)
        for i in range(1, 9):
            port = server.get_server_port()
            assert port == f"端口{i}"
        with pytest.raises(ValueError):
            server.get_server_port()

    # ---- 端口命名前缀 ----

    def test_custom_port_prefix(self):
        """自定义端口前缀"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=64)
        leaf.downlink_prefix = "Eth1/0/"
        port = leaf.get_downlink_port()
        assert port == "Eth1/0/1"

        leaf.uplink_prefix = "Eth1/0/"
        port = leaf.get_uplink_port()
        assert port == "Eth1/0/33"

    def test_empty_port_prefix(self):
        """空前缀使用默认"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=64)
        leaf.downlink_prefix = ""
        port = leaf.get_downlink_port()
        assert port == "端口1"

    def test_switch_port_prefixes(self):
        """交换机端口命名前缀"""
        # 华为风格
        sw = NetworkObject(name="HW_Leaf", obj_type="param_leaf", max_ports=64)
        sw.downlink_prefix = "Eth-Trunk"
        assert sw.get_downlink_port() == "Eth-Trunk1"

        # H3C风格
        sw2 = NetworkObject(name="H3C_Leaf", obj_type="param_leaf", max_ports=64)
        sw2.downlink_prefix = "Bridge-Aggregation"
        assert sw2.get_downlink_port() == "Bridge-Aggregation1"

    # ---- Device Profile 字段 ----

    def test_device_profile_fields(self):
        """设备档案字段"""
        server = NetworkObject(
            name="GPU服务器_1", obj_type="server", max_ports=8,
            device_profile={"vendor": "NVIDIA", "model": "H100"},
            power_watts=10000, u_height=8
        )
        assert server.device_profile == {"vendor": "NVIDIA", "model": "H100"}
        assert server.power_watts == 10000
        assert server.u_height == 8

    def test_device_profile_none(self):
        """无设备档案"""
        server = NetworkObject(name="Server", obj_type="server")
        assert server.device_profile is None
        assert server.power_watts == 0
        assert server.u_height == 1

    # ---- 机柜字段 ----

    def test_cabinet_assignment(self):
        """机柜分配"""
        server = NetworkObject(name="Server", obj_type="server")
        server.cabinet_id = 1
        server.cabinet_name = "A01"
        server.start_u = 1
        server.end_u = 8
        assert server.cabinet_id == 1
        assert server.cabinet_name == "A01"
        assert server.start_u == 1
        assert server.end_u == 8

    # ---- get_next_port 兼容性 ----

    def test_get_next_port_leaf(self):
        """Leaf的get_next_port"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=64)
        # 先获取下联端口
        ports = [leaf.get_next_port() for _ in range(32)]
        assert all(p.startswith("端口") for p in ports)
        # 下联用尽后自动切换到上联
        port = leaf.get_next_port()
        assert "端口" in port

    def test_get_next_port_core(self):
        """Core的get_next_port"""
        core = NetworkObject(name="Core", obj_type="param_core", max_ports=64)
        port = core.get_next_port()
        assert port == "端口1"

    def test_get_next_port_server(self):
        """Server的get_next_port"""
        server = NetworkObject(name="Server", obj_type="server", max_ports=8)
        port = server.get_next_port()
        assert port == "端口1"

    # ---- 非标准设备类型 ----

    def test_unknown_obj_type(self):
        """未知设备类型"""
        obj = NetworkObject(name="Unknown", obj_type="unknown", max_ports=10)
        assert obj.port_counter == 1
        assert obj.port_limit == 10
        # 应该能正常获取端口
        port = obj.get_server_port()
        assert port == "端口1"

    def test_access_switch_type(self):
        """接入交换机类型"""
        acc = NetworkObject(name="OOB接入_1", obj_type="oob_access", max_ports=48)
        # 接入交换机不是leaf/spine/core，按server处理
        assert hasattr(acc, 'port_counter')
        port = acc.get_server_port()
        assert port == "端口1"


class TestConnectionComprehensive:
    """Connection 综合测试"""

    def test_connection_all_fields(self):
        """所有字段填充"""
        conn = Connection(
            a_device="S1", a_port="NIC1", a_module="400G-QSFP56",
            z_device="L1", z_port="Eth1/0/1", z_module="400G-QSFP56",
            cable_type="MPO-16", description="服务器到Leaf",
            a_cabinet_id=1, a_cabinet_name="A01",
            a_start_u=1, a_end_u=8,
            z_cabinet_id=10, z_cabinet_name="C01",
            z_start_u=1, z_end_u=1,
        )
        assert conn.a_device == "S1"
        assert conn.a_cabinet_name == "A01"
        assert conn.z_cabinet_name == "C01"
        assert conn.a_start_u == 1
        assert conn.z_start_u == 1

    def test_connection_partial_cabinet(self):
        """部分机柜信息"""
        conn = Connection(
            "S1", "P1", "400G", "L1", "P2", "400G", "MPO", "test",
            a_cabinet_id=1,  # 只有A端机柜
        )
        assert conn.a_cabinet_id == 1
        assert conn.z_cabinet_id is None
        assert conn.a_cabinet_name == ""
        assert conn.z_cabinet_name == ""

    def test_connection_u_range(self):
        """U位范围"""
        conn = Connection(
            "S1", "P1", "400G", "L1", "P2", "400G", "MPO", "test",
            a_start_u=1, a_end_u=8,  # 8U服务器
            z_start_u=20, z_end_u=21,  # 2U交换机
        )
        assert conn.a_start_u == 1
        assert conn.a_end_u == 8
        assert conn.z_start_u == 20
        assert conn.z_end_u == 21


class TestNetworkObjectOddPortCounts:
    """奇数端口数交换机"""

    def test_odd_port_leaf(self):
        """奇数端口Leaf"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=49)
        # 49/2 = 24.5, floor = 24下联, ceil+1 = 26上联起始
        assert leaf.downlink_limit == 24
        assert leaf.uplink_counter == 26

    def test_odd_port_spine(self):
        """奇数端口Spine"""
        spine = NetworkObject(name="Spine", obj_type="param_spine", max_ports=49)
        assert spine.downlink_limit == 24
        assert spine.uplink_counter == 26

    def test_small_port_count(self):
        """小端口数设备"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=4)
        assert leaf.downlink_limit == 2
        assert leaf.uplink_counter == 3

    def test_single_port_device(self):
        """单端口设备"""
        leaf = NetworkObject(name="Leaf", obj_type="param_leaf", max_ports=1)
        assert leaf.downlink_limit == 0
        assert leaf.uplink_counter == 2
        with pytest.raises(ValueError, match="下联端口限制为0"):
            leaf.get_downlink_port()