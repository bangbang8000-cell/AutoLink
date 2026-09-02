"""4.6.0（F6-2）：测试数据资产可复用性（Q-2）

遍历 tests/fixtures/projects/*/project_config.json（样例项目），
交给 NetworkDesignerV2 生成拓扑，断言：
  - 资产清单 manifest.json 与磁盘目录一一对应
  - 所有样例可被设计器消费且拓扑校验通过
  - 设计器输出规模与样例配置声明一致（至少 1 个样例被测试消费）
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from designer import NetworkDesignerV2  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), '..', 'fixtures')
PROJECTS = os.path.join(FIXTURES, 'projects')

# 主消费样例：64 台 H100 规划（GPU 64 + 全闪 4 + 混闪 4 + 通算 8 = 80 台服务器）
PRIMARY_SAMPLE = '64_h100'
PRIMARY_EXPECTED_SERVERS = 80


def _iter_projects():
    """产出 (name, project_config.json 绝对路径)"""
    for name in sorted(os.listdir(PROJECTS)):
        cfg = os.path.join(PROJECTS, name, 'project_config.json')
        if os.path.isfile(cfg):
            yield name, cfg


def _load(name):
    with open(os.path.join(PROJECTS, name, 'project_config.json'), encoding='utf-8') as f:
        return json.load(f)


def test_fixture_manifest_lists_all_projects():
    """资产清单 manifest.json 与磁盘目录一一对应（清单一致性）"""
    with open(os.path.join(FIXTURES, 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    assert manifest['schemaVersion'] == 1
    listed = {p['id'] for p in manifest['projects']}
    disk = {name for name, _ in _iter_projects()}
    assert listed == disk, f'manifest 与磁盘不一致: manifest-only={listed - disk}, disk-only={disk - listed}'


def test_at_least_one_sample_consumed():
    """Q-2：至少 1 个样例被测试消费（64_h100 由本测试加载并断言规模）"""
    cfg_path = os.path.join(PROJECTS, PRIMARY_SAMPLE, 'project_config.json')
    assert os.path.exists(cfg_path), f'缺少主样例: {cfg_path}'
    d = NetworkDesignerV2(cfg_path)
    assert len(d.servers) == PRIMARY_EXPECTED_SERVERS, \
        f'{PRIMARY_SAMPLE}: 服务器数 {len(d.servers)} != {PRIMARY_EXPECTED_SERVERS}'
    assert len(d.servers) > 0


def test_all_fixture_projects_design_valid():
    """所有样例项目可被 NetworkDesignerV2 消费且拓扑校验通过"""
    designed = 0
    for name, cfg_path in _iter_projects():
        d = NetworkDesignerV2(cfg_path)
        v = d.validate_topology()
        assert v['valid'], f'{name}: 拓扑校验失败: {v.get("errors")}'
        designed += 1
    assert designed >= 1, '至少 1 个样例被测试消费'


def test_designer_scale_matches_config():
    """设计器输出规模与样例配置声明一致（自洽性）"""
    for name, cfg_path in _iter_projects():
        topo = _load(name)['topology']
        expected = (topo.get('num_gpu_servers', 0)
                    + topo.get('num_all_flash_storage', 0)
                    + topo.get('num_hybrid_flash_storage', 0)
                    + topo.get('num_compute_servers', 0))
        d = NetworkDesignerV2(cfg_path)
        total = len(d.servers)
        # 超节点 NPU 单独建模（huawei_npus），不计入 servers
        if topo.get('param_network_mode') == 'huawei_supernode':
            total += len(getattr(d, 'huawei_npus', []))
        assert total == expected, \
            f'{name}: 设计规模 {total} != 配置声明 {expected}'


def test_fixture_scenario_flags():
    """关键场景标志位生效（融合网 / 存储关闭 / 超节点 / zcube）"""
    combined = _load('combined_network_gb300')
    assert combined['networks']['eth_combined'] is True

    storage_off = _load('storage_disabled')
    assert storage_off['networks']['storage_network'] is False
    assert storage_off['topology']['num_all_flash_storage'] == 0

    supernode = _load('supernode_384')
    assert supernode['topology']['param_network_mode'] == 'huawei_supernode'

    zcube = _load('zcube_512')
    assert zcube['topology']['param_network_mode'] == 'zcube'
