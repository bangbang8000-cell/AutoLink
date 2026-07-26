"""
AutoLink V1.1 - 网络设计协调层
NetworkDesigner: 整合参数网络和存储网络的拓扑设计
"""

import math
import os
import configparser
from models import NetworkObject
from topology import FatTreeTopology, AccessAggTopology, calc_max_2tier


class NetworkDesigner:
    """网络设计器 - 协调参数网络和存储网络的创建与连接"""

    def __init__(self, config_file="network_config.ini"):
        # 加载配置文件
        self.config = configparser.ConfigParser()
        if os.path.exists(config_file):
            with open(config_file, 'r', encoding='utf-8') as f:
                self.config.read_file(f)
        else:
            self.config['DEFAULT'] = {
                'num_servers': '256',
                'param_ports_per_server': '8',
                'storage_ports_per_server': '1',
                'param_switch_ports': '64',
                'storage_switch_ports': '40',
                'param_speed': '400G',
                'storage_speed': '200G',
                'cable_param_server_leaf': 'MPO',
                'cable_param_leaf_spine': 'MPO',
                'cable_param_spine_core': 'MPO',
                'cable_storage_server_leaf': 'MPO',
                'cable_storage_leaf_spine': 'MPO',
                'cable_storage_spine_core': 'MPO'
            }

        # OOB配置
        self.oob_enabled = self.config.getboolean('DEFAULT', 'oob_enabled', fallback=False)
        self.oob_access_ports = int(self.config.get('DEFAULT', 'oob_access_ports', fallback=48))
        self.oob_access_uplinks = int(self.config.get('DEFAULT', 'oob_access_uplinks', fallback=2))
        self.oob_agg_ports = int(self.config.get('DEFAULT', 'oob_agg_ports', fallback=48))
        self.oob_speed = self.config.get('DEFAULT', 'oob_speed', fallback='1G')
        self.oob_uplink_speed = self.config.get('DEFAULT', 'oob_uplink_speed', fallback='10G')
        self.cable_oob_server_access = self.config.get('DEFAULT', 'cable_oob_server_access', fallback='网线')
        self.cable_oob_access_agg = self.config.get('DEFAULT', 'cable_oob_access_agg', fallback='光纤')

        # 业务网络配置
        self.biz_enabled = self.config.getboolean('DEFAULT', 'biz_enabled', fallback=False)
        self.biz_port_speed = self.config.get('DEFAULT', 'biz_port_speed', fallback='25G')
        self.biz_access_ports = int(self.config.get('DEFAULT', 'biz_access_ports', fallback=48))
        self.biz_access_uplinks = int(self.config.get('DEFAULT', 'biz_access_uplinks', fallback=8))
        self.biz_uplink_speed = self.config.get('DEFAULT', 'biz_uplink_speed', fallback='100G')
        self.biz_agg_box_ports = int(self.config.get('DEFAULT', 'biz_agg_box_ports', fallback=32))
        self.biz_agg_chassis_ports = int(self.config.get('DEFAULT', 'biz_agg_chassis_ports', fallback=32))
        self.cable_biz_server_access = self.config.get('DEFAULT', 'cable_biz_server_access', fallback='光纤')
        self.cable_biz_access_agg = self.config.get('DEFAULT', 'cable_biz_access_agg', fallback='光纤')

        # 解析配置
        self.num_servers = int(self.config.get('DEFAULT', 'num_servers', fallback=256))
        self.param_ports_per_server = int(self.config.get('DEFAULT', 'param_ports_per_server', fallback=8))
        self.storage_ports_per_server = int(self.config.get('DEFAULT', 'storage_ports_per_server', fallback=1))
        self.param_switch_ports = int(self.config.get('DEFAULT', 'param_switch_ports', fallback=64))
        self.storage_switch_ports = int(self.config.get('DEFAULT', 'storage_switch_ports', fallback=40))
        self.param_speed = self.config.get('DEFAULT', 'param_speed', fallback="400G")
        self.storage_speed = self.config.get('DEFAULT', 'storage_speed', fallback="200G")

        # 线缆类型配置
        self.cable_types = {
            'param': {
                'server_leaf': self.config.get('DEFAULT', 'cable_param_server_leaf', fallback='MPO'),
                'leaf_spine': self.config.get('DEFAULT', 'cable_param_leaf_spine', fallback='MPO'),
                'spine_core': self.config.get('DEFAULT', 'cable_param_spine_core', fallback='MPO')
            },
            'storage': {
                'server_leaf': self.config.get('DEFAULT', 'cable_storage_server_leaf', fallback='MPO'),
                'leaf_spine': self.config.get('DEFAULT', 'cable_storage_leaf_spine', fallback='MPO'),
                'spine_core': self.config.get('DEFAULT', 'cable_storage_spine_core', fallback='MPO')
            }
        }

        # 网络对象存储
        self.servers = []
        self.param_leaves = []
        self.param_spines = []
        self.param_cores = []
        self.storage_leaves = []
        self.storage_spines = []
        self.storage_cores = []

        # OOB交换机
        self.oob_access = []
        self.oob_agg = []
        self.oob_info = {}

        # 业务网络交换机
        self.biz_access = []
        self.biz_agg = []
        self.biz_info = {}

        # 组映射
        self.server_groups = {}
        self.switch_groups = {}
        self.podid_map = {}

        # 执行设计流程
        self.calc_network_hierarchy()
        self.create_network_objects()
        self.generate_connections()

        # OOB和业务网络 (在服务器对象创建后执行)
        if self.oob_enabled:
            self._design_oob_network()
        if self.biz_enabled:
            self._design_biz_network()

    def calc_network_hierarchy(self):
        """计算网络层次结构（参数和存储网络）"""
        # 参数网络
        param_topology = FatTreeTopology(
            self.param_ports_per_server, self.param_switch_ports,
            self.param_speed, self.cable_types['param'], "param"
        )

        self.param_3tier_needed, param_leaves, param_spines, param_cores = \
            param_topology.calculate_hierarchy(self.num_servers)

        if self.param_3tier_needed:
            self.param_leaf_count = param_leaves
            self.param_spine_count = param_spines
            self.param_core_count = param_cores
            max_2tier = calc_max_2tier(self.param_switch_ports, self.param_ports_per_server)
            self.param_pods = math.ceil(self.num_servers / max_2tier)
            self.param_servers_per_pod = min(max_2tier, self.num_servers)
        else:
            self.param_servers_per_group = min(self.param_switch_ports // 2, self.num_servers)
            self.param_groups = math.ceil(self.num_servers / self.param_servers_per_group)
            self.param_leaf_per_group = self.param_ports_per_server
            self.param_leaf_count = self.param_groups * self.param_leaf_per_group
            self.param_spine_count = max(1, self.param_leaf_count // 2)
            self.param_core_count = 0
            self.param_pods = 0
            self.param_servers_per_pod = 0

        # 存储网络
        storage_topology = FatTreeTopology(
            self.storage_ports_per_server, self.storage_switch_ports,
            self.storage_speed, self.cable_types['storage'], "storage"
        )

        self.storage_3tier_needed, storage_leaves, storage_spines, storage_cores = \
            storage_topology.calculate_hierarchy(self.num_servers)

        if self.storage_3tier_needed:
            self.storage_leaf_count = storage_leaves
            self.storage_spine_count = storage_spines
            self.storage_core_count = storage_cores
            max_2tier = calc_max_2tier(self.storage_switch_ports, self.storage_ports_per_server)
            self.storage_pods = math.ceil(self.num_servers / max_2tier)
            self.storage_servers_per_pod = min(max_2tier, self.num_servers)
        else:
            self.storage_servers_per_group = min(self.storage_switch_ports // 2, self.num_servers)
            self.storage_groups = math.ceil(self.num_servers / self.storage_servers_per_group)
            self.storage_leaf_per_group = self.storage_ports_per_server
            self.storage_leaf_count = self.storage_groups * self.storage_leaf_per_group
            self.storage_spine_count = max(1, self.storage_leaf_count // 2)
            self.storage_core_count = 0
            self.storage_pods = 0
            self.storage_servers_per_pod = 0

    def create_network_objects(self):
        """创建网络设备对象"""
        # 创建服务器
        for server_idx in range(1, self.num_servers + 1):
            if self.param_3tier_needed:
                pod_id = (server_idx - 1) // self.param_servers_per_pod + 1
                group_name = f"服务器POD{pod_id}"
                podid = f"pod-{pod_id}"
            else:
                group_id = (server_idx - 1) // self.param_servers_per_group + 1
                group_name = f"服务器组{group_id}"
                podid = f"pod-{group_id}"

            server = NetworkObject(
                name=f"GPU服务器_{server_idx}",
                obj_type='server',
                group=group_name,
                podid=podid
            )
            self.servers.append(server)
            self.server_groups[server.name] = group_name
            self.podid_map[server.name] = podid

        # 参数网络交换机
        if self.param_3tier_needed:
            param_topology = FatTreeTopology(
                self.param_ports_per_server, self.param_switch_ports,
                self.param_speed, self.cable_types['param'], "param"
            )
            param_topology.create_network_objects(self.param_pods, self.param_servers_per_pod)
            self.param_leaves = param_topology.leaves
            self.param_spines = param_topology.spines
            self.param_cores = param_topology.cores
            self.switch_groups.update(param_topology.switch_groups)
            self.podid_map.update(param_topology.podid_map)
        else:
            self._create_param_2tier_switches()

        # 存储网络交换机
        if self.storage_3tier_needed:
            storage_topology = FatTreeTopology(
                self.storage_ports_per_server, self.storage_switch_ports,
                self.storage_speed, self.cable_types['storage'], "storage"
            )
            storage_topology.create_network_objects(self.storage_pods, self.storage_servers_per_pod)
            self.storage_leaves = storage_topology.leaves
            self.storage_spines = storage_topology.spines
            self.storage_cores = storage_topology.cores
            self.switch_groups.update(storage_topology.switch_groups)
            self.podid_map.update(storage_topology.podid_map)
        else:
            self._create_storage_2tier_switches()

    def _create_param_2tier_switches(self):
        """创建参数网络二层交换机"""
        for group in range(1, self.param_groups + 1):
            for leaf_idx in range(1, self.param_leaf_per_group + 1):
                leaf_name = f"参数Leaf_G{group}_{leaf_idx}"
                leaf = NetworkObject(
                    name=leaf_name, obj_type='param_leaf',
                    group=f"参数Leaf组{group}",
                    max_ports=self.param_switch_ports,
                    podid=f"pod-{group}"
                )
                self.param_leaves.append(leaf)
                self.switch_groups[leaf_name] = leaf.group
                self.podid_map[leaf_name] = leaf.podid

        for spine_idx in range(1, self.param_spine_count + 1):
            spine_name = f"参数Spine_{spine_idx}"
            spine = NetworkObject(
                name=spine_name, obj_type='param_spine',
                group="参数Spine组",
                max_ports=self.param_switch_ports,
                podid="superpod"
            )
            self.param_spines.append(spine)
            self.switch_groups[spine_name] = spine.group
            self.podid_map[spine_name] = spine.podid

    def _create_storage_2tier_switches(self):
        """创建存储网络二层交换机"""
        for group in range(1, self.storage_groups + 1):
            for leaf_idx in range(1, self.storage_leaf_per_group + 1):
                leaf_name = f"存储Leaf_G{group}_{leaf_idx}"
                leaf = NetworkObject(
                    name=leaf_name, obj_type='storage_leaf',
                    group=f"存储Leaf组{group}",
                    max_ports=self.storage_switch_ports,
                    podid=f"pod-{group}"
                )
                self.storage_leaves.append(leaf)
                self.switch_groups[leaf_name] = leaf.group
                self.podid_map[leaf_name] = leaf.podid

        for spine_idx in range(1, self.storage_spine_count + 1):
            spine_name = f"存储Spine_{spine_idx}"
            spine = NetworkObject(
                name=spine_name, obj_type='storage_spine',
                group="存储Spine组",
                max_ports=self.storage_switch_ports,
                podid="superpod"
            )
            self.storage_spines.append(spine)
            self.switch_groups[spine_name] = spine.group
            self.podid_map[spine_name] = spine.podid

    def generate_connections(self):
        """生成网络连接"""
        # 参数网络连接
        if self.param_3tier_needed:
            param_topology = FatTreeTopology(
                self.param_ports_per_server, self.param_switch_ports,
                self.param_speed, self.cable_types['param'], "param"
            )
            param_topology.leaves = self.param_leaves
            param_topology.spines = self.param_spines
            param_topology.cores = self.param_cores
            param_topology.generate_connections(self.servers, self.param_pods, self.param_servers_per_pod)
        else:
            self._generate_param_2tier_connections()

        # 存储网络连接
        if self.storage_3tier_needed:
            storage_topology = FatTreeTopology(
                self.storage_ports_per_server, self.storage_switch_ports,
                self.storage_speed, self.cable_types['storage'], "storage"
            )
            storage_topology.leaves = self.storage_leaves
            storage_topology.spines = self.storage_spines
            storage_topology.cores = self.storage_cores
            storage_topology.generate_connections(self.servers, self.storage_pods, self.storage_servers_per_pod)
        else:
            self._generate_storage_2tier_connections()

    def _generate_param_2tier_connections(self):
        """生成参数网络二层组网连接"""
        from models import Connection

        for server in self.servers:
            server_idx = int(server.name.split('_')[1])
            group_id = (server_idx - 1) // self.param_servers_per_group + 1

            for port_idx in range(1, self.param_ports_per_server + 1):
                leaf_name = f"参数Leaf_G{group_id}_{port_idx}"
                leaf = next((l for l in self.param_leaves if l.name == leaf_name), None)
                if not leaf:
                    continue

                try:
                    server_port = f"参数网卡{port_idx}"
                    leaf_port = leaf.get_downlink_port()

                    conn_down = Connection(
                        a_device=server.name, a_port=server_port, a_module=self.param_speed,
                        z_device=leaf.name, z_port=leaf_port, z_module=self.param_speed,
                        cable_type=self.cable_types['param']['server_leaf'],
                        description="服务器到参数Leaf"
                    )
                    conn_up = Connection(
                        a_device=leaf.name, a_port=leaf_port, a_module=self.param_speed,
                        z_device=server.name, z_port=server_port, z_module=self.param_speed,
                        cable_type=self.cable_types['param']['server_leaf'],
                        description="参数Leaf到服务器"
                    )

                    server.add_connection(conn_down)
                    leaf.add_connection(conn_up)

                except ValueError as e:
                    print(f"警告: {str(e)}")
                    continue

        for leaf in self.param_leaves:
            max_uplinks = leaf.uplink_limit - leaf.uplink_counter + 1
            spines_per_leaf = min(max_uplinks, self.param_spine_count)

            for spine_idx in range(1, spines_per_leaf + 1):
                spine_name = f"参数Spine_{spine_idx}"
                spine = next((s for s in self.param_spines if s.name == spine_name), None)
                if not spine:
                    continue

                try:
                    leaf_port = leaf.get_uplink_port()
                    spine_port = spine.get_downlink_port()

                    conn_leaf_to_spine = Connection(
                        a_device=leaf.name, a_port=leaf_port, a_module=self.param_speed,
                        z_device=spine.name, z_port=spine_port, z_module=self.param_speed,
                        cable_type=self.cable_types['param']['leaf_spine'],
                        description="参数Leaf到Spine"
                    )
                    conn_spine_to_leaf = Connection(
                        a_device=spine.name, a_port=spine_port, a_module=self.param_speed,
                        z_device=leaf.name, z_port=leaf_port, z_module=self.param_speed,
                        cable_type=self.cable_types['param']['leaf_spine'],
                        description="参数Spine到Leaf"
                    )

                    leaf.add_connection(conn_leaf_to_spine)
                    spine.add_connection(conn_spine_to_leaf)

                except ValueError as e:
                    print(f"警告: {str(e)}")
                    continue

    def _generate_storage_2tier_connections(self):
        """生成存储网络二层组网连接"""
        from models import Connection

        for server in self.servers:
            server_idx = int(server.name.split('_')[1])
            group_id = (server_idx - 1) // self.storage_servers_per_group + 1

            for port_idx in range(1, self.storage_ports_per_server + 1):
                leaf_name = f"存储Leaf_G{group_id}_{port_idx}"
                leaf = next((l for l in self.storage_leaves if l.name == leaf_name), None)
                if not leaf:
                    continue

                try:
                    server_port = f"存储网卡{port_idx}"
                    leaf_port = leaf.get_downlink_port()

                    conn_down = Connection(
                        a_device=server.name, a_port=server_port, a_module=self.storage_speed,
                        z_device=leaf.name, z_port=leaf_port, z_module=self.storage_speed,
                        cable_type=self.cable_types['storage']['server_leaf'],
                        description="服务器到存储"
                    )
                    conn_up = Connection(
                        a_device=leaf.name, a_port=leaf_port, a_module=self.storage_speed,
                        z_device=server.name, z_port=server_port, z_module=self.storage_speed,
                        cable_type=self.cable_types['storage']['server_leaf'],
                        description="存储下行连接"
                    )

                    server.add_connection(conn_down)
                    leaf.add_connection(conn_up)

                except ValueError as e:
                    print(f"警告: {str(e)}")
                    continue

        for leaf in self.storage_leaves:
            max_uplinks = leaf.uplink_limit - leaf.uplink_counter + 1
            spines_per_leaf = min(max_uplinks, self.storage_spine_count)

            for spine_idx in range(1, spines_per_leaf + 1):
                spine_name = f"存储Spine_{spine_idx}"
                spine = next((s for s in self.storage_spines if s.name == spine_name), None)
                if not spine:
                    continue

                try:
                    leaf_port = leaf.get_uplink_port()
                    spine_port = spine.get_downlink_port()

                    conn_leaf_to_spine = Connection(
                        a_device=leaf.name, a_port=leaf_port, a_module=self.storage_speed,
                        z_device=spine.name, z_port=spine_port, z_module=self.storage_speed,
                        cable_type=self.cable_types['storage']['leaf_spine'],
                        description="存储网络上联"
                    )
                    conn_spine_to_leaf = Connection(
                        a_device=spine.name, a_port=spine_port, a_module=self.storage_speed,
                        z_device=leaf.name, z_port=leaf_port, z_module=self.storage_speed,
                        cable_type=self.cable_types['storage']['leaf_spine'],
                        description="存储网络下联"
                    )

                    leaf.add_connection(conn_leaf_to_spine)
                    spine.add_connection(conn_spine_to_leaf)

                except ValueError as e:
                    print(f"警告: {str(e)}")
                    continue

    def validate_topology(self):
        """自检拓扑合法性：检查服务器覆盖率、端口溢出、连接完整性"""
        print("\n" + "=" * 60)
        print("拓扑自检")
        print("=" * 60)

        errors = []

        param_nic_total = self.num_servers * self.param_ports_per_server
        storage_nic_total = self.num_servers * self.storage_ports_per_server
        oob_total = self.num_servers * (1 if self.oob_enabled else 0)
        biz_total = self.num_servers * (2 if self.biz_enabled else 0)
        param_conn_count = 0
        storage_conn_count = 0
        oob_conn_count = 0
        biz_conn_count = 0
        servers_with_param = set()
        servers_with_storage = set()

        for server in self.servers:
            for conn in server.connections:
                if conn.a_device == server.name:
                    if "参数" in conn.a_port:
                        param_conn_count += 1
                        servers_with_param.add(server.name)
                    elif "存储" in conn.a_port:
                        storage_conn_count += 1
                        servers_with_storage.add(server.name)

        if param_conn_count != param_nic_total:
            errors.append(f"参数网连接数不足: {param_conn_count}/{param_nic_total}")
        if storage_conn_count != storage_nic_total:
            errors.append(f"存储网连接数不足: {storage_conn_count}/{storage_nic_total}")
        if len(servers_with_param) != self.num_servers:
            errors.append(f"参数网覆盖服务器数不足: {len(servers_with_param)}/{self.num_servers}")
        if len(servers_with_storage) != self.num_servers:
            errors.append(f"存储网覆盖服务器数不足: {len(servers_with_storage)}/{self.num_servers}")

        all_switches = (self.param_leaves + self.param_spines + self.param_cores +
                       self.storage_leaves + self.storage_spines + self.storage_cores +
                       self.oob_access + self.oob_agg +
                       self.biz_access + self.biz_agg)
        for sw in all_switches:
            if len(sw.connections) > sw.max_ports:
                errors.append(f"{sw.name} 端口溢出: {len(sw.connections)}/{sw.max_ports}")

        if self.param_3tier_needed and self.param_spine_count != self.param_leaf_count:
            errors.append(f"参数网Leaf:Spine比例不为1:1 ({self.param_leaf_count}:{self.param_spine_count})")
        if self.storage_3tier_needed and self.storage_spine_count != self.storage_leaf_count:
            errors.append(f"存储网Leaf:Spine比例不为1:1 ({self.storage_leaf_count}:{self.storage_spine_count})")

        if errors:
            print("发现以下问题:")
            for e in errors:
                print(f"  [错误] {e}")
        else:
            print("拓扑自检通过 - 无端口溢出，服务器全覆盖")

        return len(errors) == 0

    def _design_oob_network(self):
        """设计带外管理网络"""
        topo = AccessAggTopology(
            access_down_ports=self.oob_access_ports,
            access_up_ports=self.oob_access_uplinks,
            agg_down_ports=self.oob_agg_ports,
            downlink_speed=self.oob_speed,
            uplink_speed=self.oob_uplink_speed,
            cable_server_access=self.cable_oob_server_access,
            cable_access_agg=self.cable_oob_access_agg,
            network_name="OOB",
            redundancy=False
        )
        self.oob_info = topo.calculate(self.num_servers)
        topo.create_and_connect(self.servers, self.oob_info['num_access'], self.oob_info['num_agg'])
        self.oob_access = topo.access_switches
        self.oob_agg = topo.agg_switches
        self.switch_groups.update(topo.switch_groups)
        self.podid_map.update(topo.podid_map)

    def _design_biz_network(self):
        """设计业务网络"""
        topo = AccessAggTopology(
            access_down_ports=self.biz_access_ports,
            access_up_ports=self.biz_access_uplinks,
            agg_down_ports=self.biz_agg_box_ports,  # 盒式默认
            downlink_speed=self.biz_port_speed,
            uplink_speed=self.biz_uplink_speed,
            cable_server_access=self.cable_biz_server_access,
            cable_access_agg=self.cable_biz_access_agg,
            network_name="业务",
            redundancy=True  # MLAG双接入
        )

        # 汇聚层选型：>128用框式
        chassis_config = None
        if self.num_servers > 128:
            if self.num_servers <= 512:
                frames = 4
            elif self.num_servers <= 1024:
                frames = 8
            else:
                frames = 18
            chassis_config = {'enabled': True, 'frames': frames}
            topo.agg_down_ports = self.biz_agg_chassis_ports

        self.biz_info = topo.calculate(self.num_servers, chassis_config)
        topo.create_and_connect(self.servers, self.biz_info['num_access'], self.biz_info['num_agg'])
        self.biz_access = topo.access_switches
        self.biz_agg = topo.agg_switches
        self.switch_groups.update(topo.switch_groups)
        self.podid_map.update(topo.podid_map)

    def print_summary(self):
        """打印网络设计摘要"""
        print("\n" + "=" * 60)
        print("网络设计摘要")
        print("=" * 60)
        print(f"GPU服务器数量: {self.num_servers}")
        print(f"每台服务器参数网卡数: {self.param_ports_per_server}")
        print(f"每台服务器存储网卡数: {self.storage_ports_per_server}\n")

        half_ports = self.param_switch_ports // 2
        if self.param_3tier_needed:
            servers_per_group = min(self.param_servers_per_pod // self.param_ports_per_server, half_ports)
            param_downlink_usage = f"{servers_per_group}/{half_ports} ({servers_per_group / half_ports * 100:.1f}%)"
            param_uplink_usage = f"{half_ports}/{half_ports} (100.0%)"
            param_port_usage = f"下联:{param_downlink_usage}, 上联:{param_uplink_usage}"
        else:
            param_downlink_usage = f"{self.param_servers_per_group}/{half_ports} ({self.param_servers_per_group / half_ports * 100:.1f}%)"
            uplinks_used = min(half_ports, self.param_spine_count)
            param_uplink_usage = f"{uplinks_used}/{half_ports} ({uplinks_used / half_ports * 100:.1f}%)"
            param_port_usage = f"下联:{param_downlink_usage}, 上联:{param_uplink_usage}"

        half_ports = self.storage_switch_ports // 2
        if self.storage_3tier_needed:
            servers_per_group = min(self.storage_servers_per_pod // self.storage_ports_per_server, half_ports)
            storage_downlink_usage = f"{servers_per_group}/{half_ports} ({servers_per_group / half_ports * 100:.1f}%)"
            storage_uplink_usage = f"{half_ports}/{half_ports} (100.0%)"
            storage_port_usage = f"下联:{storage_downlink_usage}, 上联:{storage_uplink_usage}"
        else:
            storage_downlink_usage = f"{self.storage_servers_per_group}/{half_ports} ({self.storage_servers_per_group / half_ports * 100:.1f}%)"
            uplinks_used = min(half_ports, self.storage_spine_count)
            storage_uplink_usage = f"{uplinks_used}/{half_ports} ({uplinks_used / half_ports * 100:.1f}%)"
            storage_port_usage = f"下联:{storage_downlink_usage}, 上联:{storage_uplink_usage}"

        print("参数网络:")
        print(f"  Leaf交换机数量: {self.param_leaf_count}")
        print(f"  Spine交换机数量: {self.param_spine_count}")
        if self.param_3tier_needed:
            print(f"  Core交换机数量: {self.param_core_count}")
            print(f"  网络层级: 3层(Leaf-Spine-Core)")
            print(f"  POD数量: {self.param_pods}, 每POD服务器数: {self.param_servers_per_pod}")
            print(f"  收敛比例: 1:1:1")
        else:
            print(f"  网络层级: 2层(Leaf-Spine)")
            print(f"  组数量: {self.param_groups}, 每组服务器数: {self.param_servers_per_group}")
            print(f"  收敛比例: 1:1")
        print(f"  交换机端口数: {self.param_switch_ports}")
        print(f"  端口使用率: {param_port_usage}")
        print(f"  网络速度: {self.param_speed}\n")

        print("存储网络:")
        print(f"  Leaf交换机数量: {self.storage_leaf_count}")
        print(f"  Spine交换机数量: {self.storage_spine_count}")
        if self.storage_3tier_needed:
            print(f"  Core交换机数量: {self.storage_core_count}")
            print(f"  网络层级: 3层(Leaf-Spine-Core)")
            print(f"  POD数量: {self.storage_pods}, 每POD服务器数: {self.storage_servers_per_pod}")
            print(f"  收敛比例: 1:1:1")
        else:
            print(f"  网络层级: 2层(Leaf-Spine)")
            print(f"  组数量: {self.storage_groups}, 每组服务器数: {self.storage_servers_per_group}")
            print(f"  收敛比例: 1:1")
        print(f"  交换机端口数: {self.storage_switch_ports}")
        print(f"  端口使用率: {storage_port_usage}")
        print(f"  网络速度: {self.storage_speed}")

        if self.oob_enabled and self.oob_info:
            info = self.oob_info
            print(f"\n带外管理网络(OOB):")
            print(f"  接入交换机数量: {info['num_access']}")
            print(f"  汇聚交换机数量: {info['num_agg']}")
            print(f"  每接入覆盖: {info['servers_per_access']}台服务器")
            print(f"  下联速度: {self.oob_speed}, 上联速度: {self.oob_uplink_speed}")

        if self.biz_enabled and self.biz_info:
            info = self.biz_info
            print(f"\n业务网络(Business):")
            print(f"  接入交换机数量: {info['num_access']} (MLAG配对)")
            print(f"  汇聚交换机: {info['agg_type']}")
            print(f"  每接入对覆盖: {info['servers_per_access']}台服务器")
            print(f"  下联速度: {self.biz_port_speed}, 上联速度: {self.biz_uplink_speed}")
            print(f"  接入上联总带宽: {info['total_access_uplinks']}×{self.biz_uplink_speed}")
            print(f"  汇聚总端口: {info['total_agg_ports']}×{self.biz_uplink_speed}")

        print("=" * 60)
