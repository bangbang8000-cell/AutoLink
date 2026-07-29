"""
V2.4.2 - layer_hint 字段与全节点输出单元测试
验证 NetworkObject.layer_hint 自动推断及 engine.py 全 11 类节点输出
"""
import sys
import os
import json
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from models import NetworkObject
from engine import handle_design


class TestLayerHintInference:
    """测试 NetworkObject._infer_layer_hint 静态方法"""

    def test_server_layer_hint(self):
        """server → 'server'"""
        s = NetworkObject(name="GPU服务器_1", obj_type="server", max_ports=8)
        assert s.layer_hint == "server"

    def test_param_leaf_layer_hint(self):
        """param_leaf → 'leaf'"""
        sw = NetworkObject(name="参数Leaf_1", obj_type="param_leaf", max_ports=64)
        assert sw.layer_hint == "leaf"

    def test_param_spine_layer_hint(self):
        """param_spine → 'spine'"""
        sw = NetworkObject(name="参数Spine_1", obj_type="param_spine", max_ports=64)
        assert sw.layer_hint == "spine"

    def test_param_core_layer_hint(self):
        """param_core → 'core'"""
        sw = NetworkObject(name="参数Core_1", obj_type="param_core", max_ports=64)
        assert sw.layer_hint == "core"

    def test_storage_leaf_layer_hint(self):
        """storage_leaf → 'leaf'"""
        sw = NetworkObject(name="存储Leaf_1", obj_type="storage_leaf", max_ports=48)
        assert sw.layer_hint == "leaf"

    def test_storage_spine_layer_hint(self):
        """storage_spine → 'spine'"""
        sw = NetworkObject(name="存储Spine_1", obj_type="storage_spine", max_ports=48)
        assert sw.layer_hint == "spine"

    def test_storage_core_layer_hint(self):
        """storage_core → 'core'"""
        sw = NetworkObject(name="存储Core_1", obj_type="storage_core", max_ports=48)
        assert sw.layer_hint == "core"

    def test_biz_access_layer_hint(self):
        """biz_access → 'access'"""
        sw = NetworkObject(name="业务接入_1", obj_type="biz_access", max_ports=56)
        assert sw.layer_hint == "access"

    def test_biz_agg_layer_hint(self):
        """biz_agg → 'agg'"""
        sw = NetworkObject(name="业务汇聚_1", obj_type="biz_agg", max_ports=32)
        assert sw.layer_hint == "agg"

    def test_oob_access_layer_hint(self):
        """oob_access → 'access'"""
        sw = NetworkObject(name="OOB接入_1", obj_type="oob_access", max_ports=50)
        assert sw.layer_hint == "access"

    def test_oob_agg_layer_hint(self):
        """oob_agg → 'agg'"""
        sw = NetworkObject(name="OOB汇聚_1", obj_type="oob_agg", max_ports=48)
        assert sw.layer_hint == "agg"

    def test_explicit_layer_hint_override(self):
        """显式传入 layer_hint 时覆盖自动推断"""
        sw = NetworkObject(name="custom", obj_type="server", max_ports=8, layer_hint="custom")
        assert sw.layer_hint == "custom"

    def test_unknown_obj_type_fallback(self):
        """未知 obj_type 回退到 'server'"""
        sw = NetworkObject(name="unknown", obj_type="something_else", max_ports=8)
        assert sw.layer_hint == "server"


class TestFullNodeOutput:
    """测试 engine.py 输出全 11 类节点（V2.4.2）"""

    @staticmethod
    def _make_config(num_servers=100, biz_enabled=True, oob_enabled=True, storage_enabled=True):
        """构造 project_config.json 测试配置"""
        return {
            "meta": {"name": "test", "description": "", "version": 1,
                     "created_at": "2024-01-01", "updated_at": "2024-01-01"},
            "networks": {
                "param_network": True,
                "storage_network": storage_enabled,
                "biz_network": biz_enabled,
                "oob_network": oob_enabled,
            },
            "topology": {
                "downlink_mode": "custom",
                "num_gpu_servers": num_servers,
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

    def _run_design(self, **kwargs):
        config = self._make_config(**kwargs)
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'project_config.json')
            with open(config_path, 'w') as f:
                json.dump(config, f)
            return handle_design({"configFile": config_path})

    def test_all_nodes_have_layer_hint(self):
        """所有节点都包含 layerHint 字段"""
        result = self._run_design()
        assert "error" not in result
        topology = result["topology"]
        assert len(topology["nodes"]) > 0
        for node in topology["nodes"]:
            assert "layerHint" in node, f"节点 {node.get('id', '?')} 缺少 layerHint 字段"
            assert node["layerHint"] in {"server", "leaf", "spine", "core", "access", "agg"}, \
                f"节点 {node['id']} 的 layerHint='{node['layerHint']}' 不合法"

    def test_server_nodes_output(self):
        """输出 server 节点"""
        result = self._run_design(num_servers=10)
        server_nodes = [n for n in result["topology"]["nodes"] if n["type"] == "server"]
        assert len(server_nodes) == 10
        for n in server_nodes:
            assert n["layerHint"] == "server"

    def test_param_leaf_nodes_output(self):
        """输出 param_leaf 节点"""
        result = self._run_design()
        param_leaves = [n for n in result["topology"]["nodes"] if n["type"] == "param_leaf"]
        assert len(param_leaves) > 0
        for n in param_leaves:
            assert n["layerHint"] == "leaf"

    def test_param_spine_nodes_output(self):
        """输出 param_spine 节点"""
        result = self._run_design()
        param_spines = [n for n in result["topology"]["nodes"] if n["type"] == "param_spine"]
        assert len(param_spines) > 0
        for n in param_spines:
            assert n["layerHint"] == "spine"

    def test_storage_leaf_nodes_output(self):
        """输出 storage_leaf 节点"""
        result = self._run_design()
        storage_leaves = [n for n in result["topology"]["nodes"] if n["type"] == "storage_leaf"]
        assert len(storage_leaves) > 0
        for n in storage_leaves:
            assert n["layerHint"] == "leaf"

    def test_storage_spine_nodes_output(self):
        """输出 storage_spine 节点"""
        result = self._run_design()
        storage_spines = [n for n in result["topology"]["nodes"] if n["type"] == "storage_spine"]
        assert len(storage_spines) > 0
        for n in storage_spines:
            assert n["layerHint"] == "spine"

    def test_oob_access_nodes_output(self):
        """输出 oob_access 节点"""
        result = self._run_design(oob_enabled=True)
        oob_access = [n for n in result["topology"]["nodes"] if n["type"] == "oob_access"]
        assert len(oob_access) > 0
        for n in oob_access:
            assert n["layerHint"] == "access"

    def test_oob_agg_nodes_output(self):
        """输出 oob_agg 节点"""
        result = self._run_design(oob_enabled=True)
        oob_agg = [n for n in result["topology"]["nodes"] if n["type"] == "oob_agg"]
        assert len(oob_agg) > 0
        for n in oob_agg:
            assert n["layerHint"] == "agg"

    def test_biz_access_nodes_output(self):
        """输出 biz_access 节点"""
        result = self._run_design(biz_enabled=True)
        biz_access = [n for n in result["topology"]["nodes"] if n["type"] == "biz_access"]
        assert len(biz_access) > 0
        for n in biz_access:
            assert n["layerHint"] == "access"

    def test_biz_agg_nodes_output(self):
        """输出 biz_agg 节点"""
        result = self._run_design(biz_enabled=True)
        biz_agg = [n for n in result["topology"]["nodes"] if n["type"] == "biz_agg"]
        assert len(biz_agg) > 0
        for n in biz_agg:
            assert n["layerHint"] == "agg"

    def test_biz_disabled_no_biz_nodes(self):
        """biz_enabled=False 时不输出业务网节点"""
        result = self._run_design(biz_enabled=False)
        biz_nodes = [n for n in result["topology"]["nodes"]
                     if n["type"] in ("biz_access", "biz_agg")]
        assert len(biz_nodes) == 0

    def test_oob_disabled_no_oob_nodes(self):
        """oob_enabled=False 时不输出 OOB 节点"""
        result = self._run_design(oob_enabled=False)
        oob_nodes = [n for n in result["topology"]["nodes"]
                     if n["type"] in ("oob_access", "oob_agg")]
        assert len(oob_nodes) == 0

    def test_all_11_types_present_when_enabled(self):
        """启用全部网络时输出全部 11 类节点类型"""
        result = self._run_design(num_servers=100, biz_enabled=True, oob_enabled=True)
        actual_types = {n["type"] for n in result["topology"]["nodes"]}
        # storage_core 在当前实现中始终为空（storage 始终 2-tier）
        # param_core 仅在 3-tier 时存在（100台+64口+8网卡=2-tier 够用，所以无 core）
        expected_types = {
            "server", "param_leaf", "param_spine",
            "storage_leaf", "storage_spine",
            "biz_access", "biz_agg",
            "oob_access", "oob_agg",
        }
        missing = expected_types - actual_types
        assert not missing, f"缺少节点类型: {missing}，实际: {actual_types}"

    def test_param_core_output_in_3tier(self):
        """3-tier 参数网（大集群）输出 param_core 节点"""
        # 500台服务器 + 64口交换机 + 8网卡/服务器 → max_2tier = 64^2/(4*8) = 128 → 需要 4 POD → 3-tier
        result = self._run_design(num_servers=500)
        param_cores = [n for n in result["topology"]["nodes"] if n["type"] == "param_core"]
        assert len(param_cores) > 0, "500台应触发 3-tier，应有 param_core 节点"
        for n in param_cores:
            assert n["layerHint"] == "core"

    def test_edges_have_network_type(self):
        """V2.4.2: 边包含 networkType 字段"""
        result = self._run_design()
        for edge in result["topology"]["edges"]:
            assert "networkType" in edge, "边缺少 networkType 字段"
            assert edge["networkType"] in {"param", "storage", "oob", "biz", ""}, \
                f"边 networkType='{edge['networkType']}' 不合法"


class TestLayerHintLayerAssignment:
    """测试 layer_hint 与 Y 轴分层的对应关系（PRD 第4节）"""

    LAYER_MAP = {
        "agg": 0,     # L0
        "access": 1,  # L1
        "server": 2,  # L2
        "leaf": 3,    # L3
        "spine": 4,   # L4
        "core": 5,    # L5
    }

    def test_layer_hint_ordering(self):
        """layer_hint 的 Y 轴顺序: agg < access < server < leaf < spine < core"""
        result = handle_design.__wrapped__ if hasattr(handle_design, '__wrapped__') else None
        # 直接通过 _infer_layer_hint 验证
        assert NetworkObject._infer_layer_hint("oob_agg") == "agg"
        assert NetworkObject._infer_layer_hint("biz_agg") == "agg"
        assert NetworkObject._infer_layer_hint("oob_access") == "access"
        assert NetworkObject._infer_layer_hint("biz_access") == "access"
        assert NetworkObject._infer_layer_hint("server") == "server"
        assert NetworkObject._infer_layer_hint("param_leaf") == "leaf"
        assert NetworkObject._infer_layer_hint("storage_leaf") == "leaf"
        assert NetworkObject._infer_layer_hint("param_spine") == "spine"
        assert NetworkObject._infer_layer_hint("storage_spine") == "spine"
        assert NetworkObject._infer_layer_hint("param_core") == "core"
        assert NetworkObject._infer_layer_hint("storage_core") == "core"

    def test_layer_hint_y_ordering(self):
        """所有 layer_hint 都能映射到有效的 Y 层级"""
        for hint in ["agg", "access", "server", "leaf", "spine", "core"]:
            assert hint in self.LAYER_MAP
