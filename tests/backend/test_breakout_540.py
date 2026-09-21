"""AutoLink v5.4.0（6 场景内容建设）—— breakout 链式结构与角色化专项

对应 PRD 评审发现 1 / FR-A5 / 开发计划 W1.3-W1.4 / 测试计划 T-6S-B 组：

  W1.3（640-b）：breakout `stages: [{...}]` 链式（两级分光 1.6T→2×800G→4×400G），
        单级档案不写 `stages` 行为不变（向后兼容）。
  W1.4（640-c）：`breakout.applicable_networks` 限定生效角色；缺省 = 全部角色适用。
        QM9700 参数网角色**完全禁用**（1:1 400G），存储网角色 400G→2×200G。

评审发现 1 原状：QM9700 档案 `applicable_networks:["param"]` 却硬带存储分光
breakout ⇒ 参数网链路被错误分裂为 200G。本组用例钉死修复后行为。
"""
import json

import pytest

from project_config import create_default_config
from designer import NetworkDesignerV2
from models import (NetworkObject, apply_breakout,
                    breakout_total_count, breakout_for_role)


# ---------- 单元：链式总逻辑口计数（W1.3） ----------

def test_chain_stages_total_count():
    bk = {'stages': [
        {'input_speed': '1.6T', 'logical_speed': '800G', 'count': 2},
        {'input_speed': '800G', 'logical_speed': '400G', 'count': 2},
    ]}
    assert breakout_total_count(bk) == 4


def test_single_stage_and_default_counts():
    assert breakout_total_count({'count': 2, 'logical_speed': '400G'}) == 2
    assert breakout_total_count(None) == 1
    assert breakout_total_count({}) == 1
    assert breakout_total_count({'stages': []}) == 1


# ---------- 单元：角色过滤（W1.4 / FR-A5） ----------

def test_role_filter_semantics():
    bk = {'applicable_networks': ['storage'], 'count': 2}
    assert breakout_for_role(bk, 'param') is None      # 参数网角色禁用
    assert breakout_for_role(bk, 'storage') is bk      # 存储网角色生效
    assert breakout_for_role(bk, 'biz') is bk          # 非 param/storage 不过滤
    # 缺省（不写 applicable_networks）= 全部角色适用（向后兼容）
    assert breakout_for_role({'count': 2}, 'param')['count'] == 2
    # 空列表 = 全部角色适用
    assert breakout_for_role({'applicable_networks': [], 'count': 2}, 'param')['count'] == 2


# ---------- 单元：apply_breakout 链式与向后兼容（W1.3） ----------

class _Profile:
    def __init__(self, bk):
        self.breakout = bk


def test_apply_chain_stages():
    obj = NetworkObject('x', 'param_leaf', network_type='param')
    apply_breakout(obj, _Profile({'stages': [
        {'input_speed': '1.6T', 'logical_speed': '800G', 'count': 2},
        {'input_speed': '800G', 'logical_speed': '400G', 'count': 2},
    ]}))
    assert obj.breakout_count == 4
    assert obj.breakout_output_speed == '400G'          # 末级逻辑速率
    li = obj.breakout_link_info
    assert li['input_speed'] == '1.6T'                  # 首级物理速率
    assert li['output_speed'] == '400G'
    assert len(li['stages']) == 2
    assert li['stages'][0] == {'input_speed': '1.6T', 'output_speed': '800G', 'count': 2}
    assert li['stages'][1] == {'input_speed': '800G', 'output_speed': '400G', 'count': 2}


def test_apply_single_stage_backward_compatible():
    """单级档案不写 stages ⇒ 行为与 V3.0.2-T2-11 完全一致（无 stages 键）。"""
    obj = NetworkObject('x', 'param_leaf', network_type='param')
    apply_breakout(obj, _Profile({'physical_speed': '800G', 'logical_speed': '400G', 'count': 2}))
    assert obj.breakout_count == 2
    assert obj.breakout_output_speed == '400G'
    assert obj.breakout_link_info == {'input_speed': '800G', 'output_speed': '400G', 'count': 2}
    assert 'stages' not in obj.breakout_link_info


def test_apply_role_disabled_is_1_to_1():
    """角色禁用 ⇒ count=1、无逻辑速率、无标注（QM9700 参数网 = 1:1 400G）。"""
    obj = NetworkObject('x', 'param_leaf', network_type='param')
    apply_breakout(obj, _Profile({'applicable_networks': ['storage'],
                                  'physical_speed': '400G', 'logical_speed': '200G',
                                  'count': 2}))
    assert obj.breakout_count == 1
    assert obj.breakout_output_speed is None
    assert obj.breakout_link_info is None


# ---------- 集成：真实档案 + NetworkDesignerV2（W1.4 / FR-A5 守卫） ----------

def _qm9700_param_config(name="bk_qm9700", servers=4):
    """参数网 400G + 显式指定 QM9700（评审发现 1 场景复刻）。"""
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': servers,
        'num_all_flash_storage': 0,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 0,
        'param_protocol': 'IB',
        'param_speed': '400G',
        'param_ports_per_server': 8,
        'param_switch_ports': 64,
        'storage_ports_per_server': 1,
        'storage_switch_ports': 32,
        'storage_speed': '100G',
    })
    cfg['device_refs'] = cfg.get('device_refs', {})
    cfg['device_refs']['param_leaf_switch'] = {"library_id": "nvidia_mqm9700_64_400g_ib"}
    return cfg


def _write(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def test_qm9700_param_role_breakout_disabled(tmp_path):
    """FR-A5 守卫：QM9700 参数网角色 breakout 完全禁用 —— 1:1 400G。"""
    d = NetworkDesignerV2(str(_write(tmp_path, _qm9700_param_config())))
    # 交换机级：param_breakout_count == 1（无 1 分 2）
    assert d.param_breakout_count == 1, d.param_breakout_count
    leaf = d.param_leaves[0]
    assert leaf.breakout_count == 1
    assert leaf.breakout_link_info is None
    # 参数网链路速率 == param_speed（400G），且无分裂标注
    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'param' and c.a_device == s.name]
    assert conns
    assert all(c.a_module == '400G' for c in conns), [c.a_module for c in conns[:5]]
    assert all(c.breakout is None for c in conns), conns[0].breakout


def test_qm9700_storage_role_breakout_enabled(tmp_path):
    """QM9700 存储网角色 400G→2×200G（breakout.applicable_networks 限定）。"""
    cfg = _qm9700_param_config('bk_qm9700_st', servers=4)
    cfg['topology']['num_all_flash_storage'] = 2
    cfg['topology']['storage_ports_per_server'] = 2
    cfg['topology']['storage_speed'] = '400G'
    cfg['topology']['storage_switch_ports'] = 64
    cfg['device_refs']['storage_leaf_switch'] = {"library_id": "nvidia_mqm9700_64_400g_ib"}
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.storage_breakout_count == 2, d.storage_breakout_count
    sconns = [c for s in d.servers for c in s.connections
              if c.network_type == 'storage' and c.a_device == s.name]
    assert sconns
    assert all(c.a_module == '200G' for c in sconns), [c.a_module for c in sconns[:5]]


def test_q3200_param_role_unchanged_backward_compat(tmp_path):
    """Q3200（无 breakout.applicable_networks）参数网角色仍 800G→2×400G（向后兼容）。"""
    cfg = create_default_config('bk_q3200')
    cfg['topology'].update({
        'num_gpu_servers': 4,
        'num_all_flash_storage': 0,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 0,
        'param_protocol': 'IB',
        'param_speed': '800G',
        'param_ports_per_server': 8,
        'param_switch_ports': 72,
        'storage_ports_per_server': 1,
        'storage_switch_ports': 32,
        'storage_speed': '100G',
    })
    cfg['device_refs'] = cfg.get('device_refs', {})
    cfg['device_refs']['param_leaf_switch'] = {"library_id": "nvidia_q3200_72_800g_ib"}
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    assert d.param_breakout_count == 2, d.param_breakout_count
    conns = [c for s in d.servers for c in s.connections
             if c.network_type == 'param' and c.a_device == s.name]
    assert conns
    # 逻辑速率 400G（800G 分光），携带 1 分 2 标注
    assert all(c.a_module == '400G' for c in conns), [c.a_module for c in conns[:5]]
    assert all(isinstance(c.breakout, dict) and c.breakout['count'] == 2
               for c in conns), conns[0].breakout
