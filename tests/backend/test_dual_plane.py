"""V3.0.1-T1-1/T1-2/T1-8: 双平面 16 Leaf / 800G IB（后端）测试

覆盖：
  - param_planes schema 校验（合法/非法/缺失兼容 2.9.9）
  - 128×H200（CX7 2×200G）：双平面各 8 Leaf、每服务器 16 口（8/平面）、自检通过
  - 1024×B300（CX8 2×400G）800G IB：leaf 自动扩容、自检通过
  - 逐平面 protocol/speed 独立生效
  - 传统配置（无 param_planes）行为不变（双平面关闭）
  - engine handle_design summary 输出 domains.planes=2
  - golden 快照经 scripts/gen_golden.py --check 门禁（T1-8，CI 已接入）
"""
import json

import pytest

from project_config import create_default_config, validate_config
from designer import NetworkDesignerV2
from engine import handle_design


def _dual_plane_config(name="dp", servers=128, speed="200G", leaf=8,
                       switch_ports=144, uplink=16, nics=8, storage=4, compute=4,
                       planes_speed=None):
    """构造双平面配置；planes_speed: [speedA, speedB] 用于逐平面差异化"""
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': servers,
        'num_all_flash_storage': storage,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': compute,
        'param_protocol': 'IB',
        'param_speed': speed,
        'param_nics_per_server': nics,
        'ports_per_nic': 2,
        'param_planes': [
            {'leaf_count': leaf, 'protocol': 'IB', 'speed': (planes_speed or [speed, speed])[0],
             'switch_ports': switch_ports, 'uplink': uplink},
            {'leaf_count': leaf, 'protocol': 'IB', 'speed': (planes_speed or [speed, speed])[1],
             'switch_ports': switch_ports, 'uplink': uplink},
        ],
    })
    return cfg


def _write(tmp_path, cfg):
    path = tmp_path / 'project_config.json'
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _designer(tmp_path, **kw):
    return NetworkDesignerV2(str(_write(tmp_path, _dual_plane_config(**kw))))


# ---------- schema 校验（T1-1） ----------

def test_dual_plane_config_valid(tmp_path):
    cfg = _dual_plane_config()
    assert validate_config(cfg) is None


def test_dual_plane_absent_legacy_compat(tmp_path):
    cfg = create_default_config("legacy")
    cfg['topology'].update({'num_gpu_servers': 8, 'param_speed': '400G'})
    assert validate_config(cfg) is None
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.dual_plane_enabled is False
    assert d.param_planes == []
    assert d.ports_per_nic == 1


def test_dual_plane_invalid_structures(tmp_path):
    cfg = _dual_plane_config()
    cfg['topology']['param_planes'] = 'not-a-list'
    assert validate_config(cfg) is not None

    cfg = _dual_plane_config()
    cfg['topology']['param_planes'] = [{'leaf_count': 0}]
    assert validate_config(cfg) is not None

    cfg = _dual_plane_config()
    cfg['topology']['param_planes'] = [{'leaf_count': 8, 'uplink': -1}]
    assert validate_config(cfg) is not None

    cfg = _dual_plane_config()
    cfg['topology']['param_planes'][0]['protocol'] = 'NVLink'
    assert validate_config(cfg) is not None


def test_dual_plane_requires_dual_port_nic(tmp_path):
    cfg = _dual_plane_config()
    cfg['topology']['ports_per_nic'] = 1
    assert validate_config(cfg) is not None  # 双平面要求双口网卡


# ---------- 128×H200（CX7 2×200G）全链路 ----------

def test_h200_dual_plane_structure(tmp_path):
    d = _designer(tmp_path, servers=128)
    assert d.dual_plane_enabled is True
    assert len(d.param_planes) == 2
    # 双平面各 8 Leaf → 共 16 Leaf；Spine = leaf_count//2/平面
    assert len(d.param_leaves) == 16
    assert len(d.param_spines) == 8
    from collections import Counter
    assert dict(Counter(getattr(l, 'plane_id', None) for l in d.param_leaves)) == {0: 8, 1: 8}
    # 域元数据 planes=2
    assert len(d.domains) >= 1
    param_domain = next(dom for dom in d.domains if dom.type == 'param')
    assert param_domain.planes == 2
    assert param_domain.leaf_count == 16


def test_h200_server_dual_port_connections(tmp_path):
    d = _designer(tmp_path, servers=128)
    gpu = d.servers[:128]
    for s in gpu:
        param_conns = [c for c in s.connections if c.network_type == 'param']
        assert len(param_conns) == 16  # 8 网卡 × 双口
    # 每服务器端口命名 1..16（平面 A=1..8、平面 B=9..16）
    s0 = gpu[0]
    ports = sorted(c.a_port if c.a_device == s0.name else c.z_port
                   for c in s0.connections if c.network_type == 'param')
    nums = sorted(int(p.replace('参数网卡', '')) for p in ports)
    assert nums == list(range(1, 17))
    # 每平面连接数 = 128 × 8
    plane_a = [c for c in s0.connections if c.network_type == 'param'
               and int(c.a_port.replace('参数网卡', '')) <= 8]
    assert len(plane_a) == 8


def test_h200_topology_valid(tmp_path):
    d = _designer(tmp_path, servers=128)
    result = d.validate_topology()
    assert result['valid'], result['errors']


# ---------- 1024×B300（CX8 2×400G）800G IB：leaf 自动扩容 ----------

def test_b300_800g_dual_plane(tmp_path):
    d = _designer(tmp_path, servers=1024, speed="800G", storage=32, compute=16)
    # 8192 下联/平面 ÷ 128/Leaf → 64 Leaf/平面（自动扩容）
    from collections import Counter
    assert dict(Counter(getattr(l, 'plane_id', None) for l in d.param_leaves)) == {0: 64, 1: 64}
    assert len(d.param_leaves) == 128
    assert d.validate_topology()['valid']


# ---------- 逐平面 protocol/speed 独立 ----------

def test_per_plane_speed_honored(tmp_path):
    d = _designer(tmp_path, servers=128, planes_speed=['200G', '400G'])
    conns = [c for c in d.param_leaves[0].connections]
    # 平面 A（参数A_Leaf_*）连接速率 200G；平面 B 400G
    plane_a_speeds = {c.a_module or c.z_module for c in conns}
    plane_b_speeds = {c.a_module or c.z_module for c in d.param_leaves[8].connections}
    assert '200G' in plane_a_speeds
    assert '400G' in plane_b_speeds


# ---------- engine 集成 ----------

def test_engine_design_summary_dual_plane(tmp_path):
    cfg = _dual_plane_config(servers=128)
    path = _write(tmp_path, cfg)
    result = handle_design({'configFile': str(path)})
    assert 'error' not in result
    assert result['summary']['paramLeafCount'] == 16
    domains = {d_['type']: d_ for d_ in result['summary']['domains']}
    assert domains['param']['planes'] == 2
    assert domains['param']['leaf_count'] == 16


# ---------- 传统配置回归 ----------

def test_legacy_unchanged(tmp_path):
    cfg = create_default_config("legacy")
    cfg['topology'].update({'num_gpu_servers': 8, 'num_all_flash_storage': 2,
                            'num_hybrid_flash_storage': 0, 'num_compute_servers': 2,
                            'param_speed': '400G'})
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.dual_plane_enabled is False
    assert len(d.param_leaves) > 0
    assert d.validate_topology()['valid']
