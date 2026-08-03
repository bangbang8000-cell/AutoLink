"""
AutoLink V2.1 - Engine 模块单元测试
测试 engine.py 中的设计、验证、导出、功率评估功能
"""
import sys
import os
import json
import tempfile

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from engine import handle_design, handle_validate, handle_export, _calculate_power_summary, _get_config_file


class TestGetConfigFile:
    """测试配置文件路径解析"""

    def test_json_config_preferred(self):
        """优先使用 JSON 配置"""
        with tempfile.TemporaryDirectory() as tmpdir:
            json_path = os.path.join(tmpdir, 'project_config.json')
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(json_path, 'w') as f:
                json.dump({"meta": {"name": "test"}}, f)
            with open(ini_path, 'w') as f:
                f.write("[DEFAULT]\nnum_servers = 10\n")

            result, error = _get_config_file({"configFile": ini_path})
            assert error is None
            assert result == json_path

    def test_ini_only(self):
        """INI 文件无对应 JSON 时使用 INI"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write("[DEFAULT]\nnum_servers = 10\n")

            result, error = _get_config_file({"configFile": ini_path})
            assert error is None
            assert result == ini_path

    def test_missing_config_file_param(self):
        """缺少 configFile 参数"""
        result, error = _get_config_file({})
        assert result is None
        assert error is not None

    def test_nonexistent_config_file(self):
        """配置文件不存在"""
        result, error = _get_config_file({"configFile": "/nonexistent/path.ini"})
        assert result is None
        assert error is not None


class TestHandleDesign:
    """测试拓扑设计请求处理"""

    def test_design_with_ini_config(self):
        """使用 INI 配置进行设计"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write("""[DEFAULT]
num_servers = 10
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
oob_enabled = True
biz_enabled = False
""")

            result = handle_design({"configFile": ini_path})
            assert "error" not in result
            assert "summary" in result
            assert "topology" in result
            assert "valid" in result
            assert "powerData" in result

            summary = result["summary"]
            assert summary["numServers"] == 10
            assert summary["mode"] == "custom"

    def test_design_missing_config(self):
        """缺少配置文件"""
        result = handle_design({})
        assert "error" in result


class TestHandleValidate:
    """测试拓扑验证请求处理"""

    def test_validate_with_ini_config(self):
        """使用 INI 配置进行验证"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write("""[DEFAULT]
num_servers = 10
switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
""")

            result = handle_validate({"configFile": ini_path})
            assert "valid" in result

    def test_validate_missing_config(self):
        """缺少配置文件"""
        result = handle_validate({})
        assert "error" in result


class TestHandleExport:
    """测试导出请求处理"""

    def test_export_connections(self):
        """导出连接表"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write("""[DEFAULT]
num_servers = 10
switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
""")

            output_dir = os.path.join(tmpdir, 'output')
            result = handle_export({
                "configFile": ini_path,
                "outputDir": output_dir,
                "outputTypes": ["connections"],
            })

            assert "results" in result
            assert len(result["results"]) == 1
            assert result["results"][0]["status"] == "success"

    def test_export_device_list(self):
        """导出设备清单"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write("""[DEFAULT]
num_servers = 10
switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
""")

            output_dir = os.path.join(tmpdir, 'output')
            result = handle_export({
                "configFile": ini_path,
                "outputDir": output_dir,
                "outputTypes": ["deviceList"],
            })

            assert "results" in result
            assert len(result["results"]) == 1
            assert result["results"][0]["status"] == "success"

    def test_export_both_types(self):
        """同时导出连接表和设备清单"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write("""[DEFAULT]
num_servers = 10
switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
""")

            output_dir = os.path.join(tmpdir, 'output')
            result = handle_export({
                "configFile": ini_path,
                "outputDir": output_dir,
                "outputTypes": ["connections", "deviceList"],
            })

            assert "results" in result
            assert len(result["results"]) == 2
            assert all(r["status"] == "success" for r in result["results"])

    def test_export_missing_config(self):
        """缺少配置文件"""
        result = handle_export({})
        assert "error" in result


class TestPowerSummary:
    """测试功率评估功能"""

    def test_power_summary_empty(self):
        """空设计器的功率评估"""
        class MockDesigner:
            servers = []
            power_limit_per_rack = 6000
            all_switch_lists = lambda self: []  # V3.0.0-T0-3: 统一访问器
        result = _calculate_power_summary(MockDesigner())
        assert result["totalRacks"] == 0
        assert result["totalPowerWatts"] == 0

    def test_power_summary_single_server(self):
        """单台服务器的功率评估"""
        class MockServer:
            def __init__(self):
                self.name = "GPU服务器_1"
                self.cabinet_id = 1
                self.cabinet_name = "A01"
                self.power_watts = 1000
                self.u_height = 2
                self.start_u = 1
                self.end_u = 2

        class MockDesigner:
            servers = [MockServer()]
            power_limit_per_rack = 6000
            all_switch_lists = lambda self: []  # V3.0.0-T0-3: 统一访问器

        result = _calculate_power_summary(MockDesigner())
        assert result["totalRacks"] == 1
        assert result["totalPowerWatts"] == 1000
        assert len(result["cabinets"]) == 1
        assert result["cabinets"][0]["percent"] == round(1000 / 6000 * 100, 1)
        assert result["cabinets"][0]["exceeded"] is False

    def test_power_summary_exceeded(self):
        """功率超标告警"""
        class MockServer:
            def __init__(self):
                self.name = "GPU服务器_1"
                self.cabinet_id = 1
                self.cabinet_name = "A01"
                self.power_watts = 7000
                self.u_height = 4
                self.start_u = 1
                self.end_u = 4

        class MockDesigner:
            servers = [MockServer()]
            power_limit_per_rack = 6000
            all_switch_lists = lambda self: []  # V3.0.0-T0-3: 统一访问器

        result = _calculate_power_summary(MockDesigner())
        assert result["cabinets"][0]["exceeded"] is True
        assert result["cabinets"][0]["percent"] > 100

    def test_power_summary_zero_power_limit(self):
        """功率上限为0时安全处理（0被视为使用默认值6000）"""
        class MockServer:
            def __init__(self):
                self.name = "GPU服务器_1"
                self.cabinet_id = 1
                self.cabinet_name = "A01"
                self.power_watts = 1000
                self.u_height = 2
                self.start_u = 1
                self.end_u = 2

        class MockDesigner:
            servers = [MockServer()]
            power_limit_per_rack = 0
            all_switch_lists = lambda self: []  # V3.0.0-T0-3: 统一访问器

        result = _calculate_power_summary(MockDesigner())
        # 0 被视为 falsy，or 6000 生效，使用默认值 6000
        assert result["cabinets"][0]["powerLimit"] == 6000
        assert result["cabinets"][0]["percent"] == round(1000 / 6000 * 100, 1)

    def test_power_summary_none_power_limit(self):
        """功率上限为None时使用默认值"""
        class MockServer:
            def __init__(self):
                self.name = "GPU服务器_1"
                self.cabinet_id = 1
                self.cabinet_name = "A01"
                self.power_watts = 1000
                self.u_height = 2
                self.start_u = 1
                self.end_u = 2

        class MockDesigner:
            servers = [MockServer()]
            power_limit_per_rack = None
            all_switch_lists = lambda self: []  # V3.0.0-T0-3: 统一访问器

        result = _calculate_power_summary(MockDesigner())
        assert result["cabinets"][0]["powerLimit"] == 6000  # 默认值

    def test_power_summary_no_cabinet(self):
        """服务器未分配机柜时跳过"""
        class MockServer:
            def __init__(self):
                self.cabinet_id = None
                self.cabinet_name = None
                self.power_watts = 1000
                self.u_height = 2
                self.start_u = None
                self.end_u = None

        class MockDesigner:
            servers = [MockServer()]
            power_limit_per_rack = 6000
            all_switch_lists = lambda self: []  # V3.0.0-T0-3: 统一访问器

        result = _calculate_power_summary(MockDesigner())
        assert result["totalRacks"] == 0
        assert result["totalPowerWatts"] == 0

    def test_power_summary_zero_power_server(self):
        """服务器功率为None时使用0"""
        class MockServer:
            def __init__(self):
                self.name = "GPU服务器_1"
                self.cabinet_id = 1
                self.cabinet_name = "A01"
                self.power_watts = None
                self.u_height = 2
                self.start_u = 1
                self.end_u = 2

        class MockDesigner:
            servers = [MockServer()]
            power_limit_per_rack = 6000
            all_switch_lists = lambda self: []  # V3.0.0-T0-3: 统一访问器

        result = _calculate_power_summary(MockDesigner())
        assert result["totalPowerWatts"] == 0

    def test_power_summary_multiple_cabinets(self):
        """多机柜功率评估"""
        class MockServer:
            def __init__(self, name, cab_id, power):
                self.name = name
                self.cabinet_id = cab_id
                self.cabinet_name = f"A{cab_id:02d}"
                self.power_watts = power
                self.u_height = 2
                self.start_u = 1
                self.end_u = 2

        class MockDesigner:
            servers = [
                MockServer("s1", 1, 1000),
                MockServer("s2", 1, 2000),
                MockServer("s3", 2, 3000),
            ]
            power_limit_per_rack = 6000
            all_switch_lists = lambda self: []  # V3.0.0-T0-3: 统一访问器

        result = _calculate_power_summary(MockDesigner())
        assert result["totalRacks"] == 2
        assert result["totalPowerWatts"] == 6000
        assert len(result["cabinets"]) == 2


class TestMainEntry:
    """测试主入口函数（V3.0.0-T0-6: NDJSON 逐行协议 + 持久循环）"""

    @staticmethod
    def _run_main(lines):
        from engine import main
        import io

        old_stdin = sys.stdin
        old_stdout = sys.stdout
        try:
            sys.stdin = io.StringIO("\n".join(lines) + "\n")
            sys.stdout = io.StringIO()
            main()
            out = sys.stdout.getvalue()
            return [json.loads(l) for l in out.strip().split("\n") if l.strip()]
        finally:
            sys.stdin = old_stdin
            sys.stdout = old_stdout

    def test_main_unknown_action(self):
        """未知 action → {type:'result', success:false}"""
        resp = self._run_main([json.dumps({"action": "unknown", "params": {}})])[0]
        assert resp["type"] == "result"
        assert resp["success"] is False
        assert "未知 action" in resp["error"]

    def test_main_invalid_json(self):
        """无效 JSON → {type:'error'}"""
        resp = self._run_main(["not json"])[0]
        assert resp["type"] == "error"
        assert "JSON 解析失败" in resp["error"]

    def test_main_multiple_requests_persistent(self):
        """V3.0.0-T0-6: 一次 stdin 多条请求 → 逐行响应（持久循环，requestId 分发）"""
        reqs = [
            {"action": "unknown", "params": {}, "requestId": "r1"},
            {"action": "unknown", "params": {}, "requestId": "r2"},
            "not json",
            {"action": "unknown", "params": {}, "requestId": "r3"},
        ]
        resps = self._run_main([json.dumps(r) if isinstance(r, dict) else r for r in reqs])
        assert len(resps) == 4
        assert [r.get("requestId") for r in resps] == ["r1", "r2", "", "r3"]
        assert all(r["type"] == "result" for r in resps[:2])
        assert resps[2]["type"] == "error"


class TestDesignWithProjectConfig:
    """测试 project_config.json 格式的设计"""

    def test_design_with_project_config(self):
        """使用 project_config.json 进行设计"""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'project_config.json')
            config = {
                "meta": {"name": "test", "description": "", "version": 1,
                         "created_at": "2024-01-01", "updated_at": "2024-01-01"},
                "networks": {
                    "param_network": True,
                    "storage_network": True,
                    "biz_network": False,
                    "oob_network": True,
                },
                "topology": {
                    "downlink_mode": "custom",
                    "num_gpu_servers": 10,
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
            with open(config_path, 'w') as f:
                json.dump(config, f)

            result = handle_design({"configFile": config_path})
            assert "error" not in result
            assert result["summary"]["rackType"] == 42
            assert result["summary"]["powerLimitPerRack"] == 8000
            assert result["powerData"]["cabinets"][0]["powerLimit"] == 8000


class TestTopologyDataFormat:
    """测试拓扑数据格式一致性（前后端接口对齐）"""

    NODE_REQUIRED_FIELDS = {"id", "type", "group", "podid"}
    EDGE_REQUIRED_FIELDS = {"source", "target", "speed", "cableType", "description"}

    def _run_design(self):
        """运行设计并返回拓扑数据"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write("""[DEFAULT]
num_servers = 10
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
oob_enabled = True
biz_enabled = False
""")
            result = handle_design({"configFile": ini_path})
            return result

    def test_topology_nodes_have_all_required_fields(self):
        """拓扑节点包含所有必需字段"""
        result = self._run_design()
        assert "error" not in result
        topology = result["topology"]
        assert len(topology["nodes"]) > 0

        for node in topology["nodes"]:
            missing = self.NODE_REQUIRED_FIELDS - set(node.keys())
            assert not missing, f"节点 {node.get('id', '?')} 缺少字段: {missing}"

    def test_topology_edges_have_all_required_fields(self):
        """拓扑边包含所有必需字段"""
        result = self._run_design()
        assert "error" not in result
        topology = result["topology"]
        assert len(topology["edges"]) > 0

        for edge in topology["edges"]:
            missing = self.EDGE_REQUIRED_FIELDS - set(edge.keys())
            assert not missing, f"边 {edge.get('source', '?')}->{edge.get('target', '?')} 缺少字段: {missing}"

    def test_server_nodes_have_cabinet_fields(self):
        """服务器节点包含机柜相关字段"""
        result = self._run_design()
        assert "error" not in result
        topology = result["topology"]

        server_nodes = [n for n in topology["nodes"] if n["type"] == "server"]
        assert len(server_nodes) > 0

        for node in server_nodes:
            assert "cabinetId" in node
            assert "cabinetName" in node
            assert "startU" in node
            assert "endU" in node
            assert "powerWatts" in node
            assert "uHeight" in node

    def test_switch_nodes_have_podid(self):
        """交换机节点包含 podid 字段（之前缺失，已修复）"""
        result = self._run_design()
        assert "error" not in result
        topology = result["topology"]

        switch_types = {"param_leaf", "param_spine", "storage_leaf", "storage_spine"}
        switch_nodes = [n for n in topology["nodes"] if n["type"] in switch_types]
        assert len(switch_nodes) > 0, "拓扑中应该有交换机节点"

        for node in switch_nodes:
            assert "podid" in node, f"交换机节点 {node['id']} 缺少 podid 字段"
            assert node["podid"] is not None, f"交换机节点 {node['id']} 的 podid 为 None"

    def test_node_types_are_valid(self):
        """节点类型合法"""
        valid_types = {
            "server", "param_leaf", "param_spine", "param_core",
            "storage_leaf", "storage_spine", "storage_core",
            "oob_access", "oob_agg", "biz_access", "biz_agg",
        }
        result = self._run_design()
        assert "error" not in result
        topology = result["topology"]

        for node in topology["nodes"]:
            assert node["type"] in valid_types, f"节点 {node['id']} 类型 '{node['type']}' 不合法"

    def test_topology_data_structure_complete(self):
        """拓扑数据结构完整：包含 nodes/edges 且非空"""
        result = self._run_design()
        assert "error" not in result

        topology = result["topology"]
        assert "nodes" in topology
        assert "edges" in topology
        assert isinstance(topology["nodes"], list)
        assert isinstance(topology["edges"], list)
        assert len(topology["nodes"]) > 0
        assert len(topology["edges"]) > 0