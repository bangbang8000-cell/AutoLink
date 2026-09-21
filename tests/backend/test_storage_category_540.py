"""AutoLink v5.4.0（6 场景内容建设）—— 存储网按类别口径专项

对应 PRD FR-A4 / FR-A8 / §3.5-C / 开发计划 W1.6-W1.8 / 测试计划 T-6S-C 组：

  W1.6（FR-A4）: 全闪/混闪按类别各自映射型号（all_flash_storage_server /
        hybrid_flash_storage_server 分别落档案）；
  W1.7（FR-A8）: 存储网口数按类别（GPU 1 / 存储 4 / 通算 1（O-8）），
        建链 / 层级判据 / V016 三处同源（_storage_port_demand 单一来源）；
  W1.8（FR-A8）: 层级判据端口容量式 = (k×breakout_count)²/2（PRD §3.5-C：
        QM9700 存储 1分2 ⇒ 逻辑 k=128，单层容量 8192 口）。
"""
import json

import pytest

from project_config import create_default_config
from designer import NetworkDesignerV2


def _write(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _base_cfg(name="bk_stcat", gpu=4, allflash=2, hybrid=1, compute=1):
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': gpu,
        'num_all_flash_storage': allflash,
        'num_hybrid_flash_storage': hybrid,
        'num_compute_servers': compute,
        'param_protocol': 'RoCE',
        'param_speed': '400G',
        'param_ports_per_server': 8,
        'param_switch_ports': 64,
        'storage_ports_per_server': 1,
        'storage_switch_ports': 64,
        'storage_downlink_limit': 32,
        'storage_speed': '200G',
    })
    return cfg


# ---------- W1.7：类别口数与建链 ----------

def test_category_ports_defaults(tmp_path):
    d = NetworkDesignerV2(str(_write(tmp_path, _base_cfg())))
    assert d.storage_ports_gpu == 1
    assert d.storage_ports_storage == 4
    assert d.storage_ports_compute == 1


def test_category_ports_override(tmp_path):
    cfg = _base_cfg()
    cfg['topology'].update({'storage_ports_compute': 2, 'storage_ports_gpu': 0})
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.storage_ports_gpu == 0
    assert d.storage_ports_compute == 2
    assert d.storage_ports_storage == 4          # 未配置保持默认


def test_wire_storage_category_counts(tmp_path):
    """4 GPU(1) + 2 全闪(4) + 1 混闪(4) + 1 通算(1) ⇒ 连接数 4+8+4+1 = 17。"""
    d = NetworkDesignerV2(str(_write(tmp_path, _base_cfg(gpu=4, allflash=2, hybrid=1, compute=1))))
    sconns = [c for s in d.servers for c in s.connections
              if c.network_type == 'storage' and c.a_device == s.name]
    assert len(sconns) == 4 * 1 + (2 + 1) * 4 + 1 * 1, len(sconns)
    # 存储服务器每台 4 条
    storage_conns = {s.name: sum(1 for c in s.connections
                                 if c.network_type == 'storage' and c.a_device == s.name)
                     for s in d.servers if s.name.startswith('存储服务器')}
    assert all(n == 4 for n in storage_conns.values()), storage_conns
    # GPU 每台 1 条
    gpu_conns = {s.name: sum(1 for c in s.connections
                             if c.network_type == 'storage' and c.a_device == s.name)
                 for s in d.servers if s.name.startswith('GPU服务器')}
    assert all(n == 1 for n in gpu_conns.values()), gpu_conns


def test_demand_matches_connections(tmp_path):
    """同源守卫：_storage_port_demand == 实际存储连接总数。"""
    d = NetworkDesignerV2(str(_write(tmp_path, _base_cfg(gpu=4, allflash=3, hybrid=2, compute=2))))
    sconns = [c for s in d.servers for c in s.connections
              if c.network_type == 'storage' and c.a_device == s.name]
    assert d._storage_port_demand() == len(sconns)


# ---------- W1.6：全闪/混闪分别映射 ----------

def test_allflash_hybrid_separate_profiles(tmp_path):
    cfg = _base_cfg()
    cfg['device_refs'] = cfg.get('device_refs', {})
    cfg['device_refs']['all_flash_storage_server'] = {"library_id": "generic_all_flash"}
    cfg['device_refs']['hybrid_flash_storage_server'] = {"library_id": "generic_hybrid_flash"}
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    af = [s for s in d.servers if s.name.startswith('存储服务器')][:d.num_all_flash_storage]
    hf = [s for s in d.servers if s.name.startswith('存储服务器')][d.num_all_flash_storage:]
    assert all((s.device_profile.id if s.device_profile else None)
               == 'generic_all_flash' for s in af), \
        [s.device_profile.id if s.device_profile else None for s in af]
    assert all((s.device_profile.id if s.device_profile else None)
               == 'generic_hybrid_flash' for s in hf), \
        [s.device_profile.id if s.device_profile else None for s in hf]


def test_allflash_default_falls_back_storage_server(tmp_path):
    """无 all_flash/hybrid 档案 ⇒ 回退 storage_server（向后兼容）。"""
    cfg = _base_cfg()
    cfg['device_refs'] = cfg.get('device_refs', {})
    cfg['device_refs']['storage_server'] = {"library_id": "generic_4u_gpu"}
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    st = [s for s in d.servers if s.name.startswith('存储服务器')]
    assert st and all(s.device_profile.id == 'generic_4u_gpu' for s in st)


# ---------- W1.8：容量式判据 ----------

def test_capacity_formula_per_prd():
    """PRD §3.5-C：QM9700 存储（k=64 1分2）与 X400（k=128）单层容量均 8192 口。"""
    # 容量 = (k×breakout_count)²/2（designer._storage_capacity 的同构公式）
    assert ((64 * 2) ** 2) // 2 == 8192          # QM9700 存储 1分2
    assert ((128 * 1) ** 2) // 2 == 8192         # X400 无分光
    # 与真实实现一致性（集成环境：designer._storage_capacity）
    import tempfile
    from pathlib import Path
    tmp = Path(tempfile.mkdtemp())
    d = NetworkDesignerV2(str(_write(tmp, _base_cfg())))
    d.storage_switch_ports = 64
    d.storage_breakout_count = 2
    assert d._storage_capacity() == 8192
    d2 = NetworkDesignerV2(str(_write(tmp, _base_cfg('x400'))))
    d2.storage_switch_ports = 128
    d2.storage_breakout_count = 1
    assert d2._storage_capacity() == 8192


def test_hierarchy_two_tier_for_six_scenarios(tmp_path):
    """六场景存储网全部落二层：需求(≤1781) ≤ 容量(8192)。"""
    for name, gpu, allflash, hybrid, compute in [
        ('s1', 1250, 59, 59, 59),
        ('s2', 1250, 59, 59, 59),
        ('s3', 1250, 59, 59, 59),
        ('s4', 256, 12, 12, 12),
        ('s5', 1024, 48, 48, 48),
        ('s6', 1250, 59, 59, 59),
    ]:
        cfg = _base_cfg(name, gpu=gpu, allflash=allflash, hybrid=hybrid, compute=compute)
        cfg['topology']['storage_switch_ports'] = 64
        cfg['device_refs'] = cfg.get('device_refs', {})
        cfg['device_refs']['storage_leaf_switch'] = {"library_id": "nvidia_mqm9700_64_400g_ib"}
        d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
        assert d.storage_3tier_needed is False, f'{name}: 应落二层'
        # 需求 < 容量
        assert d._storage_port_demand() <= d._storage_capacity(), name


def test_hierarchy_three_tier_when_over_capacity(tmp_path):
    """需求 > 容量 ⇒ 三层（证明判据非恒二层）。"""
    cfg = _base_cfg('big', gpu=5000, allflash=500, hybrid=0, compute=0)
    cfg['topology']['storage_switch_ports'] = 48     # (48)²/2 = 1152 口容量
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d._storage_port_demand() > d._storage_capacity()
    assert d.storage_3tier_needed is True
