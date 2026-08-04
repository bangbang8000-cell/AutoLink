"""
AutoLink V3.0.2-T2-1 - ZCube 拓扑（扁平化二部图，无 Spine）

依据（PRD 4.1.2 / 清华 SIGCOMM 2025 ZCube 论文）：
  - 完全扁平化二部图互联：取消 Spine 层，两组 Leaf 直连 GPU；
  - 任意 GPU 间独享最短路径：GPU → 组内 Leaf →（跨组时）另一组 Leaf → GPU；
  - 双口网卡单轨/多轨混合接入：每 GPU 端口分组 A / 组 B（默认双口 = 1+1）；
  - 无 Spine 层级一致性：全部节点仅 param_leaf，无 param_spine/param_core。

模型：
  两组 Leaf（组 A / 组 B），组间全二部互联（每组内 Leaf 与对组每个 Leaf 直连），
  组内 Leaf 下联 GPU。Leaf 端口划分：
    - 下联（GPU）：switch_ports - L 口（L = 每组 Leaf 数）
    - 组间互联（Leaf↔Leaf）：L 口（与对组全互联）
  L 自动推导：min L 使 L × (switch_ports - L) ≥ num_gpus × ports_to_group。
"""
import math
from typing import Dict, List, Any

from models import NetworkObject, Connection


class ZcubeTopology:
    """ZCube 扁平化二部图拓扑设计器（V3.0.2-T2-1）"""

    def __init__(self, num_gpus: int, nics_per_gpu: int = 2,
                 leaf_count: int = 0, switch_ports: int = 144,
                 cable_type_config: Dict[str, str] = None,
                 network_type: str = "param", prefix: str = "参数"):
        self.num_gpus = int(num_gpus)
        self.nics_per_gpu = int(nics_per_gpu)
        self.leaf_count = int(leaf_count)          # 0 = 自动推导
        self.switch_ports = int(switch_ports)
        self.cable_type_config = cable_type_config or {'server_leaf': 'MPO', 'leaf_spine': 'MPO'}
        self.network_type = network_type
        self.prefix = prefix

        # 组件（仅 Leaf，两组；无 Spine/Core）
        self.leaves: List[NetworkObject] = []
        self.switch_groups: Dict[str, str] = {}
        self.podid_map: Dict[str, str] = {}

        # 统计（calculate 填充）
        self.stats: Dict[str, Any] = {}

    # ================================================================
    #  层次计算
    # ================================================================

    @property
    def ports_to_group_a(self) -> int:
        """每 GPU 连到组 A 的端口数（双口混合：前一半端口给 A）"""
        return max(1, math.ceil(self.nics_per_gpu / 2))

    def calculate(self) -> Dict[str, Any]:
        """推导两组 Leaf 数与端口划分

        Returns:
            stats: {num_gpus, nics_per_gpu, leaf_count(L), ports_to_group_a,
                    downlink_per_leaf, inter_leaf_per_leaf, total_ports}
        """
        p_a = self.ports_to_group_a
        required = max(0, self.num_gpus) * p_a
        # min L 使 L*(switch_ports-L) >= required（无 Spine 扁平二部图容量）
        L = self.leaf_count
        if L <= 0:
            L = 8  # 初始猜测（最小规模）
            while L < self.switch_ports:
                if L * (self.switch_ports - L) >= required:
                    break
                L += 1
            if L >= self.switch_ports:
                L = max(1, self.switch_ports // 2)  # 兜底
        L = max(1, min(int(L), self.switch_ports - 1))
        self.stats = {
            'num_gpus': self.num_gpus,
            'nics_per_gpu': self.nics_per_gpu,
            'leaf_count': L,
            'ports_to_group_a': p_a,
            'downlink_per_leaf': max(1, self.switch_ports - L),
            'inter_leaf_per_leaf': L,
            'total_ports': self.num_gpus * self.nics_per_gpu,
        }
        return self.stats

    # ================================================================
    #  对象创建（两组 Leaf，无 Spine/Core）
    # ================================================================

    def create_objects(self) -> None:
        if not self.stats:
            self.calculate()
        L = self.stats['leaf_count']
        for label in ('A', 'B'):
            for li in range(1, L + 1):
                name = f"{self.prefix}{label}_Leaf_{li}"
                leaf = NetworkObject(
                    name=name,
                    obj_type=f"{self.network_type}_leaf",   # 无 Spine/Core：层级一致性
                    group=f"{self.prefix}{label}Leaf组",
                    max_ports=self.switch_ports,
                    podid=f"zcube-{label}",
                    downlink_limit=self.stats['downlink_per_leaf'],
                    ports_per_nic=1,
                )
                leaf.plane_id = 0 if label == 'A' else 1   # 复用平面 A/B 配色
                leaf.zcube_group = label
                self.leaves.append(leaf)
                self.switch_groups[name] = leaf.group
                self.podid_map[name] = leaf.podid

    # ================================================================
    #  连接生成：GPU→组内 Leaf（混合接入）+ 组 A↔组 B 全二部
    # ================================================================

    def generate_connections(self, servers: List[NetworkObject]) -> List[Connection]:
        connections: List[Connection] = []
        if not self.stats:
            self.calculate()
        L = self.stats['leaf_count']
        p_a = self.stats['ports_to_group_a']
        speed = '400G'
        leaves_a = [l for l in self.leaves if l.zcube_group == 'A']
        leaves_b = [l for l in self.leaves if l.zcube_group == 'B']
        leaf_a_map = {l.name: l for l in leaves_a}
        leaf_b_map = {l.name: l for l in leaves_b}

        # --- GPU → Leaf（双口混合接入：前 p_a 口 → A，余口 → B；组内轮转均摊） ---
        for server in servers:
            sidx = getattr(server, 'server_index', None)
            if sidx is None:
                continue
            sidx0 = sidx - 1
            for port_idx in range(1, self.nics_per_gpu + 1):
                to_a = port_idx <= p_a
                group_leaves = leaves_a if to_a else leaves_b
                # 组内序号（组 A 第 k 口 / 组 B 第 k 口）→ 轮转覆盖组内全部 Leaf
                intra = port_idx - 1 if to_a else (port_idx - 1 - p_a)
                leaf = group_leaves[(sidx0 + intra) % len(group_leaves)]
                srv_port = f"{server.port_prefix or f'{self.prefix}网卡'}{port_idx}"
                try:
                    leaf_port = leaf.get_downlink_port()
                except ValueError as e:
                    print(f"警告: ZCube {str(e)}")
                    continue
                self._connect_pair(server, srv_port, speed, leaf, leaf_port, speed,
                                   self.cable_type_config['server_leaf'],
                                   f"服务器到{self.prefix}{'A' if to_a else 'B'}Leaf",
                                   network_type=self.network_type, out=connections)

        # --- 组 A ↔ 组 B 全二部互联（无 Spine：此即扁平化核心，路径唯一） ---
        for a_leaf in leaves_a:
            for b_leaf in leaves_b:
                try:
                    a_port = a_leaf.get_uplink_port()
                    b_port = b_leaf.get_uplink_port()
                except ValueError as e:
                    print(f"警告: ZCube {str(e)}")
                    continue
                self._connect_pair(a_leaf, a_port, speed, b_leaf, b_port, speed,
                                   self.cable_type_config['leaf_spine'],
                                   f"{self.prefix}A到{self.prefix}B Leaf互联",
                                   network_type=self.network_type, out=connections)

        return connections

    def _connect_pair(self, a_dev, a_port, a_mod, z_dev, z_port, z_mod,
                      cable, desc, network_type, out: List[Connection]) -> None:
        c1 = Connection(a_dev.name, a_port, a_mod, z_dev.name, z_port, z_mod, cable, desc,
                        a_cabinet_id=a_dev.cabinet_id, a_cabinet_name=a_dev.cabinet_name,
                        a_start_u=a_dev.start_u, a_end_u=a_dev.end_u,
                        z_cabinet_id=z_dev.cabinet_id, z_cabinet_name=z_dev.cabinet_name,
                        z_start_u=z_dev.start_u, z_end_u=z_dev.end_u,
                        network_type=network_type)
        c2 = Connection(z_dev.name, z_port, z_mod, a_dev.name, a_port, a_mod, cable, desc,
                        z_cabinet_id=a_dev.cabinet_id, z_cabinet_name=a_dev.cabinet_name,
                        z_start_u=a_dev.start_u, z_end_u=a_dev.end_u,
                        a_cabinet_id=z_dev.cabinet_id, a_cabinet_name=z_dev.cabinet_name,
                        a_start_u=z_dev.start_u, a_end_u=z_dev.end_u,
                        network_type=network_type)
        a_dev.add_connection(c1)
        z_dev.add_connection(c2)
        out.extend([c1, c2])
