"""V3.0.0-T0-3/T0-5: 网络域抽象 + 插件接线 + 集群正交模型（后端）

覆盖：
  - engine 注册内置插件（main/直接调用 handle_design 两条路径）
  - resolve_network_mode 分派（native / plugin / unknown）
  - designer 构建 self.domains（真实对象计数；含 scale_up 域）
  - clusters 元数据（network_mode/role/scale，clusters_raw 保留原样）
  - engine 对未知 network_mode 明确报错（分派接缝），native/缺省放行
  - summary 输出 domains / clusters 字段
  - project_config 对 network_mode 类型校验（值域语义在 engine 层）
"""
import json

import pytest

from project_config import create_default_config, validate_config
from designer import NetworkDesignerV2
from network_plugin import (
    register_builtin_plugins, resolve_network_mode, get_plugin, list_plugins,
)
from engine import handle_design, _ensure_plugins_ready, _validate_cluster_network_modes


def _write_config(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _base_config(name="domains-test"):
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': 8,
        'num_all_flash_storage': 2,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': 2,
        'param_speed': '400G',
    })
    return cfg


# ---------- 插件注册 ----------

def test_engine_registers_builtin_plugins():
    _ensure_plugins_ready()  # 幂等
    assert set(list_plugins()) == {"param", "storage", "biz", "oob", "scale_up", "zcube"}
    assert get_plugin("param") is not None


def test_register_builtin_plugins_idempotent():
    register_builtin_plugins()
    register_builtin_plugins()
    assert set(list_plugins()) == {"param", "storage", "biz", "oob", "scale_up", "zcube"}


# ---------- network_mode 分派 ----------

def test_resolve_network_mode_dispatch():
    # native：缺省/standard/fat_tree/rail/rail_optimized/网络域级
    assert resolve_network_mode(None) == 'native'
    assert resolve_network_mode('') == 'native'
    assert resolve_network_mode('standard') == 'native'
    assert resolve_network_mode('FAT_TREE') == 'native'   # 大小写不敏感
    assert resolve_network_mode('rail_optimized') == 'native'
    assert resolve_network_mode('param') == 'native'
    assert resolve_network_mode('scale_up') == 'native'
    # V3.0.1/V3.0.2: dual_plane / zcube 已接入 Designer 原生路径
    assert resolve_network_mode('dual_plane') == 'native'
    assert resolve_network_mode('zcube') == 'native'
    # unknown：3.0.2 未实现的组网模式（插件落地后变为 plugin）
    assert resolve_network_mode('huawei_supernode') == 'unknown'


def test_validate_cluster_network_modes_unknown():
    cfg = _base_config()
    cfg['clusters'] = [
        {"cluster_id": "c-p", "role": "P", "network_mode": "huawei_supernode", "gpu_pools": []},
    ]
    errors = _validate_cluster_network_modes(cfg)
    assert len(errors) == 1
    assert 'huawei_supernode' in errors[0]


def test_validate_cluster_network_modes_native_ok():
    cfg = _base_config()
    cfg['clusters'] = [
        {"cluster_id": "c-p", "role": "P", "network_mode": "fat_tree", "gpu_pools": []},
    ]
    assert _validate_cluster_network_modes(cfg) == []


# ---------- designer.domains ----------

def test_domains_standard_config(tmp_path):
    d = NetworkDesignerV2(str(_write_config(tmp_path, _base_config())))
    types = [dom.type for dom in d.domains]
    assert 'param' in types and 'storage' in types
    assert 'oob' in types and 'biz' in types  # 默认四网全开
    param = next(dom for dom in d.domains if dom.type == 'param')
    assert param.leaf_count == len(d.param_leaves)
    assert param.speed == '400G'
    assert param.ports_per_server == d.param_ports_per_server
    assert param.tiers in (2, 3)
    # to_dict 可序列化
    as_dict = [dom.to_dict() for dom in d.domains]
    assert all({'type', 'planes', 'tiers', 'protocol', 'speed',
                'ports_per_server', 'leaf_count'} <= set(item) for item in as_dict)


def test_domains_include_scale_up(tmp_path):
    from pathlib import Path
    repo_root = Path(__file__).resolve().parent.parent.parent
    json_path = repo_root / 'template' / 'ualink_1_0_1024' / 'project_config.json'
    if not json_path.exists():
        pytest.skip('ualink_1_0_1024 模板缺失')
    d = NetworkDesignerV2(str(json_path))
    types = [dom.type for dom in d.domains]
    assert 'scale_up' in types
    su = next(dom for dom in d.domains if dom.type == 'scale_up')
    assert su.protocol == 'UALink'
    assert su.leaf_count == len(d.scale_up_gpus)


# ---------- clusters 元数据（T0-5 正交模型） ----------

def _clustered_config(network_mode='standard'):
    cfg = _base_config("clustered")
    cfg['topology']['num_gpu_servers'] = 99  # 应被池汇总覆盖
    cfg['clusters'] = [
        {
            "cluster_id": "c-p", "role": "P", "network_mode": network_mode,
            "gpu_pools": [
                {"pool_id": "h100", "count": 2,
                 "profile_ref": {"library_id": "generic_4u_gpu",
                                 "overrides": {"power_watts": 1000, "u_height": 4}}},
                {"pool_id": "h200", "count": 2,
                 "profile_ref": {"library_id": "generic_4u_gpu",
                                 "overrides": {"power_watts": 7000, "u_height": 8}}},
            ],
        },
        {
            "cluster_id": "c-d", "role": "D", "network_mode": network_mode,
            "gpu_pools": [
                {"pool_id": "b200", "count": 1,
                 "profile_ref": {"library_id": "generic_4u_gpu",
                                 "overrides": {"power_watts": 12000, "u_height": 8}}},
            ],
        },
    ]
    return cfg


def test_clusters_metadata_and_raw(tmp_path):
    d = NetworkDesignerV2(str(_write_config(tmp_path, _clustered_config())))
    assert len(d.clusters) == 2
    by_id = {c['cluster_id']: c for c in d.clusters}
    assert by_id['c-p']['role'] == 'P'
    assert by_id['c-p']['network_mode'] == 'standard'   # 缺省值
    assert by_id['c-p']['scale'] == 4                    # 池计数汇总
    assert by_id['c-d']['scale'] == 1
    # clusters_raw 保留原始结构（含 profile_ref）
    assert d.clusters_raw[0]['gpu_pools'][0]['profile_ref']['library_id'] == 'generic_4u_gpu'
    # gpu_pool_defs 携带 network_mode
    assert all(p['network_mode'] == 'standard' for p in d.gpu_pool_defs)


def test_clusters_metadata_no_clusters(tmp_path):
    d = NetworkDesignerV2(str(_write_config(tmp_path, _base_config())))
    assert d.clusters == []
    assert d.clusters_raw == []


# ---------- engine 分派接缝（handle_design 级别） ----------

def test_handle_design_rejects_unknown_network_mode(tmp_path):
    cfg = _clustered_config(network_mode='huawei_supernode')
    path = _write_config(tmp_path, cfg)
    result = handle_design({'configFile': str(path)})
    assert 'error' in result and 'huawei_supernode' in result['error']


def test_handle_design_accepts_native_network_mode(tmp_path):
    cfg = _clustered_config(network_mode='fat_tree')
    path = _write_config(tmp_path, cfg)
    result = handle_design({'configFile': str(path)})
    assert 'error' not in result
    assert result['summary']['numServers'] == 5
    # summary 输出 clusters/domains 字段
    assert result['summary']['clusters'][0]['network_mode'] == 'fat_tree'
    types = [d['type'] for d in result['summary']['domains']]
    assert 'param' in types


def test_handle_design_legacy_no_clusters(tmp_path):
    cfg = _base_config("legacy")
    path = _write_config(tmp_path, cfg)
    result = handle_design({'configFile': str(path)})
    assert 'error' not in result
    assert result['summary']['clusters'] == []
    assert 'domains' in result['summary']


# ---------- project_config network_mode 类型校验 ----------

def test_clusters_network_mode_type_validation(tmp_path):
    cfg = _clustered_config()
    cfg['clusters'][0]['network_mode'] = 42
    assert validate_config(cfg) is not None  # 非字符串 → 校验失败
    cfg['clusters'][0]['network_mode'] = '  '
    assert validate_config(cfg) is not None  # 空白字符串 → 校验失败
    cfg['clusters'][0]['network_mode'] = 'zcube'
    assert validate_config(cfg) is None       # 合法字符串 → schema 通过（值域语义在 engine 层）
