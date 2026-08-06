"""AutoLink V3.2.0-T9-2 - ATOP 式自动拓扑优化

依据《From ATOP to ZCube: Automated Topology Optimization Pipeline and
A Highly Cost-Effective Network Topology for Large Model Training》
（清华 SIGCOMM 2025）：模型通信特征（AllReduce/All-to-All/P2P + 通信占比）
→ ZCube 扁平二部图（无 Spine，两组 Leaf 直连 GPU）2D/3D cube 拓扑推荐。

流水线：features（通信特征提取）→ recommender（cube 维度推导 + 拓扑生成
+ validation 校验接入 + 推荐理由）。
"""
from .features import (
    AtopFeature, extract_features,
    COMM_PATTERN_ALLREDUCE, COMM_PATTERN_ALLTOALL, COMM_PATTERN_P2P,
)
from .recommender import recommend, recommend_topology, derive_cube_dims

__all__ = [
    'AtopFeature', 'extract_features',
    'COMM_PATTERN_ALLREDUCE', 'COMM_PATTERN_ALLTOALL', 'COMM_PATTERN_P2P',
    'recommend', 'recommend_topology', 'derive_cube_dims',
]
