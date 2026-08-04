"""V3.0.2-T2-3: 华为超节点（UB 域内全对等 + 域间 Scale-Out）后端测试

覆盖：
  - param_network_mode / param_huawei_supernode schema 校验（合法/非法/缺省兼容）
  - 384 NPU CloudMatrix 单域：域内 UB 全对等（N×(N-1)/2）、Scale-Out 交换机、
    NPU 上联（N×口数）+ 交换机全互联
  - 768 NPU 双域：域划分/每域 NPU 数/域间 Scale-Out 骨干
  - domains 元数据：scale_up（UB）+ scale_out（800G）
  - V021 华为超节点专属规则：合法设计无 ERROR
  - cluster network_mode='huawei_supernode' → engine 原生路径放行
  - HuaweiSuperNodePlugin 注册 + generate_topology 纯 dict（ub_full_mesh=True）
  - 传统四网关闭：无 param/storage 交换机与服务器
"""
import json

import pytest

from project_config import create_default_config, validate_config
from designer import NetworkDesignerV2
from network_plugin import (
    register_builtin_plugins, resolve_network_mode, get_plugin,
)
from engine import handle_design, _validate_cluster_network_modes


def _write(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _huawei_config(name="hs", npus=384, domain_size=0, so_switches=16,
                   so_ports=2, storage=8, compute=8):
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': npus,
        'num_all_flash_storage': storage,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': compute,
        'param_network_mode': 'huawei_supernode',
        'param_huawei_supernode': {
            'num_npus': npus, 'npus_per_node': 8, 'ub_bandwidth_gbps': 2800,
            'ub_domain_size': domain_size,
            'num_scaleout_switches': so_switches, 'scaleout_ports_per_npu': so_ports,
            'scaleout_speed': '800G', 'scaleout_switch_ports': 144,
        },
    })
    return cfg


def _designer(tmp_path, **kw):
    return NetworkDesignerV2(str(_write(tmp_path, _huawei_config(**kw))))


# ---------- schema 校验 ----------

def test_huawei_config_valid(tmp_path):
    assert validate_config(_huawei_config()) is None


def test_huawei_invalid_mode(tmp_path):
    cfg = _huawei_config()
    cfg['topology']['param_network_mode'] = 'hypercube'
    assert validate_config(cfg) is not None

    cfg = _huawei_config()
    cfg['topology']['param_huawei_supernode'] = {'num_npus': 0}
    assert validate_config(cfg) is not None

    cfg = _huawei_config()
    cfg['topology']['param_huawei_supernode'] = {'num_scaleout_switches': -1}
    assert validate_config(cfg) is not None


def test_huawei_absent_legacy_compat(tmp_path):
    """无 param_network_mode → 缺省 standard，行为与传统一致（兼容 2.9.9）"""
    cfg = create_default_config("legacy")
    cfg['topology'].update({'num_gpu_servers': 8, 'param_speed': '400G'})
    assert validate_config(cfg) is None
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.param_network_mode == 'standard'
    assert d.huawei_stats == {}


# ---------- 384 NPU CloudMatrix 单域结构 ----------

def test_huawei_384_single_domain_structure(tmp_path):
    d = _designer(tmp_path, npus=384)
    assert d.param_network_mode == 'huawei_supernode'
    st = d.huawei_stats
    assert st['num_npus'] == 384
    assert st['num_domains'] == 1
    # NPU 节点与 Scale-Out 交换机
    assert len(d.huawei_npus) == 384
    assert len(d.huawei_scaleout_switches) == 16
    # 传统四网关闭：无服务器、无 param/storage 交换机
    assert d.servers == []
    assert d.param_leaves == [] and d.param_spines == [] and d.param_cores == []
    assert d.storage_leaves == []
    # UB 域内全对等边数 = 384×383/2
    ub_conns = [c for c in d.huawei_connections if c.network_type == 'ub']
    assert len(ub_conns) == 384 * 383 // 2 * 2          # 双向 Connection
    assert st['total_links'] == 384 * 383 // 2
    # Scale-Out：NPU 上联 + 交换机全互联
    so_conns = [c for c in d.huawei_connections if c.network_type == 'scale_out']
    assert len(so_conns) == (384 * 2 + 16 * 15 // 2) * 2
    assert st['scaleout_uplink_edges'] == 384 * 2
    assert st['scaleout_interconnect_edges'] == 120


def test_huawei_384_valid_topology(tmp_path):
    """合法 384 NPU 设计自检通过（无端口溢出/无四网误报）"""
    d = _designer(tmp_path, npus=384)
    vr = d.validate_topology()
    assert vr['valid'], vr['errors']


def test_huawei_npu_ports_and_groups(tmp_path):
    """NPU 节点：每 NPU 域内全对等口 = 域内 NPU-1 + Scale-Out 上联口；分组 podid=ub-domain-1"""
    d = _designer(tmp_path, npus=384)
    npu0 = d.huawei_npus[0]
    assert npu0.max_ports == 383 + 2
    assert npu0.podid == 'ub-domain-1'
    assert npu0.network_type == 'ub'
    assert all(n.podid == 'ub-domain-1' for n in d.huawei_npus)
    assert all(s.podid == 'ub-domain-1' for s in d.huawei_scaleout_switches)


# ---------- 双域（域间 Scale-Out 骨干） ----------

def test_huawei_768_two_domains(tmp_path):
    d = _designer(tmp_path, npus=768, domain_size=384, so_switches=8)
    st = d.huawei_stats
    assert st['num_domains'] == 2
    assert st['npus_per_domain'] == 384
    assert len(d.huawei_npus) == 768
    assert len(d.huawei_scaleout_switches) == 16        # 每域 8
    assert st['scaleout_interconnect_edges'] == 16 * 15 // 2   # 跨域全互联骨干
    assert st['scaleout_uplink_edges'] == 768 * 2
    # 域分组：NPU 前 384 → ub-domain-1，后 384 → ub-domain-2
    assert d.huawei_npus[0].podid == 'ub-domain-1'
    assert d.huawei_npus[384].podid == 'ub-domain-2'
    assert d.validate_topology()['valid']


# ---------- domains 元数据 ----------

def test_huawei_domains(tmp_path):
    d = _designer(tmp_path, npus=384)
    types = [(dom.type, dom.speed, dom.leaf_count, dom.network_mode) for dom in d.domains]
    assert ('scale_up', '2800G', 0, 'huawei_supernode') in types
    assert ('scale_out', '800G', 16, 'huawei_supernode') in types
    # 无传统 param/storage 域
    assert not any(dom.type in ('param', 'storage') for dom in d.domains)


# ---------- V021 专属规则 ----------

def test_v021_no_error_on_valid(tmp_path):
    """合法 384 NPU 设计无 ERROR（含 V021 规则）"""
    from engine import handle_design
    cfg_path = str(_write(tmp_path, _huawei_config(npus=384)))
    result = handle_design({'configFile': cfg_path})
    assert result['valid'], result['validationIssues']
    err_issues = [i for i in result['validationIssues'] if i.get('severity') == 'error']
    assert not err_issues, err_issues


def test_v021_skipped_outside_mode(tmp_path):
    """非 huawei_supernode 模式不触发 V021"""
    cfg = create_default_config("std")
    cfg['topology'].update({'num_gpu_servers': 8, 'param_speed': '400G'})
    cfg_path = str(_write(tmp_path, cfg))
    result = handle_design({'configFile': cfg_path})
    v021 = [i for i in result['validationIssues'] if i.get('rule_id') == 'V021']
    assert v021 == []


# ---------- cluster network_mode 桥接 + engine 原生路径 ----------

def test_huawei_cluster_network_mode_bridge(tmp_path):
    """单集群 cluster.network_mode='huawei_supernode' → designer 原生路径放行"""
    cfg = _huawei_config(npus=64)
    cfg['clusters'] = [{'cluster_id': 'c1', 'role': 'P', 'network_mode': 'huawei_supernode', 'scale': 64}]
    cfg['topology'].pop('param_network_mode', None)
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.param_network_mode == 'huawei_supernode'


def test_huawei_engine_design(tmp_path):
    """engine handle_design 全链路：summary + topology nodes/edges 输出"""
    cfg_path = str(_write(tmp_path, _huawei_config(npus=64, so_switches=4)))
    result = handle_design({'configFile': cfg_path})
    assert 'error' not in result
    hs = result['summary']['huaweiSuperNode']
    assert hs['enabled'] is True
    assert hs['stats']['num_npus'] == 64
    topo = result['topology']
    # 节点：64 NPU + 4 Scale-Out
    ids = [n['id'] for n in topo['nodes']]
    assert sum(1 for i in ids if i.startswith('NPU_')) == 64
    assert sum(1 for i in ids if i.startswith('ScaleOut_')) == 4
    # 边：UB 全对等 + Scale-Out（engine 对双向不同端口各输出一次，×2）
    nets = {}
    for e in topo['edges']:
        nets[e['network_type']] = nets.get(e['network_type'], 0) + 1
    assert nets.get('ub', 0) == 2 * (64 * 63 // 2)
    assert nets.get('scale_out', 0) == 2 * (64 * 2 + 4 * 3 // 2)
    # 校验结果
    assert result['valid']


# ---------- 插件 ----------

def test_huawei_plugin_registered():
    register_builtin_plugins()
    plugin = get_plugin('huawei_supernode')
    assert plugin is not None
    assert plugin.get_info().display_name == '华为超节点'


def test_huawei_plugin_generate_topology():
    register_builtin_plugins()
    plugin = get_plugin('huawei_supernode')
    topo = plugin.generate_topology({'num_npus': 64, 'npus_per_node': 8,
                                     'num_scaleout_switches': 4})
    assert topo['network_type'] == 'huawei_supernode'
    assert topo['stats']['ub_full_mesh'] is True
    assert topo['stats']['num_npus'] == 64
    assert len([n for n in topo['nodes'] if n['type'] == 'npu']) == 64
    assert len([n for n in topo['nodes'] if n['type'] == 'huawei_scaleout']) == 4
    # 边：UB 全对等（单向 dict）+ Scale-Out
    ub = [e for e in topo['edges'] if e['network_type'] == 'ub']
    so = [e for e in topo['edges'] if e['network_type'] == 'scale_out']
    assert len(ub) == 64 * 63 // 2
    assert len(so) == 64 * 2 + 4 * 3 // 2


def test_huawei_resolve_network_mode():
    register_builtin_plugins()
    # 原生路径（与 zcube 一致）：designer 直接处理
    assert resolve_network_mode('huawei_supernode') == 'native'
    assert resolve_network_mode('unknown_hs') == 'unknown'
    assert resolve_network_mode(None) == 'native'
