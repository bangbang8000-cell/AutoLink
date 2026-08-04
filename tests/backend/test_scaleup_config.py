"""
AutoLink V2.9.3-T1 - Scale-Up 配置层测试
验证 JSON/INI 配置的 scale_up 段解析、迁移与校验；旧配置无此段不报错。
"""
import pytest
import sys, os, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from designer import NetworkDesignerV2
from project_config import validate_config, create_default_config
from migration import ini_to_project_config
from engine import handle_design
from exporter import generate_report_data


def _write_json(tmpdir, config):
    path = os.path.join(tmpdir, 'project_config.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    return path


def _write_ini(tmpdir, content):
    path = os.path.join(tmpdir, 'network_config.ini')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    return path


def _base_json_config():
    return {
        "meta": {"name": "t", "description": "", "version": 1,
                 "created_at": "", "updated_at": ""},
        "networks": {"param_network": True, "storage_network": True,
                     "biz_network": False, "oob_network": False},
        "topology": {"downlink_mode": "custom", "param_protocol": "RoCE",
                     "num_gpu_servers": 10, "num_all_flash_storage": 2,
                     "num_hybrid_flash_storage": 0, "num_compute_servers": 0,
                     "param_ports_per_server": 8, "storage_ports_per_server": 1,
                     "param_switch_ports": 64, "storage_switch_ports": 48,
                     "param_speed": "400G", "storage_speed": "200G",
                     "param_downlink_limit": 25, "storage_downlink_limit": 20,
                     "biz_downlink_limit": 25, "oob_downlink_limit": 25},
        "device_refs": {},
        "rack_config": {"rack_type": 42, "power_limit_per_rack": 8000,
                        "naming_prefix": "机柜"},
    }


class TestScaleUpJSON:
    """JSON 模式 scale_up 段解析"""

    def test_without_scale_up(self):
        """旧配置无 scale_up 段 → scale_up_config=None 且不报错"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write_json(tmpdir, _base_json_config())
            designer = NetworkDesignerV2(path)
            assert designer.scale_up_config is None

    def test_with_scale_up(self):
        """带 scale_up 段 → 解析正确"""
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {
                "protocol": "UALink",
                "num_gpus": 1024,
                "gpus_per_node": 8,
                "domain_size": 512,
                "bandwidth": 200,
            }
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            assert designer.scale_up_config == {
                'protocol': 'UALink',
                'num_gpus': 1024,
                'gpus_per_node': 8,
                'domain_size': 512,
                'bandwidth': 200.0,
            }

    def test_bandwidth_legacy_name(self):
        """兼容旧命名 bandwidth_per_link_gbps"""
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {"protocol": "UB", "num_gpus": 384,
                               "bandwidth_per_link_gbps": 2800}
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            assert designer.scale_up_config['protocol'] == 'UB'
            assert designer.scale_up_config['bandwidth'] == 2800.0

    def test_invalid_scale_up(self):
        """非法 scale_up 值 → 降级为 None 不崩溃"""
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {"protocol": "UALink", "num_gpus": "not-a-number"}
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            assert designer.scale_up_config is None


class TestScaleUpINI:
    """INI 模式 [scale_up] section 解析"""

    _MINI = """[DEFAULT]
num_servers = 10
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
biz_enabled = False
oob_enabled = False
"""

    def test_without_scale_up(self):
        """INI 无 [scale_up] → None"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = _write_ini(tmpdir, self._MINI)
            designer = NetworkDesignerV2(ini)
            assert designer.scale_up_config is None

    def test_with_scale_up(self):
        """INI 带 [scale_up] → 解析正确"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = _write_ini(tmpdir, self._MINI + """
[scale_up]
protocol = NVLink
num_gpus = 72
gpus_per_node = 8
domain_size = 72
bandwidth = 1800
""")
            designer = NetworkDesignerV2(ini)
            assert designer.scale_up_config == {
                'protocol': 'NVLink',
                'num_gpus': 72,
                'gpus_per_node': 8,
                'domain_size': 72,
                'bandwidth': 1800.0,
            }


class TestScaleUpMigration:
    """INI → JSON 迁移保留 scale_up 段"""

    def test_migrate_scale_up(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = _write_ini(tmpdir, TestScaleUpINI._MINI + """
[scale_up]
protocol = UB
num_gpus = 384
gpus_per_node = 8
domain_size = 384
bandwidth = 2800
""")
            config, warnings = ini_to_project_config(ini, "p1")
            assert config is not None
            assert config['scale_up'] == {
                'protocol': 'UB',
                'num_gpus': 384,
                'gpus_per_node': 8,
                'domain_size': 384,
                'bandwidth': 2800.0,
            }
            assert validate_config(config) is None

    def test_migrate_without_scale_up(self):
        """无 scale_up 的 INI 迁移后 scale_up 为空对象, 校验通过"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = _write_ini(tmpdir, TestScaleUpINI._MINI)
            config, warnings = ini_to_project_config(ini, "p1")
            assert config is not None
            assert config.get('scale_up') == {}
            assert validate_config(config) is None


class TestScaleUpValidation:
    """project_config.validate_config scale_up 校验"""

    def test_valid_scale_up(self):
        cfg = create_default_config("t")
        cfg['scale_up'] = {"protocol": "UALink", "num_gpus": 1024}
        assert validate_config(cfg) is None

    def test_invalid_protocol(self):
        cfg = create_default_config("t")
        cfg['scale_up'] = {"protocol": "InfiniBand", "num_gpus": 1024}
        assert validate_config(cfg) is not None

    def test_invalid_num_gpus_type(self):
        cfg = create_default_config("t")
        cfg['scale_up'] = {"num_gpus": "many"}
        assert validate_config(cfg) is not None

    def test_scale_up_not_dict(self):
        cfg = create_default_config("t")
        cfg['scale_up'] = "enabled"
        assert validate_config(cfg) is not None


class TestScaleUpGeneration:
    """V2.9.3-T2: Scale-Up 生成层 (GPU 节点 + 全对等边)"""

    def test_disabled_no_gpus(self):
        """未配置 scale_up → 无 GPU 节点/边, 引擎输出不含 scale_up"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write_json(tmpdir, _base_json_config())
            designer = NetworkDesignerV2(path)
            assert designer.scale_up_gpus == []
            assert designer.scale_up_connections == []
            result = handle_design({'configFile': path})
            assert 'error' not in result
            assert result['summary']['scaleUp']['enabled'] is False
            assert all('scale_up' not in (e.get('networkType') or '')
                       for e in result['topology']['edges'])

    def test_full_mesh_gpu_nodes_and_edges(self):
        """启用 scale_up → GPU 节点数 = num_gpus, 全对等边数 = N*(N-1)/2"""
        n = 8
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {"protocol": "UALink", "num_gpus": n,
                               "gpus_per_node": 8, "domain_size": 8,
                               "bandwidth": 200}
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            assert len(designer.scale_up_gpus) == n
            for g in designer.scale_up_gpus:
                assert g.obj_type == 'scaleup_gpu'
                assert g.network_type == 'scale_up'
                assert g.domain_id == 0
            # 全对等: N*(N-1)/2 条边 (单侧)
            assert len(designer.scale_up_connections) == n * (n - 1) // 2
            assert designer.scale_up_stats['num_gpus'] == n

    def test_multiple_domains(self):
        """domain_size 小于 num_gpus → 多域, domain_id 正确"""
        n, ds = 16, 8
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {"protocol": "NVLink", "num_gpus": n,
                               "domain_size": ds}
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            domain_ids = {g.domain_id for g in designer.scale_up_gpus}
            assert domain_ids == {0, 1}
            assert len(designer.scale_up_connections) == 2 * (ds * (ds - 1) // 2)

    def test_engine_output_contains_scale_up(self):
        """engine 拓扑结果含 scale_up 节点与边"""
        n = 4
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {"protocol": "UB", "num_gpus": n}
            path = _write_json(tmpdir, cfg)
            result = handle_design({'configFile': path})
            assert 'error' not in result
            topo = result['topology']
            gpu_nodes = [nd for nd in topo['nodes'] if nd['type'] == 'scaleup_gpu']
            assert len(gpu_nodes) == n
            assert gpu_nodes[0]['protocol'] == 'UB'
            su_edges = [e for e in topo['edges'] if e.get('networkType') == 'scale_up']
            pairs = {tuple(sorted([e['source'], e['target']])) for e in su_edges}
            assert len(pairs) == n * (n - 1) // 2
            assert result['summary']['scaleUp']['enabled'] is True


class TestScaleUpRack:
    """V2.9.3-T3: Scale-Up GPU 机柜分配"""

    def test_gpu_has_cabinet(self):
        """GPU 节点回填 cabinet_id/start_u/end_u, 1 台/柜"""
        n = 4
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {"protocol": "UALink", "num_gpus": n, "domain_size": 2}
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            cabinets = {g.cabinet_id for g in designer.scale_up_gpus}
            assert len(cabinets) == n          # 每 GPU 独立柜
            assert all(g.cabinet_id is not None for g in designer.scale_up_gpus)
            assert all(g.start_u == 1 and g.end_u == 1 for g in designer.scale_up_gpus)
            su_cabs = [c for c in designer._rack_cabinets if c.type == 'scaleup']
            assert len(su_cabs) == n
            assert all(len(c.devices) == 1 for c in su_cabs)

    def test_domain_cabinets_adjacent(self):
        """域内 GPU 柜号相邻 (域0 在前, 域1 在后, 各自连续)"""
        n, ds = 8, 4
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {"protocol": "UB", "num_gpus": n, "domain_size": ds}
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            cab_ids = {}
            for g in designer.scale_up_gpus:
                cab_ids.setdefault(g.domain_id, []).append(g.cabinet_id)
            for d, ids in cab_ids.items():
                assert ids == list(range(min(ids), max(ids) + 1)), "域内柜号必须连续"
            # 域 0 全部柜号 < 域 1 全部柜号
            assert max(cab_ids[0]) < min(cab_ids[1])

    def test_disabled_no_scaleup_cabinet(self):
        """未配置 scale_up → 不产生 scaleup 机柜"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write_json(tmpdir, _base_json_config())
            designer = NetworkDesignerV2(path)
            su_cabs = [c for c in designer._rack_cabinets if c.type == 'scaleup']
            assert su_cabs == []

    def test_engine_cabinet_type(self):
        """engine 输出 GPU 节点带 cabinet 字段, 每 GPU 独立柜"""
        n = 2
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {"protocol": "NVLink", "num_gpus": n}
            path = _write_json(tmpdir, cfg)
            result = handle_design({'configFile': path})
            gpu_nodes = [nd for nd in result['topology']['nodes']
                         if nd['type'] == 'scaleup_gpu']
            assert all(nd.get('cabinetId') is not None for nd in gpu_nodes)
            assert all(nd.get('cabinetName') for nd in gpu_nodes)
            # 1 台/柜 → 柜号互不相同
            assert len({nd['cabinetId'] for nd in gpu_nodes}) == n


class TestScaleUpReport:
    """V2.9.3-T4: 报告含 Scale-Up 汇总"""

    def test_report_contains_scale_up(self):
        """generate_report_data 概览/架构/机柜含 scale_up"""
        n, ds = 8, 4
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['scale_up'] = {"protocol": "UALink", "num_gpus": n, "domain_size": ds}
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            data = generate_report_data(designer)
            assert data['overview']['Scale-Up协议'] == 'UALink'
            assert data['overview']['Scale-Up GPU节点数'] == n
            assert data['overview']['Scale-Up域数'] == 2
            assert data['architecture']['Scale-Up GPU节点'] == n
            su_racks = [r for r in data['racks'] if r['类型'] == 'Scale-Up柜']
            assert len(su_racks) == n

    def test_report_without_scale_up(self):
        """未配置 scale_up → 报告无 scale_up 字段, 不报错"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write_json(tmpdir, _base_json_config())
            designer = NetworkDesignerV2(path)
            data = generate_report_data(designer)
            assert 'Scale-Up协议' not in data['overview']
            assert data['architecture']['Scale-Up GPU节点'] == 0


def _full_json_config():
    """启用全部网络(含 OOB/业务)的测试配置"""
    cfg = _base_json_config()
    cfg['networks'] = {"param_network": True, "storage_network": True,
                       "biz_network": True, "oob_network": True}
    return cfg


def _server_port_prefix(designer, server_name, network_type):
    """从服务器连接中提取指定网络的端口前缀"""
    srv = next(s for s in designer.servers if s.name == server_name)
    for conn in srv.connections:
        if conn.network_type != network_type:
            continue
        if conn.a_device == server_name:
            return conn.a_port
        return conn.z_port
    return None


class TestPortPrefixes:
    """V2.9.3-T7: 存储/OOB/业务网卡端口命名前缀"""

    def test_default_storage_prefix(self):
        """无设备档案 → 存储网卡前缀默认 '存储网卡'"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write_json(tmpdir, _base_json_config())
            designer = NetworkDesignerV2(path)
            assert designer._server_storage_prefix == '存储网卡'
            assert all(s.storage_prefix == '存储网卡' for s in designer.servers)
            port = _server_port_prefix(designer, 'GPU服务器_1', 'storage')
            assert port is not None and port.startswith('存储网卡')

    def test_default_oob_biz_prefix(self):
        """OOB/业务网卡前缀默认 'OOB网卡'/'业务网卡'"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write_json(tmpdir, _full_json_config())
            designer = NetworkDesignerV2(path)
            assert designer._server_oob_prefix == 'OOB网卡'
            assert designer._server_biz_prefix == '业务网卡'
            oob_port = _server_port_prefix(designer, 'GPU服务器_1', 'oob')
            assert oob_port is not None and oob_port.startswith('OOB网卡')
            biz_port = _server_port_prefix(designer, 'GPU服务器_1', 'biz')
            assert biz_port is not None and biz_port.startswith('业务网卡')

    def test_device_ref_prefix_applied(self):
        """device_refs 指定 gpu_server(前缀 NIC) → 三类网卡前缀均取 NIC"""
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _full_json_config()
            cfg['device_refs'] = {'gpu_server': {'library_id': 'generic_4u_gpu'}}
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            assert designer._server_storage_prefix == 'NIC'
            assert designer._server_oob_prefix == 'NIC'
            assert designer._server_biz_prefix == 'NIC'
            srv = next(s for s in designer.servers if s.name == 'GPU服务器_1')
            assert srv.storage_prefix == 'NIC'
            assert srv.oob_prefix == 'NIC'
            assert srv.biz_prefix == 'NIC'
            storage_port = _server_port_prefix(designer, 'GPU服务器_1', 'storage')
            assert storage_port is not None and storage_port.startswith('NIC')
            oob_port = _server_port_prefix(designer, 'GPU服务器_1', 'oob')
            assert oob_port is not None and oob_port.startswith('NIC')

    def test_ini_default_prefix(self):
        """INI 模式同样提供默认前缀"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini = _write_ini(tmpdir, TestScaleUpINI._MINI)
            designer = NetworkDesignerV2(ini)
            assert designer._server_storage_prefix == '存储网卡'
            assert designer._server_oob_prefix == 'OOB网卡'
            assert designer._server_biz_prefix == '业务网卡'


class TestTemplateScaleUpConsistency:
    """V2.9.3-T8: UEC 校验 + 3 个 Scale-Up 模板名实相符"""

    def test_uec_protocol_valid(self):
        """validate_config 接受 UEC 协议"""
        cfg = create_default_config("t")
        cfg['topology']['param_protocol'] = 'UEC'
        assert validate_config(cfg) is None

    def test_uec_designer_accepts(self):
        """designer 以 UEC 协议创建项目不报错, 且自动选型生效"""
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg = _base_json_config()
            cfg['topology']['param_protocol'] = 'UEC'
            path = _write_json(tmpdir, cfg)
            designer = NetworkDesignerV2(path)
            assert designer.param_protocol == 'UEC'
            assert designer._device_profiles.get('param_switch') is not None

    def test_invalid_protocol_rejected(self):
        """非法协议仍被拒绝"""
        cfg = create_default_config("t")
        cfg['topology']['param_protocol'] = 'TokenRing'
        assert validate_config(cfg) is not None

    def test_ualink_template(self):
        """ualink_1_0_1024: UALink 1024 GPU 单域"""
        ini = os.path.join('template', 'ualink_1_0_1024', 'network_config.ini')
        designer = NetworkDesignerV2(ini)
        assert designer.scale_up_config == {
            'protocol': 'UALink', 'num_gpus': 1024, 'gpus_per_node': 8,
            'domain_size': 1024, 'bandwidth': 200.0}
        assert len(designer.scale_up_gpus) == 1024
        assert designer.scale_up_stats['num_domains'] == 1

    def test_cloudmatrix_template(self):
        """cloudmatrix_384: 华为超节点 UB 384 NPU 单域 (V3.0.2-T2-3 huawei_supernode 模式)"""
        ini = os.path.join('template', 'cloudmatrix_384', 'network_config.ini')
        designer = NetworkDesignerV2(ini)
        # JSON 优先加载：cloudmatrix_384 已升级为 huawei_supernode（UB 由 param_huawei_supernode 表达）
        assert designer.param_network_mode == 'huawei_supernode'
        assert designer.scale_up_config is None          # 不再走 scale_up 段
        assert len(designer.huawei_npus) == 384
        assert designer.huawei_stats['num_domains'] == 1
        assert designer.huawei_stats['total_links'] == 384 * 383 // 2

    def test_nvl72_template(self):
        """NVL72-单架: NVLink 72 GPU 单域 (NVL72)"""
        ini = os.path.join('template', 'NVL72-单架', 'network_config.ini')
        designer = NetworkDesignerV2(ini)
        assert designer.scale_up_config == {
            'protocol': 'NVLink', 'num_gpus': 72, 'gpus_per_node': 8,
            'domain_size': 72, 'bandwidth': 1800.0}
        assert len(designer.scale_up_gpus) == 72
        assert designer.scale_up_stats['num_domains'] == 1

    def test_template_migration_preserves_scale_up(self):
        """模板 INI → JSON 迁移保留 scale_up (名实相符闭环)"""
        ini = os.path.join('template', 'NVL72-单架', 'network_config.ini')
        config, warnings = ini_to_project_config(ini, "p1")
        assert config is not None
        assert config['scale_up'] == {
            'protocol': 'NVLink', 'num_gpus': 72, 'gpus_per_node': 8,
            'domain_size': 72, 'bandwidth': 1800.0}
        assert validate_config(config) is None
