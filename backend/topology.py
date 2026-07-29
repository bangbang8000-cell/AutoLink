"""
AutoLink V2.1 - 胖树拓扑计算引擎
FatTreeTopology: 三层/二层Fat-Tree网络拓扑设计器
AccessAggTopology: 接入-汇聚网络拓扑设计器
"""

import math
import re
from typing import Optional, Dict, Any
from models import NetworkObject, Connection


def calc_max_2tier(switch_ports, ports_per_server):
    """计算二层Fat-Tree最大支持服务器数量
    标准公式: k^2 / (4 * p)
    k=交换机端口数, p=每服务器网卡数
    推导: (k/2 * k/2) / p = k^2/(4p)
    """
    if ports_per_server <= 0:
        return 0
    return (switch_ports ** 2) // (4 * ports_per_server)


def calc_leafs_per_pod(switch_ports, ports_per_server, servers_per_pod):
    """计算每个POD内的Leaf交换机数量"""
    if ports_per_server <= 0 or servers_per_pod <= 0:
        return 1
    max_servers_per_leaf = switch_ports // 2
    servers_per_group = max(1, min(servers_per_pod // ports_per_server, max_servers_per_leaf))
    groups_per_pod = max(1, servers_per_pod // servers_per_group)
    return groups_per_pod * ports_per_server


class FatTreeTopology:
    """Fat-Tree网络拓扑设计器（支持二层/三层自动判定）"""

    def __init__(self, ports_per_server, switch_ports, network_speed, cable_type_config, network_type="param"):
        self.ports_per_server = ports_per_server
        self.switch_ports = switch_ports
        self.network_speed = network_speed
        self.cable_type_config = cable_type_config
        self.network_type = network_type
        self.prefix = "参数" if network_type == "param" else "存储"

        # 网络组件
        self.leaves = []
        self.spines = []
        self.cores = []

        # 组映射
        self.switch_groups = {}
        self.podid_map = {}

    def calculate_hierarchy(self, num_servers):
        """计算网络层次结构，返回 (is_3tier, total_leaves, total_spines, total_cores)"""
        max_2tier = calc_max_2tier(self.switch_ports, self.ports_per_server)

        if num_servers <= max_2tier:
            return False, None, None, None

        # 三层组网配置 (Leaf:Spine:Core = 2:2:1)
        num_pods = math.ceil(num_servers / max_2tier)
        servers_per_pod = min(max_2tier, num_servers)
        leafs_per_pod = calc_leafs_per_pod(self.switch_ports, self.ports_per_server, servers_per_pod)

        total_leaves = num_pods * leafs_per_pod
        total_spines = total_leaves
        total_cores = max(1, total_spines // 2)

        return True, total_leaves, total_spines, total_cores

    def create_network_objects(self, num_pods, servers_per_pod):
        """创建三层网络设备对象"""
        leafs_per_pod = calc_leafs_per_pod(self.switch_ports, self.ports_per_server, servers_per_pod)

        # 创建Leaf交换机
        for pod in range(1, num_pods + 1):
            for leaf_idx in range(1, leafs_per_pod + 1):
                leaf_name = f"{self.prefix}Leaf_P{pod}_{leaf_idx}"
                leaf = NetworkObject(
                    name=leaf_name,
                    obj_type=f"{self.network_type}_leaf",
                    group=f"{self.prefix}Leaf组P{pod}",
                    max_ports=self.switch_ports,
                    podid=f"pod-{pod}"
                )
                self.leaves.append(leaf)
                self.switch_groups[leaf_name] = leaf.group
                self.podid_map[leaf_name] = leaf.podid

        # 创建Spine交换机
        for spine_idx in range(1, len(self.leaves) + 1):
            spine_name = f"{self.prefix}Spine_{spine_idx}"
            spine = NetworkObject(
                name=spine_name,
                obj_type=f"{self.network_type}_spine",
                group=f"{self.prefix}Spine组",
                max_ports=self.switch_ports,
                podid="superpod"
            )
            self.spines.append(spine)
            self.switch_groups[spine_name] = spine.group
            self.podid_map[spine_name] = spine.podid

        # 创建Core交换机
        core_count = max(1, len(self.spines) // 2)
        for core_idx in range(1, core_count + 1):
            core_name = f"{self.prefix}Core_{core_idx}"
            core = NetworkObject(
                name=core_name,
                obj_type=f"{self.network_type}_core",
                group=f"{self.prefix}Core组",
                max_ports=self.switch_ports,
                podid="superpod"
            )
            self.cores.append(core)
            self.switch_groups[core_name] = core.group
            self.podid_map[core_name] = core.podid

    def generate_connections(self, servers, num_pods, servers_per_pod):
        """生成三层网络连接关系，使用轮转(Round-Robin)端口分配策略"""
        connections = []

        # 1. 服务器到Leaf连接 - 使用Leaf的下联端口
        self._connect_servers_to_leaves(servers, num_pods, servers_per_pod, connections)

        # 2. Leaf到Spine连接 - 使用轮转分配
        self._connect_leaves_to_spines(num_pods, connections)

        # 3. Spine到Core连接 - 使用轮转分配
        self._connect_spines_to_cores(connections)

        return connections

    def _connect_servers_to_leaves(self, servers, num_pods, servers_per_pod, connections):
        """服务器到Leaf连接"""
        if servers_per_pod <= 0 or self.ports_per_server <= 0:
            return
        max_servers_per_leaf = max(1, math.floor(self.switch_ports / 2))
        servers_per_group = min(servers_per_pod // self.ports_per_server, max_servers_per_leaf)

        if servers_per_group <= 0:
            servers_per_group = 1

        for server in servers:
            parts = server.name.split('_')
            if len(parts) < 2:
                continue
            try:
                server_idx = int(parts[1])
            except (ValueError, IndexError):
                continue
            pod_id = (server_idx - 1) // servers_per_pod + 1
            server.podid = f"pod-{pod_id}"

            server_idx_in_pod = (server_idx - 1) % servers_per_pod
            group_index = server_idx_in_pod // servers_per_group

            for port_idx in range(1, self.ports_per_server + 1):
                leaf_idx = group_index * self.ports_per_server + port_idx
                leaf_name = f"{self.prefix}Leaf_P{pod_id}_{leaf_idx}"

                leaf = next((l for l in self.leaves if l.name == leaf_name), None)
                if not leaf:
                    continue

                if leaf.downlink_counter > leaf.downlink_limit:
                    backup_found = False
                    for backup_idx in range(1, len(self.leaves) // num_pods + 1):
                        if backup_idx == leaf_idx:
                            continue
                        backup_name = f"{self.prefix}Leaf_P{pod_id}_{backup_idx}"
                        backup_leaf = next((l for l in self.leaves if l.name == backup_name), None)
                        if backup_leaf and backup_leaf.downlink_counter <= backup_leaf.downlink_limit:
                            leaf = backup_leaf
                            backup_found = True
                            break

                    if not backup_found:
                        raise ValueError(f"{leaf_name}下联端口不足，且无可用备用Leaf")

                # 使用设备档案端口命名，否则使用默认前缀
                srv_prefix = server.port_prefix or f"{self.prefix}网卡"
                server_port = f"{srv_prefix}{port_idx}"
                try:
                    leaf_port = leaf.get_downlink_port()
                except ValueError as e:
                    print(f"警告: {str(e)}")
                    continue

                conn_down = Connection(
                    a_device=server.name, a_port=server_port, a_module=self.network_speed,
                    z_device=leaf.name, z_port=leaf_port, z_module=self.network_speed,
                    cable_type=self.cable_type_config['server_leaf'],
                    description=f"服务器到{self.prefix}Leaf",
                    a_cabinet_id=server.cabinet_id, a_cabinet_name=server.cabinet_name,
                    a_start_u=server.start_u, a_end_u=server.end_u,
                    z_cabinet_id=leaf.cabinet_id, z_cabinet_name=leaf.cabinet_name,
                    z_start_u=leaf.start_u, z_end_u=leaf.end_u,
                    network_type=self.network_type,
                )
                conn_up = Connection(
                    a_device=leaf.name, a_port=leaf_port, a_module=self.network_speed,
                    z_device=server.name, z_port=server_port, z_module=self.network_speed,
                    cable_type=self.cable_type_config['server_leaf'],
                    description=f"{self.prefix}Leaf到服务器",
                    a_cabinet_id=leaf.cabinet_id, a_cabinet_name=leaf.cabinet_name,
                    a_start_u=leaf.start_u, a_end_u=leaf.end_u,
                    z_cabinet_id=server.cabinet_id, z_cabinet_name=server.cabinet_name,
                    z_start_u=server.start_u, z_end_u=server.end_u,
                    network_type=self.network_type,
                )

                server.add_connection(conn_down)
                leaf.add_connection(conn_up)
                connections.extend([conn_down, conn_up])

    def _connect_leaves_to_spines(self, num_pods, connections):
        """Leaf到Spine连接 - 使用轮转分配防止Spine端口溢出"""
        if num_pods <= 0 or not self.spines:
            return

        for leaf in self.leaves:
            pod_match = re.search(r"P(\d+)", leaf.name)
            leaf_idx_match = re.search(r'_(\d+)$', leaf.name)
            if not pod_match or not leaf_idx_match:
                continue
            pod_id = int(pod_match.group(1))

            start_spine = (pod_id - 1) * len(self.spines) // num_pods + 1
            end_spine = pod_id * len(self.spines) // num_pods
            spines_for_pod = end_spine - start_spine + 1

            max_uplinks = leaf.uplink_limit - leaf.uplink_counter + 1
            connections_per_leaf = min(max_uplinks, spines_for_pod)

            leaf_idx_in_pod = int(leaf_idx_match.group(1)) - 1
            spine_offset = (leaf_idx_in_pod * connections_per_leaf) % spines_for_pod if spines_for_pod > 0 else 0

            for i in range(connections_per_leaf):
                spine_idx = start_spine + (spine_offset + i) % spines_for_pod
                spine_name = f"{self.prefix}Spine_{spine_idx}"
                spine = next((s for s in self.spines if s.name == spine_name), None)
                if not spine:
                    continue

                try:
                    leaf_port = leaf.get_uplink_port()
                    spine_port = spine.get_downlink_port()

                    conn_leaf_to_spine = Connection(
                        a_device=leaf.name, a_port=leaf_port, a_module=self.network_speed,
                        z_device=spine.name, z_port=spine_port, z_module=self.network_speed,
                        cable_type=self.cable_type_config['leaf_spine'],
                        description=f"{self.prefix}Leaf到Spine",
                        a_cabinet_id=leaf.cabinet_id, a_cabinet_name=leaf.cabinet_name,
                        a_start_u=leaf.start_u, a_end_u=leaf.end_u,
                        z_cabinet_id=spine.cabinet_id, z_cabinet_name=spine.cabinet_name,
                        z_start_u=spine.start_u, z_end_u=spine.end_u,
                        network_type=self.network_type,
                    )
                    conn_spine_to_leaf = Connection(
                        a_device=spine.name, a_port=spine_port, a_module=self.network_speed,
                        z_device=leaf.name, z_port=leaf_port, z_module=self.network_speed,
                        cable_type=self.cable_type_config['leaf_spine'],
                        description=f"{self.prefix}Spine到Leaf",
                        a_cabinet_id=spine.cabinet_id, a_cabinet_name=spine.cabinet_name,
                        a_start_u=spine.start_u, a_end_u=spine.end_u,
                        z_cabinet_id=leaf.cabinet_id, z_cabinet_name=leaf.cabinet_name,
                        z_start_u=leaf.start_u, z_end_u=leaf.end_u,
                        network_type=self.network_type,
                    )

                    leaf.add_connection(conn_leaf_to_spine)
                    spine.add_connection(conn_spine_to_leaf)
                    connections.extend([conn_leaf_to_spine, conn_spine_to_leaf])

                except ValueError as e:
                    print(f"警告: {str(e)}")
                    continue

    def _connect_spines_to_cores(self, connections):
        """Spine到Core连接 - 使用轮转分配防止Core端口溢出"""
        if not self.cores:
            return

        max_uplinks_per_spine = self.switch_ports // 2
        max_links_per_core = [getattr(core, 'core_limit', core.max_ports) for core in self.cores]
        core_port_used = [0] * len(self.cores)

        for spine_idx, spine in enumerate(self.spines):
            remaining_uplinks = spine.uplink_limit - spine.uplink_counter + 1
            if remaining_uplinks <= 0:
                continue

            uplinks = min(remaining_uplinks, max_uplinks_per_spine)
            core_offset = (spine_idx * uplinks) % len(self.cores)

            for i in range(uplinks):
                core_idx = (core_offset + i) % len(self.cores)
                if core_port_used[core_idx] >= max_links_per_core[core_idx]:
                    continue

                try:
                    spine_port = spine.get_uplink_port()
                    core_port = self.cores[core_idx].get_core_port()
                    core_port_used[core_idx] += 1

                    conn_spine_to_core = Connection(
                        a_device=spine.name, a_port=spine_port, a_module=self.network_speed,
                        z_device=self.cores[core_idx].name, z_port=core_port, z_module=self.network_speed,
                        cable_type=self.cable_type_config['spine_core'],
                        description=f"{self.prefix}Spine到Core",
                        a_cabinet_id=spine.cabinet_id, a_cabinet_name=spine.cabinet_name,
                        a_start_u=spine.start_u, a_end_u=spine.end_u,
                        z_cabinet_id=self.cores[core_idx].cabinet_id,
                        z_cabinet_name=self.cores[core_idx].cabinet_name,
                        z_start_u=self.cores[core_idx].start_u,
                        z_end_u=self.cores[core_idx].end_u,
                        network_type=self.network_type,
                    )
                    conn_core_to_spine = Connection(
                        a_device=self.cores[core_idx].name, a_port=core_port, a_module=self.network_speed,
                        z_device=spine.name, z_port=spine_port, z_module=self.network_speed,
                        cable_type=self.cable_type_config['spine_core'],
                        description=f"{self.prefix}Core到Spine",
                        a_cabinet_id=self.cores[core_idx].cabinet_id,
                        a_cabinet_name=self.cores[core_idx].cabinet_name,
                        a_start_u=self.cores[core_idx].start_u,
                        a_end_u=self.cores[core_idx].end_u,
                        z_cabinet_id=spine.cabinet_id, z_cabinet_name=spine.cabinet_name,
                        z_start_u=spine.start_u, z_end_u=spine.end_u,
                        network_type=self.network_type,
                    )

                    spine.add_connection(conn_spine_to_core)
                    self.cores[core_idx].add_connection(conn_core_to_spine)
                    connections.extend([conn_spine_to_core, conn_core_to_spine])

                except ValueError as e:
                    print(f"警告: {str(e)}")
                    continue


class AccessAggTopology:
    """接入-汇聚网络拓扑设计器（用于带外管理和业务网络）
    
    拓扑结构:
        服务器 → 接入交换机 → 汇聚交换机
    
    支持特性:
        - 冗余模式(redundancy): 服务器双上联到MLAG配对的两台接入交换机
        - 框式汇聚(chassis): 大规模场景使用多框汇聚交换机
    """

    def __init__(self, access_down_ports, access_up_ports, agg_down_ports,
                 downlink_speed, uplink_speed, cable_server_access, cable_access_agg,
                 network_name="OOB", redundancy=False, downlink_limit=None):
        self.access_down_ports = access_down_ports
        self.access_up_ports = access_up_ports
        self.agg_down_ports = agg_down_ports
        self.downlink_speed = downlink_speed
        self.uplink_speed = uplink_speed
        self.cable_server_access = cable_server_access
        self.cable_access_agg = cable_access_agg
        self.network_name = network_name
        self.redundancy = redundancy  # True=MLAG双接入
        # downlink_limit: None=自动(min(ports,25)), 数字=指定下行口数
        self.downlink_limit = downlink_limit
        _network_type_map = {"OOB": "oob", "业务": "biz"}
        self.network_type = _network_type_map.get(network_name, network_name.lower())

        # 交换机对象
        self.access_switches = []
        self.agg_switches = []
        self.switch_groups = {}
        self.podid_map = {}

    def calculate(self, num_servers, chassis_config=None):
        """计算需要的接入和汇聚交换机数量
        chassis_config: (enabled, frames) for chassis-style aggregation
        """
        # 接入层: 解析下联口限制
        dl = self.downlink_limit if self.downlink_limit is not None else min(self.access_down_ports, 25)
        servers_per_access = max(1, min(self.access_down_ports, dl))
        if self.redundancy:
            # MLAG对：两台交换机为一组，每组覆盖servers_per_access台服务器
            num_access_groups = max(1, math.ceil(num_servers / servers_per_access))
            num_access = num_access_groups * 2
        else:
            num_access = max(1, math.ceil(num_servers / servers_per_access))

        # 汇聚层
        total_access_uplinks = num_access * self.access_up_ports
        if chassis_config and chassis_config['enabled']:
            # 框式：每框 agg_down_ports 个端口，多框堆叠
            frames = chassis_config['frames']
            total_agg_ports = frames * self.agg_down_ports
            num_agg = frames  # 框数
            agg_type = f"框式({frames}框×{self.agg_down_ports}口)"
        else:
            num_agg = max(1, math.ceil(total_access_uplinks / self.agg_down_ports))
            total_agg_ports = num_agg * self.agg_down_ports
            agg_type = f"盒式({num_agg}台×{self.agg_down_ports}口)"

        return {
            'num_servers': num_servers,
            'servers_per_access': servers_per_access,
            'num_access': num_access,
            'num_agg': num_agg,
            'total_access_uplinks': total_access_uplinks,
            'total_agg_ports': total_agg_ports,
            'agg_type': agg_type,
            'redundancy': self.redundancy
        }

    def create_and_connect(self, servers, num_access, num_agg):
        """创建交换机并生成连接"""
        # 创建接入交换机
        for i in range(1, num_access + 1):
            sw = NetworkObject(
                name=f"{self.network_name}接入_{i}",
                obj_type=f"{self.network_type}_access",
                group=f"{self.network_name}接入组",
                max_ports=self.access_down_ports + self.access_up_ports
            )
            dl = self.downlink_limit if self.downlink_limit is not None else min(self.access_down_ports, 25)
            sw.downlink_counter = 1
            sw.downlink_limit = min(self.access_down_ports, dl)
            sw.uplink_counter = self.access_down_ports + 1
            sw.uplink_limit = self.access_down_ports + self.access_up_ports
            self.access_switches.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = f"pod-{i}"

        # 创建汇聚交换机
        for i in range(1, num_agg + 1):
            sw = NetworkObject(
                name=f"{self.network_name}汇聚_{i}",
                obj_type=f"{self.network_type}_agg",
                group=f"{self.network_name}汇聚组",
                max_ports=self.agg_down_ports
            )
            sw.downlink_counter = 1
            sw.downlink_limit = self.agg_down_ports
            self.agg_switches.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = "superpod"

        # 服务器 → 接入交换机
        if self.redundancy:
            self._connect_servers_redundant(servers)
        else:
            self._connect_servers_single(servers)

        # 接入交换机 → 汇聚交换机 (轮转分配)
        self._connect_access_to_agg()

    def _connect_servers_single(self, servers):
        """单链路上联：每台服务器连1台接入交换机"""
        dl = self.downlink_limit if self.downlink_limit is not None else min(self.access_down_ports, 25)
        servers_per_access = max(1, min(self.access_down_ports, dl))
        for si, server in enumerate(servers):
            access_idx = si // servers_per_access
            if access_idx >= len(self.access_switches):
                break
            sw = self.access_switches[access_idx]

            try:
                sw_port = sw.get_downlink_port()
                # 使用服务器端口命名前缀
                srv_prefix = server.port_prefix or f"{self.network_name}口"
                srv_port = f"{srv_prefix}1"

                conn_down = Connection(
                    a_device=server.name, a_port=srv_port, a_module=self.downlink_speed,
                    z_device=sw.name, z_port=sw_port, z_module=self.downlink_speed,
                    cable_type=self.cable_server_access,
                    description=f"服务器到{self.network_name}接入",
                    a_cabinet_id=server.cabinet_id, a_cabinet_name=server.cabinet_name,
                    a_start_u=server.start_u, a_end_u=server.end_u,
                    z_cabinet_id=sw.cabinet_id, z_cabinet_name=sw.cabinet_name,
                    z_start_u=sw.start_u, z_end_u=sw.end_u,
                    network_type=self.network_type,
                )
                conn_up = Connection(
                    a_device=sw.name, a_port=sw_port, a_module=self.downlink_speed,
                    z_device=server.name, z_port=srv_port, z_module=self.downlink_speed,
                    cable_type=self.cable_server_access,
                    description=f"{self.network_name}接入到服务器",
                    a_cabinet_id=sw.cabinet_id, a_cabinet_name=sw.cabinet_name,
                    a_start_u=sw.start_u, a_end_u=sw.end_u,
                    z_cabinet_id=server.cabinet_id, z_cabinet_name=server.cabinet_name,
                    z_start_u=server.start_u, z_end_u=server.end_u,
                    network_type=self.network_type,
                )
                server.add_connection(conn_down)
                sw.add_connection(conn_up)
            except ValueError as e:
                print(f"警告: {str(e)}")
                continue

    def _connect_servers_redundant(self, servers):
        """冗余双上联：每台服务器连2台接入交换机(MLAG对)"""
        dl = self.downlink_limit if self.downlink_limit is not None else min(self.access_down_ports, 25)
        servers_per_pair = max(1, min(self.access_down_ports, dl))
        for si, server in enumerate(servers):
            pair_idx = si // servers_per_pair
            # MLAG对中的两台交换机
            base = pair_idx * 2
            if base + 1 >= len(self.access_switches):
                break
            sw_a = self.access_switches[base]
            sw_b = self.access_switches[base + 1]

            for port_idx, sw in enumerate([sw_a, sw_b], 1):
                try:
                    sw_port = sw.get_downlink_port()
                    srv_prefix = server.port_prefix or f"{self.network_name}口"
                    srv_port = f"{srv_prefix}{port_idx}"

                    conn_down = Connection(
                        a_device=server.name, a_port=srv_port, a_module=self.downlink_speed,
                        z_device=sw.name, z_port=sw_port, z_module=self.downlink_speed,
                        cable_type=self.cable_server_access,
                        description=f"服务器到{self.network_name}接入",
                        a_cabinet_id=server.cabinet_id, a_cabinet_name=server.cabinet_name,
                        a_start_u=server.start_u, a_end_u=server.end_u,
                        z_cabinet_id=sw.cabinet_id, z_cabinet_name=sw.cabinet_name,
                        z_start_u=sw.start_u, z_end_u=sw.end_u,
                        network_type=self.network_type,
                    )
                    conn_up = Connection(
                        a_device=sw.name, a_port=sw_port, a_module=self.downlink_speed,
                        z_device=server.name, z_port=srv_port, z_module=self.downlink_speed,
                        cable_type=self.cable_server_access,
                        description=f"{self.network_name}接入到服务器",
                        a_cabinet_id=sw.cabinet_id, a_cabinet_name=sw.cabinet_name,
                        a_start_u=sw.start_u, a_end_u=sw.end_u,
                        z_cabinet_id=server.cabinet_id, z_cabinet_name=server.cabinet_name,
                        z_start_u=server.start_u, z_end_u=server.end_u,
                        network_type=self.network_type,
                    )
                    server.add_connection(conn_down)
                    sw.add_connection(conn_up)
                except ValueError as e:
                    print(f"警告: {str(e)}")
                    continue

    def _connect_access_to_agg(self):
        """接入交换机到汇聚交换机 - 轮转分配"""
        if not self.agg_switches:
            return

        agg_capacity = [self.agg_down_ports] * len(self.agg_switches)
        agg_used = [0] * len(self.agg_switches)

        for acc_idx, acc_sw in enumerate(self.access_switches):
            uplinks_needed = self.access_up_ports
            agg_offset = (acc_idx * uplinks_needed) % len(self.agg_switches)

            for i in range(uplinks_needed):
                agg_idx = (agg_offset + i) % len(self.agg_switches)
                if agg_used[agg_idx] >= agg_capacity[agg_idx]:
                    continue

                try:
                    acc_port = acc_sw.get_uplink_port()
                    agg_port = self.agg_switches[agg_idx].get_downlink_port()
                    agg_used[agg_idx] += 1

                    conn_to_agg = Connection(
                        a_device=acc_sw.name, a_port=acc_port, a_module=self.uplink_speed,
                        z_device=self.agg_switches[agg_idx].name,
                        z_port=agg_port, z_module=self.uplink_speed,
                        cable_type=self.cable_access_agg,
                        description=f"{self.network_name}接入到汇聚",
                        a_cabinet_id=acc_sw.cabinet_id, a_cabinet_name=acc_sw.cabinet_name,
                        a_start_u=acc_sw.start_u, a_end_u=acc_sw.end_u,
                        z_cabinet_id=self.agg_switches[agg_idx].cabinet_id,
                        z_cabinet_name=self.agg_switches[agg_idx].cabinet_name,
                        z_start_u=self.agg_switches[agg_idx].start_u,
                        z_end_u=self.agg_switches[agg_idx].end_u,
                        network_type=self.network_type,
                    )
                    conn_from_agg = Connection(
                        a_device=self.agg_switches[agg_idx].name,
                        a_port=agg_port, a_module=self.uplink_speed,
                        z_device=acc_sw.name, z_port=acc_port, z_module=self.uplink_speed,
                        cable_type=self.cable_access_agg,
                        description=f"{self.network_name}汇聚到接入",
                        a_cabinet_id=self.agg_switches[agg_idx].cabinet_id,
                        a_cabinet_name=self.agg_switches[agg_idx].cabinet_name,
                        a_start_u=self.agg_switches[agg_idx].start_u,
                        a_end_u=self.agg_switches[agg_idx].end_u,
                        z_cabinet_id=acc_sw.cabinet_id, z_cabinet_name=acc_sw.cabinet_name,
                        z_start_u=acc_sw.start_u, z_end_u=acc_sw.end_u,
                        network_type=self.network_type,
                    )
                    acc_sw.add_connection(conn_to_agg)
                    self.agg_switches[agg_idx].add_connection(conn_from_agg)
                except ValueError as e:
                    print(f"警告: {str(e)}")
                    continue
