"""
AutoLink V2.0 - 统一网络设计协调层
支持 full(满接) 和 custom(自定义下行口数) 两种模式
"""
import math, os, configparser
from models import NetworkObject, Connection
from topology import FatTreeTopology, AccessAggTopology, calc_max_2tier


class NetworkDesignerV2:
    """统一网络设计器 - 支持 full/custom 双模式"""

    def __init__(self, config_file="network_config.ini"):
        self.config = configparser.ConfigParser()
        if os.path.exists(config_file):
            with open(config_file, 'r', encoding='utf-8') as f:
                self.config.read_file(f)

        # --- 下行端口模式 ---
        self.downlink_mode = self.config.get('DEFAULT', 'downlink_mode', fallback='custom')
        self._resolve_downlink_limits()

        # --- 通用配置 ---
        self._load_common_config()

        # --- 网络对象存储 ---
        self.servers = []
        self.param_leaves, self.param_spines, self.param_cores = [], [], []
        self.storage_leaves, self.storage_spines, self.storage_cores = [], [], []
        self.oob_access, self.oob_agg, self.oob_info = [], [], {}
        self.biz_access, self.biz_agg, self.biz_info = [], [], {}
        self.server_groups, self.switch_groups, self.podid_map = {}, {}, {}

        # --- 执行设计 ---
        self.calc_network_hierarchy()
        self.create_network_objects()
        self.generate_connections()
        if self.oob_enabled:
            self._design_oob_network()
        if self.biz_enabled:
            self._design_biz_network()

    # ================================================================
    #  下行端口解析
    # ================================================================
    def _resolve_downlink_limits(self):
        """根据 mode 解析各网络下行口数"""
        if self.downlink_mode == 'full':
            # full模式: 满接 (参数/存储=一半口, 业务=45, OOB=48)
            ps = int(self.config.get('DEFAULT', 'param_switch_ports', fallback=64))
            ss = int(self.config.get('DEFAULT', 'storage_switch_ports', fallback=40))
            self.param_dl = ps // 2
            self.storage_dl = ss // 2
            self.biz_dl = 45
            self.oob_dl = 48
        else:
            # custom模式: 读取配置
            ps = int(self.config.get('DEFAULT', 'param_switch_ports', fallback=64))
            ss = int(self.config.get('DEFAULT', 'storage_switch_ports', fallback=40))
            self.param_dl = int(self.config.get('DEFAULT', 'param_downlink_limit',
                                                 fallback=ps // 2))
            self.storage_dl = int(self.config.get('DEFAULT', 'storage_downlink_limit',
                                                   fallback=ss // 2))
            self.biz_dl = int(self.config.get('DEFAULT', 'biz_downlink_limit', fallback=48))
            self.oob_dl = int(self.config.get('DEFAULT', 'oob_downlink_limit', fallback=48))

    def _load_common_config(self):
        """加载通用配置"""
        self.num_servers = int(self.config.get('DEFAULT', 'num_servers', fallback=100))
        self.additional_storage = int(self.config.get('DEFAULT', 'additional_storage_servers', fallback=0))
        self.additional_compute = int(self.config.get('DEFAULT', 'additional_compute_servers', fallback=0))
        self.total_servers = self.num_servers + self.additional_storage + self.additional_compute

        self.param_ports_per_server = int(self.config.get('DEFAULT', 'param_ports_per_server', fallback=8))
        self.storage_ports_per_server = int(self.config.get('DEFAULT', 'storage_ports_per_server', fallback=1))
        self.param_switch_ports = int(self.config.get('DEFAULT', 'param_switch_ports', fallback=64))
        self.storage_switch_ports = int(self.config.get('DEFAULT', 'storage_switch_ports', fallback=40))
        self.param_speed = self.config.get('DEFAULT', 'param_speed', fallback="400G")
        self.storage_speed = self.config.get('DEFAULT', 'storage_speed', fallback="200G")

        self.cable_types = {
            'param': {
                'server_leaf': self.config.get('DEFAULT', 'cable_param_server_leaf', fallback='MPO'),
                'leaf_spine': self.config.get('DEFAULT', 'cable_param_leaf_spine', fallback='MPO'),
                'spine_core': self.config.get('DEFAULT', 'cable_param_spine_core', fallback='MPO')
            },
            'storage': {
                'server_leaf': self.config.get('DEFAULT', 'cable_storage_server_leaf', fallback='AOC'),
                'leaf_spine': self.config.get('DEFAULT', 'cable_storage_leaf_spine', fallback='AOC'),
                'spine_core': self.config.get('DEFAULT', 'cable_storage_spine_core', fallback='MPO')
            }
        }

        # OOB
        self.oob_enabled = self.config.getboolean('DEFAULT', 'oob_enabled', fallback=True)
        self.oob_access_ports = int(self.config.get('DEFAULT', 'oob_access_ports', fallback=48))
        self.oob_access_uplinks = int(self.config.get('DEFAULT', 'oob_access_uplinks', fallback=2))
        self.oob_agg_ports = int(self.config.get('DEFAULT', 'oob_agg_ports', fallback=48))
        self.oob_speed = self.config.get('DEFAULT', 'oob_speed', fallback='1G')
        self.oob_uplink_speed = self.config.get('DEFAULT', 'oob_uplink_speed', fallback='10G')
        self.cable_oob_server_access = self.config.get('DEFAULT', 'cable_oob_server_access', fallback='网线')
        self.cable_oob_access_agg = self.config.get('DEFAULT', 'cable_oob_access_agg', fallback='光纤')

        # Business
        self.biz_enabled = self.config.getboolean('DEFAULT', 'biz_enabled', fallback=True)
        self.biz_port_speed = self.config.get('DEFAULT', 'biz_port_speed', fallback='25G')
        self.biz_access_ports = int(self.config.get('DEFAULT', 'biz_access_ports', fallback=48))
        self.biz_access_uplinks = int(self.config.get('DEFAULT', 'biz_access_uplinks', fallback=8))
        self.biz_uplink_speed = self.config.get('DEFAULT', 'biz_uplink_speed', fallback='100G')
        self.biz_agg_box_ports = int(self.config.get('DEFAULT', 'biz_agg_box_ports', fallback=32))
        self.biz_agg_chassis_ports = int(self.config.get('DEFAULT', 'biz_agg_chassis_ports', fallback=32))
        self.cable_biz_server_access = self.config.get('DEFAULT', 'cable_biz_server_access', fallback='光纤')
        self.cable_biz_access_agg = self.config.get('DEFAULT', 'cable_biz_access_agg', fallback='光纤')

    # ================================================================
    #  层次计算
    # ================================================================
    def calc_network_hierarchy(self):
        """计算参数网络和存储网络的层次结构"""
        # --- 参数网络 ---
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
            self.param_servers_per_group = min(self.param_dl, self.num_servers)
            self.param_groups = math.ceil(self.num_servers / self.param_servers_per_group)
            self.param_leaf_per_group = self.param_ports_per_server
            self.param_leaf_count = self.param_groups * self.param_leaf_per_group
            self.param_spine_count = max(1, self.param_leaf_count // 2)
            self.param_core_count = 0
            self.param_pods = 0
            self.param_servers_per_pod = 0

        # --- 存储网络 (自动计算) ---
        self.storage_3tier_needed = False
        self.storage_servers_per_group = min(self.storage_dl, self.total_servers)
        self.storage_groups = math.ceil(self.total_servers / self.storage_servers_per_group)
        self.storage_leaf_per_group = self.storage_ports_per_server
        self.storage_leaf_count = self.storage_groups * self.storage_leaf_per_group
        self.storage_spine_count = max(1, self.storage_leaf_count // 2)
        self.storage_core_count = 0

    # ================================================================
    #  对象创建
    # ================================================================
    def create_network_objects(self):
        """创建服务器和交换机对象"""
        # GPU服务器
        for server_idx in range(1, self.num_servers + 1):
            group_id = (server_idx - 1) // self.param_servers_per_group + 1
            group_name = f"GPU服务器组{group_id}"
            podid = f"pod-gpu-{group_id}"
            s = NetworkObject(name=f"GPU服务器_{server_idx}", obj_type='server',
                              group=group_name, podid=podid)
            self.servers.append(s)
            self.server_groups[s.name] = group_name
            self.podid_map[s.name] = podid

        # 额外存储服务器
        for i in range(1, self.additional_storage + 1):
            s = NetworkObject(name=f"存储服务器_{i}", obj_type='server',
                              group="存储服务器组", podid="pod-storage")
            self.servers.append(s)
            self.server_groups[s.name] = s.group
            self.podid_map[s.name] = s.podid

        # 额外通算服务器
        for i in range(1, self.additional_compute + 1):
            s = NetworkObject(name=f"通算服务器_{i}", obj_type='server',
                              group="通算服务器组", podid="pod-general")
            self.servers.append(s)
            self.server_groups[s.name] = s.group
            self.podid_map[s.name] = s.podid

        # 参数网络交换机
        if self.param_3tier_needed:
            pt = FatTreeTopology(self.param_ports_per_server, self.param_switch_ports,
                                 self.param_speed, self.cable_types['param'], "param")
            pt.create_network_objects(self.param_pods, self.param_servers_per_pod)
            self.param_leaves = pt.leaves
            self.param_spines = pt.spines
            self.param_cores = pt.cores
            self.switch_groups.update(pt.switch_groups)
            self.podid_map.update(pt.podid_map)
        else:
            self._create_param_2tier_switches()

        # 存储网络交换机 (自动计算)
        self._create_storage_switches()

    def _create_param_2tier_switches(self):
        for group in range(1, self.param_groups + 1):
            for leaf_idx in range(1, self.param_leaf_per_group + 1):
                sw = NetworkObject(name=f"参数Leaf_G{group}_{leaf_idx}",
                                   obj_type='param_leaf', group=f"参数Leaf组{group}",
                                   max_ports=self.param_switch_ports, podid=f"pod-gpu-{group}")
                sw.downlink_limit = self.param_dl
                self.param_leaves.append(sw)
                self.switch_groups[sw.name] = sw.group
                self.podid_map[sw.name] = sw.podid
        for i in range(1, self.param_spine_count + 1):
            sw = NetworkObject(name=f"参数Spine_{i}", obj_type='param_spine',
                               group="参数Spine组", max_ports=self.param_switch_ports,
                               podid="superpod")
            self.param_spines.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid

    def _create_storage_switches(self):
        for group in range(1, self.storage_groups + 1):
            for leaf_idx in range(1, self.storage_leaf_per_group + 1):
                sw = NetworkObject(name=f"存储Leaf_{group}_{leaf_idx}",
                                   obj_type='storage_leaf', group=f"存储Leaf组{group}",
                                   max_ports=self.storage_switch_ports,
                                   podid=f"pod-storage-{group}")
                sw.downlink_limit = self.storage_dl
                sw.uplink_counter = self.storage_dl + 1
                self.storage_leaves.append(sw)
                self.switch_groups[sw.name] = sw.group
                self.podid_map[sw.name] = sw.podid
        for i in range(1, self.storage_spine_count + 1):
            sw = NetworkObject(name=f"存储Spine_{i}", obj_type='storage_spine',
                               group="存储Spine组", max_ports=self.storage_switch_ports,
                               podid="superpod")
            self.storage_spines.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid

    # ================================================================
    #  连接生成
    # ================================================================
    def generate_connections(self):
        gpu_servers = self.servers[:self.num_servers]

        if self.param_3tier_needed:
            pt = FatTreeTopology(self.param_ports_per_server, self.param_switch_ports,
                                 self.param_speed, self.cable_types['param'], "param")
            pt.leaves = self.param_leaves
            pt.spines = self.param_spines
            pt.cores = self.param_cores
            pt.generate_connections(gpu_servers, self.param_pods, self.param_servers_per_pod)
        else:
            self._wire_param_2tier(gpu_servers)
        self._wire_storage()

    def _wire_param_2tier(self, gpu_servers):
        """参数网络2tier: GPU→Leaf + Leaf→Spine (每Spine 2×400G)"""
        # Server → Leaf (使用 get_downlink_port)
        for server in gpu_servers:
            sidx = int(server.name.split('_')[1])
            gid = (sidx - 1) // self.param_servers_per_group + 1
            for pi in range(1, self.param_ports_per_server + 1):
                leaf = next((l for l in self.param_leaves
                             if l.name == f"参数Leaf_G{gid}_{pi}"), None)
                if not leaf:
                    continue
                try:
                    sp = f"参数网卡{pi}"
                    lp = leaf.get_downlink_port()
                    self._add_conn(server, sp, self.param_speed, leaf, lp, self.param_speed,
                                   self.cable_types['param']['server_leaf'], "服务器到参数Leaf")
                except ValueError:
                    continue

        # Leaf → Spine: 每Leaf连全部Spine, uplink_ports/spine_count 口/Spine
        uplink_avail = self.param_switch_ports - self.param_dl
        ports_per_spine = uplink_avail // self.param_spine_count
        for leaf in self.param_leaves:
            leaf.uplink_counter = self.param_dl + 1
            leaf.uplink_limit = self.param_switch_ports
            po = self.param_dl + 1
            for si in range(self.param_spine_count):
                for p in range(ports_per_spine):
                    spine = self.param_spines[si]
                    lf = f"端口{po}"
                    spn = ((po - self.param_dl - 1) % spine.downlink_limit) + 1
                    spine.downlink_counter = max(spine.downlink_counter, spn + 1)
                    po += 1
                    self._add_conn(leaf, lf, self.param_speed, spine, f"端口{spn}",
                                   self.param_speed,
                                   self.cable_types['param']['leaf_spine'],
                                   "参数Leaf到Spine")

    def _wire_storage(self):
        """存储网络: 所有服务器→Leaf + Leaf→Spine (每Spine ports_per_spine×200G)"""
        # Server → Leaf: 轮转分配
        servers_per_leaf = math.ceil(self.total_servers / self.storage_leaf_count)
        for si, server in enumerate(self.servers):
            li = si // servers_per_leaf
            if li >= len(self.storage_leaves):
                li = len(self.storage_leaves) - 1
            leaf = self.storage_leaves[li]
            try:
                lp = leaf.get_downlink_port()
                self._add_conn(server, "存储网卡1", self.storage_speed,
                               leaf, lp, self.storage_speed,
                               self.cable_types['storage']['server_leaf'],
                               "服务器到存储Leaf")
            except ValueError:
                continue

        # Leaf → Spine
        uplink_avail = self.storage_switch_ports - self.storage_dl
        ports_per_spine = uplink_avail // self.storage_spine_count
        for leaf in self.storage_leaves:
            leaf.uplink_counter = self.storage_dl + 1
            leaf.uplink_limit = self.storage_switch_ports
            po = self.storage_dl + 1
            for si in range(self.storage_spine_count):
                for p in range(ports_per_spine):
                    spine = self.storage_spines[si]
                    lf = f"端口{po}"
                    spn = ((po - self.storage_dl - 1) % spine.downlink_limit) + 1
                    spine.downlink_counter = max(spine.downlink_counter, spn + 1)
                    po += 1
                    self._add_conn(leaf, lf, self.storage_speed, spine, f"端口{spn}",
                                   self.storage_speed,
                                   self.cable_types['storage']['leaf_spine'],
                                   "存储Leaf到Spine")

    def _add_conn(self, a_dev, a_port, a_mod, z_dev, z_port, z_mod, cable, desc):
        c1 = Connection(a_dev.name, a_port, a_mod, z_dev.name, z_port, z_mod, cable, desc)
        c2 = Connection(z_dev.name, z_port, z_mod, a_dev.name, a_port, a_mod, cable, desc)
        a_dev.add_connection(c1)
        z_dev.add_connection(c2)

    # ================================================================
    #  OOB / 业务
    # ================================================================
    def _design_oob_network(self):
        topo = AccessAggTopology(
            access_down_ports=self.oob_access_ports,
            access_up_ports=self.oob_access_uplinks,
            agg_down_ports=self.oob_agg_ports,
            downlink_speed=self.oob_speed,
            uplink_speed=self.oob_uplink_speed,
            cable_server_access=self.cable_oob_server_access,
            cable_access_agg=self.cable_oob_access_agg,
            network_name="OOB",
            redundancy=False,
            downlink_limit=self.oob_dl
        )
        self.oob_info = topo.calculate(self.total_servers)
        topo.create_and_connect(self.servers, self.oob_info['num_access'],
                                self.oob_info['num_agg'])
        self.oob_access = topo.access_switches
        self.oob_agg = topo.agg_switches
        self.switch_groups.update(topo.switch_groups)
        self.podid_map.update(topo.podid_map)

    def _design_biz_network(self):
        topo = AccessAggTopology(
            access_down_ports=self.biz_access_ports,
            access_up_ports=self.biz_access_uplinks,
            agg_down_ports=self.biz_agg_box_ports,
            downlink_speed=self.biz_port_speed,
            uplink_speed=self.biz_uplink_speed,
            cable_server_access=self.cable_biz_server_access,
            cable_access_agg=self.cable_biz_access_agg,
            network_name="业务",
            redundancy=True,
            downlink_limit=self.biz_dl
        )
        chassis_config = None
        if self.total_servers > 128:
            frames = 4 if self.total_servers <= 512 else 8 if self.total_servers <= 1024 else 18
            chassis_config = {'enabled': True, 'frames': frames}
            topo.agg_down_ports = self.biz_agg_chassis_ports
        self.biz_info = topo.calculate(self.total_servers, chassis_config)
        topo.create_and_connect(self.servers, self.biz_info['num_access'],
                                self.biz_info['num_agg'])
        self.biz_access = topo.access_switches
        self.biz_agg = topo.agg_switches
        self.switch_groups.update(topo.switch_groups)
        self.podid_map.update(topo.podid_map)

    # ================================================================
    #  拓扑验证
    # ================================================================
    def validate_topology(self):
        print("\n" + "=" * 60)
        print("拓扑自检")
        print("=" * 60)
        errors = []
        param_nic_total = self.num_servers * self.param_ports_per_server
        storage_nic_total = self.total_servers * self.storage_ports_per_server
        pc, sc = 0, 0
        sp, ss = set(), set()
        for server in self.servers:
            for conn in server.connections:
                if conn.a_device == server.name:
                    if "参数" in conn.a_port:
                        pc += 1; sp.add(server.name)
                    elif "存储" in conn.a_port:
                        sc += 1; ss.add(server.name)
        if pc != param_nic_total:
            errors.append(f"参数网连接: {pc}/{param_nic_total}")
        if sc != storage_nic_total:
            errors.append(f"存储网连接: {sc}/{storage_nic_total}")
        if len(sp) != self.num_servers:
            errors.append(f"参数网覆盖: {len(sp)}/{self.num_servers}")

        all_sw = (self.param_leaves + self.param_spines + self.param_cores +
                  self.storage_leaves + self.storage_spines + self.storage_cores +
                  self.oob_access + self.oob_agg + self.biz_access + self.biz_agg)
        for sw in all_sw:
            # Spine/汇聚可支持2:1收敛, 连接数可达端口数的2倍
            is_convergence = ('Spine' in sw.name or '汇聚' in sw.name)
            limit = sw.max_ports * 2 if is_convergence else sw.max_ports
            if len(sw.connections) > limit:
                errors.append(f"{sw.name} 端口溢出: {len(sw.connections)}/{sw.max_ports}")
        if errors:
            print("发现以下问题:")
            for e in errors:
                print(f"  [错误] {e}")
        else:
            print("拓扑自检通过 - 无端口溢出，服务器全覆盖")
        return len(errors) == 0

    # ================================================================
    #  摘要
    # ================================================================
    def print_summary(self):
        print("\n" + "=" * 60)
        print("网络设计摘要 (V2.0)")
        print("=" * 60)
        print(f"模式: {self.downlink_mode}")
        print(f"GPU服务器: {self.num_servers}")
        if self.additional_storage or self.additional_compute:
            print(f"  附加: 存储{self.additional_storage} + 通算{self.additional_compute}")
            print(f"  总数: {self.total_servers}")
        print()

        uplink_avail = self.param_switch_ports - self.param_dl
        pps = uplink_avail // self.param_spine_count if self.param_spine_count else 0
        print("参数网络:")
        print(f"  Leaf: {self.param_leaf_count}, Spine: {self.param_spine_count}")
        print(f"  下联: {self.param_dl}口, 上联: {uplink_avail}口 ({pps}口/Spine)")
        print(f"  速度: {self.param_speed}")

        uplink_avail = self.storage_switch_ports - self.storage_dl
        sps = uplink_avail // self.storage_spine_count if self.storage_spine_count else 0
        print(f"\n存储网络:")
        print(f"  Leaf: {self.storage_leaf_count}, Spine: {self.storage_spine_count}")
        print(f"  下联: {self.storage_dl}口, 上联: {uplink_avail}口 ({sps}口/Spine)")
        print(f"  速度: {self.storage_speed}")

        if self.oob_enabled and self.oob_info:
            i = self.oob_info
            print(f"\nOOB: {i['num_access']}接入 + {i['num_agg']}汇聚, 每接入{i['servers_per_access']}台")
        if self.biz_enabled and self.biz_info:
            i = self.biz_info
            print(f"业务: {i['num_access']}接入(MLAG) + {i['agg_type']}, 每对{i['servers_per_access']}台")
        print("=" * 60)