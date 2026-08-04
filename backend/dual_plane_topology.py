"""
AutoLink V3.0.1-T1-2 / V3.0.1-T1-5: 双平面 16 Leaf 拓扑（2-tier / 3-tier）

定义（PRD 4.1.1）：
  服务器配 N 张参数网卡、每卡双口（dual-port）：
    - 每卡接口 1 → 平面 A（plane 0）
    - 每卡接口 2 → 平面 B（plane 1）
  每平面独立 Leaf 层（leaf_count，典型 8 → 双平面共 16 Leaf），
  每服务器每平面承载 nics_per_server 个口（如 8 口/平面）。

层次判定（V3.0.1-T1-5）：
  - 逐平面独立判定 2/3-tier：num_servers ≤ calc_max_2tier → 2-tier；
    否则 3-tier（Pod 化：Leaf/Spine 按 Pod，Core 平面内共享），复用标准 Fat-Tree 公式。
  - 2-tier：leaf_count 缺省 8，容量不足自动扩容（ceil(required/downlink_per_leaf)），保证可生成。
  - 3-tier：按 Pod 展开，每 Pod 内 Leaf 数 = groups_per_pod × nics_per_server。

连接规则：
  - Server → Leaf：轮转均摊（2-tier 取模；3-tier 按 Pod 内 group 映射）。
  - Leaf → Spine：轮转全互联（2-tier 全平面；3-tier Pod 内）。
  - Spine → Core：轮转（仅 3-tier）。
  - 每网卡双口在服务器侧命名区分：平面 A 用端口 1..N，平面 B 用 N+1..2N。
"""
import math
from typing import Dict, List, Any

from models import NetworkObject, Connection
from topology import calc_max_2tier


class DualPlaneTopology:
    """双平面 16 Leaf 拓扑设计器（V3.0.1-T1-2，支持 2/3-tier）"""

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
        """逐平面计算层次（2/3-tier 自动判定）

        Returns:
            plane_stats: [{plane, tier(2/3), pods, servers_per_pod, leaf_count, spine_count,
                           core_count, speed, protocol, switch_ports, downlink_per_leaf, uplink}]
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

            # --- 2/3-tier 判定（标准 Fat-Tree 公式，ports_per_server = nics_per_server） ---
            max_2tier = calc_max_2tier(switch_ports, self.nics_per_server)
            if num_servers > max_2tier and max_2tier > 0:
                # 3-tier：Pod 化
                pods = math.ceil(num_servers / max_2tier)
                servers_per_pod = min(max_2tier, num_servers)
                max_servers_per_leaf = max(1, switch_ports // 2)
                servers_per_group = max(1, min(servers_per_pod // max(1, self.nics_per_server),
                                               max_servers_per_leaf))
                groups_per_pod = max(1, math.ceil(servers_per_pod / servers_per_group))
                leaves_per_pod = groups_per_pod * self.nics_per_server
                leaf_count = pods * leaves_per_pod
                spine_count = leaf_count                 # Leaf↔Spine 全互联（同 FatTree）
                core_count = max(1, spine_count // 2)
                stat = {
                    'plane': pi, 'tier': 3, 'pods': pods, 'servers_per_pod': servers_per_pod,
                    'servers_per_group': servers_per_group, 'leaves_per_pod': leaves_per_pod,
                    'leaf_count': leaf_count, 'spine_count': spine_count, 'core_count': core_count,
                    'speed': speed, 'protocol': protocol, 'switch_ports': switch_ports,
                    'downlink_per_leaf': max_servers_per_leaf, 'uplink': switch_ports - max_servers_per_leaf,
                }
            else:
                # 2-tier：leaf 自动扩容满足容量；缺省 leaf_count=8
                required_downlinks = max(0, num_servers) * self.nics_per_server
                leaf_count = max(int(pl.get('leaf_count', 8)),
                                 math.ceil(required_downlinks / downlink_per_leaf) if downlink_per_leaf > 0 else 0)
                leaf_count = max(1, leaf_count)
                stat = {
                    'plane': pi, 'tier': 2, 'pods': 0, 'servers_per_pod': 0, 'servers_per_group': 0,
                    'leaves_per_pod': 0,
                    'leaf_count': leaf_count, 'spine_count': max(1, leaf_count // 2), 'core_count': 0,
                    'speed': speed, 'protocol': protocol, 'switch_ports': switch_ports,
                    'downlink_per_leaf': downlink_per_leaf, 'uplink': uplink,
                }
            self.plane_stats.append(stat)
        return self.plane_stats

    # ================================================================
    #  对象创建
    # ================================================================

    def create_network_objects(self) -> None:
        """按平面创建 Leaf / Spine / Core（2-tier：参数A_Leaf_N；3-tier：参数A_Leaf_P{pod}_{n}）"""
        if not self.plane_stats:
            self.calculate_hierarchy(0)
        for pl in self.plane_stats:
            pid = pl['plane']
            label = self.plane_label(pid)

            # --- Leaf ---
            if pl['tier'] == 3:
                for pod in range(1, pl['pods'] + 1):
                    for li in range(1, pl['leaves_per_pod'] + 1):
                        self._add_leaf(f"{self.prefix}{label}_Leaf_P{pod}_{li}", pid, pl,
                                       podid=f"plane-{label}-pod{pod}", dl=pl['downlink_per_leaf'])
            else:
                for li in range(1, pl['leaf_count'] + 1):
                    self._add_leaf(f"{self.prefix}{label}_Leaf_{li}", pid, pl,
                                   podid=f"plane-{label}", dl=pl['downlink_per_leaf'])

            # --- Spine ---
            if pl['tier'] == 3:
                for pod in range(1, pl['pods'] + 1):
                    for si in range(1, pl['spine_count'] // pl['pods'] + 1):
                        self._add_spine(f"{self.prefix}{label}_Spine_P{pod}_{si}", pid, pl,
                                        podid=f"plane-{label}-pod{pod}")
            else:
                for si in range(1, pl['spine_count'] + 1):
                    self._add_spine(f"{self.prefix}{label}_Spine_{si}", pid, pl,
                                    podid=f"plane-{label}")

            # --- Core（仅 3-tier，平面内共享） ---
            if pl['tier'] == 3:
                for ci in range(1, pl['core_count'] + 1):
                    name = f"{self.prefix}{label}_Core_{ci}"
                    core = NetworkObject(
                        name=name,
                        obj_type=f"{self.network_type}_core",
                        group=f"{self.prefix}{label}Core组",
                        max_ports=pl['switch_ports'],
                        podid=f"plane-{label}",
                        ports_per_nic=self.ports_per_nic,
                    )
                    core.plane_id = pid
                    self.cores.append(core)
                    self.switch_groups[name] = core.group
                    self.podid_map[name] = core.podid

    def _add_leaf(self, name: str, pid: int, pl: Dict[str, Any], podid: str, dl: int) -> None:
        leaf = NetworkObject(
            name=name,
            obj_type=f"{self.network_type}_leaf",
            group=f"{self.prefix}{self.plane_label(pid)}Leaf组",
            max_ports=pl['switch_ports'],
            podid=podid,
            downlink_limit=dl,
            ports_per_nic=self.ports_per_nic,
        )
        leaf.plane_id = pid
        self.leaves.append(leaf)
        self.switch_groups[name] = leaf.group
        self.podid_map[name] = leaf.podid

    def _add_spine(self, name: str, pid: int, pl: Dict[str, Any], podid: str) -> None:
        spine = NetworkObject(
            name=name,
            obj_type=f"{self.network_type}_spine",
            group=f"{self.prefix}{self.plane_label(pid)}Spine组",
            max_ports=pl['switch_ports'],
            podid=podid,
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
        """逐平面生成连接：Server→Leaf + Leaf→Spine（+ Spine→Core 3-tier）"""
        connections: List[Connection] = []
        for pl in self.plane_stats:
            pid = pl['plane']
            label = self.plane_label(pid)
            leaves = [l for l in self.leaves if getattr(l, 'plane_id', None) == pid]
            spines = [s for s in self.spines if getattr(s, 'plane_id', None) == pid]
            cores = [c for c in self.cores if getattr(c, 'plane_id', None) == pid]
            speed = pl['speed']
            if not leaves:
                continue

            if pl['tier'] == 3:
                self._wire_3tier(servers, pid, label, pl, leaves, spines, cores, speed, connections)
            else:
                self._wire_2tier(servers, pid, label, pl, leaves, spines, speed, connections)

        return connections

    # ---------- 2-tier：Server→Leaf（轮转均摊）+ Leaf→Spine（轮转全互联） ----------

    def _wire_2tier(self, servers, pid, label, pl, leaves, spines, speed, connections):
        for server in servers:
            sidx = getattr(server, 'server_index', None)
            if sidx is None:
                continue
            sidx0 = sidx - 1
            for port_idx in range(1, self.nics_per_server + 1):
                leaf = leaves[(sidx0 * self.nics_per_server + (port_idx - 1)) % len(leaves)]
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

        if not spines:
            return
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

    # ---------- 3-tier：Pod 内 Server→Leaf / Leaf→Spine + Spine→Core ----------

    def _wire_3tier(self, servers, pid, label, pl, leaves, spines, cores, speed, connections):
        """3-tier：每平面 Pod 化。Server→Leaf（Pod 内 group 映射）、Leaf→Spine（Pod 内全互联）、Spine→Core"""
        pods = pl['pods']
        servers_per_pod = pl['servers_per_pod']
        servers_per_group = pl['servers_per_group']
        leaf_map = {l.name: l for l in leaves}

        # --- Server → Leaf（镜像 FatTree._connect_servers_to_leaves 的 Pod/group 映射） ---
        for server in servers:
            sidx = getattr(server, 'server_index', None)
            if sidx is None:
                continue
            pod_id = (sidx - 1) // servers_per_pod + 1
            sidx_in_pod = (sidx - 1) % servers_per_pod
            group_index = sidx_in_pod // servers_per_group
            for port_idx in range(1, self.nics_per_server + 1):
                leaf_idx = group_index * self.nics_per_server + port_idx
                leaf = leaf_map.get(f"{self.prefix}{label}_Leaf_P{pod_id}_{leaf_idx}")
                if not leaf:
                    continue
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

        # --- Leaf → Spine（Pod 内全互联，轮转） ---
        for pod in range(1, pods + 1):
            pod_spines = [s for s in spines if getattr(s, 'podid', '') == f"plane-{label}-pod{pod}"]
            if not pod_spines:
                continue
            pod_leaves = [l for l in leaves if getattr(l, 'podid', '') == f"plane-{label}-pod{pod}"]
            for li, leaf in enumerate(pod_leaves):
                max_uplinks = leaf.uplink_limit - leaf.uplink_counter + 1
                for u in range(max(0, max_uplinks)):
                    spine = pod_spines[(li + u) % len(pod_spines)]
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

        # --- Spine → Core（轮转；Core 平面内共享） ---
        if not cores:
            return
        core_port_used = [0] * len(cores)
        max_links_per_core = [getattr(c, 'core_limit', c.max_ports) for c in cores]
        for si, spine in enumerate(spines):
            remaining_uplinks = spine.uplink_limit - spine.uplink_counter + 1
            if remaining_uplinks <= 0:
                continue
            core_offset = (si * remaining_uplinks) % len(cores)
            for i in range(remaining_uplinks):
                core_idx = (core_offset + i) % len(cores)
                if core_port_used[core_idx] >= max_links_per_core[core_idx]:
                    continue
                try:
                    spine_port = spine.get_uplink_port()
                    core_port = cores[core_idx].get_core_port()
                    core_port_used[core_idx] += 1
                except ValueError as e:
                    print(f"警告: 双平面 {label} {str(e)}")
                    continue
                self._connect_pair(spine, spine_port, speed, cores[core_idx], core_port, speed,
                                   self.cable_type_config['spine_core'],
                                   f"{self.prefix}{label}Spine到Core",
                                   network_type=self.network_type, out=connections)

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
