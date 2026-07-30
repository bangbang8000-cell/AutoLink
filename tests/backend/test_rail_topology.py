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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
