"""AutoLink V2.7.6 - Scale-Up 拓扑 + 网络插件化测试

覆盖:
  - scaleup_topology.ScaleUpTopology:
    - 协议默认参数应用 (NVLink/UALink/UB)
    - 域划分 (domain_size / 自动切分)
    - 全对等连接数公式 N*(N-1)/2
    - 端口命名规则
    - 统计信息 (带宽/链路数)
    - to_dict_list 输出兼容 engine.py edge schema
  - network_plugin:
    - 插件注册/查询/注销
    - 内置 5 个插件 (param/storage/biz/oob/scale_up)
    - 插件化扩展性: 新增测试用插件注册后立即可用
"""
import sys
from pathlib import Path

import pytest

# 确保 backend 目录可导入
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from network_plugin import (  # noqa: E402
    NetworkPlugin,
    NetworkPluginInfo,
    NetworkTier,
    ParamNetworkPlugin,
    StorageNetworkPlugin,
    BizNetworkPlugin,
    OOBNetworkPlugin,
    ScaleUpNetworkPlugin,
    get_plugin,
    list_plugins,
    register_plugin,
    register_builtin_plugins,
    unregister_plugin,
)
from scaleup_topology import (  # noqa: E402
    ScaleUpConfig,
    ScaleUpProtocol,
    ScaleUpTopology,
    generate_scaleup_connections,
)


# ==================================================================
#  Scale-Up 拓扑
# ==================================================================

class TestScaleUpDefaults:
    """协议默认参数应用"""

    def test_ualink_defaults(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UALINK, num_gpus=1024)
        topo = ScaleUpTopology(cfg)
        assert cfg.bandwidth_per_link_gbps == 200
        assert cfg.num_links_per_gpu == 4
        assert cfg.domain_size == 1024

    def test_nvlink_defaults(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.NVLINK, num_gpus=72)
        topo = ScaleUpTopology(cfg)
        assert cfg.bandwidth_per_link_gbps == 1800
        assert cfg.num_links_per_gpu == 18
        assert cfg.domain_size == 72

    def test_ub_defaults(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UB, num_gpus=384)
        topo = ScaleUpTopology(cfg)
        assert cfg.bandwidth_per_link_gbps == 2800
        assert cfg.domain_size == 384

    def test_custom_values_override_defaults(self):
        cfg = ScaleUpConfig(
            protocol=ScaleUpProtocol.UB,
            num_gpus=384,
            bandwidth_per_link_gbps=500,
            domain_size=128,
        )
        ScaleUpTopology(cfg)
        assert cfg.bandwidth_per_link_gbps == 500
        assert cfg.domain_size == 128


class TestScaleUpDomains:
    """域划分"""

    def test_single_domain_when_less_than_max(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UALINK, num_gpus=256)
        topo = ScaleUpTopology(cfg)
        domains = topo.plan_domains()
        assert len(domains) == 1
        assert domains[0].gpu_ids == list(range(256))
        assert domains[0].is_full_mesh

    def test_multiple_domains(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UB, num_gpus=800, domain_size=384)
        topo = ScaleUpTopology(cfg)
        domains = topo.plan_domains()
        assert len(domains) == 3  # 384 + 384 + 32
        assert domains[0].gpu_ids == list(range(0, 384))
        assert domains[1].gpu_ids == list(range(384, 768))
        assert domains[2].gpu_ids == list(range(768, 800))
        assert len(domains[2].gpu_ids) == 32

    def test_zero_gpus_returns_empty(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UB, num_gpus=0)
        topo = ScaleUpTopology(cfg)
        assert topo.plan_domains() == []

    def test_bandwidth_per_gpu(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UB, num_gpus=384)
        topo = ScaleUpTopology(cfg)
        domains = topo.plan_domains()
        # UB: 1 link × 2800 Gbps = 2800
        assert domains[0].bandwidth_per_gpu_gbps == 2800


class TestScaleUpConnections:
    """全对等连接生成"""

    def test_full_mesh_connection_count(self):
        """域内 N GPU 全对等连接数 = N*(N-1)/2"""
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UALINK, num_gpus=8)
        topo = ScaleUpTopology(cfg)
        conns = topo.generate_connections()
        assert len(conns) == 8 * 7 // 2  # 28

    def test_nvlink_72_full_mesh(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.NVLINK, num_gpus=72)
        topo = ScaleUpTopology(cfg)
        conns = topo.generate_connections()
        assert len(conns) == 72 * 71 // 2  # 2556

    def test_port_naming(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UALINK, num_gpus=4)
        topo = ScaleUpTopology(cfg)
        conns = topo.generate_connections()
        # GPU_0 ↔ GPU_1: source_port=UALink_1, target_port=UALink_0
        pair = [c for c in conns if c.source == "GPU_0" and c.target == "GPU_1"][0]
        assert pair.source_port == "UALink_1"
        assert pair.target_port == "UALink_0"
        assert pair.protocol == "UALink"
        assert pair.bandwidth_gbps == 200
        assert pair.cable_type == "UALink-Cable"
        assert pair.domain_id == 0

    def test_multi_domain_connections_no_cross(self):
        """跨域 GPU 不生成连接"""
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UB, num_gpus=6, domain_size=3)
        topo = ScaleUpTopology(cfg)
        conns = topo.generate_connections()
        # 每域 3 GPU: 3*2/2 = 3 条, 共 6 条
        assert len(conns) == 6
        # GPU_0 只连接域内 GPU_1/GPU_2, 不连接 GPU_3
        srcs = {c.target for c in conns if c.source == "GPU_0"}
        assert srcs == {"GPU_1", "GPU_2"}


class TestScaleUpStats:
    """统计信息"""

    def test_stats_fields(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UALINK, num_gpus=1024)
        topo = ScaleUpTopology(cfg)
        stats = topo.get_stats()
        assert stats["topology_type"] == "scale_up_full_mesh"
        assert stats["protocol"] == "UALink"
        assert stats["num_gpus"] == 1024
        assert stats["num_nodes"] == 128  # 1024 / 8 per node
        assert stats["bandwidth_per_gpu"] == 800  # 4 × 200
        assert stats["num_domains"] == 1
        assert stats["total_connections"] == 1024 * 1023 // 2
        assert stats["total_bandwidth_gbps"] == stats["total_connections"] * 200

    def test_stats_domain_detail(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.UB, num_gpus=400, domain_size=384)
        topo = ScaleUpTopology(cfg)
        stats = topo.get_stats()
        assert stats["num_domains"] == 2
        assert stats["domains"][0]["num_gpus"] == 384
        assert stats["domains"][1]["num_gpus"] == 16
        assert stats["domains"][0]["is_full_mesh"] is True


class TestScaleUpExport:
    """导出格式 (engine.py edge schema 兼容)"""

    def test_to_dict_list_schema(self):
        cfg = ScaleUpConfig(protocol=ScaleUpProtocol.NVLINK, num_gpus=8)
        edges = generate_scaleup_connections(cfg)
        assert len(edges) == 28
        edge = edges[0]
        # engine.py schema 兼容字段
        assert edge["networkType"] == "scale_up"
        assert edge["network_type"] == "scale_up"
        assert "source" in edge and "target" in edge
        assert edge["speed"] == "1800G"
        assert edge["aSpeed"] == "1800G"
        assert "a_device" in edge and "z_device" in edge
        # Scale-Up 专用字段
        assert "domain_id" in edge
        assert "protocol" in edge
        assert edge["protocol"] == "NVLink"
        assert "cable_type" in edge


# ==================================================================
#  网络插件化
# ==================================================================

class TestPluginRegistry:
    """插件注册表"""

    def setup_method(self):
        register_builtin_plugins()

    def test_builtin_plugins_registered(self):
        plugins = list_plugins()
        assert set(plugins) == {"param", "storage", "biz", "oob", "scale_up", "zcube"}

    def test_get_plugin(self):
        plugin = get_plugin("param")
        assert plugin is not None
        assert isinstance(plugin, NetworkPlugin)
        assert plugin.get_info().display_name == "参数网"

    def test_get_unknown_plugin_returns_none(self):
        assert get_plugin("nonexistent") is None

    def test_unregister_plugin(self):
        assert unregister_plugin("oob") is True
        assert get_plugin("oob") is None
        assert unregister_plugin("oob") is False  # 二次注销失败

    def test_plugin_info_fields(self):
        info = get_plugin("scale_up").get_info()
        assert info.name == "scale_up"
        assert info.tier == NetworkTier.SCALE_UP
        assert info.protocols == ["NVLink", "UALink", "UB"]


class TestNetworkPlugins:
    """各插件默认配置与拓扑生成"""

    def setup_method(self):
        register_builtin_plugins()

    def test_param_plugin_default(self):
        plugin = get_plugin("param")
        cfg = plugin.get_default_config()
        assert cfg["speed"] == "400G"
        assert cfg["protocol"] == "RoCEv2"
        assert plugin.validate_config(cfg) == []
        topo = plugin.generate_topology(cfg)
        assert topo["network_type"] == "param"
        assert len(topo["nodes"]) > 0
        assert len(topo["edges"]) > 0
        assert "stats" in topo

    def test_param_plugin_validation(self):
        plugin = get_plugin("param")
        errors = plugin.validate_config({"num_servers": 0, "switch_ports": 64, "speed": "400G", "protocol": "RoCEv2"})
        assert any("num_servers" in e for e in errors)
        # 不支持的协议
        errors = plugin.validate_config({"num_servers": 8, "switch_ports": 64, "speed": "400G", "protocol": "Fiber"})
        assert any("不支持的协议" in e for e in errors)
        # 不支持的速率
        errors = plugin.validate_config({"num_servers": 8, "switch_ports": 64, "speed": "500G", "protocol": "RoCEv2"})
        assert any("不支持的速率" in e for e in errors)

    def test_storage_plugin(self):
        plugin = get_plugin("storage")
        cfg = plugin.get_default_config()
        assert plugin.validate_config(cfg) == []
        topo = plugin.generate_topology(cfg)
        assert topo["network_type"] == "storage"
        assert topo["stats"]["convergence_ratio"] > 0

    def test_biz_plugin(self):
        """V2.9.1: biz 业务网插件默认配置/校验/拓扑生成"""
        plugin = get_plugin("biz")
        cfg = plugin.get_default_config()
        assert cfg["speed"] == "25G"
        assert cfg["protocol"] == "Ethernet"
        assert plugin.validate_config(cfg) == []
        # 不支持的协议/速率
        assert any("不支持的协议" in e for e in plugin.validate_config(
            {"num_servers": 8, "switch_ports": 48, "speed": "25G", "protocol": "RoCEv2"}))
        assert any("不支持的速率" in e for e in plugin.validate_config(
            {"num_servers": 8, "switch_ports": 48, "speed": "400G", "protocol": "Ethernet"}))
        topo = plugin.generate_topology(cfg)
        assert topo["network_type"] == "biz"
        assert len(topo["nodes"]) > 0
        assert len(topo["edges"]) > 0
        assert topo["stats"]["convergence_ratio"] > 0

    def test_oob_plugin(self):
        """V2.9.1: oob 带外管理网插件默认配置/校验/拓扑生成"""
        plugin = get_plugin("oob")
        cfg = plugin.get_default_config()
        assert cfg["speed"] == "1G"
        assert cfg["protocol"] == "Ethernet"
        assert plugin.validate_config(cfg) == []
        # 1G 端口 + 48 端口 → 收敛比 > 1 (管理网收敛)
        topo = plugin.generate_topology(cfg)
        assert topo["network_type"] == "oob"
        assert len(topo["nodes"]) > 0
        assert len(topo["edges"]) > 0
        # 无效配置: 空 num_servers
        assert any("num_servers" in e for e in plugin.validate_config(
            {"num_servers": 0, "switch_ports": 48, "speed": "1G", "protocol": "Ethernet"}))

    def test_scale_up_plugin(self):
        plugin = get_plugin("scale_up")
        cfg = plugin.get_default_config()
        assert cfg["protocol"] == "UALink"
        assert plugin.validate_config(cfg) == []
        topo = plugin.generate_topology(cfg)
        assert topo["network_type"] == "scale_up"
        assert topo["stats"]["protocol"] == "UALink"
        assert topo["stats"]["total_connections"] == 1024 * 1023 // 2
        # 节点为 GPU 类型
        gpu_nodes = [n for n in topo["nodes"] if n["type"] == "gpu"]
        assert len(gpu_nodes) == 1024

    def test_scale_up_plugin_validation(self):
        plugin = get_plugin("scale_up")
        errors = plugin.validate_config({"protocol": "Foo", "num_gpus": 8, "gpus_per_node": 8})
        assert any("不支持的协议" in e for e in errors)
        errors = plugin.validate_config({"protocol": "UB", "num_gpus": 0, "gpus_per_node": 8})
        assert any("num_gpus" in e for e in errors)


class TestPluginExtensibility:
    """插件化扩展性: 新增测试用网络插件验证可扩展性 (PRD 验收)"""

    def test_custom_plugin_registration(self):
        class QuantumNetworkPlugin(NetworkPlugin):
            """测试用: 量子计算网络插件"""

            def get_info(self) -> NetworkPluginInfo:
                return NetworkPluginInfo(
                    name="quantum",
                    display_name="量子计算网",
                    tier=NetworkTier.SCALE_OUT,
                    protocols=["QPU-Link"],
                    description="测试用量子计算互联网络",
                )

            def validate_config(self, config):
                errors = []
                if config.get("num_qpus", 0) <= 0:
                    errors.append("num_qpus 必须大于 0")
                return errors

            def generate_topology(self, config):
                n = config.get("num_qpus", 0)
                return {
                    "network_type": "quantum",
                    "nodes": [{"id": f"QPU_{i}", "type": "qpu"} for i in range(n)],
                    "edges": [],
                    "stats": {"num_qpus": n, "num_nodes": n},
                }

            def get_default_config(self):
                return {"num_qpus": 16}

        # 注册自定义插件
        register_plugin("quantum", QuantumNetworkPlugin())
        try:
            plugin = get_plugin("quantum")
            assert plugin is not None
            assert plugin.get_info().display_name == "量子计算网"
            assert plugin.validate_config({"num_qpus": 16}) == []
            assert plugin.validate_config({"num_qpus": 0}) != []
            topo = plugin.generate_topology({"num_qpus": 16})
            assert topo["network_type"] == "quantum"
            assert len(topo["nodes"]) == 16
            # 注册后可被列出
            assert "quantum" in list_plugins()
        finally:
            unregister_plugin("quantum")
        assert get_plugin("quantum") is None
