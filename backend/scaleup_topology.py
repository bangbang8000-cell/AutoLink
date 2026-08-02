"""
AutoLink V2.7.6 - Scale-Up 拓扑规划
支持 NVLink / UALink / UB 三种 scale-up 协议的 Pod 内拓扑规划

Scale-Up 协议对比:
  - NVLink: NVIDIA 专有，NVLink 5.0 单链路 900 GBps，NVL72 单域 72 GPU
  - UALink: 开放标准，UALink 1.0 支持 1024 GPU Pod，单链路 200 GBps
  - UB: 华为昇腾专有，单卡 2800 Gbps，CloudMatrix 384 单域

工作流程:
  1. 将 GPU/NPU 划分到 Scale-Up 域 (每域不超过 domain_size)
  2. 对每个域内的 GPU 生成全对等 (Full-Mesh) 连接 (N*(N-1)/2 条链路)
  3. 汇总统计信息 (总链路数、总带宽、每 GPU 聚合带宽等)

典型用法:
  >>> config = ScaleUpConfig(protocol=ScaleUpProtocol.UALINK, num_gpus=1024)
  >>> topo = ScaleUpTopology(config)
  >>> topo.plan_domains()
  >>> edges = topo.to_dict_list()
  >>> stats = topo.get_stats()
"""
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from enum import Enum


class ScaleUpProtocol(Enum):
    """Scale-Up 互联协议"""
    NVLINK = "NVLink"
    UALINK = "UALink"
    UB = "UB"


@dataclass
class ScaleUpConfig:
    """Scale-Up 拓扑配置

    Attributes:
        protocol: Scale-Up 互联协议 (NVLink / UALink / UB)
        num_gpus: GPU/NPU 总数
        gpus_per_node: 每节点 GPU 数 (仅用于统计节点数, 不参与连接生成)
        domain_size: 单域规模 (0=按协议默认取 max_domain_size)
        bandwidth_per_link_gbps: 单链路带宽 Gbps (0=按协议默认)
        num_links_per_gpu: 每GPU链路数 (0=按协议默认)
    """
    protocol: ScaleUpProtocol = ScaleUpProtocol.UALINK
    num_gpus: int = 1024                    # GPU/NPU 总数
    gpus_per_node: int = 8                  # 每节点 GPU 数
    domain_size: int = 0                    # 单域规模 (0=自动)
    bandwidth_per_link_gbps: float = 0      # 单链路带宽 (0=按协议默认)
    num_links_per_gpu: int = 0              # 每GPU链路数 (0=按协议默认)


# 协议默认参数
_PROTOCOL_DEFAULTS = {
    ScaleUpProtocol.NVLINK: {
        'bandwidth_per_link_gbps': 1800,    # NVLink 5.0: 900 GBps = 1800 Gbps
        'max_domain_size': 72,              # NVL72
        'default_links_per_gpu': 18,        # 18 NVLinks per GPU
    },
    ScaleUpProtocol.UALINK: {
        'bandwidth_per_link_gbps': 200,     # UALink 1.0: 200 GBps per lane
        'max_domain_size': 1024,            # UALink 1.0 max
        'default_links_per_gpu': 4,         # 4 UALink ports
    },
    ScaleUpProtocol.UB: {
        'bandwidth_per_link_gbps': 2800,    # UB: 2800 Gbps
        'max_domain_size': 384,             # CloudMatrix 384
        'default_links_per_gpu': 1,         # Single UB port
    },
}


@dataclass
class ScaleUpDomain:
    """Scale-Up 域

    Attributes:
        domain_id: 域 ID
        protocol: 所属协议
        gpu_ids: 域内 GPU 索引列表
        is_full_mesh: 是否为全对等互联
        bandwidth_per_gpu_gbps: 单 GPU 聚合带宽 (Gbps)
    """
    domain_id: int
    protocol: ScaleUpProtocol
    gpu_ids: List[int]
    is_full_mesh: bool
    bandwidth_per_gpu_gbps: float


@dataclass
class ScaleUpConnection:
    """Scale-Up 连接 (单条 GPU↔GPU 链路)

    端口命名规则: GPU_i 连接 GPU_j 的源端口为 "{PROTOCOL}_{j}"。

    Attributes:
        source: 源 GPU 名称 (如 "GPU_0")
        target: 目标 GPU 名称 (如 "GPU_1")
        source_port: 源端口 (如 "UALink_1")
        target_port: 目标端口 (如 "UALink_0")
        bandwidth_gbps: 单链路带宽 (Gbps)
        protocol: 协议名称字符串
        domain_id: 所属 Scale-Up 域 ID
        cable_type: 线缆类型 (协议专用)
        description: 连接描述
    """
    source: str
    target: str
    source_port: str
    target_port: str
    bandwidth_gbps: float
    protocol: str
    domain_id: int
    cable_type: str
    description: str = ""


class ScaleUpTopology:
    """Scale-Up 拓扑规划器

    根据 ScaleUpConfig 生成 Scale-Up 域内 GPU 全对等 (Full-Mesh) 互联连接。

    工作流程:
        1. 应用协议默认参数 (带宽/链路数/域大小)
        2. 将 GPU 划分到 Scale-Up 域 (每域不超过 domain_size)
        3. 对每个域内的 GPU 生成全对等连接 (N*(N-1)/2 条链路)
        4. 汇总统计信息并导出为 engine.py 兼容的 edge schema

    典型用法:
        >>> config = ScaleUpConfig(protocol=ScaleUpProtocol.UALINK, num_gpus=1024)
        >>> topo = ScaleUpTopology(config)
        >>> topo.plan_domains()
        >>> edges = topo.to_dict_list()
        >>> stats = topo.get_stats()
    """

    def __init__(self, config: ScaleUpConfig):
        self.config = config
        self._apply_defaults()
        self._domains: List[ScaleUpDomain] = []
        self._connections: List[ScaleUpConnection] = []
        self._stats: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    #  协议默认参数
    # ------------------------------------------------------------------
    def _apply_defaults(self):
        """应用协议默认参数

        当配置中 bandwidth_per_link_gbps / num_links_per_gpu / domain_size 为 0 时,
        使用 _PROTOCOL_DEFAULTS 中对应协议的默认值。
        """
        defaults = _PROTOCOL_DEFAULTS.get(self.config.protocol, {})
        if self.config.bandwidth_per_link_gbps == 0:
            self.config.bandwidth_per_link_gbps = defaults.get('bandwidth_per_link_gbps', 200)
        if self.config.num_links_per_gpu == 0:
            self.config.num_links_per_gpu = defaults.get('default_links_per_gpu', 4)
        if self.config.domain_size == 0:
            self.config.domain_size = defaults.get('max_domain_size', 1024)

    # ------------------------------------------------------------------
    #  域划分
    # ------------------------------------------------------------------
    def plan_domains(self) -> List[ScaleUpDomain]:
        """规划 Scale-Up 域

        将 num_gpus 个 GPU 按 domain_size 切分到多个 Scale-Up 域:
          - 每 domain_size 个 GPU 组成一个域, 末尾域可能不满
          - 域内采用全对等 (Full-Mesh) 互联

        Returns:
            ScaleUpDomain 列表
        """
        if self._domains:
            return self._domains

        n = self.config.num_gpus
        if n <= 0:
            return []

        size = self.config.domain_size
        if size <= 0:
            size = n

        # 单 GPU 聚合带宽 = 链路数 × 单链路带宽
        bw_per_gpu = self.config.num_links_per_gpu * self.config.bandwidth_per_link_gbps

        domains: List[ScaleUpDomain] = []
        for did, start in enumerate(range(0, n, size)):
            gpu_ids = list(range(start, min(start + size, n)))
            domains.append(ScaleUpDomain(
                domain_id=did,
                protocol=self.config.protocol,
                gpu_ids=gpu_ids,
                is_full_mesh=True,
                bandwidth_per_gpu_gbps=bw_per_gpu,
            ))

        self._domains = domains
        return domains

    # ------------------------------------------------------------------
    #  连接生成
    # ------------------------------------------------------------------
    def generate_connections(self) -> List[ScaleUpConnection]:
        """生成 Scale-Up 连接 (域内全对等)

        对每个 Scale-Up 域内的 GPU 生成全对等 (Full-Mesh) 连接:
          - 域内 N 个 GPU 产生 N*(N-1)/2 条链路 (无向, 每对仅生成一条)
          - 端口命名: GPU_i → GPU_j 的源端口为 "{PROTOCOL}_{j}", 目标端口为 "{PROTOCOL}_{i}"
          - 线缆类型: {PROTOCOL}-Cable (协议专用线缆)
          - 单链路带宽 = bandwidth_per_link_gbps

        Returns:
            ScaleUpConnection 列表
        """
        if self._connections:
            return self._connections

        domains = self.plan_domains()
        connections: List[ScaleUpConnection] = []

        protocol_name = self.config.protocol.value
        cable = f"{protocol_name}-Cable"
        bw = self.config.bandwidth_per_link_gbps

        for domain in domains:
            gpu_ids = domain.gpu_ids
            m = len(gpu_ids)
            # 全对等: ii < jj, 每对生成一条链路
            for ii in range(m):
                for jj in range(ii + 1, m):
                    gi = gpu_ids[ii]
                    gj = gpu_ids[jj]
                    src = f"GPU_{gi}"
                    tgt = f"GPU_{gj}"
                    connections.append(ScaleUpConnection(
                        source=src,
                        target=tgt,
                        source_port=f"{protocol_name}_{gj}",
                        target_port=f"{protocol_name}_{gi}",
                        bandwidth_gbps=bw,
                        protocol=protocol_name,
                        domain_id=domain.domain_id,
                        cable_type=cable,
                        description=f"{protocol_name} 域 {domain.domain_id} 全对等链路: {src} ↔ {tgt}",
                    ))

        self._connections = connections
        self._stats = self._compute_stats()
        return connections

    # ------------------------------------------------------------------
    #  统计信息
    # ------------------------------------------------------------------
    def _compute_stats(self) -> Dict[str, Any]:
        """计算拓扑统计信息 (内部调用)"""
        n = self.config.num_gpus
        domains = self._domains
        num_domains = len(domains)

        # 各域明细
        domain_stats = []
        total_connections = 0
        for domain in domains:
            m = len(domain.gpu_ids)
            links = m * (m - 1) // 2   # 全对等链路数
            total_connections += links
            domain_stats.append({
                "domain_id": domain.domain_id,
                "num_gpus": m,
                "num_connections": links,
                "is_full_mesh": domain.is_full_mesh,
                "domain_bandwidth_gbps": links * self.config.bandwidth_per_link_gbps,
            })

        total_bw_gbps = total_connections * self.config.bandwidth_per_link_gbps
        # 单 GPU 聚合带宽 = 链路数 × 单链路带宽
        bw_per_gpu = self.config.num_links_per_gpu * self.config.bandwidth_per_link_gbps
        # 节点数 (仅统计, 不参与连接生成)
        num_nodes = (
            (n + self.config.gpus_per_node - 1) // self.config.gpus_per_node
            if self.config.gpus_per_node > 0 else 0
        )

        return {
            "topology_type": "scale_up_full_mesh",
            "protocol": self.config.protocol.value,
            "num_gpus": n,
            "gpus_per_node": self.config.gpus_per_node,
            "num_nodes": num_nodes,
            "domain_size": self.config.domain_size,
            "bandwidth_per_link_gbps": self.config.bandwidth_per_link_gbps,
            "num_links_per_gpu": self.config.num_links_per_gpu,
            "bandwidth_per_gpu": bw_per_gpu,
            "num_domains": num_domains,
            "total_connections": total_connections,
            "total_bandwidth_gbps": total_bw_gbps,
            "total_bandwidth_tbps": total_bw_gbps / 1000.0,
            "domains": domain_stats,
        }

    def get_stats(self) -> Dict[str, Any]:
        """获取拓扑统计信息

        Returns:
            统计字典, 含:
              - topology_type / protocol / num_gpus / gpus_per_node / num_nodes
              - domain_size / bandwidth_per_link_gbps / num_links_per_gpu
              - bandwidth_per_gpu (单 GPU 聚合带宽)
              - num_domains (域数量)
              - total_connections (总连接数)
              - total_bandwidth_gbps / total_bandwidth_tbps (总带宽)
              - domains (各域明细: num_gpus / num_connections / is_full_mesh / domain_bandwidth_gbps)
        """
        if not self._stats:
            self.generate_connections()
        return self._stats

    # ------------------------------------------------------------------
    #  导出为 dict 列表 (兼容 engine.py edge schema)
    # ------------------------------------------------------------------
    def to_dict_list(self) -> List[Dict[str, Any]]:
        """将 Scale-Up 连接导出为 dict 列表

        输出格式兼容 engine.py 的 edge schema, 同时保留 Scale-Up 专用字段
        (source_port / target_port / bandwidth_gbps / protocol / domain_id)。

        Returns:
            连接字典列表
        """
        if not self._connections:
            self.generate_connections()

        edges: List[Dict[str, Any]] = []
        for c in self._connections:
            edges.append({
                # Scale-Up 专用字段
                "source": c.source,
                "target": c.target,
                "source_port": c.source_port,
                "target_port": c.target_port,
                "bandwidth_gbps": c.bandwidth_gbps,
                "protocol": c.protocol,
                "cable_type": c.cable_type,
                "description": c.description,
                "domain_id": c.domain_id,
                # engine.py edge schema 兼容字段
                "a_port": c.source_port,
                "z_port": c.target_port,
                "speed": f"{int(c.bandwidth_gbps)}G",
                "aSpeed": f"{int(c.bandwidth_gbps)}G",
                "zSpeed": f"{int(c.bandwidth_gbps)}G",
                "cableType": c.cable_type,
                "networkType": "scale_up",
                "network_type": "scale_up",
                "a_device": c.source,
                "z_device": c.target,
                "aCabinetId": None,
                "aCabinetName": "",
                "aStartU": None,
                "aEndU": None,
                "zCabinetId": None,
                "zCabinetName": "",
                "zStartU": None,
                "zEndU": None,
            })
        return edges


def generate_scaleup_connections(config: ScaleUpConfig) -> List[Dict[str, Any]]:
    """生成 Scale-Up 连接列表 (dict 格式, 兼容 engine.py edge schema)

    本函数为对外入口, 接受 ScaleUpConfig 实例并返回连接字典列表。

    Args:
        config: ScaleUpConfig 实例

    Returns:
        连接字典列表, 兼容 engine.py edge schema

    典型用法:
        >>> cfg = ScaleUpConfig(protocol=ScaleUpProtocol.NVLINK, num_gpus=72)
        >>> edges = generate_scaleup_connections(cfg)
        >>> len(edges)
        2556
    """
    topo = ScaleUpTopology(config)
    topo.plan_domains()
    return topo.to_dict_list()
