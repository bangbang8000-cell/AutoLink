"""V3.0.2-T2-11: 1 分 2 扇出（breakout）阶段2 接线/逻辑口测试

覆盖：
  - 场景A（IB 800G→2×400G）：Q3200 自动选型 → 参数网逻辑连接速率 400G、Leaf 逻辑口命名、连接携带 breakout
  - 场景B（存储 400G→2×200G）：MQM9790 作存储交换机 → 存储网逻辑连接速率 200G、逻辑口、breakout 标注
  - select_module_for_connection 感知 conn.breakout 按物理速率匹配分裂线缆
  - engine 全链路：逻辑速率与节点/边输出
"""
import json

import pytest

from project_config import create_default_config
from designer import NetworkDesignerV2
from engine import handle_design
from optical_selector import select_module_for_connection


def _write(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _param_ib_800g_config(name="bk_param_ib", servers=8, storage=1, compute=1):
    """场景A：IB 参数网 800G → Q3200 自动选型（800G→2×400G）"""
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': servers,
        'num_all_flash_storage': storage,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': compute,
        'param_protocol': 'IB',
        'param_speed': '800G',
        'param_ports_per_server': 8,
        'storage_ports_per_server': 1,
        'param_switch_ports': 72,
        'storage_switch_ports': 32,
        'storage_speed': '100G',
    })
    return cfg


def _storage_mqm9790_config(name="bk_storage", servers=8, storage=2, compute=2):
    """场景B：存储网交换机指定 MQM9790（400G→2×200G 分裂接存储）"""
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': servers,
        'num_all_flash_storage': storage,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': compute,
        'param_speed': '400G',
        'storage_ports_per_server': 1,
        'storage_speed': '400G',
        'param_switch_ports': 64,
        'storage_switch_ports': 64,
    })
    cfg['device_refs'] = cfg.get('device_refs', {})
    cfg['device_refs']['storage_switch'] = {"library_id": "nvidia_mqm9790_64_400g_ib"}
    return cfg


# ---------- 场景A：IB 800G→2×400G ----------

def test_param_breakout_logical_rate_and_ports(tmp_path):
    """Q3200(800G→2×400G) 参数网：逻辑连接速率 400G、Leaf 逻辑口命名、breakout 标注"""
    d = NetworkDesignerV2(str(_write(tmp_path, _param_ib_800g_config())))
    leaf = d.param_leaves[0]
    assert leaf.breakout_count == 2
    assert leaf.breakout_output_speed == '400G'

    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'param' and c.a_device == s.name]
    assert conns, "参数网无连接"
    # 逻辑连接速率 = 400G（非物理 800G）
    assert all(c.a_module == '400G' for c in conns), \
        [c.a_module for c in conns[:5]]
    # Leaf 下联口为逻辑口命名（端口1-1/端口1-2/端口2-1...）
    leaf_ports = {c.z_port for c in conns if c.z_device.startswith('参数Leaf')}
    assert leaf_ports and all('-' in p for p in leaf_ports), leaf_ports
    # 连接携带 1 分 2 标注
    assert all(isinstance(c.breakout, dict) for c in conns), conns[0].breakout
    assert conns[0].breakout['count'] == 2
    assert conns[0].breakout['input_speed'] == '800G'
    assert conns[0].breakout['output_speed'] == '400G'


def test_param_breakout_leaf_downlink_capacity(tmp_path):
    """逻辑口上限 = 物理口数 × 2：全部服务器接入后 Leaf 不溢出"""
    d = NetworkDesignerV2(str(_write(tmp_path, _param_ib_800g_config(servers=8))))
    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'param' and c.a_device == s.name]
    # 8 台 × 8 口 = 64 条连接，Q3200 dl=36 → 逻辑容量 72，无溢出
    assert len(conns) == 8 * 8
    vr = d.validate_topology()
    assert vr['valid'], vr['errors']


# ---------- 场景B：存储 400G→2×200G ----------

def test_storage_breakout_logical_rate_and_ports(tmp_path):
    """MQM9790(400G→2×200G) 存储网：逻辑连接速率 200G、Leaf 逻辑口、breakout 标注"""
    d = NetworkDesignerV2(str(_write(tmp_path, _storage_mqm9790_config())))
    leaf = d.storage_leaves[0]
    assert leaf.breakout_count == 2
    assert leaf.breakout_output_speed == '200G'

    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'storage' and c.a_device == s.name]
    assert conns, "存储网无连接"
    # 物理 400G 口分裂为 2×200G 逻辑口
    assert all(c.a_module == '200G' for c in conns), [c.a_module for c in conns[:5]]
    assert all(c.breakout is not None for c in conns)
    assert conns[0].breakout == {'input_speed': '400G', 'output_speed': '200G', 'count': 2}


# ---------- 选型：分裂线缆匹配 ----------

def test_select_module_for_connection_breakout():
    """select_module_for_connection 感知 conn.breakout：按物理速率匹配分裂线缆"""
    from models import Connection
    # 同柜 3m MPO：匹配 800G 2×400G 分裂线缆（DAC 3m），而非 800G 常规模块
    conn = Connection("S", "端口1-1", "400G", "L", "端口1-1", "400G", "MPO", "test",
                      a_cabinet_name="C1", z_cabinet_name="C1",
                      breakout={"input_speed": "800G", "output_speed": "400G", "count": 2})
    sel = select_module_for_connection(conn)
    assert sel is not None, "未匹配到 800G 分裂线缆"
    # 应匹配 800G 分裂线缆（input_speed=800G），而非 400G 常规模块
    assert '2x400' in sel.module_id
    assert sel.breakout is not None
    assert sel.breakout['input_speed'] == '800G'
    assert sel.breakout['count'] == 2


def test_select_module_for_connection_normal():
    """无 breakout 的连接按逻辑速率匹配常规模块，结果 breakout 为 None"""
    from models import Connection
    conn = Connection("S", "端口1", "400G", "L", "端口1", "400G", "MPO", "test")
    sel = select_module_for_connection(conn)
    assert sel is not None
    assert sel.breakout is None


# ---------- engine 全链路 ----------

def test_breakout_engine_design(tmp_path):
    cfg_path = str(_write(tmp_path, _param_ib_800g_config(servers=4, storage=1, compute=0)))
    result = handle_design({'configFile': cfg_path})
    assert 'error' not in result
    assert result['valid'], result['validationIssues']
    edges = result['topology']['edges']
    # 服务器→Leaf 下联边 = 逻辑速率 400G（1 分 2）
    leaf_edges = [e for e in edges if e.get('network_type') == 'param'
                  and str(e.get('source', '')).startswith('GPU')]
    assert leaf_edges, "无服务器→参数Leaf 边"
    assert all(e.get('speed') == '400G' for e in leaf_edges), \
        [e.get('speed') for e in leaf_edges[:5]]
    # Leaf→Spine 上联边保持物理速率 800G（上联不分裂）
    uplink_edges = [e for e in edges if e.get('network_type') == 'param'
                    and str(e.get('target', '')).startswith('参数Spine')]
    assert uplink_edges and all(e.get('speed') == '800G' for e in uplink_edges), \
        [e.get('speed') for e in uplink_edges[:5]]
