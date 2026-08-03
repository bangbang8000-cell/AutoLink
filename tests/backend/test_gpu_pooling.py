"""V3.0.0-T0-5b: GPU 池化 + 正交集群模型（后端生成）测试

覆盖：
  - 多集群/多池配置可生成（num_servers 由池汇总）
  - 池间异构 profile（pool 内同构、pool 间可异，power/u 不同）
  - 服务器池/集群标记（pool_id/cluster_id）与命名
  - 机柜按池聚柜（同池共柜、池间不混柜）
  - 导出按池分组（server view / device list）
  - 无 clusters 段时走原逻辑（2.9.9 兼容）
"""
import json
import pytest

from project_config import create_default_config, validate_config
from designer import NetworkDesignerV2
from exporter import generate_server_view, generate_device_list


def _pooled_config(tmp_path, pools=None, storage=1, compute=1):
    """构造带 clusters 段的配置；pools: [{cluster_id, role, pool_id, count, power, u}]"""
    pools = pools or [
        {"cluster_id": "c-p", "role": "P", "pool_id": "h100", "count": 2, "power": 1000, "u": 4},
        {"cluster_id": "c-p", "role": "P", "pool_id": "h200", "count": 2, "power": 7000, "u": 8},
        {"cluster_id": "c-d", "role": "D", "pool_id": "b200", "count": 1, "power": 12000, "u": 8},
    ]
    cfg = create_default_config("pooled")
    cfg['topology'].update({
        'num_gpu_servers': 99,  # 应被池汇总覆盖
        'num_all_flash_storage': storage,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': compute,
        'param_speed': '400G',
    })
    by_cluster = {}
    for p in pools:
        by_cluster.setdefault(p['cluster_id'], []).append(p)
    cfg['clusters'] = [
        {
            "cluster_id": cid,
            "role": ps[0]['role'],
            "gpu_pools": [
                {
                    "pool_id": p['pool_id'], "count": p['count'],
                    "profile_ref": {
                        "library_id": "generic_4u_gpu",
                        "overrides": {"power_watts": p['power'], "u_height": p['u']},
                    },
                }
                for p in ps
            ],
        }
        for cid, ps in by_cluster.items()
    ]
    path = tmp_path / 'project_config.json'
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _designer(tmp_path, **kw):
    d = NetworkDesignerV2(str(_pooled_config(tmp_path, **kw)))
    return d


# ---------- 多集群生成 ----------

def test_pooled_num_servers_from_pools(tmp_path):
    d = _designer(tmp_path)
    assert d.num_servers == 5  # 2+2+1，覆盖 topology.num_gpu_servers=99
    assert len(d.servers) == 5 + 1 + 1  # GPU + 存储 + 通算
    assert len(d.gpu_pool_defs) == 3


def test_pooled_server_names_and_tags(tmp_path):
    d = _designer(tmp_path)
    names = {s.name for s in d.servers[:5]}
    assert 'GPU服务器_h100_1' in names
    assert 'GPU服务器_h100_2' in names
    assert 'GPU服务器_h200_3' in names
    assert 'GPU服务器_b200_5' in names
    h100 = next(s for s in d.servers if s.name == 'GPU服务器_h100_1')
    assert h100.pool_id == 'h100'
    assert h100.cluster_id == 'c-p'
    b200 = next(s for s in d.servers if s.name == 'GPU服务器_b200_5')
    assert b200.pool_id == 'b200'
    assert b200.cluster_id == 'c-d'


def test_pooled_hetero_profiles(tmp_path):
    """池间异构：power/u 按池 profile 生效（pool 内同构）"""
    d = _designer(tmp_path)
    h100 = [s for s in d.servers if getattr(s, 'pool_id', '') == 'h100']
    h200 = [s for s in d.servers if getattr(s, 'pool_id', '') == 'h200']
    assert len(h100) == 2 and len(h200) == 2
    assert {s.power_watts for s in h100} == {1000}
    assert {s.power_watts for s in h200} == {7000}
    assert {s.u_height for s in h100} == {4}
    assert {s.u_height for s in h200} == {8}


def test_pooled_validate_and_topology(tmp_path):
    cfg = json.loads(_pooled_config(tmp_path).read_text(encoding='utf-8'))
    assert validate_config(cfg) is None
    d = _designer(tmp_path)
    assert d.validate_topology()['valid']
    assert len(d.param_leaves) >= 1


# ---------- 机柜按池聚柜 ----------

def test_rack_pool_isolation(tmp_path):
    d = _designer(tmp_path)
    # h100 池 2 台低功率(1000W/4U) → 同柜共柜
    h100 = sorted([s for s in d.servers if getattr(s, 'pool_id', '') == 'h100'], key=lambda s: s.name)
    assert len(h100) == 2
    assert h100[0].cabinet_id == h100[1].cabinet_id
    # 不同池不混柜
    b200 = next(s for s in d.servers if getattr(s, 'pool_id', '') == 'b200')
    assert b200.cabinet_id != h100[0].cabinet_id
    # 池化 GPU 柜类型为 gpu
    cab = next(c for c in d._rack_cabinets if c.id == h100[0].cabinet_id)
    assert cab.type == 'gpu'


# ---------- 导出按池分组 ----------

def test_export_server_view_grouped_by_pool(tmp_path):
    d = _designer(tmp_path)
    df = generate_server_view(d)
    groups = sorted(set(df['服务器分组']))
    assert 'GPU服务器组h100' in groups
    assert 'GPU服务器组h200' in groups
    assert 'GPU服务器组b200' in groups


def test_export_device_list_grouped_by_pool(tmp_path):
    d = _designer(tmp_path)
    df = generate_device_list(d)
    types = df['设备类型'].astype(str).tolist()
    assert any('h100' in t for t in types)
    assert any('h200' in t for t in types)
    assert any('b200' in t for t in types)


# ---------- 无池兼容（2.9.9 行为） ----------

def test_no_pool_legacy_behavior(tmp_path):
    cfg = create_default_config("legacy")
    cfg['topology'].update({
        'num_gpu_servers': 4, 'num_all_flash_storage': 1,
        'num_hybrid_flash_storage': 0, 'num_compute_servers': 1, 'param_speed': '400G',
    })
    path = tmp_path / 'project_config.json'
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    d = NetworkDesignerV2(str(path))
    assert d.gpu_pool_defs == []
    assert d.num_servers == 4
    assert 'GPU服务器_1' in {s.name for s in d.servers[:4]}
    assert all(getattr(s, 'pool_id', '') == '' for s in d.servers[:4])
