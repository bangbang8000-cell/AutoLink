"""
测试 backend/topology.py - FatTreeTopology 和 AccessAggTopology
"""
import pytest

from topology import FatTreeTopology, AccessAggTopology, calc_max_2tier, calc_leafs_per_pod
from models import NetworkObject


class TestCalcMax2Tier:
    """calc_max_2tier 测试"""

    def test_standard_case(self):
        """标准情况: 64口交换机, 8网卡/服务器"""
        result = calc_max_2tier(64, 8)
        assert result == 128  # 64^2 / (4*8) = 4096/32 = 128

    def test_large_switch(self):
        """128口交换机"""
        result = calc_max_2tier(128, 8)
        assert result == 512  # 128^2 / (4*8) = 16384/32 = 512

    def test_zero_ports_per_server(self):
        """ports_per_server 为 0"""
        result = calc_max_2tier(64, 0)
        assert result == 0

    def test_single_port(self):
        """单网卡"""
        result = calc_max_2tier(64, 1)
        assert result == 1024  # 64^2 / 4 = 1024


class TestFatTreeTopology:
    """FatTreeTopology 测试"""

    def test_calculate_hierarchy_2tier(self):
        """小规模服务器 - 2层组网"""
        topo = FatTreeTopology(8, 64, "400G", {}, "param")
        is_3tier, leaves, spines, cores = topo.calculate_hierarchy(64)
        assert not is_3tier
        assert leaves is None
        assert spines is None
        assert cores is None

    def test_calculate_hierarchy_3tier(self):
        """大规模服务器 - 3层组网"""
        topo = FatTreeTopology(8, 64, "400G", {}, "param")
        is_3tier, leaves, spines, cores = topo.calculate_hierarchy(256)
        assert is_3tier
        assert leaves is not None
        assert spines is not None
        assert cores is not None
        assert leaves > 0
        assert spines > 0
        assert cores > 0

    def test_create_network_objects(self):
        """创建网络对象"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        topo.create_network_objects(num_pods=2, servers_per_pod=64)

        assert len(topo.leaves) > 0
        assert len(topo.spines) > 0
        assert len(topo.cores) > 0
        # 检查命名
        assert "参数Leaf_P1_1" in [l.name for l in topo.leaves]
        assert "参数Spine_1" in [s.name for s in topo.spines]
        assert "参数Core_1" in [c.name for c in topo.cores]

    def test_generate_connections(self):
        """生成连接关系"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        topo.create_network_objects(num_pods=2, servers_per_pod=64)

        # 创建服务器
        servers = []
        for i in range(1, 9):
            s = NetworkObject(name=f"GPU服务器_{i}", obj_type="server", max_ports=8)
            s.port_prefix = "参数网卡"
            servers.append(s)

        connections = topo.generate_connections(servers, 2, 64)
        assert len(connections) > 0

    def test_connect_leaves_to_spines_no_pods(self):
        """num_pods为0时安全返回"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        connections = []
        topo._connect_leaves_to_spines(0, connections)
        assert len(connections) == 0

    def test_connect_spines_to_cores_no_cores(self):
        """无Core时安全返回"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        connections = []
        topo._connect_spines_to_cores(connections)
        assert len(connections) == 0


class TestAccessAggTopology:
    """AccessAggTopology 测试"""

    def test_calculate_single(self):
        """单链路模式计算"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            redundancy=False, downlink_limit=25
        )
        info = topo.calculate(100)
        assert info['num_servers'] == 100
        assert info['servers_per_access'] == 25
        assert info['num_access'] == 4  # ceil(100/25)
        assert info['num_agg'] > 0

    def test_calculate_redundant(self):
        """冗余模式计算"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            redundancy=True, downlink_limit=25
        )
        info = topo.calculate(100)
        assert info['redundancy'] is True
        assert info['num_access'] == 8  # ceil(100/25) * 2

    def test_servers_per_access_zero_safe(self):
        """servers_per_access为0时安全"""
        topo = AccessAggTopology(
            access_down_ports=0, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            redundancy=False, downlink_limit=0
        )
        info = topo.calculate(100)
        # 应该至少为1, 不会除零
        assert info['servers_per_access'] >= 1