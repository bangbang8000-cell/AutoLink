"""AutoLink v5.4.0（6 场景内容建设）—— storage_protocol 键专项

对应 PRD FR-A3 / 开发计划 W1.5 / 测试计划 T-6S-C 组：

  - 新增可选 `topology.storage_protocol` 键，取值 IB/RoCE/UEC（非法回退）；
  - **默认跟随 param_protocol**；未配置/缺失时不得 AttributeError；
  - 唯一初始化入口 `_init_biz_caliber_switches`（JSON/INI 双路径同源）——
    防 5.3.0/5.3.1/5.3.2 的「INI 路径 AttributeError」血训复现。
"""
import json

import pytest

from project_config import create_default_config, validate_config
from designer import NetworkDesignerV2


def _write_json(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _write_ini(tmp_path, ini_text, name='network_config.ini'):
    path = tmp_path / name
    path.write_text(ini_text, encoding='utf-8')
    return path


def _base_cfg(name="bk_sp", servers=4):
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': servers,
        'num_all_flash_storage': 0,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 0,
        'param_protocol': 'RoCE',
        'param_speed': '400G',
        'param_ports_per_server': 8,
        'param_switch_ports': 64,
        'storage_ports_per_server': 1,
        'storage_switch_ports': 48,
        'storage_speed': '200G',
    })
    return cfg


# ---------- JSON 路径 ----------

def test_json_explicit_storage_protocol(tmp_path):
    cfg = _base_cfg()
    cfg['topology']['storage_protocol'] = 'IB'
    d = NetworkDesignerV2(str(_write_json(tmp_path, cfg)))
    assert d.storage_protocol == 'IB'
    assert d.param_protocol == 'RoCE'          # 两网协议可不同


def test_json_default_follows_param_protocol(tmp_path):
    """未配置 storage_protocol ⇒ 跟随 param_protocol。"""
    cfg = _base_cfg()
    d = NetworkDesignerV2(str(_write_json(tmp_path, cfg)))
    assert d.storage_protocol == 'RoCE'


def test_json_invalid_falls_back_to_param_protocol(tmp_path):
    cfg = _base_cfg()
    cfg['topology']['storage_protocol'] = 'XYZ'
    d = NetworkDesignerV2(str(_write_json(tmp_path, cfg)))
    assert d.storage_protocol == 'RoCE'        # 非法值回退


# ---------- INI 路径（血训守卫） ----------

def test_ini_explicit_storage_protocol(tmp_path):
    ini = """[DEFAULT]
name = bk_sp_ini
num_servers = 4
param_protocol = RoCE
storage_protocol = IB
param_speed = 400G
param_ports_per_server = 8
param_switch_ports = 64
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
num_all_flash_storage = 0
num_hybrid_flash_storage = 0
num_compute_servers = 0
"""
    d = NetworkDesignerV2(str(_write_ini(tmp_path, ini)))
    assert d.storage_protocol == 'IB'


def test_ini_missing_no_attribute_error(tmp_path):
    """INI 路径未配置 storage_protocol ⇒ 无 AttributeError，跟随 param_protocol。"""
    ini = """[DEFAULT]
name = bk_sp_ini2
num_servers = 4
param_protocol = IB
param_speed = 400G
param_ports_per_server = 8
param_switch_ports = 64
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
num_all_flash_storage = 0
num_hybrid_flash_storage = 0
num_compute_servers = 0
"""
    d = NetworkDesignerV2(str(_write_ini(tmp_path, ini)))
    assert d.storage_protocol == 'IB'          # 跟随 param_protocol


# ---------- 校验器 ----------

def test_validate_accepts_storage_protocol():
    cfg = _base_cfg()
    cfg['topology']['storage_protocol'] = 'UEC'
    assert validate_config(cfg) is None


def test_validate_rejects_invalid_storage_protocol():
    cfg = _base_cfg()
    cfg['topology']['storage_protocol'] = 'XYZ'
    err = validate_config(cfg)
    assert err is not None and 'storage_protocol' in err


def test_validate_relaxed_mode_accepts_storage_protocol():
    cfg = _base_cfg()
    cfg['topology']['storage_protocol'] = 'IB'
    assert validate_config(cfg, strict=False) is None
