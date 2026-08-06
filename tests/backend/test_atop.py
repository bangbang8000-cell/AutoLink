"""V3.2.0-T9-2: ATOP 自动拓扑优化测试

覆盖：通信特征解析 / cube 维度推导 / 拓扑生成校验（V020 接入无 error）/
      渲染元数据完整性 / action 主入口
"""
import pytest

from atop import (
    extract_features, recommend, recommend_topology, derive_cube_dims,
    COMM_PATTERN_ALLREDUCE, COMM_PATTERN_ALLTOALL, COMM_PATTERN_P2P,
)
from atop.features import AtopFeature
from zcube_topology import build_cube_topology_data


class TestFeatureExtraction:
    def test_moe_alltoall(self):
        """MoE（num_experts>0）→ alltoall 主导 + 高通信占比 + 四口接入"""
        f = extract_features({'model': 'deepseek-v3', 'num_gpus': 1024})
        assert f.communication_pattern == COMM_PATTERN_ALLTOALL
        assert f.comm_ratio >= 0.6
        assert f.traffic_breakdown['alltoall'] > 0.5
        assert f.nics_per_gpu >= 2

    def test_dense_allreduce(self):
        """稠密模型 → allreduce 主导，双口接入"""
        f = extract_features({'model': 'llama3-70b', 'num_gpus': 512})
        assert f.communication_pattern == COMM_PATTERN_ALLREDUCE
        assert f.comm_ratio == pytest.approx(0.5)
        assert f.nics_per_gpu == 2

    def test_pp_p2p_component(self):
        """pp>1 → traffic_breakdown 含 p2p 分量"""
        f = extract_features({'model': 'llama3-70b', 'num_gpus': 512, 'pp': 4})
        assert f.traffic_breakdown['p2p'] > 0
        assert abs(sum(f.traffic_breakdown.values()) - 1.0) < 1e-6

    def test_explicit_override(self):
        """显式覆盖 communication_pattern/comm_ratio 优先"""
        f = extract_features({'model': 'deepseek-v3', 'num_gpus': 1024,
                              'communication_pattern': 'allreduce', 'comm_ratio': 0.3})
        assert f.communication_pattern == COMM_PATTERN_ALLREDUCE
        assert f.comm_ratio == pytest.approx(0.3)

    def test_traffic_driven_pattern(self):
        """显式 traffic → 主导模式按占比推导"""
        f = extract_features({'model': 'llama3-70b', 'num_gpus': 512,
                              'traffic': {'alltoall': 0.6, 'allreduce': 0.4, 'p2p': 0.0}})
        assert f.communication_pattern == COMM_PATTERN_ALLTOALL
        assert f.traffic_breakdown['alltoall'] == pytest.approx(0.6)

    def test_invalid_comm_ratio(self):
        with pytest.raises(ValueError):
            extract_features({'model': 'llama3-70b', 'num_gpus': 512, 'comm_ratio': 1.5})

    def test_unknown_model_error(self):
        with pytest.raises(ValueError):
            extract_features({'model': 'no-such-model', 'num_gpus': 512})


class TestCubeDims:
    def test_2d_cube_small(self):
        cube = derive_cube_dims(128)
        assert cube['dim'] == 2
        assert len(cube['dims']) == 2
        assert cube['volume'] >= 128

    def test_3d_cube_large(self):
        cube = derive_cube_dims(1024)
        assert cube['dim'] == 3
        assert len(cube['dims']) == 3
        assert cube['volume'] >= 1024


class TestTopologyGeneration:
    def test_render_data_complete(self):
        """拓扑渲染数据完整性：GPU/Leaf 节点 + 双向边 + 分组着色元数据"""
        topo = build_cube_topology_data(num_gpus=256, nics_per_gpu=2,
                                        switch_ports=64, cube_dims=[16, 16])
        nodes = topo['nodes']
        edges = topo['edges']
        gpus = [n for n in nodes if n['type'] == 'server']
        leaves = [n for n in nodes if n['type'] != 'server']
        assert len(gpus) == 256
        assert len(leaves) == 2 * topo['stats']['leaf_count']
        assert len(edges) > 0
        # 分组着色元数据
        for g in gpus:
            assert g['zcubeGroup'] in ('A', 'B')
            assert g['planeId'] in (0, 1)
            assert g['cubeRank'] >= 0
            assert len(g['cubePos']) == 2
        for lf in leaves:
            assert lf['zcubeGroup'] in ('A', 'B')
            assert lf['planeId'] in (0, 1)
        # 链路元数据
        for e in edges:
            assert e['source'] and e['target']
            assert e['speed'] and e['networkType'] == 'param'
        # 分组统计
        assert topo['meta']['groups']['A'] + topo['meta']['groups']['B'] == 256

    def test_3d_cube_meta(self):
        topo = build_cube_topology_data(num_gpus=512, cube_dims=[8, 8, 8])
        assert topo['meta']['dim'] == 3
        assert topo['meta']['cubeDimensions'] == [8, 8, 8]
        gpu = [n for n in topo['nodes'] if n['type'] == 'server'][0]
        assert len(gpu['cubePos']) == 3


class TestRecommend:
    def test_recommend_topology_valid(self):
        """1024 GPU（MoE 特征）→ 推荐拓扑校验通过（V020 无 error）+ 容量满足"""
        feature = extract_features({'model': 'deepseek-v3', 'num_gpus': 1024})
        result = recommend_topology(feature, 1024)
        assert result['success'] is True
        assert result['cube']['dim'] == 3
        assert result['validation']['valid'] is True
        assert not any(i['severity'] == 'error' for i in result['validation']['issues'])
        assert result['rationale']['points']
        # 端口容量：GPU 网卡总数 ≤ 两组 Leaf 总下联容量
        stats = result['zcube']['stats']
        nics = result['zcube']['params']['nics_per_gpu']
        L = stats['leaf_count']
        ports = result['zcube']['params']['switch_ports']
        assert 1024 * nics <= 2 * L * (ports - L)

    def test_recommend_dense_2d(self):
        feature = extract_features({'model': 'llama3-70b', 'num_gpus': 256})
        result = recommend_topology(feature, 256)
        assert result['cube']['dim'] == 2
        assert len(result['topology']['nodes']) >= 256
        assert result['validation']['valid'] is True

    def test_recommend_action_missing_gpus(self):
        assert recommend({'model': 'llama3-70b'})['success'] is False

    def test_recommend_action_bad_feature(self):
        result = recommend({'model': 'llama3-70b', 'num_gpus': 256, 'comm_ratio': 3})
        assert result['success'] is False
        assert 'comm_ratio' in result['error']

    def test_recommend_action_full(self):
        result = recommend({'model': 'deepseek-v3', 'num_gpus': 1024, 'pp': 4})
        assert result['success'] is True
        assert result['feature']['communicationPattern'] == COMM_PATTERN_ALLTOALL
        assert result['zcube']['meta']['noSpine'] is True
        # 渲染元数据完整性（供前端直接消费）
        nodes = result['topology']['nodes']
        gpus = [n for n in nodes if n['type'] == 'server']
        assert len(gpus) == 1024
        assert all('zcubeGroup' in n and 'planeId' in n for n in gpus)


class TestEngineAction:
    def test_atop_action_registered(self):
        """atop:recommend 已注册并可经 cli.execute 调用"""
        from engine import list_registered_actions, get_action_handler
        assert 'atop:recommend' in list_registered_actions()
        assert get_action_handler('atop:recommend') is not None

    def test_atop_action_execute(self):
        from cli import execute
        result = execute('atop:recommend', {'model': 'llama3-70b', 'num_gpus': 128})
        assert result.get('success') is True
        assert result['cube']['dim'] == 2
