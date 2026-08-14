"""H1 AL 设备库测试：加载 + 规格自洽 + 命名规范 + 硬编码映射一致。"""
import glob
import io
import json
import os

from aidc_planner import DEFAULTS
import device_defaults as dd

_LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'template', 'device_library')

_VALID_SPEEDS = ('1G', '10G', '25G', '40G', '50G', '100G', '200G', '400G', '800G', '1600G')


def _switches():
    out = []
    for p in glob.glob(os.path.join(_LIB, 'switches', '*', '*.json')):
        out.append(json.load(io.open(p, encoding='utf-8')))
    return out


def test_load_no_dup():
    sw = _switches()
    ids = [d['id'] for d in sw]
    assert len(ids) == len(set(ids))
    assert len(sw) >= 40


def test_spec_self_consistent():
    for d in _switches():
        assert d['port_count'] > 0
        assert d['port_speed'] in _VALID_SPEEDS, f"{d['id']} 速率非法 {d['port_speed']}"
        assert d['model'] != 'S9850-64H'  # 硬错误已清
        assert 'S9820-8C 固定64' not in d.get('description', '')


def test_naming_prefix():
    for d in _switches():
        assert d.get('name_prefix'), f"{d['id']} 缺 name_prefix"


def test_id_prefix():
    for d in _switches():
        if d.get('vendor') == '锐捷':
            assert d['id'].startswith('ruijie_rg_'), d['id']


def test_defaults_reference_existing_ids():
    sw_ids = {d['id'] for d in _switches()}
    for group in (dd.ROCE_DEFAULTS, dd.BIZ_DEFAULTS, dd.OOB_DEFAULTS):
        for key, did in group.items():
            assert did in sw_ids, f'{key}={did} 不在设备库'


def test_roce_defaults_real_400g():
    assert dd.ROCE_DEFAULTS['param_leaf_switch'] == 'h3c_s9825_64d'
    assert dd.ROCE_DEFAULTS['param_spine_switch'] == 'h3c_s9827'
    assert dd.ROCE_DEFAULTS['param_core_switch'] == 'h3c_s9827'
    assert dd.ROCE_DEFAULTS['param_leaf_switch'] not in ('h3c_s9850_64h', 'h3c_s9820_64h', 'h3c_s9820_8c')


def test_aidc_planner_models_match_library():
    sw = {d['id']: d for d in _switches()}
    mapping = {
        'SPINE': 'h3c_s9827', 'LEAF': 'h3c_s9827',
        'STO_SPINE': 'h3c_s9825_128b', 'STO_LEAF': 'h3c_s9825_128b',
        'BIZ_AGG': 'h3c_s9850_32h', 'BIZ_ACCESS': 'h3c_s6850_56hf',
        'OOB_AGG': 'h3c_s6805_56hf_g', 'OOB_ACCESS': 'h3c_s5560x_54c_ei',
    }
    for role, did in mapping.items():
        dev = sw[did]
        expected = f"{dev['vendor']} {dev['model']}"
        assert DEFAULTS['device_models'][role] == expected, f'{role} 应 {expected}'
