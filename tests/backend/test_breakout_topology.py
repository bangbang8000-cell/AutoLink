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


# ---------- 场景C：双平面服务器网卡 1 分 2（5.2.2-522-c） ----------

def _dual_plane_800g_config(name="bk_dp", servers=8):
    """5.2.2-522-c：B300 8×800G 分光 16×400G → A/B 两平面各 8 Leaf（128口400G）"""
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': servers,
        'num_all_flash_storage': 0,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 0,
        'param_protocol': 'RoCE',
        'param_speed': '800G',
        'param_ports_per_server': 8,
        'param_switch_ports': 128,
        'ports_per_nic': 2,
        'param_planes': [
            {'leaf_count': 8, 'switch_ports': 128, 'speed': '400G', 'protocol': 'RoCE', 'uplink': 0},
            {'leaf_count': 8, 'switch_ports': 128, 'speed': '400G', 'protocol': 'RoCE', 'uplink': 0},
        ],
    })
    return cfg


def test_dual_plane_nic_breakout_annotation(tmp_path):
    """5.2.2-522-c: 双平面 8×800G 分光 16×400G → A/B 平面 400G 连接携带分光标注"""
    d = NetworkDesignerV2(str(_write(tmp_path, _dual_plane_800g_config())))
    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'param' and c.a_device == s.name]
    # 8 台 × 每卡 8 口 × 2 平面 = 128 条逻辑连接
    assert len(conns) == 8 * 8 * 2, len(conns)
    # 逻辑速率 400G（物理 800G 分光）
    assert all(c.a_module == '400G' for c in conns), [c.a_module for c in conns[:5]]
    # 服务器侧端口区分 A/B 平面（NIC1-8 → A，NIC9-16 → B）
    a_ports = {c.a_port for c in conns}
    assert len(a_ports) == 8 * 2, a_ports
    # 携带 1 分 2 分光标注（input=800G / output=400G）
    assert all(isinstance(c.breakout, dict) for c in conns), conns[0].breakout
    assert conns[0].breakout['count'] == 2
    assert conns[0].breakout['input_speed'] == '800G'
    assert conns[0].breakout['output_speed'] == '400G'


# ---------- 场景D：TH6 800G 单接（5.2.2-522-d） ----------

def _th6_800g_single_config(name="bk_th6", servers=8, storage=1, compute=1):
    """5.2.2-522-d：TH6（128×800G）800G 单接形态（无 1 分 2 分光）"""
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
        'param_switch_ports': 128,
        'storage_switch_ports': 32,
        'storage_speed': '100G',
        'rail_mode': 'rail_optimized',
        'rail_count': 8,
    })
    cfg['device_refs'] = cfg.get('device_refs', {})
    cfg['device_refs']['param_leaf_switch'] = {"library_id": "nvidia_th6_128_800g_ib"}
    return cfg


def test_th6_800g_single_mode_no_breakout(tmp_path):
    """5.2.2-522-d: TH6（128×800G）800G 单接 —— 交换机无 breakout、逻辑速率=物理 800G、连接无分裂标注"""
    d = NetworkDesignerV2(str(_write(tmp_path, _th6_800g_single_config())))
    leaf = d.param_leaves[0]
    # TH6 档案无 breakout → 1:1 物理口（count=1，无逻辑速率/无分裂标注）
    assert leaf.breakout_count == 1
    assert leaf.breakout_output_speed is None
    assert leaf.breakout_link_info is None

    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'param' and c.a_device == s.name]
    assert conns, "轨道优化参数网无连接"
    # 单接：逻辑速率保持 800G
    assert all(c.a_module == '800G' for c in conns), [c.a_module for c in conns[:5]]
    # 无 1 分 2 标注
    assert all(c.breakout is None for c in conns), conns[0].breakout
    # Leaf 下联口为物理口命名（无 '-' 逻辑口拆分）
    leaf_ports = {c.z_port for c in conns if c.z_device.startswith('参数Leaf')}
    assert leaf_ports and all('-' not in p for p in leaf_ports), leaf_ports


def _th6_800g_fattree_config(name="bk_th6_ft", servers=4, storage=1, compute=0):
    """TH6 单接 + 普通胖树（无 rail 每服务器 1 下行缺口）：8 口全连 800G"""
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
        'param_switch_ports': 128,
        'storage_switch_ports': 32,
        'storage_speed': '100G',
        'param_network_mode': 'standard',
    })
    cfg['device_refs'] = cfg.get('device_refs', {})
    cfg['device_refs']['param_leaf_switch'] = {"library_id": "nvidia_th6_128_800g_ib"}
    return cfg


def test_th6_800g_single_engine_design(tmp_path):
    """5.2.2-522-d: TH6 单接 engine 全链路 —— 边速率 800G、无分光标注、端口校验通过"""
    cfg_path = str(_write(tmp_path, _th6_800g_fattree_config()))
    result = handle_design({'configFile': cfg_path})
    assert 'error' not in result
    assert result['valid'], result['validationIssues']
    edges = result['topology']['edges']
    leaf_edges = [e for e in edges if e.get('network_type') == 'param'
                  and str(e.get('source', '')).startswith('GPU')]
    # 4 台 × 8 口 = 32 条 800G 单接连接（无分裂）
    assert len(leaf_edges) == 4 * 8, len(leaf_edges)
    assert all(e.get('speed') == '800G' for e in leaf_edges), \
        [e.get('speed') for e in leaf_edges[:5]]
    assert all(not e.get('breakout') for e in leaf_edges), \
        [e.get('breakout') for e in leaf_edges[:3]]


# ---------- 场景A：IB 800G→2×400G ----------

def _param_ib_800g_rail_config(name="bk_rail", servers=8, storage=1, compute=1):
    """5.2.2-522-b：轨道优化（rail_optimized）+ Q3200 自动选型（800G→2×400G）"""
    cfg = _param_ib_800g_config(name, servers=servers, storage=storage, compute=compute)
    cfg['topology']['rail_mode'] = 'rail_optimized'
    cfg['topology']['rail_count'] = 8
    return cfg


def test_rail_optimized_breakout_logical_rate_and_ports(tmp_path):
    """5.2.2-522-b: 轨道优化路径 Leaf 应用交换机档案 1 分 2 分光（800G→2×400G）"""
    d = NetworkDesignerV2(str(_write(tmp_path, _param_ib_800g_rail_config())))
    leaf = d.param_leaves[0]
    assert leaf.breakout_count == 2
    assert leaf.breakout_output_speed == '400G'

    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'param' and c.a_device == s.name]
    assert conns, "轨道优化参数网无连接"
    # 逻辑连接速率 = 400G（非物理 800G）
    assert all(c.a_module == '400G' for c in conns), [c.a_module for c in conns[:5]]
    # Leaf 下联口为逻辑口命名（端口1-1/端口1-2...）
    leaf_ports = {c.z_port for c in conns if c.z_device.startswith('参数Leaf')}
    assert leaf_ports and all('-' in p for p in leaf_ports), leaf_ports
    # 连接携带 1 分 2 标注
    assert all(isinstance(c.breakout, dict) for c in conns), conns[0].breakout
    assert conns[0].breakout['count'] == 2
    assert conns[0].breakout['input_speed'] == '800G'
    assert conns[0].breakout['output_speed'] == '400G'


def test_rail_optimized_breakout_no_overflow(tmp_path):
    """5.2.2-522-b: 轨道优化（每服务器 1 下行）+ 分光逻辑口容量充足、无端口耗尽异常

    注：轨道模型当前每服务器仅接 1 个下行（NIC{rail}→Rail Leaf，NVIDIA 8-Rail 多 NIC 接线
    为既有设计缺口，另项跟进）；本用例聚焦分光后逻辑口容量与异常安全。
    """
    d = NetworkDesignerV2(str(_write(tmp_path, _param_ib_800g_rail_config(servers=16))))
    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'param' and c.a_device == s.name]
    assert len(conns) == 16
    # 分光后 Leaf 逻辑口未被耗尽：全部 16 条下行分配成功且 (Leaf, 逻辑口) 不重复
    leaf_ports = [(c.z_device, c.z_port) for c in conns]
    assert len(set(leaf_ports)) == len(leaf_ports), '逻辑口重复分配'
    # 其余校验仅含既有"每服务器 1 连接"缺口（非端口溢出/分光问题）
    vr = d.validate_topology()
    errors = vr.get('errors') or []
    assert all('端口' not in e and '溢出' not in e and '下联' not in e for e in errors), errors


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
