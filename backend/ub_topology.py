"""
AutoLink V2.7.5-T2 - UB 统一总线拓扑算法
华为昇腾 CloudMatrix 超节点 UB 总线全对等互联

UB (Unified Bus) 是华为昇腾 910C NPU 的 scale-up 互联协议:
  - 单卡 scale-up 带宽: 2800 Gbps
  - 全对等互联: 域内任意 NPU 间可直接通信
  - 支持多 UB 域: 域内全互联,域间通过 Scale-Out 网络

典型场景:
  - CloudMatrix 384 超节点: 384 颗昇腾 910C NPU + 192 颗鲲鹏 CPU
  - 单 UB 域 384 NPU 全互联,任意 NPU 对间单跳直达
  - 域内全对等 (Full-Mesh): N 个 NPU 产生 N*(N-1)/2 条链路
"""
from dataclasses import dataclass
from typing import List, Dict, Any, Union


@dataclass
class UBConfig:
    """UB 总线拓扑配置

    Attributes:
        num_npus: NPU 总数 (CloudMatrix 384 超节点 = 384)
        npus_per_node: 每节点 NPU 数 (Atlas 800T A2 = 8)
        ub_bandwidth_gbps: 单卡 UB scale-up 带宽 (Gbps), 910C 默认 2800
        num_cpus: 配套 CPU 数 (鲲鹏), 仅用于统计,不参与 UB 互联
        ub_domain_size: UB 域大小 (0=所有 NPU 同属一个域; >0=按指定大小切分多域)
        protocol: 协议类型, 固定 "UB"
        num_scaleout_switches: 每 UB 域 Scale-Out 交换机数 (V3.0.2-T2-3, 0=不生成)
        scaleout_ports_per_npu: 每 NPU Scale-Out 上联口数
        scaleout_speed: Scale-Out 端口速率 (如 "800G")
        scaleout_switch_ports: Scale-Out 交换机端口数
    """
    num_npus: int = 384                    # NPU 总数
    npus_per_node: int = 8                 # 每节点 NPU 数 (如 Atlas 800T A2 = 8)
    ub_bandwidth_gbps: float = 2800.0      # 单卡 UB 带宽 (Gbps)
    num_cpus: int = 0                      # 配套 CPU 数 (鲲鹏)
    ub_domain_size: int = 0                # UB 域大小 (0=所有 NPU 一个域)
    protocol: str = "UB"                   # 协议类型
    # V3.0.2-T2-3: 域间 Scale-Out (800G) 上联
    num_scaleout_switches: int = 16        # 每 UB 域 Scale-Out 交换机数
    scaleout_ports_per_npu: int = 2        # 每 NPU Scale-Out 上联口数
    scaleout_speed: str = "800G"           # Scale-Out 端口速率
    scaleout_switch_ports: int = 144       # Scale-Out 交换机端口数


@dataclass
class UBConnection:
    """UB 总线连接 (单条 NPU↔NPU 链路)

    UB 为全对等互联,每条链路双向可用,此处以单向 (source→target) 描述一条逻辑链路。
    端口命名规则: NPU_i 连接 NPU_j 的端口为 "UB_{j}"。

    Attributes:
        source: 源 NPU 名称 (如 "NPU_0")
        target: 目标 NPU 名称 (如 "NPU_1")
        source_port: 源端口 (如 "UB_1")
        target_port: 目标端口 (如 "UB_0")
        bandwidth_gbps: 单链路带宽 (Gbps)
        cable_type: 线缆类型 (UB 专用背板线缆)
        network_type: 网络类型, 固定 "ub"
        description: 连接描述
        domain_id: 所属 UB 域 ID
    """
    source: str
    target: str
    source_port: str
    target_port: str
    bandwidth_gbps: float
    cable_type: str
    network_type: str = "ub"
    description: str = ""
    domain_id: int = 0


class UBTopology:
    """UB 总线拓扑生成器

    根据 UBConfig 生成 UB 域内 NPU 全对等 (Full-Mesh) 互联连接。

    工作流程:
        1. 将 NPU 划分到 UB 域 (ub_domain_size=0 时全部归入单域)
        2. 对每个域内的 NPU 生成全对等连接 (N*(N-1)/2 条链路)
        3. 汇总统计信息 (总链路数、总带宽、每 NPU 上行带宽等)

    典型用法:
        >>> config = UBConfig(num_npus=384, npus_per_node=8, ub_bandwidth_gbps=2800)
        >>> topo = UBTopology(config)
        >>> conns = topo.generate_connections()
        >>> stats = topo.get_stats()
    """

    def __init__(self, config: UBConfig):
        self.config = config
        # 运行时缓存
        self._connections: List[UBConnection] = []
        self._scaleout_connections: List[Dict[str, Any]] = []   # V3.0.2-T2-3: Scale-Out 上联/互联边
        self._domains: List[List[int]] = []   # 每个域的 NPU 索引列表
        self._stats: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    #  域划分
    # ------------------------------------------------------------------
    def _divide_domains(self) -> List[List[int]]:
        """将 NPU 索引划分到 UB 域

        - ub_domain_size=0: 所有 NPU 归入单个域 (CloudMatrix 384 场景)
        - ub_domain_size>0: 每 ub_domain_size 个 NPU 组成一个域, 末尾域可能不满

        Returns:
            域列表, 每个元素为该域内的 NPU 索引列表
        """
        n = self.config.num_npus
        if n <= 0:
            return []

        size = self.config.ub_domain_size
        if size <= 0 or size >= n:
            # 单域: 全部 NPU
            return [list(range(n))]

        # 多域: 按指定大小切分
        domains = []
        for start in range(0, n, size):
            domains.append(list(range(start, min(start + size, n))))
        return domains

    # ------------------------------------------------------------------
    #  连接生成
    # ------------------------------------------------------------------
    def generate_connections(self) -> List[UBConnection]:
        """生成 UB 总线全对等互联连接

        对每个 UB 域内的 NPU 生成全对等 (Full-Mesh) 连接:
          - 域内 N 个 NPU 产生 N*(N-1)/2 条链路 (无向, 每对仅生成一条)
          - 端口命名: NPU_i → NPU_j 的源端口为 "UB_{j}", 目标端口为 "UB_{i}"
          - 线缆类型: UB-Cable (昇腾专用背板线缆)
          - 单链路带宽 = ub_bandwidth_gbps

        Returns:
            UBConnection 列表
        """
        if self._connections:
            return self._connections

        domains = self._divide_domains()
        self._domains = domains
        connections: List[UBConnection] = []

        bw = self.config.ub_bandwidth_gbps
        cable = "UB-Cable"

        for domain_id, npu_indices in enumerate(domains):
            m = len(npu_indices)
            # 全对等: i < j, 每对生成一条链路
            for ii in range(m):
                for jj in range(ii + 1, m):
                    i = npu_indices[ii]
                    j = npu_indices[jj]
                    src = f"NPU_{i}"
                    tgt = f"NPU_{j}"
                    connections.append(UBConnection(
                        source=src,
                        target=tgt,
                        source_port=f"UB_{j}",
                        target_port=f"UB_{i}",
                        bandwidth_gbps=bw,
                        cable_type=cable,
                        network_type="ub",
                        description=f"UB 域 {domain_id} 全对等链路: {src} ↔ {tgt}",
                        domain_id=domain_id,
                    ))

        self._connections = connections
        self._stats = self._compute_stats()
        return connections

    # ------------------------------------------------------------------
    #  Scale-Out 上联 / 域间互联 (V3.0.2-T2-3)
    # ------------------------------------------------------------------
    def generate_scaleout_connections(self) -> List[Dict[str, Any]]:
        """生成 Scale-Out 上联与域间互联连接 (dict 格式, 兼容 engine edge schema)

        华为超节点 Scale-Out 网络 (PRD 4.1.3)：
          - 上联: 每 NPU 的 Scale-Out 口 (默认 2 口, 800G) 轮转连接域内 Scale-Out 交换机
          - 域间互联: 全部 Scale-Out 交换机全互联 (全 mesh, 构成域间 800G 骨干)

        num_scaleout_switches=0 时不生成任何 Scale-Out 边。

        Returns:
            连接字典列表, 每条含 source/target/source_port/target_port/speed/
            cable_type/network_type('scale_out')/description/domain_id
        """
        if self._scaleout_connections:
            return self._scaleout_connections

        N = int(self.config.num_scaleout_switches or 0)
        if N <= 0:
            self._scaleout_connections = []
            return self._scaleout_connections

        domains = self._divide_domains()
        if not domains:
            self._scaleout_connections = []
            return self._scaleout_connections

        speed = self.config.scaleout_speed
        cable = "AOC"
        edges: List[Dict[str, Any]] = []
        so_switches: List[str] = []
        for domain_id, npu_indices in enumerate(domains):
            dom_switches = [f"ScaleOut_{domain_id + 1}_{j}" for j in range(1, N + 1)]
            so_switches.extend(dom_switches)
            # 1. NPU → 域内 Scale-Out 交换机 (轮转均摊, 与 NPU 序号解耦)
            for i in npu_indices:
                for p in range(1, self.config.scaleout_ports_per_npu + 1):
                    sw = dom_switches[(i + p) % N]
                    edges.append({
                        "source": f"NPU_{i}", "target": sw,
                        "source_port": f"SO_{p}", "target_port": f"NPU_{i}",
                        "speed": speed, "aSpeed": speed, "zSpeed": speed,
                        "cable_type": cable, "cableType": cable,
                        "network_type": "scale_out", "networkType": "scale_out",
                        "description": f"超节点域 {domain_id + 1} Scale-Out 上联: NPU_{i} → {sw}",
                        "domain_id": domain_id,
                    })

        # 2. Scale-Out 交换机全互联 (域间 800G 骨干, 全 mesh)
        m = len(so_switches)
        for ii in range(m):
            for jj in range(ii + 1, m):
                a, b = so_switches[ii], so_switches[jj]
                edges.append({
                    "source": a, "target": b,
                    "source_port": f"SO-Link_{jj + 1}", "target_port": f"SO-Link_{ii + 1}",
                    "speed": speed, "aSpeed": speed, "zSpeed": speed,
                    "cable_type": cable, "cableType": cable,
                    "network_type": "scale_out", "networkType": "scale_out",
                    "description": f"Scale-Out 域间互联: {a} ↔ {b}",
                    "domain_id": None,
                })

        self._scaleout_connections = edges
        return edges

    def to_scaleout_dict_list(self) -> List[Dict[str, Any]]:
        """导出 Scale-Out 连接为 dict 列表 (兼容 engine.py edge schema)

        若未生成则先调用 generate_scaleout_connections()。num_scaleout_switches=0
        时返回空列表。
        """
        if not self._scaleout_connections:
            self.generate_scaleout_connections()
        return self._scaleout_connections

    # ------------------------------------------------------------------
    #  统计信息
    # ------------------------------------------------------------------
    def _compute_stats(self) -> Dict[str, Any]:
        """计算拓扑统计信息 (内部调用)"""
        n = self.config.num_npus
        domains = self._domains
        num_domains = len(domains)

        # 域内连接数与每 NPU 端口数
        domain_stats = []
        total_links = 0
        max_ports_per_npu = 0
        for did, npu_indices in enumerate(domains):
            m = len(npu_indices)
            links = m * (m - 1) // 2   # 全对等链路数
            ports = m - 1               # 每 NPU 端口数
            total_links += links
            if ports > max_ports_per_npu:
                max_ports_per_npu = ports
            domain_stats.append({
                "domain_id": did,
                "num_npus": m,
                "num_links": links,
                "ports_per_npu": ports,
                "domain_bandwidth_gbps": links * self.config.ub_bandwidth_gbps,
            })

        total_bw = total_links * self.config.ub_bandwidth_gbps
        # 单 NPU 双向聚合带宽 = (N-1) * ub_bandwidth (域内全互联时)
        per_npu_agg_bw = max_ports_per_npu * self.config.ub_bandwidth_gbps

        # V3.0.2-T2-3: Scale-Out 统计 (num_scaleout_switches=0 时全为 0)
        so_per_domain = int(self.config.num_scaleout_switches or 0)
        num_so_total = so_per_domain * num_domains
        uplink_edges = n * (int(self.config.scaleout_ports_per_npu or 0)) if so_per_domain > 0 else 0
        inter_edges = (num_so_total * (num_so_total - 1) // 2) if num_so_total > 1 else 0

        return {
            "topology_type": "ub_full_mesh",
            "protocol": self.config.protocol,
            "num_npus": n,
            "npus_per_node": self.config.npus_per_node,
            "num_nodes": (n + self.config.npus_per_node - 1) // self.config.npus_per_node if self.config.npus_per_node > 0 else 0,
            "num_cpus": self.config.num_cpus,
            "ub_bandwidth_gbps": self.config.ub_bandwidth_gbps,
            "ub_domain_size": self.config.ub_domain_size,
            "num_domains": num_domains,
            "npus_per_domain": domains[0][-1] + 1 if domains else 0,   # 首域 NPU 数（域划分语义）
            "total_links": total_links,
            "total_bandwidth_gbps": total_bw,
            "total_bandwidth_tbps": total_bw / 1000.0,
            "max_ports_per_npu": max_ports_per_npu,
            "per_npu_aggregate_bandwidth_gbps": per_npu_agg_bw,
            # V3.0.2-T2-3: Scale-Out 上联/域间互联
            "scaleout_enabled": so_per_domain > 0,
            "num_scaleout_switches_per_domain": so_per_domain,
            "num_scaleout_switches": num_so_total,
            "scaleout_ports_per_npu": int(self.config.scaleout_ports_per_npu or 0),
            "scaleout_speed": self.config.scaleout_speed,
            "scaleout_switch_ports": int(self.config.scaleout_switch_ports or 0),
            "scaleout_uplink_edges": uplink_edges,
            "scaleout_interconnect_edges": inter_edges,
            "scaleout_total_edges": uplink_edges + inter_edges,
            "domains": domain_stats,
        }

    def get_stats(self) -> Dict[str, Any]:
        """获取拓扑统计信息

        Returns:
            统计字典, 含:
              - topology_type / protocol / num_npus / npus_per_node / num_nodes
              - num_cpus / ub_bandwidth_gbps / ub_domain_size / num_domains
              - total_links (总链路数)
              - total_bandwidth_gbps / total_bandwidth_tbps (总带宽)
              - max_ports_per_npu (单 NPU 最大端口数)
              - per_npu_aggregate_bandwidth_gbps (单 NPU 聚合带宽)
              - domains (各域明细: num_npus / num_links / ports_per_npu / domain_bandwidth_gbps)
              - V3.0.2-T2-3 Scale-Out: num_scaleout_switches_per_domain / num_scaleout_switches
                / scaleout_uplink_edges / scaleout_interconnect_edges / scaleout_total_edges
        """
        if not self._stats:
            self.generate_connections()
        return self._stats

    # ------------------------------------------------------------------
    #  导出为 dict 列表 (兼容 engine.py edge schema)
    # ------------------------------------------------------------------
    def to_dict_list(self) -> List[Dict[str, Any]]:
        """将 UB 连接导出为 dict 列表

        输出格式兼容 engine.py 的 edge schema, 同时保留 UB 专用字段
        (source_port / target_port / bandwidth_gbps)。

        Returns:
            连接字典列表
        """
        if not self._connections:
            self.generate_connections()

        edges: List[Dict[str, Any]] = []
        for c in self._connections:
            edges.append({
                # UB 专用字段
                "source": c.source,
                "target": c.target,
                "source_port": c.source_port,
                "target_port": c.target_port,
                "bandwidth_gbps": c.bandwidth_gbps,
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
                "networkType": c.network_type,
                "network_type": c.network_type,
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


def generate_ub_connections(config_or_designer: Union[UBConfig, Any]) -> List[Dict[str, Any]]:
    """生成 UB 总线连接列表 (dict 格式, 兼容 engine.py edge schema)

    本函数为对外入口, 接受两种参数:
      1. UBConfig 实例: 直接用于生成拓扑
      2. designer-like 对象: 从其属性提取 UB 配置后生成
         (需含 num_npus / npus_per_node / ub_bandwidth_gbps / num_cpus /
          ub_domain_size / protocol 之一或 ub_config 属性)

    Args:
        config_or_designer: UBConfig 实例 或 designer-like 对象

    Returns:
        连接字典列表, 兼容 engine.py edge schema

    典型用法:
        >>> cfg = UBConfig(num_npus=384, ub_bandwidth_gbps=2800)
        >>> edges = generate_ub_connections(cfg)
        >>> len(edges)
        73536
    """
    # 1. 解析配置
    if isinstance(config_or_designer, UBConfig):
        config = config_or_designer
    else:
        # designer-like 对象: 优先取 ub_config, 否则按属性拼装
        designer = config_or_designer
        if hasattr(designer, "ub_config") and isinstance(designer.ub_config, UBConfig):
            config = designer.ub_config
        else:
            config = UBConfig(
                num_npus=getattr(designer, "num_npus", 384),
                npus_per_node=getattr(designer, "npus_per_node", 8),
                ub_bandwidth_gbps=getattr(designer, "ub_bandwidth_gbps", 2800.0),
                num_cpus=getattr(designer, "num_cpus", 0),
                ub_domain_size=getattr(designer, "ub_domain_size", 0),
                protocol=getattr(designer, "protocol", "UB"),
            )

    # 2. 生成拓扑并导出 dict 列表
    topo = UBTopology(config)
    topo.generate_connections()
    return topo.to_dict_list()


def generate_cloudmatrix384_ub_connections() -> List[Dict[str, Any]]:
    """快捷生成 CloudMatrix 384 超节点 UB 拓扑连接

    CloudMatrix 384 超节点: 384 颗昇腾 910C NPU + 192 颗鲲鹏 CPU,
    全部 384 NPU 归入单个 UB 域, 域内全对等互联。

    Returns:
        连接字典列表 (共 384*383/2 = 73536 条链路)
    """
    config = UBConfig(
        num_npus=384,
        npus_per_node=8,
        ub_bandwidth_gbps=2800.0,
        num_cpus=192,
        ub_domain_size=0,   # 单域
        protocol="UB",
    )
    return generate_ub_connections(config)
