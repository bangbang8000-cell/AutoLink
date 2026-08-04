"""
AutoLink V3.0.1-T1-2 - 双平面 16 Leaf 拓扑

定义（PRD 4.1.1）：
  服务器配 N 张参数网卡、每卡双口（dual-port）：
    - 每卡接口 1 → 平面 A（plane 0）
    - 每卡接口 2 → 平面 B（plane 1）
  每平面独立 Leaf 层（leaf_count，典型 8 → 双平面共 16 Leaf），
  每服务器每平面承载 nics_per_server 个口（如 8 口/平面）。

设计规则：
  - 逐平面独立计算层次：Leaf 下联容量 = switch_ports - uplink（缺省 half-half）；
    leaf_count 缺省 8，若容量不足自动扩容（ceil(required/downlink_per_leaf)），保证可生成。
  - Server → Leaf：轮转均摊（server_index × nics + port_idx 取模），每 Leaf 下联均摊。
  - Leaf → Spine：轮转全互联（每 Leaf 按 uplink 口数轮转到 Spine）。
  - 每网卡双口在服务器侧命名区分：平面 A 用端口 1..N，平面 B 用 N+1..2N。
  - 首版不建 Core（2-tier），core_count 预留 0；3-tier 逐平面扩展见后续版本。
"""
import math
from typing import Dict, List, Optional, Any

from models import NetworkObject, Connection


class DualPlaneTopology:
    """双平面 16 Leaf 拓扑设计器（V3.0.1-T1-2）"""

    def __init__(self, nics_per_server: int, ports_per_nic: int,
                 planes: List[Dict[str, Any]],
                 cable_type_config: Dict[str, str],
                 network_type: str = "param", prefix: str = "参数"):
        self.nics_per_server = int(nics_per_server)
        self.ports_per_nic = int(ports_per_nic)
        self.planes = planes              # [ {leaf_count, protocol, speed, switch_ports, uplink} ]
        self.cable_type_config = cable_type_config
        self.network_type = network_type
        self.prefix = prefix

        # 网络组件（全部平面压平；平面归属经 plane_id 区分）
        self.leaves: List[NetworkObject] = []
        self.spines: List[NetworkObject] = []
        self.cores: List[NetworkObject] = []
        self.switch_groups: Dict[str, str] = {}
        self.podid_map: Dict[str, str] = {}

        # 逐平面统计（calculate_hierarchy 填充）
        self.plane_stats: List[Dict[str, Any]] = []

    # ================================================================
    #  平面标签 / 统计
    # ================================================================

    @staticmethod
    def plane_label(pid: int) -> str:
        """平面标签：0→'A'，1→'B'，≥2 用数字"""
        return 'A' if pid == 0 else ('B' if pid == 1 else str(pid + 1))

    def calculate_hierarchy(self, num_servers: int) -> List[Dict[str, Any]]:
        """逐平面计算层次（leaf 自动扩容满足容量；缺省 leaf_count=8）

        Returns:
            plane_stats: [{plane, leaf_count, spine_count, core_count, speed, protocol,
                           switch_ports, downlink_per_leaf, uplink}]
        """
        self.plane_stats = []
        for pi, pl in enumerate(self.planes):
            speed = pl.get('speed', '400G')
            protocol = pl.get('protocol', 'RoCE')
            switch_ports = int(pl.get('switch_ports', 64))
            uplink = pl.get('uplink')
            if uplink is not None:
                uplink = int(uplink)
                downlink_per_leaf = max(1, switch_ports - uplink)
            else:
                uplink = max(1, switch_ports // 2)
                downlink_per_leaf = max(1, switch_ports - uplink)

            required_downlinks = max(0, num_servers) * self.nics_per_server
            leaf_count = max(int(pl.get('leaf_count', 8)),
                             math.ceil(required_downlinks / downlink_per_leaf) if downlink_per_leaf > 0 else 0)
            leaf_count = max(1, leaf_count)
            spine_count = max(1, leaf_count // 2)
            self.plane_stats.append({
                'plane': pi,
                'leaf_count': leaf_count,
                'spine_count': spine_count,
                'core_count': 0,           # 双平面首版 2-tier，预留
                'speed': speed,
                'protocol': protocol,
                'switch_ports': switch_ports,
                'downlink_per_leaf': downlink_per_leaf,
                'uplink': uplink,
            })
        return self.plane_stats

    # ================================================================
    #  对象创建
    # ================================================================

    def create_network_objects(self) -> None:
        """按平面创建 Leaf / Spine（命名: 参数A_Leaf_1 / 参数B_Spine_1）"""
        if not self.plane_stats:
            self.calculate_hierarchy(0)
        for pl in self.plane_stats:
            pid = pl['plane']
            label = self.plane_label(pid)

            for li in range(1, pl['leaf_count'] + 1):
                name = f"{self.prefix}{label}_Leaf_{li}"
                leaf = NetworkObject(
                    name=name,
                    obj_type=f"{self.network_type}_leaf",
                    group=f"{self.prefix}{label}Leaf组",
                    max_ports=pl['switch_ports'],
                    podid=f"plane-{label}",
                    # 端口容量显式化：下联 = switch_ports - uplink（非"半口下联"）
                    downlink_limit=pl['downlink_per_leaf'],
                    ports_per_nic=self.ports_per_nic,
                )
                leaf.plane_id = pid
                self.leaves.append(leaf)
                self.switch_groups[name] = leaf.group
                self.podid_map[name] = leaf.podid

            for si in range(1, pl['spine_count'] + 1):
                name = f"{self.prefix}{label}_Spine_{si}"
                spine = NetworkObject(
                    name=name,
                    obj_type=f"{self.network_type}_spine",
                    group=f"{self.prefix}{label}Spine组",
                    max_ports=pl['switch_ports'],
                    podid=f"plane-{label}",
                    ports_per_nic=self.ports_per_nic,
                )
                spine.plane_id = pid
                self.spines.append(spine)
                self.switch_groups[name] = spine.group
                self.podid_map[name] = spine.podid

    # ================================================================
    #  连接生成
    # ================================================================

    def generate_connections(self, servers: List[NetworkObject]) -> List[Connection]:
        """逐平面生成连接：Server→Leaf + Leaf→Spine（双连接已双向挂接）"""
        connections: List[Connection] = []

        for pl in self.plane_stats:
            pid = pl['plane']
            label = self.plane_label(pid)
            leaves = [l for l in self.leaves if getattr(l, 'plane_id', None) == pid]
            spines = [s for s in self.spines if getattr(s, 'plane_id', None) == pid]
            speed = pl['speed']
            if not leaves:
                continue

            # --- Server → Leaf（轮转均摊，每服务器每平面 nics_per_server 口）---
            for server in servers:
                sidx = getattr(server, 'server_index', None)
                if sidx is None:
                    continue
                sidx0 = sidx - 1
                for port_idx in range(1, self.nics_per_server + 1):
                    leaf = leaves[(sidx0 * self.nics_per_server + (port_idx - 1)) % len(leaves)]
                    # 每卡双口：平面 A 用 1..N，平面 B 用 N+1..2N
                    srv_port_num = port_idx + pid * self.nics_per_server
                    srv_port = f"{server.port_prefix or f'{self.prefix}网卡'}{srv_port_num}"
                    try:
                        leaf_port = leaf.get_downlink_port()
                    except ValueError as e:
                        print(f"警告: 双平面 {label} {str(e)}")
                        continue
                    self._connect_pair(server, srv_port, speed, leaf, leaf_port, speed,
                                       self.cable_type_config['server_leaf'],
                                       f"服务器到{self.prefix}{label}Leaf",
                                       network_type=self.network_type, out=connections)

            # --- Leaf → Spine（轮转全互联，按 Leaf 上联口数分配）---
            if not spines:
                continue
            for li, leaf in enumerate(leaves):
                max_uplinks = leaf.uplink_limit - leaf.uplink_counter + 1
                for u in range(max(0, max_uplinks)):
                    spine = spines[(li + u) % len(spines)]
                    try:
                        leaf_port = leaf.get_uplink_port()
                        spine_port = spine.get_downlink_port()
                    except ValueError as e:
                        print(f"警告: 双平面 {label} {str(e)}")
                        continue
                    self._connect_pair(leaf, leaf_port, speed, spine, spine_port, speed,
                                       self.cable_type_config['leaf_spine'],
                                       f"{self.prefix}{label}Leaf到Spine",
                                       network_type=self.network_type, out=connections)

        return connections

    def _connect_pair(self, a_dev, a_port, a_mod, z_dev, z_port, z_mod,
                      cable, desc, network_type, out: List[Connection]) -> None:
        """双向 Connection 并挂接到两端对象（与 designer._add_conn 语义一致）"""
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
