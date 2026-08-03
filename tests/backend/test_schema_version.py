"""V3.0.0-T0-2: 配置 schema 版本化 + 迁移链 + 宽松校验

覆盖：
  - get_schema_version：缺失/非法/当前版本
  - migrate_config：v1→v2 迁移、当前版本原样、非 dict 兜底、不修改入参
  - validate_config(strict=False)：宽松模式（缺键不报错、类型校验保留）
  - load_project_config：旧配置自动迁移 + 文件回写
  - designer 加载旧配置（无 schema_version）可正常设计
"""
import os
import json
import pytest

from project_config import (
    SCHEMA_VERSION, get_schema_version, migrate_config,
    validate_config, load_project_config, save_project_config, create_default_config,
)
from designer import NetworkDesignerV2


def _v1_config():
    """构造 2.9.9 风格配置（无 schema_version 字段）"""
    cfg = create_default_config("old-project")
    cfg['meta'].pop('schema_version', None)
    return cfg


# ---------- get_schema_version ----------

def test_schema_version_missing_defaults_to_1():
    assert get_schema_version(_v1_config()) == 1


def test_schema_version_current():
    assert get_schema_version(create_default_config("x")) == SCHEMA_VERSION


def test_schema_version_invalid_meta():
    assert get_schema_version({"meta": {"schema_version": "abc"}}) == 1
    assert get_schema_version({}) == 1
    assert get_schema_version(None) == 1


# ---------- migrate_config ----------

def test_migrate_v1_adds_schema_version():
    cfg = _v1_config()
    migrated = migrate_config(cfg)
    assert get_schema_version(migrated) == SCHEMA_VERSION
    # 不修改入参
    assert get_schema_version(cfg) == 1


def test_migrate_current_unchanged():
    cfg = create_default_config("x")
    assert migrate_config(cfg) is cfg  # 当前版本原样返回


def test_migrate_non_dict():
    assert migrate_config(None) is None
    assert migrate_config("str") == "str"
    assert migrate_config(42) == 42


def test_migrate_preserves_all_fields():
    cfg = _v1_config()
    cfg['topology']['param_speed'] = '800G'
    migrated = migrate_config(cfg)
    assert migrated['topology']['param_speed'] == '800G'
    assert migrated['meta']['name'] == 'old-project'


# ---------- validate_config 宽松模式 ----------

def test_validate_strict_missing_keys_fails():
    cfg = _v1_config()
    del cfg['topology']['num_gpu_servers']
    assert validate_config(cfg) is not None  # strict 默认 True


def test_validate_lenient_missing_keys_ok():
    cfg = _v1_config()
    del cfg['topology']['num_gpu_servers']
    del cfg['networks']['param_network']
    assert validate_config(cfg, strict=False) is None


def test_validate_lenient_type_check_kept():
    cfg = _v1_config()
    cfg['topology']['param_protocol'] = 'INVALID'
    assert validate_config(cfg, strict=False) is not None
    cfg['topology']['param_protocol'] = 'RoCE'
    cfg['topology']['num_gpu_servers'] = 'not-a-number'
    assert validate_config(cfg, strict=False) is not None


def test_validate_lenient_scale_up_type_check():
    cfg = _v1_config()
    cfg['scale_up'] = 'not-a-dict'
    assert validate_config(cfg, strict=False) is not None


# ---------- V3.0.0-T0-5: clusters/gpu_pools 校验 ----------

def _clusters_config():
    cfg = _v1_config()
    cfg['clusters'] = [
        {
            "cluster_id": "p-cluster",
            "role": "P",
            "gpu_pools": [
                {"pool_id": "h100-pool", "count": 8, "profile_ref": {"library_id": "x"}},
                {"pool_id": "b300-pool", "count": 4},
            ],
        },
        {"cluster_id": "d-cluster", "role": "D", "gpu_pools": []},
    ]
    return cfg


def test_clusters_valid_strict_and_lenient():
    cfg = _clusters_config()
    assert validate_config(cfg) is None
    assert validate_config(cfg, strict=False) is None


def test_clusters_absent_is_ok():
    cfg = _v1_config()
    assert validate_config(cfg) is None  # 无 clusters 段兼容 2.9.9


def test_clusters_invalid_structures():
    base = _clusters_config()

    bad = json.loads(json.dumps(base))
    bad['clusters'] = 'not-a-list'
    assert validate_config(bad) is not None
    assert validate_config(bad, strict=False) is not None

    bad = json.loads(json.dumps(base))
    bad['clusters'] = [{'cluster_id': 42, 'role': 'P', 'gpu_pools': []}]
    assert validate_config(bad) is not None

    bad = json.loads(json.dumps(base))
    bad['clusters'] = [{'cluster_id': 'x', 'role': 'X', 'gpu_pools': []}]
    assert validate_config(bad) is not None

    bad = json.loads(json.dumps(base))
    bad['clusters'][0]['gpu_pools'] = [{'pool_id': 'p', 'count': 0}]
    assert validate_config(bad) is not None

    bad = json.loads(json.dumps(base))
    bad['clusters'][0]['gpu_pools'] = [{'pool_id': 'p', 'count': 2, 'profile_ref': 'not-dict'}]
    assert validate_config(bad) is not None
    assert validate_config(bad, strict=False) is not None


# ---------- load_project_config 自动迁移 + 回写 ----------

def test_load_project_config_auto_migrate_and_writeback(tmp_path):
    path = os.path.join(str(tmp_path), 'project_config.json')
    cfg = _v1_config()
    ok, err = save_project_config(path, cfg)
    assert ok
    loaded, err2 = load_project_config(path)
    assert err2 is None
    assert get_schema_version(loaded) == SCHEMA_VERSION
    # 文件已回写 schema_version
    with open(path, encoding='utf-8') as f:
        on_disk = json.load(f)
    assert get_schema_version(on_disk) == SCHEMA_VERSION


def test_load_project_config_current_no_rewrite(tmp_path):
    path = os.path.join(str(tmp_path), 'project_config.json')
    cfg = create_default_config("cur")
    ok, _ = save_project_config(path, cfg)
    assert ok
    mtime_before = os.path.getmtime(path)
    loaded, err = load_project_config(path)
    assert err is None
    assert get_schema_version(loaded) == SCHEMA_VERSION
    assert os.path.getmtime(path) == mtime_before  # 当前版本不触发回写


# ---------- designer 加载旧配置兼容 ----------

def test_designer_loads_legacy_config(tmp_path):
    """2.9.9 旧配置（无 schema_version）经 designer 加载可正常设计"""
    cfg = create_default_config("legacy")
    cfg['meta'].pop('schema_version', None)
    cfg['topology'].update({
        'num_gpu_servers': 4,
        'num_all_flash_storage': 1,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 0,
        'param_speed': '400G',
    })
    path = tmp_path / 'project_config.json'
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')

    d = NetworkDesignerV2(str(path))
    assert d.num_servers == 4  # GPU 服务器数（servers 列表含存储/通算）
    assert len(d.param_leaves) >= 1
    assert d.validate_topology()['valid']
