"""
AutoLink V2.4.6 — Rail-Optimized 拓扑测试
验证 NVIDIA SuperPOD 8-Rail 架构集成与功能正确性
"""
import os
import sys
import json
import tempfile
import pytest

# 添加 backend 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from rail_topology import RailOptimizedTopology
from designer import NetworkDesignerV2


class TestRailOptimizedTopology:
    """Rail-Optimized 拓扑算法单元测试"""

    def test_calculate_hierarchy_8rail_128servers(self):
        """128 服务器 8 Rail 层次结构"""
        rail_topo = RailOptimizedTopology(num_servers=128, num_rails=8, switch_ports=64)
        leaves, spines, cores = rail_topo.calculate_hierarchy()

        # 128/8=16 服务器/Rail, downlink_per_leaf=32, leaves_per_rail=ceil(16/32)=1
        # 总 Leaf = 8 × 1 = 8
        assert leaves == 8, f"Expected 8 leaves, got {leaves}"
        # Spine = Leaf = 8
        assert spines == 8, f"Expected 8 spines, got {spines}"
        # 8 Spine / 64 端口 = 1 Core
        assert cores >= 1, f"Expected ≥1 core, got {cores}"

    def test_create_network_objects_rail_fields(self):
        """Rail 设备携带 rail_id/rail_role 字段"""
        rail_topo = RailOptimizedTopology(num_servers=64, num_rails=8, switch_ports=64)
        rail_topo.create_network_objects()

        # Leaf: 检查 rail_id 和 rail_role
        assert len(rail_topo.leaves) > 0
        for leaf in rail_topo.leaves:
            assert leaf.rail_id is not None, f"Leaf {leaf.name} rail_id is None"
            assert leaf.rail_role == "rail_leaf", f"Leaf {leaf.name} rail_role wrong"
            assert 0 <= leaf.rail_id < 8, f"Leaf rail_id out of range: {leaf.rail_id}"

        # Spine: 检查 rail_id 和 rail_role
        for spine in rail_topo.spines:
            assert spine.rail_id is not None
            assert spine.rail_role == "rail_spine"

    def test_generate_connections_server_to_leaf(self):
        """服务器 → Rail Leaf 连接"""
        rail_topo = RailOptimizedTopology(num_servers=32, num_rails=8, switch_ports=64)
        rail_topo.create_network_objects()
        conns = rail_topo.generate_connections()

        # 应有 32 条服务器→Leaf 连接（每服务器 1 NIC）
        server_leaf_conns = [c for c in conns if c.a_device.startswith("Server_") or c.z_device.startswith("Server_")]
        assert len(server_leaf_conns) == 32, f"Expected 32 server-leaf conns, got {len(server_leaf_conns)}"

    def test_generate_connections_leaf_spine(self):
        """Rail 内 Leaf ↔ Spine 全互联"""
        rail_topo = RailOptimizedTopology(num_servers=32, num_rails=8, switch_ports=64)
        rail_topo.create_network_objects()
        conns = rail_topo.generate_connections()

        # Leaf-Spine 连接应为 Rail 数 × (Leaf/Rail × Spine/Rail)
        leaves, spines, _ = rail_topo.calculate_hierarchy()
        leaves_per_rail = leaves // 8
        spines_per_rail = spines // 8
        expected_ls = 8 * leaves_per_rail * spines_per_rail
        ls_conns = [c for c in conns if "Leaf" in c.a_device and "Spine" in c.z_device]
        assert len(ls_conns) == expected_ls, f"Expected {expected_ls} LS conns, got {len(ls_conns)}"

    def test_get_topology_summary(self):
        """拓扑摘要"""
        rail_topo = RailOptimizedTopology(num_servers=128, num_rails=8, switch_ports=64)
        rail_topo.create_network_objects()
        rail_topo.generate_connections()
        summary = rail_topo.get_topology_summary()

        assert summary["topology_type"] == "rail_optimized"
        assert summary["num_rails"] == 8
        assert summary["num_servers"] == 128
        assert len(summary["rail_groups"]) == 8


class TestRailOptimizedIntegration:
    """Rail-Optimized 与 NetworkDesignerV2 集成测试"""

    def _create_rail_project(self, num_servers=128):
        """创建 Rail-Optimized 项目配置"""
        config = {
            "topology": {
                "num_gpu_servers": num_servers,
                "param_ports_per_server": 8,
                "param_switch_ports": 64,
                "param_speed": "400G",
                "rail_mode": "rail_optimized",
                "rail_count": 8,
                "downlink_mode": "custom",
            },
            "networks": {
                "param_network": True,
                "storage_network": False,
                "biz_network": False,
                "oob_network": False,
            },
            "rack_config": {
                "rack_type": 42,
                "power_limit_per_rack": 6000,
            },
            "device_refs": {},
        }

        tmpdir = tempfile.mkdtemp()
        config_path = os.path.join(tmpdir, "project_config.json")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f)
        return config_path, tmpdir

    def test_designer_rail_mode_standard_default(self):
        """默认 rail_mode 为 standard"""
        config = {
            "topology": {"num_gpu_servers": 10, "param_switch_ports": 64, "param_speed": "400G"},
            "networks": {"param_network": True, "storage_network": False, "biz_network": False, "oob_network": False},
            "rack_config": {},
            "device_refs": {},
        }
        tmpdir = tempfile.mkdtemp()
        config_path = os.path.join(tmpdir, "project_config.json")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f)

        designer = NetworkDesignerV2(config_path)
        assert designer.rail_mode == "standard"
        assert designer.rail_count == 8

    def test_designer_rail_mode_optimized(self):
        """rail_optimized 模式加载"""
        config_path, tmpdir = self._create_rail_project(128)
        try:
            designer = NetworkDesignerV2(config_path)
            assert designer.rail_mode == "rail_optimized"
            assert designer.rail_count == 8
        finally:
            import shutil
            shutil.rmtree(tmpdir)

    def test_designer_rail_mode_creates_rail_switches(self):
        """Rail 模式创建带 rail_id 的交换机"""
        config_path, tmpdir = self._create_rail_project(64)
        try:
            designer = NetworkDesignerV2(config_path)

            # 参数 Leaf 应携带 rail_id
            assert len(designer.param_leaves) > 0
            for leaf in designer.param_leaves:
                assert leaf.rail_id is not None, f"Leaf {leaf.name} rail_id None"
                assert leaf.rail_role == "rail_leaf"

            # 参数 Spine 应携带 rail_id
            for spine in designer.param_spines:
                assert spine.rail_id is not None
                assert spine.rail_role == "rail_spine"

            # GPU 服务器应携带 rail_id
            for server in designer.servers[:designer.num_servers]:
                assert server.rail_id is not None, f"Server {server.name} rail_id None"
                assert server.rail_role == "server_rail_endpoint"
        finally:
            import shutil
            shutil.rmtree(tmpdir)

    def test_designer_rail_mode_generates_connections(self):
        """Rail 模式生成连接"""
        config_path, tmpdir = self._create_rail_project(64)
        try:
            designer = NetworkDesignerV2(config_path)

            # 服务器应有连接
            gpu_servers = designer.servers[:designer.num_servers]
            assert any(len(s.connections) > 0 for s in gpu_servers), "GPU 服务器无连接"

            # Leaf 应有连接
            assert any(len(l.connections) > 0 for l in designer.param_leaves), "Leaf 无连接"

            # Spine 应有连接
            assert any(len(s.connections) > 0 for s in designer.param_spines), "Spine 无连接"
        finally:
            import shutil
            shutil.rmtree(tmpdir)


class TestRailOptimizedV272Fixes:
    """v2.7.2 修复验证:B2/B3/B4"""

    def test_b2_module_non_empty(self):
        """B2: a_module/z_module 非空(使用 network_speed)"""
        rail_topo = RailOptimizedTopology(
            num_servers=32, num_rails=8, switch_ports=64, network_speed="400G"
        )
        rail_topo.create_network_objects()
        conns = rail_topo.generate_connections()

        # 所有连接的 a_module/z_module 应为 "400G"(非空)
        for c in conns:
            assert c.a_module == "400G", f"Conn {c.a_device}->{c.z_device} a_module empty: '{c.a_module}'"
            assert c.z_module == "400G", f"Conn {c.a_device}->{c.z_device} z_module empty: '{c.z_module}'"

    def test_b3_port_names_use_counter(self):
        """B3: 端口名使用计数器(非静态 'Uplink'/'Downlink')"""
        rail_topo = RailOptimizedTopology(
            num_servers=32, num_rails=8, switch_ports=64, network_speed="400G"
        )
        rail_topo.create_network_objects()
        conns = rail_topo.generate_connections()

        # Leaf-Spine 连接的端口名不应是静态 "Uplink"/"Downlink"
        ls_conns = [c for c in conns if "Leaf" in c.a_device and "Spine" in c.z_device]
        assert len(ls_conns) > 0
        # 端口名应是计数器生成的(包含数字),而非静态 "Uplink"/"Downlink"
        for c in ls_conns:
            assert c.a_port != "Uplink", f"Leaf {c.a_device} 端口名仍为静态 'Uplink'"
            assert c.z_port != "Downlink", f"Spine {c.z_device} 端口名仍为静态 'Downlink'"

        # Spine-Core 连接同样验证
        sc_conns = [c for c in conns if "Spine" in c.a_device and "Core" in c.z_device]
        for c in sc_conns:
            assert c.a_port != "Uplink", f"Spine {c.a_device} 端口名仍为静态 'Uplink'"

        # 多 Leaf 场景验证端口名递增
        rail_topo2 = RailOptimizedTopology(
            num_servers=256, num_rails=8, switch_ports=64, network_speed="400G"
        )
        rail_topo2.create_network_objects()
        conns2 = rail_topo2.generate_connections()
        ls_conns2 = [c for c in conns2 if "Leaf" in c.a_device and "Spine" in c.z_device]
        # 256 服务器 / 8 Rail = 32 服务器/Rail, downlink_per_leaf=32, leaves_per_rail=1
        # 实际上 256/8=32, 32/32=1 Leaf/Rail, 仍然 1 Leaf 1 Spine
        # 改为 512 服务器确保多 Leaf
        rail_topo3 = RailOptimizedTopology(
            num_servers=512, num_rails=8, switch_ports=64, network_speed="400G"
        )
        rail_topo3.create_network_objects()
        conns3 = rail_topo3.generate_connections()
        ls_conns3 = [c for c in conns3 if "Leaf" in c.a_device and "Spine" in c.z_device]
        # 512/8=64, 64/32=2 Leaf/Rail, 2 Spine/Rail, 每 Rail 4 LS 连接
        assert len(ls_conns3) >= 8 * 2 * 2, f"LS 连接数不足: {len(ls_conns3)}"
        a_ports3 = {c.a_port for c in ls_conns3}
        # 多 Leaf 场景下 a_port 应有多种(每 Leaf 的 uplink_counter 不同)
        assert len(a_ports3) >= 2, f"多 Leaf 场景端口名仍单一: {a_ports3}"

    def test_b4_interleaved_server_allocation(self):
        """B4: 服务器交错分配(server_i → rail = i % num_rails)"""
        rail_topo = RailOptimizedTopology(
            num_servers=32, num_rails=8, switch_ports=64, network_speed="400G"
        )
        rail_topo.create_network_objects()
        server_names = [f"Server_{i+1}" for i in range(32)]
        conns = rail_topo.generate_connections(server_names)

        # Server_1(i=0) → rail 0, Server_2(i=1) → rail 1, ..., Server_9(i=8) → rail 0
        # 通过 NIC 端口名验证: NIC{rail}
        server_nic_map = {}
        for c in conns:
            if c.a_device.startswith("Server_"):
                server_idx = int(c.a_device.split("_")[1]) - 1  # 0-based
                rail = int(c.a_port.replace("NIC", ""))
                server_nic_map[server_idx] = rail

        # 验证交错分配
        for i, rail in server_nic_map.items():
            expected_rail = i % 8
            assert rail == expected_rail, \
                f"Server_{i+1}(i={i}) 应分配到 Rail {expected_rail}, 实际 Rail {rail}"

    def test_b4_designer_server_rail_id_interleaved(self):
        """B4: designer 中服务器 rail_id 也是交错分配"""
        config = {
            "topology": {
                "num_gpu_servers": 16,
                "param_ports_per_server": 8,
                "param_switch_ports": 64,
                "param_speed": "400G",
                "rail_mode": "rail_optimized",
                "rail_count": 8,
                "downlink_mode": "custom",
            },
            "networks": {
                "param_network": True,
                "storage_network": False,
                "biz_network": False,
                "oob_network": False,
            },
            "rack_config": {},
            "device_refs": {},
        }
        tmpdir = tempfile.mkdtemp()
        config_path = os.path.join(tmpdir, "project_config.json")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f)
        try:
            designer = NetworkDesignerV2(config_path)
            for idx, server in enumerate(designer.servers[:designer.num_servers]):
                expected_rail = idx % 8
                assert server.rail_id == expected_rail, \
                    f"Server idx={idx} rail_id={server.rail_id}, expected {expected_rail}"
        finally:
            import shutil
            shutil.rmtree(tmpdir)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
