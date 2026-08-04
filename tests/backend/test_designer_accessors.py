"""V3.0.0-T0-3: designer 统一访问器（all_switches/all_devices/all_switch_groups/describe_domains）

验证访问器与 2.9.9 手工聚合结果等价（重构不改变行为）。
"""
import json
import pytest

from designer import NetworkDesignerV2
from project_config import create_default_config


@pytest.fixture(scope='module')
def designer(tmp_path_factory):
    cfg = create_default_config("accessor-test")
    cfg['topology'].update({
        'num_gpu_servers': 8,
        'num_all_flash_storage': 2,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 2,
        'param_speed': '400G',
    })
    path = tmp_path_factory.mktemp('accessor') / 'project_config.json'
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return NetworkDesignerV2(str(path))


def _manual_switches(d):
    """2.9.9 风格手工聚合（11 类交换机）"""
    return (d.param_leaves + d.param_spines + d.param_cores +
            d.storage_leaves + d.storage_spines + d.storage_cores +
            d.oob_access + d.oob_agg + d.biz_access + d.biz_agg)


def test_all_switches_matches_manual(designer):
    assert set(designer.all_switches()) == set(_manual_switches(designer))


def test_all_devices_contains_all(designer):
    manual = designer.servers + _manual_switches(designer) + list(designer.scale_up_gpus)
    assert set(designer.all_devices()) == set(manual)
    assert len(designer.all_devices()) == len(manual)


def test_all_switch_groups_grouped_by_type(designer):
    groups = designer.all_switch_groups()
    for sw in designer.all_switches():
        assert sw in groups[sw.obj_type]
    assert set(groups.keys()) == {sw.obj_type for sw in designer.all_switches()}


def test_describe_domains_has_param(designer):
    domains = designer.describe_domains()
    assert 'param' in domains
    assert domains['param']['leaves'] == len(designer.param_leaves)
    assert domains['param']['spines'] == len(designer.param_spines)
    assert domains['param']['protocol'] == 'RoCE'
    assert 'storage' in domains
    assert 'oob' in domains
    assert 'biz' in domains
