"""
AutoLink V2.4 — Rail-Optimized 拓扑算法
基于 NVIDIA SuperPOD 8-Rail 架构，实现 Rail-Optimized 拓扑设计。

Rail-Optimized 核心思想：
  - 每个 GPU 服务器有 N 个参数网卡（NIC 0..N-1，通常 N=8）
  - N 个 Rail 组，每个 Rail 组对应一个 NIC 索引
  - NIC_i 连接到 Rail_i 的 Leaf 交换机
  - 同一 Rail 组内 Leaf ↔ Spine 全互联
  - 跨 Rail 通信通过 Core 交换机

优势：
  - 减少 AllReduce/All-to-All 通信跳数
  - 最大化 Rail 内通信带宽
  - 适合大规模 GPU 集群
"""
import math
from typing import List, Tuple, Dict, Optional
from models import NetworkObject, Connection


class RailOptimizedTopology:
    """Rail-Optimized 拓扑设计器（NVIDIA SuperPOD 8-Rail 架构）"""

    def __init__(
        self,
        num_servers: int,
        num_rails: int = 8,
        switch_ports: int = 64,
        ports_per_server: int = 8,
        network_speed: str = "400G",
        network_type: str = "param",
    ):
        self.num_servers = num_servers
        self.num_rails = num_rails
        self.switch_ports = switch_ports
        self.ports_per_server = ports_per_server
        self.network_speed = network_speed
        self.network_type = network_type
        self.prefix = "参数" if network_type == "param" else "存储"

        # 网络组件
        self.leaves: List[NetworkObject] = []
        self.spines: List[NetworkObject] = []
        self.cores: List[NetworkObject] = []
        self.connections: List[Connection] = []

        # Rail → Leaf 映射
        self.rail_leaf_map: Dict[int, List[str]] = {}

    def calculate_hierarchy(self) -> Tuple[int, int, int]:
        """
        计算 Rail-Optimized 层次结构
        返回 (total_leaves, total_spines, total_cores)
        """
        # 每个 Rail 组的服务器数
        servers_per_rail = math.ceil(self.num_servers / self.num_rails)

        # 每个 Rail 组的 Leaf 数（每 Leaf 下行端口 = switch_ports/2）
        downlink_per_leaf = self.switch_ports // 2
        leaves_per_rail = math.ceil(servers_per_rail / downlink_per_leaf) if downlink_per_leaf > 0 else 1

        # Spine 数 = Leaf 数（全互联，Spine 上行端口 = switch_ports - leaves_per_rail）
        spines_per_rail = leaves_per_rail

        total_leaves = self.num_rails * leaves_per_rail
        total_spines = self.num_rails * spines_per_rail

        # Core 交换机：跨 Rail 互联（每个 Spine 需要 1 个 Core 上行口）
        core_uplinks = total_spines
        core_downlinks = self.switch_ports
        total_cores = math.ceil(core_uplinks / core_downlinks) if core_downlinks > 0 else 1

        return total_leaves, total_spines, total_cores

    def create_network_objects(self) -> None:
        """创建 Rail-Optimized 网络设备对象"""
        servers_per_rail = math.ceil(self.num_servers / self.num_rails)
        downlink_per_leaf = self.switch_ports // 2
        leaves_per_rail = max(1, math.ceil(servers_per_rail / downlink_per_leaf))
        spines_per_rail = leaves_per_rail

        leaf_type = f"{self.network_type}_leaf"
        spine_type = f"{self.network_type}_spine"
        core_type = f"{self.network_type}_core"

        # 创建 Leaf 交换机（按 Rail 分组）
        for rail in range(self.num_rails):
            rail_leaf_ids = []
            for leaf_idx in range(1, leaves_per_rail + 1):
                leaf_name = f"{self.prefix}Leaf_R{rail}_{leaf_idx}"
                leaf = NetworkObject(
                    name=leaf_name,
                    obj_type=leaf_type,
                    group=f"Rail-{rail}",
                    max_ports=self.switch_ports,
                    podid=f"Rail-{rail}",
                    rail_id=rail,
                    rail_role="rail_leaf",
                )
                self.leaves.append(leaf)
                rail_leaf_ids.append(leaf_name)
            self.rail_leaf_map[rail] = rail_leaf_ids

        # 创建 Spine 交换机（按 Rail 分组）
        for rail in range(self.num_rails):
            for spine_idx in range(1, spines_per_rail + 1):
                spine_name = f"{self.prefix}Spine_R{rail}_{spine_idx}"
                spine = NetworkObject(
                    name=spine_name,
                    obj_type=spine_type,
                    group=f"Rail-{rail}",
                    max_ports=self.switch_ports,
                    podid=f"Rail-{rail}",
                    rail_id=rail,
                    rail_role="rail_spine",
                )
                self.spines.append(spine)

        # 创建 Core 交换机（跨 Rail 互联）
        total_cores = math.ceil(len(self.spines) / self.switch_ports)
        for core_idx in range(1, total_cores + 1):
            core_name = f"{self.prefix}Core_{core_idx}"
            core = NetworkObject(
                name=core_name,
                obj_type=core_type,
                group="Core",
                max_ports=self.switch_ports,
                podid="Core",
            )
            self.cores.append(core)

    def generate_connections(self, server_names: Optional[List[str]] = None) -> List[Connection]:
        """
        生成 Rail-Optimized 连接关系
        server_names: 服务器名称列表（如果为 None，使用 Server_1..Server_N）
        """
        connections: List[Connection] = []

        if server_names is None:
            server_names = [f"Server_{i+1}" for i in range(self.num_servers)]

        # 1. 服务器 NIC_i → Rail_i 的 Leaf（按负载分配）
        servers_per_rail = math.ceil(self.num_servers / self.num_rails)
        downlink_per_leaf = self.switch_ports // 2

        for rail in range(self.num_rails):
            rail_leaves = self.rail_leaf_map[rail]
            # 该 Rail 组的服务器
            start_idx = rail * servers_per_rail
            end_idx = min(start_idx + servers_per_rail, self.num_servers)
            rail_servers = server_names[start_idx:end_idx]

            for s_idx, server_name in enumerate(rail_servers):
                leaf_idx = s_idx // downlink_per_leaf
                leaf_name = rail_leaves[min(leaf_idx, len(rail_leaves) - 1)]
                connections.append(Connection(
                    a_device=server_name, a_port=f"NIC{rail}", a_module="",
                    z_device=leaf_name, z_port=f"Port{s_idx % downlink_per_leaf + 1}", z_module="",
                    cable_type=f"{self.prefix}网-{self.network_speed}",
                    description=f"{self.prefix}网 Rail-{rail} 下行",
                    network_type=self.network_type,
                ))

        # 2. Rail 内 Leaf ↔ Spine 全互联
        for rail in range(self.num_rails):
            rail_leaves = [n.name for n in self.leaves if n.group == f"Rail-{rail}"]
            rail_spines = [n.name for n in self.spines if n.group == f"Rail-{rail}"]
            for leaf_name in rail_leaves:
                for spine_name in rail_spines:
                    connections.append(Connection(
                        a_device=leaf_name, a_port="Uplink", a_module="",
                        z_device=spine_name, z_port="Downlink", z_module="",
                        cable_type=f"{self.prefix}网-{self.network_speed}",
                        description=f"{self.prefix}网 Rail-{rail} Leaf-Spine",
                        network_type=self.network_type,
                    ))

        # 3. 跨 Rail: Spine → Core
        total_cores = len(self.cores)
        if total_cores > 0:
            for s_idx, spine in enumerate(self.spines):
                core_idx = s_idx % total_cores
                core_name = self.cores[core_idx].name
                connections.append(Connection(
                    a_device=spine.name, a_port="Uplink", a_module="",
                    z_device=core_name, z_port=f"Port{s_idx % self.switch_ports + 1}", z_module="",
                    cable_type=f"{self.prefix}网-{self.network_speed}",
                    description=f"{self.prefix}网 Spine-Core 跨Rail",
                    network_type=self.network_type,
                ))

        self.connections = connections
        return connections

    def get_topology_summary(self) -> Dict:
        """返回拓扑摘要信息"""
        total_leaves, total_spines, total_cores = self.calculate_hierarchy()
        return {
            "topology_type": "rail_optimized",
            "num_rails": self.num_rails,
            "num_servers": self.num_servers,
            "total_leaves": total_leaves,
            "total_spines": total_spines,
            "total_cores": total_cores,
            "total_switches": total_leaves + total_spines + total_cores,
            "total_connections": len(self.connections),
            "network_speed": self.network_speed,
            "rail_groups": [
                {
                    "rail_id": r,
                    "leaves": len(self.rail_leaf_map.get(r, [])),
                    "spines": len([s for s in self.spines if s.group == f"Rail-{r}"]),
                }
                for r in range(self.num_rails)
            ],
        }


def is_rail_optimized_capable(device_profiles: List[Dict]) -> bool:
    """检查设备列表中是否有支持 Rail-Optimized 的 GPU 服务器"""
    for dp in device_profiles:
        if dp.get("rail_compatible") or dp.get("rail_compatible") is True:
            return True
    return False
