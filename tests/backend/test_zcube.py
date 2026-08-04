"""V3.0.2-T2-1/T1-5: ZCube 扁平二部图 + 双平面 3-tier（后端）测试

覆盖：
  - param_network_mode / param_zcube schema 校验（合法/非法/缺省兼容）
  - 512 GPU ZCube：两组 Leaf（8A+8B）、无 Spine/Core、层级一致性
  - 双口混合接入：nics_per_gpu=4 → 组A 2 口；连接数 = num_gpus × nics
  - 组 A↔组 B 全二部互联：每 Leaf 互联数 = L
  - domains 元数据：planes=2、tiers=1
  - V020 ZCube 专属规则：合法设计无 ERROR；非 zcube 模式不触发
  - cluster network_mode='zcube' → engine 原生路径放行
  - ZcubeNetworkPlugin 注册 + generate_topology 纯 dict（no_spine=True）
  - 双平面 3-tier：1024×B300 800G → 每平面 tier=3（Pod 化 + Core），自检通过
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


def _zcube_config(name="zc", servers=512, nics=2, leaf_count=0, switch_ports=144):
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': servers,
        'num_all_flash_storage': 4,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 4,
        'param_speed': '400G',
        'param_network_mode': 'zcube',
        'param_zcube': {'nics_per_gpu': nics, 'leaf_count': leaf_count,
                        'switch_ports': switch_ports},
    })
    return cfg


def _designer(tmp_path, **kw):
    return NetworkDesignerV2(str(_write(tmp_path, _zcube_config(**kw))))


# ---------- schema 校验 ----------

def test_zcube_config_valid(tmp_path):
    assert validate_config(_zcube_config()) is None


def test_zcube_invalid_mode(tmp_path):
    cfg = _zcube_config()
    cfg['topology']['param_network_mode'] = 'hypercube'
    assert validate_config(cfg) is not None

    cfg = _zcube_config()
    cfg['topology']['param_zcube'] = {'nics_per_gpu': 0}
    assert validate_config(cfg) is not None


def test_zcube_absent_legacy_compat(tmp_path):
    """无 param_network_mode → 缺省 standard，行为与传统一致（兼容 2.9.9）"""
    cfg = create_default_config("legacy")
    cfg['topology'].update({'num_gpu_servers': 8, 'param_speed': '400G'})
    assert validate_config(cfg) is None
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.param_network_mode == 'standard'
    assert d.zcube_stats == {}


# ---------- 512 GPU ZCube 结构 ----------

def test_zcube_structure_two_leaf_groups(tmp_path):
    d = _designer(tmp_path, servers=512)
    assert d.param_network_mode == 'zcube'
    assert d.zcube_stats['leaf_count'] == 8          # 单组 Leaf 数
    # 无 Spine/Core：层级一致性
    assert d.param_spines == []
    assert d.param_cores == []
    # 两组 Leaf 共 16
    from collections import Counter
    assert dict(Counter(getattr(l, 'zcube_group', '?') for l in d.param_leaves)) == {'A': 8, 'B': 8}
    # 全部为 param_leaf 类型（无 Spine/Core 层级）
    assert all(l.obj_type == 'param_leaf' for l in d.param_leaves)


def test_zcube_hybrid_multi_nic(tmp_path):
    """nics_per_gpu=4 → 前 2 口组 A、后 2 口组 B（多轨混合接入）"""
    d = _designer(tmp_path, servers=128, nics=4)
    assert d.zcube_stats['ports_to_group_a'] == 2
    gpu = d.servers[:128]
    for s in gpu:
        assert len([c for c in s.connections if c.network_type == 'param']) == 4


def test_zcube_connections_leaf_inter(tmp_path):
    d = _designer(tmp_path, servers=512)
    gpu_conns = sum(
        len([c for c in s.connections if c.network_type == 'param'])
        for s in d.servers[:512])
    assert gpu_conns == 512 * 2
    # 组 A↔组 B 全二部：每 Leaf 互联数 = 对组 Leaf 数 = L
    for l in d.param_leaves:
        inter = [c for c in l.connections
                 if c.z_device.startswith('参数') and 'Leaf' in c.z_device]
        assert len(inter) == d.zcube_stats['leaf_count']


def test_zcube_domains(tmp_path):
    d = _designer(tmp_path, servers=512)
    params = [dom for dom in d.domains if dom.type == 'param']
    assert len(params) == 1                     # 单一 param 域（无重复）
    assert params[0].planes == 2
    assert params[0].tiers == 1                 # 扁平二部图
    assert params[0].leaf_count == 16
    types = [dom.type for dom in d.domains]
    assert 'storage' in types and 'biz' in types and 'oob' in types  # 其余网络域保留


# ---------- V020 校验规则 ----------

def test_zcube_validation_clean(tmp_path):
    """合法 ZCube 设计：V020 无 ERROR，V016 容量校验不误报（nics_per_gpu 而非 param_ports）"""
    cfg = _zcube_config(servers=512)
    result = handle_design({'configFile': str(_write(tmp_path, cfg))})
    assert 'error' not in result
    v020 = [i for i in result['validationIssues'] if i['rule_id'] == 'V020']
    v016 = [i for i in result['validationIssues'] if i['rule_id'] == 'V016']
    assert all(i['severity'] != 'error' for i in v020)
    assert v016 == []                            # 容量满足（16 Leaf × 136 下联 ≥ 1024 口）
    v010 = [i for i in result['validationIssues'] if i['rule_id'] == 'V010']
    assert v010 == []                            # ZCube 无 Spine，收敛比规则不适用


def test_v020_skipped_for_standard_mode(tmp_path):
    """V020 仅在 zcube 模式触发（standard 模式返回空）"""
    from validation import create_default_engine, ValidationContext, Severity
    engine = create_default_engine()
    ctx = ValidationContext(config={'param_network_mode': 'standard'})
    issues = engine.validate(ctx)
    assert all(i.rule_id != 'V020' for i in issues)


# ---------- engine 分派（cluster network_mode） ----------

def test_zcube_cluster_mode_native(tmp_path):
    cfg = _zcube_config()
    cfg['clusters'] = [
        {"cluster_id": "c-p", "role": "P", "network_mode": "zcube", "gpu_pools": []},
    ]
    assert _validate_cluster_network_modes(cfg) == []
    assert resolve_network_mode('zcube') == 'native'
    result = handle_design({'configFile': str(_write(tmp_path, cfg))})
    assert 'error' not in result
    assert result['valid'] is True


# ---------- ZcubeNetworkPlugin ----------

def test_zcube_plugin_registered_and_generates(tmp_path):
    register_builtin_plugins()                   # 幂等
    plugin = get_plugin('zcube')
    assert plugin is not None
    topo = plugin.generate_topology({'num_gpus': 1024, 'nics_per_gpu': 2,
                                     'switch_ports': 144})
    assert topo['network_type'] == 'zcube'
    assert topo['stats']['no_spine'] is True
    assert topo['stats']['leaf_count_per_group'] == 8
    assert len(topo['nodes']) == 16              # 两组各 8


# ---------- 双平面 3-tier（V3.0.1-T1-5） ----------

def _dual_plane_3tier_config(name="dp3", servers=1024, speed="800G", nics=8):
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': servers,
        'num_all_flash_storage': 0,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 0,
        'param_protocol': 'IB',
        'param_speed': speed,
        'param_nics_per_server': nics,
        'ports_per_nic': 2,
        'param_planes': [
            {'leaf_count': 8, 'protocol': 'IB', 'speed': speed,
             'switch_ports': 144, 'uplink': 72},
            {'leaf_count': 8, 'protocol': 'IB', 'speed': speed,
             'switch_ports': 144, 'uplink': 72},
        ],
    })
    return cfg


def test_dual_plane_3tier_structure(tmp_path):
    cfg = _dual_plane_3tier_config(servers=1024)
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.dual_plane_enabled is True
    stats = d.dual_plane_stats
    assert len(stats) == 2
    assert all(s['tier'] == 3 for s in stats)    # 1024 超单 Pod 容量 → 3-tier
    assert all(s['pods'] > 1 for s in stats)
    assert all(s['core_count'] > 0 for s in stats)
    # 3-tier 命名：参数A_Leaf_P{pod}_{n}
    assert any(l.name.startswith('参数A_Leaf_P') for l in d.param_leaves)
    assert len(d.param_cores) == sum(s['core_count'] for s in stats)
    res = d.validate_topology()
    assert res['valid'] is True
    # 域元数据：逐平面 tiers 由 param_3tier_needed 决定（3-tier）
    param = next(dom for dom in d.domains if dom.type == 'param')
    assert param.planes == 2


def test_dual_plane_2tier_still_2tier(tmp_path):
    """较小规模（128）双平面仍为 2-tier，3-tier 扩展不回归 2-tier 场景"""
    cfg = _dual_plane_3tier_config(servers=128, speed="400G")
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    stats = d.dual_plane_stats
    assert len(stats) == 2
    assert all(s['tier'] == 2 for s in stats)
    assert all(s['core_count'] == 0 for s in stats)
    assert all(not l.name.startswith('参数A_Leaf_P') for l in d.param_leaves)
    assert d.validate_topology()['valid'] is True
