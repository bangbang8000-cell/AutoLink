"""AutoLink v5.4.0（6 场景内容建设）—— 设备库 S2 专项

对应开发计划 W2.1-W2.5 / 测试计划 T-6S-B 组（分光口径）：

  W2.1: 新增浪潮 X400（128×400G QSFP112 / Spectrum-4 / UXOS）；参数网每口 1 个
        400G 不分光；存储网每口 1 个 200G 不分光（PRD §3.5-B）。
  W2.2: IB 存储档案 MQM9700 同型复用（switches/storage 变体，存储网 400G 1分2
        → 2×200G）。
  W2.3: QM9700 参数网角色 breakout 完全禁用（1:1 400G）—— 评审发现 1 守卫。
  W2.4: Q3400 档案修正（描述 XDR 800Gb/s；breakout 单级 1.6T→2×800G（场景⑥），
        两级 1.6T→2×800G→4×400G 为保留能力（FR-A7））。
  W2.5: DGX B300 档案定稿（param 8×800G；storage 2×200G，本轮用 1 口）。
"""
import json

import pytest

from device_library import DeviceLibrary

LIB_DIR = 'template/device_library'


@pytest.fixture(scope='module')
def lib():
    return DeviceLibrary(LIB_DIR)


def _profile(lib, did):
    p = lib.get(did)
    assert p is not None, f'档案缺失: {did}'
    return p


# ---------- W2.1 X400 ----------

def test_x400_exists_and_spectrum4(lib):
    p = _profile(lib, 'inspur_x400_128_400g')
    assert p.port_count == 128
    assert p.port_speed == '400G'
    assert p.port_type == 'QSFP112'
    assert 'Spectrum-4' in (p.model or '')
    assert 'UXOS' in (p.description or '')
    assert p.applicable_networks == ['param', 'storage']


def test_x400_param_no_breakout(lib):
    """参数网 1:1 400G，不分光（T-6S-B03）。"""
    p = _profile(lib, 'inspur_x400_128_400g')
    assert p.breakout is None or p.breakout.count == 1


def test_x400_storage_no_breakout_200g(lib):
    """存储网每口 1 个 200G，不分光（T-6S-B04）。"""
    p = _profile(lib, 'inspur_x400_128_400g')
    # 无 breakout 字段 ⇒ 1:1（存储侧速率由存储配置 200G 决定）
    assert p.breakout is None or p.breakout.count == 1


# ---------- W2.2 IB 存储档案（同型复用） ----------

def test_mqm9700_storage_profile(lib):
    p = _profile(lib, 'nvidia_mqm9700_64_400g_ib_storage')
    assert p.category == 'switches_storage'
    assert '同型复用' in (p.description or '')
    assert p.applicable_networks == ['storage']


def test_mqm9700_storage_breakout_2x200g(lib):
    """存储网 400G 1分2 → 2×200G（T-6S-B02）。"""
    p = _profile(lib, 'nvidia_mqm9700_64_400g_ib_storage')
    bk = p.breakout or {}
    assert bk.get('count') == 2
    assert bk.get('logical_speed') == '200G'
    assert bk.get('applicable_networks') == ['storage']


# ---------- W2.3 QM9700 参数网禁用（评审发现 1 守卫，T-6S-B01） ----------

def test_mqm9700_param_breakout_disabled(lib):
    p = _profile(lib, 'nvidia_mqm9700_64_400g_ib')
    bk = p.breakout or {}
    # 角色限定：applicable_networks=['storage'] ⇒ 参数网角色下按 1:1
    assert bk.get('applicable_networks') == ['storage']


# ---------- W2.4 Q3400 ----------

def test_q3400_xdr_description(lib):
    p = _profile(lib, 'nvidia_q3400_144_800g_ib')
    assert 'XDR 800Gb/s' in (p.description or '')
    assert '保留能力' in (p.description or '')


def test_q3400_single_stage_2x800g(lib):
    """场景⑥ 单级 1.6T→2×800G（T-6S-B05）。"""
    p = _profile(lib, 'nvidia_q3400_144_800g_ib')
    bk = p.breakout or {}
    assert bk.get('physical_speed') == '1.6T'
    assert bk.get('logical_speed') == '800G'
    assert bk.get('count') == 2


# ---------- W2.5 DGX B300 ----------

def test_b300_param_8x800g(lib):
    p = _profile(lib, 'nvidia_dgx_b300')
    pm = [m for m in p.interface_models if m.network_type == 'param']
    assert len(pm) == 1
    assert pm[0].port_count == 8
    assert pm[0].port_speed == '800G'


def test_b300_storage_2x200g(lib):
    p = _profile(lib, 'nvidia_dgx_b300')
    sm = [m for m in p.interface_models if m.network_type == 'storage']
    assert len(sm) == 1
    assert sm[0].port_count == 2
    assert sm[0].port_speed == '200G'
