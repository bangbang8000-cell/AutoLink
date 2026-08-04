"""V3.0.2-T2-5: 三合一融合网（eth_combined）后端测试

覆盖：
  - networks.eth_combined schema 校验（布尔值/缺省兼容）
  - 融合网层次：combined_leaf_count = ceil(total_servers × storage_ports / storage_dl)
  - 对象创建：融合 Leaf 替代独立存储/业务交换机，OOB 独立保留
  - 接线：每服务器 storage_ports_per_server 条 combined 连接（带内管理可达）
  - domains 元数据：combined 域取代 storage/biz 域
  - V022 三合一专属规则：合法设计无 ERROR；关闭时跳过；缺融合交换机报 ERROR
  - engine 全链路：summary/networks.eth_combined、节点/边、校验
  - exporter 导出：含"融合网络"数据框
"""
import json

import pytest

from project_config import create_default_config, validate_config
from designer import NetworkDesignerV2
from engine import handle_design
from validation import (
    ValidationContext, create_default_engine, Severity,
)


def _write(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _combined_config(name="gb300", servers=72, storage=4, compute=4,
                     storage_ports=2, eth_combined=True):
    cfg = create_default_config(name)
    cfg['networks'].update({
        'param_network': True,
        'storage_network': False,   # 三合一替代独立存储网
        'biz_network': False,       # 三合一替代独立业务网
        'oob_network': True,        # OOB 独立保留
        'eth_combined': eth_combined,
    })
    cfg['topology'].update({
        'num_gpu_servers': servers,
        'num_all_flash_storage': storage,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': compute,
        'param_ports_per_server': 8,
        'storage_ports_per_server': storage_ports,
        'param_switch_ports': 64,
        'storage_switch_ports': 48,
        'param_speed': '800G',
        'storage_speed': '100G',
    })
    return cfg


def _designer(tmp_path, **kw):
    return NetworkDesignerV2(str(_write(tmp_path, _combined_config(**kw))))


# ---------- schema 校验 ----------

def test_combined_config_valid(tmp_path):
    assert validate_config(_combined_config()) is None


def test_combined_eth_combined_must_be_bool(tmp_path):
    cfg = _combined_config()
    cfg['networks']['eth_combined'] = 'yes'
    assert validate_config(cfg) is not None


def test_combined_absent_defaults_off(tmp_path):
    """缺省 eth_combined → 传统分离四网（兼容 2.9.9）"""
    cfg = create_default_config("legacy")
    cfg['topology'].update({'num_gpu_servers': 8, 'param_speed': '400G'})
    assert validate_config(cfg) is None
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.eth_combined is False


# ---------- 层次 / 对象创建 ----------

def test_combined_hierarchy(tmp_path):
    d = _designer(tmp_path)          # 72 GPU + 4 存储 + 4 通算 = 80 台, 每台 2 口
    assert d.eth_combined is True
    # custom 模式 storage_dl = storage_downlink_limit(20) → combined_leaf_count = ceil(80×2/20) = 8
    assert d.combined_dl == 20
    assert d.combined_leaf_count == 8
    # 独立存储/业务网络不创建
    assert d.storage_leaves == [] and d.storage_spines == []
    assert d.biz_access == [] and d.biz_agg == []
    assert len(d.combined_leaves) == 8
    assert all(sw.obj_type == 'combined_leaf' for sw in d.combined_leaves)


def test_combined_no_storage_biz_switches(tmp_path):
    d = _designer(tmp_path)
    # 传统存储/业务交换机为 0
    assert d.storage_leaf_count == 0 and d.storage_spine_count == 0
    assert d.storage_3tier_needed is False
    # OOB 独立保留
    assert d.oob_access and d.oob_agg


# ---------- 接线（带内管理可达） ----------

def test_combined_wiring(tmp_path):
    d = _designer(tmp_path)
    total = 72 + 4 + 4
    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'combined' and c.a_device == s.name]
    # 每服务器 2 口融合网卡
    assert len(conns) == total * 2
    per_server = {}
    for c in conns:
        per_server[c.a_device] = per_server.get(c.a_device, 0) + 1
    assert all(cnt == 2 for cnt in per_server.values())
    assert len(per_server) == total


def test_combined_valid_topology(tmp_path):
    d = _designer(tmp_path)
    vr = d.validate_topology()
    assert vr['valid'], vr['errors']


# ---------- domains 元数据 ----------

def test_combined_domains(tmp_path):
    d = _designer(tmp_path)
    types = [(dom.type, dom.tiers, dom.speed, dom.leaf_count) for dom in d.domains]
    assert ('combined', 1, '100G', 8) in types
    # 无独立 storage/biz 域
    assert not any(dom.type in ('storage', 'biz') for dom in d.domains)
    assert any(dom.type == 'param' for dom in d.domains)


# ---------- V022 专属规则 ----------

def test_v022_no_error_on_valid(tmp_path):
    cfg_path = str(_write(tmp_path, _combined_config()))
    result = handle_design({'configFile': cfg_path})
    assert result['valid'], result['validationIssues']
    err_issues = [i for i in result['validationIssues'] if i.get('severity') == 'error']
    assert not err_issues, err_issues


def test_v022_skipped_when_disabled(tmp_path):
    cfg = _combined_config(eth_combined=False)
    cfg_path = str(_write(tmp_path, cfg))
    result = handle_design({'configFile': cfg_path})
    v022 = [i for i in result['validationIssues'] if i.get('rule_id') == 'V022']
    assert v022 == []


def test_v022_missing_combined_switches():
    """eth_combined=true 但无融合交换机 → ERROR"""
    engine = create_default_engine()
    ctx = ValidationContext(
        servers=[{"name": "GPU服务器_1"}, {"name": "GPU服务器_2"}],
        switches=[{"name": "参数Leaf_1", "obj_type": "param_leaf", "network_type": "param"}],
        connections=[],
        config={"eth_combined": True},
    )
    issues = engine.validate(ctx)
    v022 = [i for i in issues if i.rule_id == 'V022']
    assert v022 and v022[0].severity == Severity.ERROR


def test_v022_inband_mgmt_unreachable():
    """融合交换机存在但服务器无 combined 连接 → ERROR（带内管理不可达）"""
    engine = create_default_engine()
    ctx = ValidationContext(
        servers=[{"name": "GPU服务器_1"}, {"name": "GPU服务器_2"}],
        switches=[{"name": "融合Leaf_1", "obj_type": "combined_leaf", "network_type": "combined"}],
        connections=[
            {"source": "GPU服务器_1", "target": "融合Leaf_1", "network_type": "combined"},
            # GPU服务器_2 无 combined 连接
        ],
        config={"eth_combined": True},
    )
    issues = engine.validate(ctx)
    v022 = [i for i in issues if i.rule_id == 'V022']
    assert v022 and v022[0].severity == Severity.ERROR
    assert 'GPU服务器_2' in v022[0].message


# ---------- engine 全链路 ----------

def test_combined_engine_design(tmp_path):
    cfg_path = str(_write(tmp_path, _combined_config(servers=32, storage=2, compute=2)))
    result = handle_design({'configFile': cfg_path})
    assert 'error' not in result
    assert result['summary']['networks']['eth_combined'] is True
    assert result['summary']['domains'] is not None
    topo = result['topology']
    ids = [n['id'] for n in topo['nodes']]
    combined_leaves = [i for i in ids if i.startswith('融合Leaf')]
    assert combined_leaves, "engine 未输出融合 Leaf 节点"
    combined_edges = [e for e in topo['edges'] if e.get('network_type') == 'combined']
    assert combined_edges, "engine 未输出 combined 边"
    # 无独立存储/业务交换机节点
    assert not any(i.startswith('存储Leaf') for i in ids)
    assert not any(i.startswith('业务') for i in ids)
    assert result['valid']


# ---------- exporter 导出 ----------

def test_combined_exporter_view(tmp_path):
    from exporter import generate_switch_view
    d = _designer(tmp_path, servers=32, storage=2, compute=2)
    view = generate_switch_view(d)
    assert '融合网络' in view
    combined_df = view['融合网络']
    assert not combined_df.empty
    assert len(combined_df) == (32 + 2 + 2) * 2
    # 独立存储网络为空
    assert view['存储网络'].empty
