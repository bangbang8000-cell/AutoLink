"""ATOP 自动拓扑推荐引擎（V3.2.0-T9-2）

依据《From ATOP to ZCube》（清华 SIGCOMM 2025）：
  模型通信特征（主导模式/占比）→ 拓扑选型 —— ZCube 扁平二部图（无 Spine，
  两组 Leaf 直连 GPU），GPU 按 2D/3D cube 维度分组着色。

推荐流程：
  特征（features.AtopFeature） + 规模（num_gpus）
    → cube 维度推导（2D/3D）
    → zcube_topology.build_cube_topology_data 生成可渲染拓扑
    → 接入 validation（V020 规则校验，无 error 才视为可校验通过）
    → rationale 推荐理由（数据驱动，供前端/对话解释）
"""
from typing import Any, Dict, List

from .features import AtopFeature, extract_features
from zcube_topology import build_cube_topology_data, _derive_cube_dims

# 交换机端口档位：按 GPU 数 × 网卡数所需下联容量选档（ATOP 选型简化规则）
def _pick_switch_ports(num_gpus: int, nics_per_gpu: int = 2) -> int:
    downlinks = max(1, int(num_gpus)) * max(1, int(nics_per_gpu))
    for ports in (64, 144, 288):
        if downlinks <= (ports // 2) ** 2:   # L*(ports-L) 最大容量 ≈ (ports/2)^2
            return ports
    return 288


def derive_cube_dims(num_gpus: int) -> Dict[str, Any]:
    """GPU 数 → cube 维度（2D/3D），返回带说明的结构

    Returns:
        {dims: [x, y] 或 [x, y, z], dim: 2 或 3, volume}
    """
    dims = _derive_cube_dims(int(num_gpus))
    return {'dims': dims, 'dim': len(dims),
            'volume': _prod(dims), 'numGpus': int(num_gpus)}


def validate_cube_topology(topology: Dict[str, Any], num_gpus: int,
                           nics_per_gpu: int, switch_ports: int,
                           stats: Dict[str, Any]) -> Dict[str, Any]:
    """接入 validation.py 的 V020（ZCube 结构规则），校验推荐拓扑无 error

    Returns:
        {valid, issues: [{rule_id, severity, message, recommendation}]}
    """
    from validation import create_default_engine, Severity, ValidationContext

    leaf_nodes = [n for n in topology['nodes'] if n['type'] != 'server']
    gpu_edges = [
        {'source': e['source'], 'target': e['target'], 'a_port': '',
         'network_type': e.get('network_type', 'param'),
         'networkType': e.get('networkType', 'param')}
        for e in topology['edges']
    ]
    config = {
        'param_network_mode': 'zcube',
        'zcube_stats': {
            'nics_per_gpu': nics_per_gpu,
            'leaf_count': stats.get('leaf_count', 0),
            'downlink_per_leaf': stats.get('downlink_per_leaf', 0),
            'ports_to_group_a': stats.get('ports_to_group_a', 1),
        },
        'param_zcube': {'nics_per_gpu': nics_per_gpu},
        'num_servers': num_gpus,
        'power_limit_per_rack': 6000,
        'param_switch_ports': switch_ports,
    }
    ctx = ValidationContext(
        servers=[{'name': n['id'], 'cabinet_id': None}
                 for n in topology['nodes'] if n['type'] == 'server'],
        switches=[{'name': n['id'], 'obj_type': n['type'],
                   'network_type': 'param', 'max_ports': switch_ports}
                  for n in leaf_nodes],
        connections=gpu_edges,
        cabinets=[],
        config=config,
        pue_result=None,
        convergence_results={},
    )
    issues = create_default_engine().validate(ctx)
    return {
        'valid': not any(i.severity == Severity.ERROR for i in issues),
        'issues': [{
            'rule_id': i.rule_id,
            'severity': i.severity.value,
            'message': i.message,
            'recommendation': i.recommendation,
        } for i in issues],
    }


def recommend_topology(feature: AtopFeature, num_gpus: int,
                       switch_ports: int = 0, leaf_count: int = 0) -> Dict[str, Any]:
    """特征 + 规模 → 完整拓扑推荐

    Args:
        feature: 模型通信特征（AtopFeature）
        num_gpus: 目标 GPU 数
        switch_ports: Leaf 端口数（0 = 按规模自动档位）
        leaf_count: 每组 Leaf 数（0 = 自动推导）

    Returns:
        {success, feature, cube, topology{nodes,edges}, zcube{stats,params},
         validation{valid,issues}, rationale{summary,points}}
    """
    n = int(num_gpus)
    if n <= 0:
        return {'success': False, 'error': 'GPU 数量必须为正数'}

    nics = feature.nics_per_gpu or 2
    ports = switch_ports if switch_ports > 0 else _pick_switch_ports(n, nics)

    cube = derive_cube_dims(n)
    topo = build_cube_topology_data(
        num_gpus=n, nics_per_gpu=nics, switch_ports=ports,
        leaf_count=leaf_count, cube_dims=cube['dims'])

    # --- 接入 validation：V020 规则校验推荐拓扑 ---
    validation = validate_cube_topology(topo, n, nics, ports, topo['stats'])

    # --- rationale：数据驱动推荐理由 ---
    pattern_label = {
        'allreduce': 'AllReduce（梯度同步）',
        'alltoall': 'All-to-All（专家/序列并行全交换）',
        'p2p': 'P2P（流水线 stage 间激活传递）',
    }.get(feature.communication_pattern, feature.communication_pattern)
    dim_label = f"{cube['dim']}D cube"
    dims_str = '×'.join(str(d) for d in cube['dims'])
    split = (n + 1) // 2
    tb = feature.traffic_breakdown
    points = [
        f"通信模式：{feature.model_name} 以 {pattern_label} 为主导（占比 {tb.get(feature.communication_pattern, 0):.0%}）",
        f"拓扑选型：ZCube 扁平二部图（无 Spine，两组 Leaf 直连 GPU，任意 GPU 间独享最短路径）",
        f"cube 布局：{n} GPU 按 {dims_str} {dim_label} 编号（前 {split} 个归组 A / 其余组 B，plane_id 着色）",
        f"接入密度：每 GPU {nics} 口网卡混合接入（通信占比 {feature.comm_ratio:.0%} → {nics} 口）",
        f"Leaf 规模：每组 {topo['stats']['leaf_count']} 台 {ports} 口交换机（组间全二部互联）",
        f"校验结果：{'通过' if validation['valid'] else '存在 ' + str(len(validation['issues'])) + ' 项问题'}（V020 结构规则）",
    ]
    if feature.comm_ratio >= 0.6:
        points.append("提示：通信占比高，建议启用 RoCE/UEC 无损网络或 IB 保障吞吐")

    return {
        'success': True,
        'estimated': True,
        'feature': feature.to_dict(),
        'cube': cube,
        'topology': {'nodes': topo['nodes'], 'edges': topo['edges']},
        'zcube': {
            'stats': topo['stats'],
            'params': {'nics_per_gpu': nics, 'switch_ports': ports,
                       'leaf_count': topo['stats']['leaf_count']},
            'meta': topo['meta'],
        },
        'validation': validation,
        'rationale': {'summary': points[0], 'points': points},
    }


def recommend(params: dict) -> dict:
    """atop:recommend action 主入口

    参数: num_gpus（必填）/ model 或自定义模型字段（可选，缺省按用户特征）/
          features（通信特征覆盖：communication_pattern/comm_ratio/traffic）/
          tp/dp/pp / switch_ports / leaf_count
    返回: {success, feature, cube, topology, zcube, validation, rationale}
    """
    num_gpus = int(params.get('num_gpus') or 0)
    if num_gpus <= 0:
        return {'success': False, 'error': '缺少参数：num_gpus（GPU 数量）'}

    # 无模型时用占位特征（仅特征提取失败时报错；拓扑推荐本身只依赖特征+规模）
    try:
        feature = extract_features(params or {})
    except ValueError as e:
        return {'success': False, 'error': str(e)}

    result = recommend_topology(
        feature, num_gpus,
        switch_ports=int(params.get('switch_ports') or 0),
        leaf_count=int(params.get('leaf_count') or 0))
    return result


def _prod(dims: List[int]) -> int:
    p = 1
    for d in dims:
        p *= d
    return p
