"""
AutoLink V2.1 - Topology 综合边界条件测试
覆盖 FatTreeTopology 和 AccessAggTopology 的极端场景
"""
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from topology import FatTreeTopology, AccessAggTopology, calc_max_2tier, calc_leafs_per_pod
from models import NetworkObject


class TestCalcFunctions:
    """calc 辅助函数边界测试"""

    def test_negative_ports_per_server(self):
        """负数ports_per_server应返回0"""
        assert calc_max_2tier(64, -1) == 0

    def test_very_large_switch(self):
        """极大端口数交换机"""
        result = calc_max_2tier(256, 8)
        assert result > 0
        # 256^2 / (4*8) = 65536/32 = 2048
        assert result == 2048

    def test_single_port_server(self):
        """单端口服务器"""
        result = calc_max_2tier(48, 1)
        assert result == 576  # 48^2 / 4 = 576

    def test_calc_leafs_per_pod_edge(self):
        """calc_leafs_per_pod 边界"""
        # 正常情况
        result = calc_leafs_per_pod(64, 8, 128)
        assert result > 0
        # 1 server case - 现在安全处理
        result = calc_leafs_per_pod(64, 8, 1)
        assert result >= 1  # 至少1个Leaf


class TestFatTreeTopologyEdgeCases:
    """FatTreeTopology 极端场景测试"""

    def test_zero_servers(self):
        """0台服务器"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        is_3tier, leaves, spines, cores = topo.calculate_hierarchy(0)
        assert not is_3tier

    def test_negative_servers(self):
        """负数服务器-应安全处理"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        is_3tier, leaves, spines, cores = topo.calculate_hierarchy(-10)
        assert not is_3tier

    def test_single_server(self):
        """单台服务器 - 2层"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        is_3tier, _, _, _ = topo.calculate_hierarchy(1)
        assert not is_3tier

    def test_servers_at_boundary(self):
        """服务器数量正好在2层/3层边界"""
        topo = FatTreeTopology(8, 64, "400G", {}, "param")
        max_2tier = calc_max_2tier(64, 8)
        # 正好最大2层数量
        is_3tier, _, _, _ = topo.calculate_hierarchy(max_2tier)
        assert not is_3tier
        # 超出1台
        is_3tier, _, _, _ = topo.calculate_hierarchy(max_2tier + 1)
        assert is_3tier

    def test_generate_connections_with_zero_pods(self):
        """num_pods为0"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        servers = [NetworkObject(name=f"GPU服务器_{i}", obj_type="server", max_ports=8)
                   for i in range(1, 5)]
        connections = topo.generate_connections(servers, 0, 64)
        # 应该安全返回空列表
        assert len(connections) == 0

    def test_generate_connections_with_invalid_server_names(self):
        """服务器名称格式异常 - 应安全跳过"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        topo.create_network_objects(num_pods=2, servers_per_pod=64)

        # 名称不含下划线+数字
        s = NetworkObject(name="GPU服务器", obj_type="server", max_ports=8)
        s.port_prefix = "参数网卡"
        connections = topo.generate_connections([s], 2, 64)
        # 应该安全处理，不崩溃（名称无效的服务器被跳过）
        assert isinstance(connections, list)

    def test_connect_leaves_to_spines_with_empty_spines(self):
        """无Spine交换机"""
        topo = FatTreeTopology(8, 64, "400G", {}, "param")
        connections = []
        topo._connect_leaves_to_spines(1, connections)
        assert len(connections) == 0

    def test_connect_spines_to_cores_without_core_limit(self):
        """Core没有core_limit属性"""
        topo = FatTreeTopology(8, 64, "400G", {
            'server_leaf': 'MPO', 'leaf_spine': 'MPO', 'spine_core': 'MPO'
        }, "param")
        # 创建Core但不设置core_limit
        core = NetworkObject(name="参数Core_1", obj_type="param_core", max_ports=64)
        topo.cores = [core]
        topo.spines = [NetworkObject(name="参数Spine_1", obj_type="param_spine", max_ports=64)]
        connections = []
        topo._connect_spines_to_cores(connections)
        # 不应崩溃（使用getattr fallback到max_ports）
        assert isinstance(connections, list)

    def test_storage_network_type(self):
        """存储网络类型"""
        topo = FatTreeTopology(2, 48, "200G", {
            'server_leaf': 'AOC', 'leaf_spine': 'AOC', 'spine_core': 'MPO'
        }, "storage")
        topo.create_network_objects(num_pods=1, servers_per_pod=48)
        assert "存储Leaf_P1_1" in [l.name for l in topo.leaves]


class TestAccessAggTopologyEdgeCases:
    """AccessAggTopology 极端场景测试"""

    def test_zero_servers(self):
        """0台服务器"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            downlink_limit=25
        )
        info = topo.calculate(0)
        assert info['num_servers'] == 0
        assert info['num_access'] >= 1  # 至少1台接入

    def test_single_server(self):
        """单台服务器"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            downlink_limit=25
        )
        info = topo.calculate(1)
        assert info['num_servers'] == 1
        assert info['num_access'] >= 1

    def test_chassis_aggregation(self):
        """框式汇聚"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            downlink_limit=25
        )
        info = topo.calculate(100, chassis_config={'enabled': True, 'frames': 2})
        assert info['num_agg'] == 2
        assert '框式' in info['agg_type']

    def test_create_and_connect_single(self):
        """创建并连接（单链路）"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            redundancy=False, downlink_limit=25
        )
        info = topo.calculate(2)
        servers = [NetworkObject(name=f"OOB服务器_{i}", obj_type="server", max_ports=1)
                   for i in range(1, 3)]
        topo.create_and_connect(servers, info['num_access'], info['num_agg'])
        assert len(topo.access_switches) > 0
        assert len(topo.agg_switches) > 0

    def test_create_and_connect_redundant(self):
        """创建并连接（冗余）"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            redundancy=True, downlink_limit=25
        )
        info = topo.calculate(2)
        servers = [NetworkObject(name=f"OOB服务器_{i}", obj_type="server", max_ports=1)
                   for i in range(1, 3)]
        topo.create_and_connect(servers, info['num_access'], info['num_agg'])
        assert len(topo.access_switches) > 0

    def test_redundant_odd_servers(self):
        """冗余模式-奇数台服务器"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            redundancy=True, downlink_limit=25
        )
        info = topo.calculate(3)
        servers = [NetworkObject(name=f"OOB服务器_{i}", obj_type="server", max_ports=1)
                   for i in range(1, 4)]
        topo.create_and_connect(servers, info['num_access'], info['num_agg'])
        # 不应崩溃

    def test_connect_access_to_agg_empty_agg(self):
        """无汇聚交换机时安全返回"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            downlink_limit=25
        )
        topo.access_switches = [NetworkObject(name="OOB接入_1", obj_type="oob_access", max_ports=48)]
        topo._connect_access_to_agg()
        # 不应崩溃

    def test_servers_exceed_access_capacity(self):
        """服务器数量超过接入交换机容量"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=2,
            agg_down_ports=48, downlink_speed="1G",
            uplink_speed="10G", cable_server_access="网线",
            cable_access_agg="光纤", network_name="OOB",
            downlink_limit=25
        )
        info = topo.calculate(1000)
        assert info['num_access'] > 0
        # 大量服务器应该产生更多接入交换机

    def test_biz_network_type(self):
        """业务网络类型"""
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=8,
            agg_down_ports=32, downlink_speed="25G",
            uplink_speed="100G", cable_server_access="光纤",
            cable_access_agg="光纤", network_name="Biz",
            downlink_limit=25
        )
        info = topo.calculate(50)
        assert info['servers_per_access'] == 25
        assert topo.network_name == 'Biz'