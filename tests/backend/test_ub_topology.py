"""AutoLink V2.9.1 - UB 统一总线拓扑测试（test_ub_topology.py 补缺）

覆盖:
  - UBConfig 默认值 (384 NPU / 8 per node / 2800 Gbps)
  - _divide_domains 域划分 (单域/多域/边界: size=0, size>=n, 末尾域不满)
  - generate_connections 全对等连接数公式 N*(N-1)/2
  - 端口命名规则 (UB_{j} / UB_{i})
  - get_stats 统计信息 (链路数/带宽/端口数)
  - to_dict_list 输出兼容 engine.py edge schema
  - generate_ub_connections 对外入口 (UBConfig / designer-like 两种形态)
  - generate_cloudmatrix384_ub_connections 快捷入口
"""
import sys
from pathlib import Path

import pytest

# 确保 backend 目录可导入
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from ub_topology import (  # noqa: E402
    UBConfig,
    UBTopology,
    generate_cloudmatrix384_ub_connections,
    generate_ub_connections,
)


# ==================================================================
#  UBConfig 默认值
# ==================================================================

class TestUBConfigDefaults:
    def test_defaults(self):
        cfg = UBConfig()
        assert cfg.num_npus == 384
        assert cfg.npus_per_node == 8
        assert cfg.ub_bandwidth_gbps == 2800.0
        assert cfg.num_cpus == 0
        assert cfg.ub_domain_size == 0
        assert cfg.protocol == "UB"

    def test_custom_values(self):
        cfg = UBConfig(num_npus=192, npus_per_node=16, ub_bandwidth_gbps=2000, num_cpus=96, ub_domain_size=48)
        assert cfg.num_npus == 192
        assert cfg.npus_per_node == 16
        assert cfg.ub_bandwidth_gbps == 2000
        assert cfg.ub_domain_size == 48


# ==================================================================
#  域划分
# ==================================================================

class TestDivideDomains:
    def test_single_domain_default(self):
        """ub_domain_size=0 → 全部 NPU 归入单域"""
        topo = UBTopology(UBConfig(num_npus=384, ub_domain_size=0))
        domains = topo._divide_domains()
        assert len(domains) == 1
        assert len(domains[0]) == 384
        assert domains[0][0] == 0
        assert domains[0][-1] == 383

    def test_single_domain_when_size_ge_n(self):
        """ub_domain_size >= n → 单域"""
        topo = UBTopology(UBConfig(num_npus=64, ub_domain_size=128))
        domains = topo._divide_domains()
        assert len(domains) == 1
        assert len(domains[0]) == 64

    def test_multi_domain_even(self):
        """多域均分"""
        topo = UBTopology(UBConfig(num_npus=96, ub_domain_size=32))
        domains = topo._divide_domains()
        assert len(domains) == 3
        assert [len(d) for d in domains] == [32, 32, 32]
        assert domains[1][0] == 32

    def test_multi_domain_last_partial(self):
        """末尾域不满"""
        topo = UBTopology(UBConfig(num_npus=100, ub_domain_size=32))
        domains = topo._divide_domains()
        assert len(domains) == 4
        assert [len(d) for d in domains] == [32, 32, 32, 4]

    def test_zero_npus(self):
        topo = UBTopology(UBConfig(num_npus=0))
        assert topo._divide_domains() == []


# ==================================================================
#  连接生成 (Full-Mesh)
# ==================================================================

class TestGenerateConnections:
    def test_full_mesh_count(self):
        """单域 N 个 NPU → N*(N-1)/2 条链路"""
        n = 16
        topo = UBTopology(UBConfig(num_npus=n))
        conns = topo.generate_connections()
        assert len(conns) == n * (n - 1) // 2

    def test_full_mesh_384(self):
        """CloudMatrix 384 单域全互联 → 73536 条"""
        topo = UBTopology(UBConfig(num_npus=384))
        conns = topo.generate_connections()
        assert len(conns) == 384 * 383 // 2 == 73536

    def test_multi_domain_total_links(self):
        """多域: 各域全对等求和 = sum(m_i*(m_i-1)/2)"""
        n, size = 100, 32
        topo = UBTopology(UBConfig(num_npus=n, ub_domain_size=size))
        conns = topo.generate_connections()
        # 32,32,32,4 → 496+496+496+6 = 1494
        assert len(conns) == 32 * 31 // 2 * 3 + 4 * 3 // 2

    def test_port_naming(self):
        """NPU_i → NPU_j 源端口 UB_{j}、目标端口 UB_{i}"""
        topo = UBTopology(UBConfig(num_npus=4))
        conns = topo.generate_connections()
        # 查找 NPU_0 → NPU_1
        conn01 = next(c for c in conns if c.source == "NPU_0" and c.target == "NPU_1")
        assert conn01.source_port == "UB_1"
        assert conn01.target_port == "UB_0"

    def test_each_pair_once(self):
        """无向对只生成一条 (source < target)"""
        topo = UBTopology(UBConfig(num_npus=8))
        conns = topo.generate_connections()
        pairs = {(c.source, c.target) for c in conns}
        assert len(pairs) == len(conns)
        for s, t in pairs:
            assert int(s.split("_")[1]) < int(t.split("_")[1])

    def test_domain_id_assigned(self):
        topo = UBTopology(UBConfig(num_npus=64, ub_domain_size=16))
        conns = topo.generate_connections()
        domain_ids = {c.domain_id for c in conns}
        assert domain_ids == {0, 1, 2, 3}

    def test_connection_fields(self):
        topo = UBTopology(UBConfig(num_npus=4))
        conn = topo.generate_connections()[0]
        assert conn.bandwidth_gbps == 2800.0
        assert conn.cable_type == "UB-Cable"
        assert conn.network_type == "ub"
        assert "UB 域" in conn.description

    def test_cache_reuse(self):
        topo = UBTopology(UBConfig(num_npus=8))
        c1 = topo.generate_connections()
        c2 = topo.generate_connections()
        assert c1 is c2


# ==================================================================
#  统计信息
# ==================================================================

class TestStats:
    def test_single_domain_stats(self):
        topo = UBTopology(UBConfig(num_npus=8))
        stats = topo.get_stats()
        assert stats["topology_type"] == "ub_full_mesh"
        assert stats["protocol"] == "UB"
        assert stats["num_npus"] == 8
        assert stats["num_domains"] == 1
        assert stats["total_links"] == 28
        assert stats["total_bandwidth_gbps"] == 28 * 2800.0
        assert stats["total_bandwidth_tbps"] == pytest.approx(28 * 2800.0 / 1000.0)
        assert stats["max_ports_per_npu"] == 7
        assert stats["per_npu_aggregate_bandwidth_gbps"] == 7 * 2800.0

    def test_multi_domain_stats(self):
        topo = UBTopology(UBConfig(num_npus=96, ub_domain_size=32))
        stats = topo.get_stats()
        assert stats["num_domains"] == 3
        assert len(stats["domains"]) == 3
        for d in stats["domains"]:
            assert d["num_links"] == 32 * 31 // 2
            assert d["ports_per_npu"] == 31

    def test_num_nodes(self):
        topo = UBTopology(UBConfig(num_npus=384, npus_per_node=8))
        stats = topo.get_stats()
        assert stats["num_nodes"] == 48

    def test_num_cpus_included(self):
        topo = UBTopology(UBConfig(num_npus=384, num_cpus=192))
        stats = topo.get_stats()
        assert stats["num_cpus"] == 192


# ==================================================================
#  engine.py edge schema 兼容
# ==================================================================

class TestDictList:
    def test_engine_schema_fields(self):
        topo = UBTopology(UBConfig(num_npus=8))
        edges = topo.to_dict_list()
        assert len(edges) == 28
        e = edges[0]
        # engine schema 兼容字段
        for key in ("a_device", "z_device", "a_port", "z_port", "speed", "aSpeed", "zSpeed",
                    "cableType", "networkType", "network_type", "aCabinetId", "zCabinetId"):
            assert key in e
        assert e["network_type"] == "ub"
        assert e["speed"] == "2800G"
        assert e["aCabinetId"] is None
        assert e["zCabinetId"] is None

    def test_ub_specific_fields_preserved(self):
        topo = UBTopology(UBConfig(num_npus=8))
        edges = topo.to_dict_list()
        assert "domain_id" in edges[0]
        assert edges[0]["cable_type"] == "UB-Cable"


# ==================================================================
#  对外入口
# ==================================================================

class TestGenerateUbConnections:
    def test_with_ubconfig(self):
        edges = generate_ub_connections(UBConfig(num_npus=8))
        assert len(edges) == 28
        assert edges[0]["network_type"] == "ub"

    def test_with_designer_like(self):
        class FakeDesigner:
            num_npus = 16
            npus_per_node = 8
            ub_bandwidth_gbps = 2800.0
            num_cpus = 0
            ub_domain_size = 0
            protocol = "UB"

        edges = generate_ub_connections(FakeDesigner())
        assert len(edges) == 16 * 15 // 2

    def test_with_designer_ub_config(self):
        class FakeDesigner:
            ub_config = UBConfig(num_npus=4, ub_bandwidth_gbps=1000)

        edges = generate_ub_connections(FakeDesigner())
        assert len(edges) == 6
        assert edges[0]["bandwidth_gbps"] == 1000

    def test_cloudmatrix384(self):
        edges = generate_cloudmatrix384_ub_connections()
        assert len(edges) == 73536
