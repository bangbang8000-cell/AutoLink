"""
AutoLink V2.1 - Exporter 模块单元测试
测试 Excel 导出功能：连接表、设备清单、格式化
"""
import sys
import os
import json
import copy
import tempfile
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from exporter import (
    _extract_number,
    _get_iface_weight,
    _get_switch_type_weight,
    generate_server_view,
    generate_switch_view,
    generate_summary_data,
    export_all_connections,
    apply_excel_formatting,
    _generate_access_agg_view,
    _generate_agg_reverse_view,
)


class TestExtractNumber:
    """测试数字提取函数"""

    def test_integer(self):
        assert _extract_number(42) == 42

    def test_float(self):
        assert _extract_number(3.14) == 3

    def test_string_with_number(self):
        assert _extract_number("GPU服务器_5") == 5

    def test_string_with_multiple_numbers(self):
        assert _extract_number("Eth1/0/33") == 1

    def test_string_without_number(self):
        assert _extract_number("abc") == 0

    def test_empty_string(self):
        # 空字符串无数字
        assert _extract_number("") == 0


class TestIfaceWeight:
    """测试接口类型排序权重"""

    def test_param_nic(self):
        assert _get_iface_weight("参数网卡1") == 1

    def test_storage_nic(self):
        assert _get_iface_weight("存储网卡1") == 2

    def test_oob_nic(self):
        assert _get_iface_weight("OOB口1") == 3

    def test_biz_nic(self):
        assert _get_iface_weight("业务口1") == 4

    def test_unknown(self):
        assert _get_iface_weight("其他接口") == 5


class TestSwitchTypeWeight:
    """测试交换机类型排序权重"""

    def test_leaf(self):
        assert _get_switch_type_weight("参数Leaf_G1_1") == 1

    def test_spine(self):
        assert _get_switch_type_weight("参数Spine_1") == 2

    def test_core(self):
        assert _get_switch_type_weight("参数Core_1") == 3

    def test_access(self):
        assert _get_switch_type_weight("OOB接入_1") == 4

    def test_agg(self):
        assert _get_switch_type_weight("OOB汇聚_1") == 5

    def test_unknown(self):
        assert _get_switch_type_weight("未知设备") == 6


class TestGenerateServerView:
    """测试服务器视角连接表生成"""

    def test_empty_servers(self):
        """空服务器列表"""
        class MockDesigner:
            servers = []
            server_groups = {}
            podid_map = {}
        df = generate_server_view(MockDesigner())
        assert df.empty

    def test_server_with_connections(self):
        """含连接的服务器"""
        class MockConnection:
            def __init__(self, a_device, a_port, a_module, z_device, z_port, z_module, cable_type, description,
                         a_cabinet_name=None, a_start_u=None, a_end_u=None,
                         z_cabinet_name=None, z_start_u=None, z_end_u=None):
                self.a_device = a_device
                self.a_port = a_port
                self.a_module = a_module
                self.z_device = z_device
                self.z_port = z_port
                self.z_module = z_module
                self.cable_type = cable_type
                self.description = description
                self.a_cabinet_name = a_cabinet_name
                self.a_start_u = a_start_u
                self.a_end_u = a_end_u
                self.z_cabinet_name = z_cabinet_name
                self.z_start_u = z_start_u
                self.z_end_u = z_end_u

        class MockServer:
            def __init__(self, name):
                self.name = name
                self.connections = [
                    MockConnection(
                        name, "参数网卡1", "400G-QSFP56", "参数Leaf_G1_1", "Eth1/0/1", "400G-QSFP56",
                        "MPO-16", "GPU服务器_1 → 参数Leaf_G1_1",
                        a_cabinet_name="A01", a_start_u=1, a_end_u=8,
                        z_cabinet_name="C01", z_start_u=1, z_end_u=2,
                    ),
                ]

        class MockDesigner:
            servers = [MockServer("GPU服务器_1")]
            server_groups = {"GPU服务器_1": "GPU组1"}
            podid_map = {"GPU服务器_1": "pod-gpu-1"}
            param_leaves = []
            param_spines = []
            param_cores = []
            storage_leaves = []
            storage_spines = []
            storage_cores = []

        df = generate_server_view(MockDesigner())
        assert not df.empty
        assert len(df) == 1
        row = df.iloc[0]
        assert row['A端设备'] == "GPU服务器_1"
        assert row['A端接口'] == "参数网卡1"
        assert row['A端机柜编号'] == "A01"
        assert row['A端U位'] == "1-8"
        assert row['Z端设备'] == "参数Leaf_G1_1"
        assert row['Z端机柜编号'] == "C01"
        assert row['Z端U位'] == "1-2"


class TestGenerateSwitchView:
    """测试交换机视角连接表生成"""

    def test_empty_switches(self):
        """空交换机列表"""
        class MockDesigner:
            param_leaves = []
            param_spines = []
            param_cores = []
            storage_leaves = []
            storage_spines = []
            storage_cores = []
            switch_groups = {}
            podid_map = {}

        result = generate_switch_view(MockDesigner())
        assert result['参数网络'].empty
        assert result['存储网络'].empty


class TestGenerateSummaryData:
    """测试网络设计摘要生成"""

    def test_summary_data(self):
        """生成摘要数据"""
        class MockDesigner:
            num_servers = 100
            param_ports_per_server = 8
            storage_ports_per_server = 2
            param_switch_ports = 64
            param_leaf_count = 16
            param_spine_count = 8
            param_core_count = 0
            param_3tier_needed = False
            param_servers_per_group = 8
            param_groups = 13
            param_pods = 0
            param_servers_per_pod = 0
            storage_switch_ports = 48
            storage_leaf_count = 4
            storage_spine_count = 2
            storage_core_count = 0
            storage_3tier_needed = False
            storage_servers_per_group = 25
            storage_groups = 0
            storage_pods = 0
            storage_servers_per_pod = 0
            param_speed = "400G"
            storage_speed = "200G"

        df = generate_summary_data(MockDesigner())
        assert not df.empty
        assert len(df) > 10


class TestExportAllConnections:
    """测试完整连接表导出"""

    def test_export_to_excel(self):
        """导出到 Excel 文件"""
        with tempfile.TemporaryDirectory() as tmpdir:
            filename = os.path.join(tmpdir, "test_export.xlsx")

            # 需要完整的 designer 来测试，这里使用 mock 跳过
            # 实际测试通过 test_engine.py 中的 handle_export 覆盖
            pass


class TestAccessAggView:
    """测试接入汇聚视图生成"""

    def test_empty_switches(self):
        """空交换机列表"""
        class MockDesigner:
            switch_groups = {}
            podid_map = {}

        df = _generate_access_agg_view(MockDesigner(), [], [])
        assert df.empty

    def test_agg_reverse_empty(self):
        """空汇聚交换机反向视图"""
        class MockDesigner:
            switch_groups = {}
            podid_map = {}

        result = _generate_agg_reverse_view(MockDesigner(), [], [], "OOB")
        assert result is None


class TestEdgeCases:
    """边界条件测试"""

    def test_sort_with_non_standard_names(self):
        """非标准命名的设备排序"""
        assert _extract_number("TestDevice") == 0
        assert _extract_number("Device-123") == 123

    def test_iface_weight_edge_cases(self):
        """接口权重边界情况"""
        assert _get_iface_weight("参数") == 1
        assert _get_iface_weight("存储") == 2
        assert _get_iface_weight("OOB") == 3
        assert _get_iface_weight("业务") == 4


class TestBinaryExcelOutput:
    """测试 Excel 二进制输出一致性（前后端接口对齐）"""

    def test_export_connections_produces_valid_xlsx(self):
        """连接表导出产生有效的 XLSX 二进制文件"""
        from designer import NetworkDesignerV2
        from engine import handle_export

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

            assert result["results"][0]["status"] == "success"

            # 验证文件存在且为非空二进制
            file_path = result["results"][0]["file"]
            assert os.path.exists(file_path)

            with open(file_path, 'rb') as f:
                content = f.read()

            assert len(content) > 0, "XLSX 文件不应为空"
            # XLSX 文件以 PK (ZIP) 魔术字节开头
            assert content[:2] == b'PK', f"XLSX 文件应以 PK 开头，实际: {content[:2].hex()}"

            # 验证可以用 pandas 重新打开
            df = pd.read_excel(file_path)
            assert len(df) > 0, "连接表不应为空"

    def test_export_device_list_produces_valid_xlsx(self):
        """设备清单导出产生有效的 XLSX 二进制文件"""
        from engine import handle_export

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

            assert result["results"][0]["status"] == "success"
            file_path = result["results"][0]["file"]
            assert os.path.exists(file_path)

            with open(file_path, 'rb') as f:
                content = f.read()

            assert len(content) > 0
            assert content[:2] == b'PK', f"XLSX 文件应以 PK 开头，实际: {content[:2].hex()}"

            df = pd.read_excel(file_path)
            assert len(df) > 0, "设备清单不应为空"

    def test_export_both_types_produces_two_valid_xlsx(self):
        """同时导出连接表和设备清单产生两个有效的 XLSX 文件"""
        from engine import handle_export

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

            assert len(result["results"]) == 2
            for r in result["results"]:
                assert r["status"] == "success"
                assert os.path.exists(r["file"])
                with open(r["file"], 'rb') as f:
                    content = f.read()
                assert len(content) > 0
                assert content[:2] == b'PK', f"文件 {r['file']} 不是有效的 XLSX"

                df = pd.read_excel(r["file"])
                assert len(df) > 0


class TestStorageDisabledExport:
    """4.4.1 回归：存储网络关闭时导出不崩溃。

    根因：NetworkDesignerV2.storage_servers_per_group 仅在 storage_enabled 分支赋值，
    存储网关闭/融合网时 exporter 无条件引用 → AttributeError。
    """

    @staticmethod
    def _write_project(tmpdir, storage_network=False):
        from project_config import DEFAULT_PROJECT_CONFIG
        cfg = copy.deepcopy(DEFAULT_PROJECT_CONFIG)
        cfg['meta']['name'] = 'regress-no-storage'
        cfg['networks']['storage_network'] = storage_network
        cfg['networks']['biz_network'] = False
        cfg['networks']['oob_network'] = False
        cfg['topology']['num_gpu_servers'] = 8
        cfg['topology']['param_ports_per_server'] = 8
        cfg['topology']['storage_ports_per_server'] = 1
        cfg['topology']['param_switch_ports'] = 64
        cfg['topology']['storage_switch_ports'] = 48
        json_path = os.path.join(tmpdir, 'project_config.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return json_path

    def test_designer_storage_servers_per_group_defaults_zero(self):
        """存储网关闭时 storage_servers_per_group 存在且为 0（exporter 不再 AttributeError）"""
        from designer import NetworkDesignerV2
        with tempfile.TemporaryDirectory() as tmpdir:
            json_path = self._write_project(tmpdir, storage_network=False)
            designer = NetworkDesignerV2(json_path)
            assert hasattr(designer, 'storage_servers_per_group')
            assert designer.storage_servers_per_group == 0

    def test_export_connections_storage_disabled_no_attr_error(self):
        """存储网关闭项目导出连接表不抛 'NetworkDesignerV2' object has no attribute 'storage_servers_per_group'"""
        from engine import handle_export
        with tempfile.TemporaryDirectory() as tmpdir:
            json_path = self._write_project(tmpdir, storage_network=False)
            output_dir = os.path.join(tmpdir, 'output')
            result = handle_export({
                "configFile": json_path,
                "outputDir": output_dir,
                "outputTypes": ["connections"],
            })
            assert result["results"][0]["status"] == "success"
            file_path = result["results"][0]["file"]
            assert os.path.exists(file_path)
            with open(file_path, 'rb') as f:
                assert f.read()[:2] == b'PK', f"连接表应以 PK 开头，实际: {file_path}"

    def test_export_connections_eth_combined_no_attr_error(self):
        """融合网（eth_combined）项目导出连接表同样不崩溃"""
        from engine import handle_export
        with tempfile.TemporaryDirectory() as tmpdir:
            json_path = self._write_project(tmpdir, storage_network=True)
            with open(json_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            cfg['networks']['eth_combined'] = True
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            output_dir = os.path.join(tmpdir, 'output')
            result = handle_export({
                "configFile": json_path,
                "outputDir": output_dir,
                "outputTypes": ["connections"],
            })
            assert result["results"][0]["status"] == "success"