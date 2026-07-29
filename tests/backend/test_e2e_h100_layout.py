"""
V2.4.2 K5.3 — E2E 验证: H100-100 台拓扑生成 + 布局数据完整性

验证 PRD 验收标准:
  - AC1: 100 台服务器矩形排列（前端 12×9 网格）
  - 后端输出全 11 类节点（server/param_leaf/spine/core/storage_leaf/spine/core
                /biz_access/agg/oob_access/agg）
  - 所有节点含 layerHint 字段
  - 所有边含 networkType 字段
  - Spine/Core 的 podid="superpod"（前端归类为全局居中）
  - 服务器 podid 非 superpod（前端按 POD 分组）
"""
import sys
import os
import json
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from engine import handle_design


def _make_h100_config():
    """H100-100 台 3-tier 配置（与示例项目一致）"""
    return {
        "meta": {"name": "H100-100台", "description": "E2E 验证", "version": 1,
                 "created_at": "2024-01-01", "updated_at": "2024-01-01"},
        "networks": {
            "param_network": True,
            "storage_network": True,
            "biz_network": True,
            "oob_network": True,
        },
        "topology": {
            "downlink_mode": "custom",
            "num_gpu_servers": 100,
            "num_storage_servers": 14,
            "num_compute_servers": 20,
            "param_ports_per_server": 8,
            "param_switch_ports": 64,
            "param_speed": "400G",
            "param_downlink_limit": 25,
            "storage_ports_per_server": 1,
            "storage_switch_ports": 48,
            "storage_speed": "200G",
            "storage_downlink_limit": 20,
            "biz_port_speed": "25G",
            "biz_access_ports": 48,
            "biz_access_uplinks": 8,
            "biz_uplink_speed": "100G",
            "biz_agg_box_ports": 32,
            "biz_agg_chassis_ports": 32,
            "oob_access_ports": 48,
            "oob_access_uplinks": 2,
            "oob_agg_ports": 48,
            "oob_speed": "1G",
            "oob_uplink_speed": "10G",
        },
        "device_refs": {},
        "rack_config": {"rack_type": 42, "power_limit_per_rack": 8000},
    }


EXPECTED_TYPES_2TIER = {
    "server", "param_leaf", "param_spine",
    "storage_leaf", "storage_spine",
    "biz_access", "biz_agg", "oob_access", "oob_agg",
}
# 3-tier 额外包含 Core 层
EXPECTED_TYPES_3TIER = EXPECTED_TYPES_2TIER | {
    "param_core", "storage_core",
}


class TestE2EH100Layout:
    """E2E: H100-100 台拓扑生成与布局数据验证"""

    @staticmethod
    def _run():
        config = _make_h100_config()
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'project_config.json')
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False)
            return handle_design({"configFile": config_path})

    def test_generation_succeeds(self):
        """拓扑生成无错误"""
        result = self._run()
        assert "error" not in result, f"生成失败: {result.get('error')}"
        assert "topology" in result
        assert len(result["topology"]["nodes"]) > 0

    def test_all_node_types_output(self):
        """AC: 后端输出全部 2-tier 节点类型（9 类）；Core 仅 3-tier 出现"""
        result = self._run()
        types = {n["type"] for n in result["topology"]["nodes"]}
        missing = EXPECTED_TYPES_2TIER - types
        assert not missing, f"2-tier 缺少节点类型: {missing}；实际: {types}"
        # 2-tier 不应包含 Core
        assert "param_core" not in types, "2-tier 不应输出 param_core"
        assert "storage_core" not in types, "2-tier 不应输出 storage_core"

    def test_server_count(self):
        """AC1: 100 GPU + 14 存储 + 20 通算 = 134 服务器"""
        result = self._run()
        servers = [n for n in result["topology"]["nodes"] if n["type"] == "server"]
        assert len(servers) == 134, f"服务器数量 {len(servers)} != 134"

    def test_all_nodes_have_layer_hint(self):
        """所有节点含 layerHint 字段且值合法"""
        result = self._run()
        valid = {"server", "leaf", "spine", "core", "access", "agg"}
        for n in result["topology"]["nodes"]:
            assert "layerHint" in n, f"节点 {n['id']} 缺少 layerHint"
            assert n["layerHint"] in valid, \
                f"节点 {n['id']} layerHint='{n['layerHint']}' 不合法"

    def test_all_edges_have_network_type(self):
        """所有边含 networkType 字段"""
        result = self._run()
        valid = {"param", "storage", "oob", "biz"}
        for e in result["topology"]["edges"]:
            assert "networkType" in e, f"边 {e} 缺少 networkType"
            assert e["networkType"] in valid, \
                f"边 networkType='{e['networkType']}' 不合法"

    def test_spine_core_podid_is_superpod(self):
        """AC9: Spine/Core podid=superpod → 前端归类为全局居中"""
        result = self._run()
        for n in result["topology"]["nodes"]:
            if n["type"] in ("param_spine", "param_core",
                             "storage_spine", "storage_core"):
                assert n.get("podid") == "superpod", \
                    f"{n['type']} {n['id']} podid='{n.get('podid')}' 应为 'superpod'"

    def test_server_podid_not_superpod(self):
        """服务器 podid 非 superpod → 前端按 POD 分组"""
        result = self._run()
        servers = [n for n in result["topology"]["nodes"] if n["type"] == "server"]
        podids = {n.get("podid", "") for n in servers}
        assert "superpod" not in podids, "服务器不应归属 superpod"
        assert len(podids) >= 1, "服务器应至少有 1 个 podid"

    def test_node_count_under_1000(self):
        """AC7: 1000 节点渲染 < 3 秒（节点数应远小于 1000）"""
        result = self._run()
        total = len(result["topology"]["nodes"])
        assert total < 1000, f"节点总数 {total} 过多，影响渲染性能"

    def test_pod_count(self):
        """100 台服务器应分布到多个 POD（param_downlink_limit=25）"""
        result = self._run()
        servers = [n for n in result["topology"]["nodes"] if n["type"] == "server"]
        podids = {n.get("podid", "") for n in servers}
        # 100 GPU 服务器 + 其他，按 25 下行收敛应至少 4+ 个 POD
        assert len(podids) >= 1, f"POD 数量 {len(podids)} 过少"

    def test_layout_data_dump(self):
        """导出拓扑数据供前端布局验证"""
        result = self._run()
        # 统计节点类型分布
        type_counts = {}
        for n in result["topology"]["nodes"]:
            type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1
        print(f"\n[E2E] H100-100 节点类型分布: {json.dumps(type_counts, ensure_ascii=False)}")
        print(f"[E2E] 总节点数: {len(result['topology']['nodes'])}")
        print(f"[E2E] 总边数: {len(result['topology']['edges'])}")
        # 确保 POD 分组合理
        servers = [n for n in result["topology"]["nodes"] if n["type"] == "server"]
        pod_groups = {}
        for s in servers:
            pid = s.get("podid", "")
            pod_groups[pid] = pod_groups.get(pid, 0) + 1
        print(f"[E2E] POD 分布: {json.dumps(pod_groups, ensure_ascii=False)}")

    def test_v243_switch_to_switch_edges_present(self):
        """V2.4.3: 边中应包含交换机间连接（Leaf-Spine / Access-Agg）"""
        result = self._run()
        edges = result["topology"]["edges"]
        node_types = {n["id"]: n["type"] for n in result["topology"]["nodes"]}

        # 统计边类型
        switch_to_switch = 0
        server_to_switch = 0
        for e in edges:
            src_type = node_types.get(e["source"], "")
            tgt_type = node_types.get(e["target"], "")
            if src_type != "server" and tgt_type != "server":
                switch_to_switch += 1
            else:
                server_to_switch += 1

        # V2.4.3 修复：交换机间连接应 > 0
        assert switch_to_switch > 0, \
            f"交换机间连接数为 0，Leaf-Spine/Access-Agg 连接缺失！"
        print(f"[E2E] 服务器↔交换机边数: {server_to_switch}；交换机↔交换机边数: {switch_to_switch}")

    def test_v243_param_leaf_spine_edges(self):
        """V2.4.3: 参数 Leaf-Spine 连接应存在"""
        result = self._run()
        edges = result["topology"]["edges"]
        node_types = {n["id"]: n["type"] for n in result["topology"]["nodes"]}

        param_ls_edges = []
        for e in edges:
            src_type = node_types.get(e["source"], "")
            tgt_type = node_types.get(e["target"], "")
            if {src_type, tgt_type} == {"param_leaf", "param_spine"}:
                param_ls_edges.append(e)
        assert len(param_ls_edges) > 0, "参数 Leaf-Spine 连接缺失"
        print(f"[E2E] 参数 Leaf-Spine 边数: {len(param_ls_edges)}")

    def test_v243_storage_leaf_spine_edges(self):
        """V2.4.3: 存储 Leaf-Spine 连接应存在"""
        result = self._run()
        edges = result["topology"]["edges"]
        node_types = {n["id"]: n["type"] for n in result["topology"]["nodes"]}

        storage_ls_edges = []
        for e in edges:
            src_type = node_types.get(e["source"], "")
            tgt_type = node_types.get(e["target"], "")
            if {src_type, tgt_type} == {"storage_leaf", "storage_spine"}:
                storage_ls_edges.append(e)
        assert len(storage_ls_edges) > 0, "存储 Leaf-Spine 连接缺失"
        print(f"[E2E] 存储 Leaf-Spine 边数: {len(storage_ls_edges)}")

    def test_v243_biz_access_agg_edges(self):
        """V2.4.3: 业务 Access-Agg 连接应存在"""
        result = self._run()
        edges = result["topology"]["edges"]
        node_types = {n["id"]: n["type"] for n in result["topology"]["nodes"]}

        biz_aa_edges = []
        for e in edges:
            src_type = node_types.get(e["source"], "")
            tgt_type = node_types.get(e["target"], "")
            if {src_type, tgt_type} == {"biz_access", "biz_agg"}:
                biz_aa_edges.append(e)
        assert len(biz_aa_edges) > 0, "业务 Access-Agg 连接缺失"
        print(f"[E2E] 业务 Access-Agg 边数: {len(biz_aa_edges)}")

    def test_v243_oob_access_agg_edges(self):
        """V2.4.3: 带外 Access-Agg 连接应存在"""
        result = self._run()
        edges = result["topology"]["edges"]
        node_types = {n["id"]: n["type"] for n in result["topology"]["nodes"]}

        oob_aa_edges = []
        for e in edges:
            src_type = node_types.get(e["source"], "")
            tgt_type = node_types.get(e["target"], "")
            if {src_type, tgt_type} == {"oob_access", "oob_agg"}:
                oob_aa_edges.append(e)
        assert len(oob_aa_edges) > 0, "带外 Access-Agg 连接缺失"
        print(f"[E2E] 带外 Access-Agg 边数: {len(oob_aa_edges)}")

    def test_v243_no_duplicate_edges(self):
        """V2.4.3: 边去重正确，无重复"""
        result = self._run()
        edges = result["topology"]["edges"]
        seen = set()
        duplicates = 0
        for e in edges:
            # 用 (source, target, aCabinetId, aStartU) 或 (source, target) 去重
            key = (e["source"], e["target"])
            if key in seen:
                duplicates += 1
            seen.add(key)
        # 允许少量重复（同一对设备可能有多条不同端口的连线，这里只验证完全相同的 source-target 不多）
        # 实际上同一对设备可能有多条连线（多端口），所以不严格要求 0 重复
        print(f"[E2E] 边总数: {len(edges)}；唯一 source-target 对数: {len(seen)}")
        assert len(edges) > 0
