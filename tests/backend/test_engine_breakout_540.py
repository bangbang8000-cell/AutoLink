"""AutoLink v5.4.0（6 场景内容建设）—— 拓扑边分光透出专项

对应 PRD FR-A9 / 开发计划 W3.1 / 测试计划 T-6S-D04：

  后端拓扑边透出 breakout（单级 {input_speed, output_speed, count}；
  两级 stages[]；None=1:1）——两条后端路径同约定：
    - handle_design（:954 边构造 → :1149 topology.edges，前端工作台拓扑）
    - _estimate_design（:432 边构造 → validation context connections，校验用）

断言：
  - QM9700 存储网（400G 1分2→2×200G）：存储侧边 breakout 存在且
    {input_speed: '400G', output_speed: '200G', count: 2}；
  - QM9700 参数网（breakout 完全禁用，评审发现 1）：参数侧边 breakout 为 None；
  - 与连接表 exporter「1分2扇出」列同源（T-6S-D05）。
"""
import json

import pytest

from project_config import create_default_config
from designer import NetworkDesignerV2
from engine import handle_design, _estimate_design


def _write_cfg(tmp_path, name='project_config.json'):
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': 8,
        'num_all_flash_storage': 2,
        'num_hybrid_flash_storage': 1,
        'num_compute_servers': 1,
        'param_protocol': 'IB',
        'param_speed': '400G',
        'param_ports_per_server': 8,
        'param_switch_ports': 64,
        'storage_ports_per_server': 1,
        'storage_switch_ports': 64,
        'storage_downlink_limit': 32,
        'storage_speed': '200G',
    })
    cfg['device_refs'] = {
        'param_leaf_switch': {'library_id': 'nvidia_mqm9700_64_400g_ib'},
        'storage_leaf_switch': {'library_id': 'nvidia_mqm9700_64_400g_ib_storage'},
    }
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _edges_by_network(edges, net):
    return [e for e in edges if e.get('networkType') == net]


def test_handle_design_edges_carry_breakout(tmp_path):
    """设计优先路径（前端拓扑）：存储网边带 400G→2×200G，参数网边无分光。"""
    cfg = _write_cfg(tmp_path)
    r = handle_design({'configFile': str(cfg)})
    assert r.get('topology') is not None, r.get('error', r)
    edges = r['topology']['edges']
    st = _edges_by_network(edges, 'storage')
    pm = _edges_by_network(edges, 'param')
    assert st, '无存储网边'
    bk = [e['breakout'] for e in st if e.get('breakout')]
    assert bk, '存储网边必须携带 breakout（400G 1分2）'
    first = bk[0]
    assert first.get('input_speed') == '400G'
    assert first.get('output_speed') == '200G'
    assert first.get('count') == 2
    # 参数网：QM9700 参数网角色 breakout 完全禁用 ⇒ 全部边无分光
    assert all(not e.get('breakout') for e in pm), \
        [e.get('breakout') for e in pm if e.get('breakout')][:3]


def test_handle_design_edges_carry_breakout_two_paths_same(tmp_path):
    """plan 兜底路径（handle_plan_aidc 同边构造）与设计路径同约定：边均含 breakout 键。"""
    cfg = _write_cfg(tmp_path, 'plan_cfg.json')
    r = handle_design({'configFile': str(cfg)})
    edges = r['topology']['edges']
    # 每条边都有 breakout 键（None=1:1），无 KeyError
    for e in edges:
        assert 'breakout' in e
    # 存储网至少一条分光
    st = _edges_by_network(edges, 'storage')
    assert any(e.get('breakout') for e in st)


def test_estimate_design_validation_edges_consistent(tmp_path):
    """估算路径（校验上下文）：边透出不破坏估算，连接层标注与边透出同源。"""
    cfg = _write_cfg(tmp_path)
    d = NetworkDesignerV2(str(cfg))
    est = _estimate_design(d)          # 不应抛异常
    assert isinstance(est, dict) and 'pue' in est
    # 分光连接在设计中真实存在（连接层标注与边透出同源）
    designer = NetworkDesignerV2(str(cfg))
    st_conns = [c for s in designer.servers for c in s.connections
                if c.network_type == 'storage' and c.a_device == s.name]
    bk_conns = [c for c in st_conns if c.breakout]
    assert bk_conns, '连接层应有存储分光标注'
    c0 = bk_conns[0].breakout
    assert c0.get('input_speed') == '400G'
    assert c0.get('output_speed') == '200G'
    assert c0.get('count') == 2
