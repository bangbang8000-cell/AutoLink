"""
AutoLink V2.1 - 统一网络设计协调层
支持 full(满接) 和 custom(自定义下行口数) 两种模式
支持 project_config.json (V2.1) 和 network_config.ini (V2.0) 两种配置格式
"""
import math, os, json, configparser
from models import NetworkObject, Connection
from topology import FatTreeTopology, AccessAggTopology, calc_max_2tier
from device_library import get_device_library, LibraryDevice, InterfaceModel
from rail_topology import RailOptimizedTopology


class NetworkDesignerV2:
    """统一网络设计器 - 支持 full/custom 双模式，兼容新旧配置格式"""

    def __init__(self, config_file="network_config.ini"):
        self.config = configparser.ConfigParser()
        self._project_config = None  # V2.1 project_config.json
        self._device_library = None  # V2.1 设备库
        self._device_profiles = {}   # V2.1 设备档案缓存 (device_ref_id -> LibraryDevice)

        if os.path.exists(config_file):
            if config_file.endswith('.json'):
                self._load_project_config(config_file)
            else:
                # 检查同目录下是否存在 project_config.json (优先使用JSON)
                config_dir = os.path.dirname(config_file) or '.'
                json_path = os.path.join(config_dir, 'project_config.json')
                if os.path.exists(json_path):
                    self._load_project_config(json_path)
                else:
                    self._load_ini_config(config_file)

        if self._project_config is None:
            # 旧格式: 从 INI 初始化
            self._init_from_ini()
        else:
            # 新格式: 从 project_config.json 初始化
            self._init_from_project_config()

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
    #  配置加载 (V2.1新增)
    # ================================================================
    def _load_project_config(self, config_file):
        """加载 project_config.json 格式"""
        with open(config_file, 'r', encoding='utf-8') as f:
            self._project_config = json.load(f)

        # 加载设备库
        try:
            self._device_library = get_device_library()
        except Exception as e:
            print(f"[Designer] 设备库加载失败: {e}")

        # V2.7.2: 读取 param_protocol (IB | RoCE | UEC),用于自动设备选型
        # V2.7.6-T2: 新增 UEC (Ultra Ethernet Consortium) 协议支持
        topo = self._project_config.get('topology', {})
        self.param_protocol = topo.get('param_protocol', 'RoCE')

        # 解析 device_refs
        if self._device_library:
            for key, ref in self._project_config.get('device_refs', {}).items():
                device = self._device_library.resolve_ref(ref)
                if device:
                    self._device_profiles[key] = device

            # V2.7.2-T8: 未通过 device_refs 指定 param_switch 时,按 param_protocol 自动选型
            if 'param_switch' not in self._device_profiles:
                auto_sw = self._auto_select_param_switch(topo.get('param_speed', '400G'))
                if auto_sw:
                    self._device_profiles['param_switch'] = auto_sw

    def _auto_select_param_switch(self, speed: str):
        """V2.7.2-T8: 根据 param_protocol + 速度自动选择参数网交换机

        IB  → NVIDIA Quantum 系列 (按速度: 200G→MQM8790, 400G→MQM9700, 800G→Q3200)
        RoCE → H3C S9820 系列 (按速度: 400G→S9820-64H, 800G→S12500R)
        UEC → CPO 硅光交换机 (按速度: 800G→H3C S12500R, 1600G→H3C 51.2T CPO, 400G→Ruijie 1.6T)
        V2.7.6-T2: 新增 UEC (Ultra Ethernet Consortium) 协议支持
          UEC 基于 Ethernet 扩展，使用 RoCEv2 传输层，但需选用支持 UEC 标准的高端交换机
        """
        if not self._device_library:
            return None
        speed_norm = (speed or '400G').upper()
        # 候选 ID 表(与 template/device_library/switches/param/ 目录对齐)
        if self.param_protocol == 'IB':
            candidates = {
                '200G': 'nvidia_mqm8790_40_200g_ib',
                '400G': 'nvidia_mqm9700_64_400g_ib',
                '800G': 'nvidia_q3200_72_800g_ib',
            }
            fallback_id = 'nvidia_mqm9700_64_400g_ib'
        elif self.param_protocol == 'UEC':
            # V2.7.6-T2: UEC 协议 - 优先选用大带宽 CPO/硅光交换机
            # UEC 1.0 规范推荐 51.2T 及以上带宽交换机
            candidates = {
                '400G': 'ruijie_s6910_32oc2vs_1_6t',
                '800G': 'h3c_s12500r_48_800g',
                '1600G': 'h3c_s12500r_cpo_51_2t',
            }
            fallback_id = 'h3c_s12500r_cpo_51_2t'
        else:  # RoCE
            candidates = {
                '200G': 'nvidia_sn5400_64_200g',
                '400G': 'h3c_s9820_64h',
                '800G': 'h3c_s12500r_48_800g',
            }
            fallback_id = 'h3c_s9820_64h'
        device_id = candidates.get(speed_norm) or fallback_id
        device = self._device_library.get(device_id)
        if device:
            print(f"[Designer] V2.7.2-T8: 自动选型 param_switch = {device_id} (protocol={self.param_protocol}, speed={speed_norm})")
        return device

    def _load_ini_config(self, config_file):
        """加载 network_config.ini 格式"""
        with open(config_file, 'r', encoding='utf-8') as f:
            self.config.read_file(f)
        # V2.7.2-T8: INI 模式也加载设备库,支持自动设备选型
        try:
            self._device_library = get_device_library()
        except Exception as e:
            print(f"[Designer] 设备库加载失败: {e}")

    def _init_from_project_config(self):
        """从 project_config.json 初始化配置"""
        pc = self._project_config
        topo = pc.get('topology', {})
        networks = pc.get('networks', {})
        rack = pc.get('rack_config', {})

        # --- 下行端口模式 ---
        self.downlink_mode = topo.get('downlink_mode', 'custom')

        # V2.4.6: Rail-Optimized 模式开关
        # rail_mode: "standard"(传统 Fat-Tree) / "rail_optimized"(NVIDIA SuperPOD 8-Rail)
        # rail_count: Rail 数量，默认 8（NVIDIA 标准）
        self.rail_mode = topo.get('rail_mode', 'standard')
        self.rail_count = topo.get('rail_count', 8)

        # --- 网络开关 (V2.1: 通过 networks 选择控制) ---
        self.param_enabled = networks.get('param_network', True)
        self.storage_enabled = networks.get('storage_network', True)
        self.biz_enabled = networks.get('biz_network', True)
        self.oob_enabled = networks.get('oob_network', True)

        # --- 服务器配置 ---
        self.num_servers = topo.get('num_gpu_servers', 0)
        # Backward compat: support both old num_storage_servers and new split fields
        if 'num_all_flash_storage' in topo or 'num_hybrid_flash_storage' in topo:
            self.additional_storage = topo.get('num_all_flash_storage', 0) + topo.get('num_hybrid_flash_storage', 0)
        else:
            self.additional_storage = topo.get('num_storage_servers', 0)
        self.additional_compute = topo.get('num_compute_servers', 0)
        self.total_servers = self.num_servers + self.additional_storage + self.additional_compute

        self.param_ports_per_server = topo.get('param_ports_per_server', 8)
        self.storage_ports_per_server = topo.get('storage_ports_per_server', 1)
        self.param_switch_ports = topo.get('param_switch_ports', 64)
        self.storage_switch_ports = topo.get('storage_switch_ports', 40)
        self.param_speed = topo.get('param_speed', '400G')
        self.storage_speed = topo.get('storage_speed', '200G')

        # --- 下行端口限制 ---
        self._resolve_downlink_limits()

        # --- 线缆类型 ---
        self.cable_types = {
            'param': {
                'server_leaf': 'MPO',
                'leaf_spine': 'MPO',
                'spine_core': 'MPO'
            },
            'storage': {
                'server_leaf': 'AOC',
                'leaf_spine': 'AOC',
                'spine_core': 'MPO'
            }
        }

        # --- OOB 配置 ---
        self.oob_access_ports = 48
        self.oob_access_uplinks = 2
        self.oob_agg_ports = 48
        self.oob_speed = '1G'
        self.oob_uplink_speed = '10G'
        self.cable_oob_server_access = '网线'
        self.cable_oob_access_agg = '光纤'
        self.oob_dl = topo.get('oob_downlink_limit', 25)

        # --- 业务网络配置 ---
        self.biz_port_speed = '25G'
        self.biz_access_ports = 48
        self.biz_access_uplinks = 8
        self.biz_uplink_speed = '100G'
        self.biz_agg_box_ports = 32
        self.biz_agg_chassis_ports = 32
        self.cable_biz_server_access = '光纤'
        self.cable_biz_access_agg = '光纤'
        self.biz_dl = topo.get('biz_downlink_limit', 25)
        # V2.7.2-T12: 业务网框式阈值参数化
        self.biz_chassis_threshold = topo.get('biz_chassis_threshold', 128)
        # 框数映射表: [(服务器数阈值, 框数), ...] 按升序,取第一个满足的
        self.biz_chassis_frames_map = topo.get('biz_chassis_frames_map', [
            [512, 4], [1024, 8], [float('inf'), 16]
        ])

        # --- 机柜配置 (V2.1新增) ---
        self.rack_type = rack.get('rack_type', 42)  # 42U or 49U
        self.power_limit_per_rack = rack.get('power_limit_per_rack', 6000)
        self.naming_prefix = rack.get('naming_prefix', '机柜')
        # V2.9.1: 机柜配置扩展
        self.cooling_method = rack.get('cooling_method', 'air')  # air/cold_plate/immersion
        self.gpu_dedicated = bool(rack.get('gpu_dedicated', False))
        self.power_preset = rack.get('power_preset', '')  # 可选预设标识

        # --- 从设备档案中提取端口命名前缀 (V2.1新增) ---
        self._server_port_prefix = None
        self._server_downlink_prefix = None
        self._param_switch_downlink_prefix = None
        self._param_switch_uplink_prefix = None
        self._storage_switch_downlink_prefix = None
        self._storage_switch_uplink_prefix = None
        self._resolve_device_port_prefixes()

    def _resolve_device_port_prefixes(self):
        """从设备档案中解析端口命名前缀"""
        for key, device in self._device_profiles.items():
            if device.is_server() and device.interface_models:
                for im in device.interface_models:
                    if im.network_type == 'param':
                        self._server_port_prefix = im.downlink_prefix or '参数网卡'
                    elif im.network_type == 'storage':
                        pass  # 存储网卡前缀
                    elif im.network_type == 'oob':
                        pass
                    elif im.network_type == 'biz':
                        pass
            elif device.is_switch():
                if device.downlink_prefix:
                    if 'param_switch' in key or 'param' in key.lower():
                        self._param_switch_downlink_prefix = device.downlink_prefix
                        self._param_switch_uplink_prefix = device.uplink_prefix or device.downlink_prefix
                    elif 'storage_switch' in key or 'storage' in key.lower():
                        self._storage_switch_downlink_prefix = device.downlink_prefix
                        self._storage_switch_uplink_prefix = device.uplink_prefix or device.downlink_prefix

        # V2.7.2-T11: 从设备档案读取 OOB/业务网下联口数(覆盖硬编码)
        self._apply_device_port_overrides()

    def _apply_device_port_overrides(self):
        """V2.7.2-T11: 从设备档案读取 OOB/业务网端口数,覆盖硬编码 48/32"""
        # OOB 接入交换机: port_count 覆盖 oob_access_ports(保留 uplinks)
        oob_access_profile = self._device_profiles.get('oob_access_switch')
        if oob_access_profile and oob_access_profile.port_count:
            total = oob_access_profile.port_count
            # 下联口 = 总端口 - 上联口
            self.oob_access_ports = max(1, total - self.oob_access_uplinks)
            if oob_access_profile.port_speed:
                self.oob_speed = oob_access_profile.port_speed

        # OOB 汇聚交换机: port_count 覆盖 oob_agg_ports
        oob_agg_profile = self._device_profiles.get('oob_agg_switch')
        if oob_agg_profile and oob_agg_profile.port_count:
            self.oob_agg_ports = oob_agg_profile.port_count

        # 业务接入交换机: port_count 覆盖 biz_access_ports
        biz_access_profile = self._device_profiles.get('biz_access_switch')
        if biz_access_profile and biz_access_profile.port_count:
            total = biz_access_profile.port_count
            self.biz_access_ports = max(1, total - self.biz_access_uplinks)
            if biz_access_profile.port_speed:
                self.biz_port_speed = biz_access_profile.port_speed

        # 业务汇聚交换机: port_count 覆盖 biz_agg_box_ports
        biz_agg_profile = self._device_profiles.get('biz_agg_switch')
        if biz_agg_profile and biz_agg_profile.port_count:
            self.biz_agg_box_ports = biz_agg_profile.port_count

    def _init_from_ini(self):
        """从 network_config.ini 初始化配置 (兼容旧版)"""
        # --- 通用配置 (必须先加载，后续依赖 param_switch_ports 等) ---
        self._load_common_ini_config()

        # --- 下行端口模式 ---
        self.downlink_mode = self.config.get('DEFAULT', 'downlink_mode', fallback='custom')
        self._resolve_downlink_limits()

        # V2.4.6: Rail-Optimized 模式开关（INI 格式默认为 standard）
        self.rail_mode = self.config.get('DEFAULT', 'rail_mode', fallback='standard')
        self.rail_count = self.config.getint('DEFAULT', 'rail_count', fallback=8)

        # V2.7.2: 参数网协议 (IB | RoCE),用于自动设备选型
        self.param_protocol = self.config.get('DEFAULT', 'param_protocol', fallback='RoCE')

        # --- 网络开关 ---
        self.param_enabled = True
        self.storage_enabled = True
        self.biz_enabled = self.config.getboolean('DEFAULT', 'biz_enabled', fallback=True)
        self.oob_enabled = self.config.getboolean('DEFAULT', 'oob_enabled', fallback=True)

        # V2.7.2-T8: INI 模式下也根据 param_protocol 自动选型 param_switch(若设备库可用)
        if self._device_library and 'param_switch' not in self._device_profiles:
            auto_sw = self._auto_select_param_switch(self.param_speed)
            if auto_sw:
                self._device_profiles['param_switch'] = auto_sw

    def _load_common_ini_config(self):
        """加载 INI 格式通用配置 (向后兼容)"""
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

        self.oob_access_ports = int(self.config.get('DEFAULT', 'oob_access_ports', fallback=48))
        self.oob_access_uplinks = int(self.config.get('DEFAULT', 'oob_access_uplinks', fallback=2))
        self.oob_agg_ports = int(self.config.get('DEFAULT', 'oob_agg_ports', fallback=48))
        self.oob_speed = self.config.get('DEFAULT', 'oob_speed', fallback='1G')
        self.oob_uplink_speed = self.config.get('DEFAULT', 'oob_uplink_speed', fallback='10G')
        self.cable_oob_server_access = self.config.get('DEFAULT', 'cable_oob_server_access', fallback='网线')
        self.cable_oob_access_agg = self.config.get('DEFAULT', 'cable_oob_access_agg', fallback='光纤')

        self.biz_port_speed = self.config.get('DEFAULT', 'biz_port_speed', fallback='25G')
        self.biz_access_ports = int(self.config.get('DEFAULT', 'biz_access_ports', fallback=48))
        self.biz_access_uplinks = int(self.config.get('DEFAULT', 'biz_access_uplinks', fallback=8))
        self.biz_uplink_speed = self.config.get('DEFAULT', 'biz_uplink_speed', fallback='100G')
        self.biz_agg_box_ports = int(self.config.get('DEFAULT', 'biz_agg_box_ports', fallback=32))
        self.biz_agg_chassis_ports = int(self.config.get('DEFAULT', 'biz_agg_chassis_ports', fallback=32))
        self.cable_biz_server_access = self.config.get('DEFAULT', 'cable_biz_server_access', fallback='光纤')
        self.cable_biz_access_agg = self.config.get('DEFAULT', 'cable_biz_access_agg', fallback='光纤')

        # V2.7.2-T12: 业务网框式阈值参数化 (INI 模式默认值,与 project_config 保持一致)
        self.biz_chassis_threshold = int(self.config.get('DEFAULT', 'biz_chassis_threshold', fallback=128))
        self.biz_chassis_frames_map = [
            [512, 4], [1024, 8], [float('inf'), 16]
        ]

        # 机柜 (旧格式无此配置，使用默认值)
        self.rack_type = 42
        self.power_limit_per_rack = 6000
        self.naming_prefix = '机柜'
        # V2.9.1: 机柜配置扩展 (INI 旧格式使用默认值)
        self.cooling_method = 'air'
        self.gpu_dedicated = False
        self.power_preset = ''

        # 端口前缀 (旧格式使用默认值)
        self._server_port_prefix = None
        self._server_downlink_prefix = None
        self._param_switch_downlink_prefix = None
        self._param_switch_uplink_prefix = None
        self._storage_switch_downlink_prefix = None
        self._storage_switch_uplink_prefix = None

    # ================================================================
    #  下行端口解析
    # ================================================================
    def _resolve_downlink_limits(self):
        """根据 mode 解析各网络下行口数"""
        if self._project_config is not None:
            # V2.1: 使用 project_config 中的值
            topo = self._project_config.get('topology', {})
            if self.downlink_mode == 'full':
                self.param_dl = self.param_switch_ports // 2
                self.storage_dl = self.storage_switch_ports // 2
                self.biz_dl = 45
                self.oob_dl = 48
            else:
                self.param_dl = int(topo.get('param_downlink_limit', self.param_switch_ports // 2))
                self.storage_dl = int(topo.get('storage_downlink_limit', self.storage_switch_ports // 2))
                self.biz_dl = int(topo.get('biz_downlink_limit', 25))
                self.oob_dl = int(topo.get('oob_downlink_limit', 25))
            return

        if self.downlink_mode == 'full':
            # full模式: 满接 (参数/存储=一半口, 业务=45, OOB=48)
            ps = self.param_switch_ports
            ss = self.storage_switch_ports
            self.param_dl = ps // 2
            self.storage_dl = ss // 2
            self.biz_dl = 45
            self.oob_dl = 48
        else:
            # custom模式: 读取配置
            ps = self.param_switch_ports
            ss = self.storage_switch_ports
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
            if self.param_servers_per_group <= 0:
                self.param_servers_per_group = 1
            self.param_groups = math.ceil(self.num_servers / self.param_servers_per_group)
            self.param_leaf_per_group = self.param_ports_per_server
            self.param_leaf_count = self.param_groups * self.param_leaf_per_group
            self.param_spine_count = max(1, self.param_leaf_count // 2)
            self.param_core_count = 0
            self.param_pods = 0
            self.param_servers_per_pod = 0

        # --- 存储网络 (自动计算) ---
        # V2.7.2-T9: 放开 3-tier 限制,根据服务器数量自动判定
        storage_max_2tier = calc_max_2tier(self.storage_switch_ports, self.storage_ports_per_server)
        self.storage_3tier_needed = self.total_servers > storage_max_2tier if storage_max_2tier > 0 else False

        if self.storage_3tier_needed:
            # 三层组网: Leaf-Spine-Core
            self.storage_pods = math.ceil(self.total_servers / max(storage_max_2tier, 1))
            self.storage_servers_per_pod = min(storage_max_2tier, self.total_servers)
            # 每 Pod 内 Leaf 数 = (servers_per_pod / max_servers_per_leaf) * ports_per_server
            max_servers_per_storage_leaf = self.storage_switch_ports // 2
            storage_servers_per_group = max(1, min(
                self.storage_servers_per_pod // self.storage_ports_per_server,
                max_servers_per_storage_leaf
            ))
            storage_groups_per_pod = max(1, self.storage_servers_per_pod // storage_servers_per_group)
            self.storage_leaf_per_group = self.storage_ports_per_server
            self.storage_groups = self.storage_pods * storage_groups_per_pod
            self.storage_leaf_count = self.storage_groups * self.storage_leaf_per_group
            self.storage_spine_count = max(1, self.storage_leaf_count // 2)
            # Core 数 = ceil(spine_count / (switch_ports // 2))
            spine_per_core = max(1, self.storage_switch_ports // 2)
            self.storage_core_count = math.ceil(self.storage_spine_count / spine_per_core)
            self.storage_servers_per_group = storage_servers_per_group
        else:
            self.storage_pods = 0
            self.storage_servers_per_pod = 0
            self.storage_servers_per_group = min(self.storage_dl, self.total_servers)
            if self.storage_servers_per_group <= 0:
                self.storage_servers_per_group = 1
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
        # 从设备档案获取默认参数
        gpu_profile = self._device_profiles.get('gpu_server')
        storage_profile = self._device_profiles.get('storage_server')
        compute_profile = self._device_profiles.get('compute_server')
        param_switch_profile = self._device_profiles.get('param_switch')
        storage_switch_profile = self._device_profiles.get('storage_switch')

        def _make_server(name, group, podid, profile=None, default_power=500, default_u=2):
            power = profile.power_watts if profile else default_power
            u = profile.u_height if profile else default_u
            prefix = profile.name_prefix if profile else ""
            s = NetworkObject(name=name, obj_type='server',
                              group=group, podid=podid,
                              device_profile=profile,
                              power_watts=power, u_height=u)
            if profile and profile.interface_models:
                # 从接口模型获取端口前缀
                for im in profile.interface_models:
                    if im.network_type == 'param':
                        s.port_prefix = im.downlink_prefix or '参数网卡'
            else:
                s.port_prefix = self._server_port_prefix or '参数网卡'
            return s

        # GPU服务器
        # 3-tier 使用 pod 分组，2-tier 使用 group 分组
        servers_per_group = self.param_servers_per_pod if self.param_3tier_needed else self.param_servers_per_group
        if servers_per_group <= 0:
            servers_per_group = 1
        for server_idx in range(1, self.num_servers + 1):
            group_id = (server_idx - 1) // servers_per_group + 1
            group_name = f"GPU服务器组{group_id}"
            podid = f"pod-gpu-{group_id}"
            s = _make_server(f"GPU服务器_{server_idx}", group_name, podid, gpu_profile)
            self.servers.append(s)
            self.server_groups[s.name] = group_name
            self.podid_map[s.name] = podid

        # 额外存储服务器
        for i in range(1, self.additional_storage + 1):
            s = _make_server(f"存储服务器_{i}", "存储服务器组", "pod-storage", storage_profile, default_power=300, default_u=2)
            self.servers.append(s)
            self.server_groups[s.name] = s.group
            self.podid_map[s.name] = s.podid

        # 额外通算服务器
        for i in range(1, self.additional_compute + 1):
            s = _make_server(f"通算服务器_{i}", "通算服务器组", "pod-general", compute_profile, default_power=400, default_u=2)
            self.servers.append(s)
            self.server_groups[s.name] = s.group
            self.podid_map[s.name] = s.podid

        # 参数网络交换机
        if self.rail_mode == 'rail_optimized':
            # V2.4.6: Rail-Optimized 模式（NVIDIA SuperPOD 8-Rail）
            self._create_rail_optimized_switches(param_switch_profile)
        elif self.param_3tier_needed:
            pt = FatTreeTopology(self.param_ports_per_server, self.param_switch_ports,
                                 self.param_speed, self.cable_types['param'], "param")
            pt.create_network_objects(self.param_pods, self.param_servers_per_pod)
            self.param_leaves = pt.leaves
            self.param_spines = pt.spines
            self.param_cores = pt.cores
            self.switch_groups.update(pt.switch_groups)
            self.podid_map.update(pt.podid_map)
            # 应用交换机端口前缀
            self._apply_switch_port_prefixes(self.param_leaves + self.param_spines + self.param_cores,
                                             param_switch_profile)
        else:
            self._create_param_2tier_switches(param_switch_profile)

        # 存储网络交换机 (仅在启用时创建)
        if self.storage_enabled:
            self._create_storage_switches(storage_switch_profile)

        # V2.9.0: 多约束机柜分配（服务器 + param/storage 交换机）
        self._allocate_rack_servers()

    # ================================================================
    #  机柜分配 (V2.9.0: 多约束装箱, 替代简单轮转)
    # ================================================================
    def _allocate_rack_servers(self):
        """V2.9.0: 服务器 + param/storage 交换机机柜分配（多约束装箱）

        规则:
          - GPU 高功率(≥50%上限)独占机柜, 覆盖 DGX H100/H200 单柜 1 台
          - 通算/存储 功率+U位装箱, 多台共柜
          - 交换机按网段聚柜(网络柜), 功率+U位装箱
        """
        from rack_allocation import RackAllocator, DeviceSlot, infer_device_type

        slots = []
        for s in self.servers:
            d = DeviceSlot(
                name=s.name, obj_type=s.obj_type, group=s.group,
                power_watts=s.power_watts or 0, u_height=s.u_height or 1,
                device_type=infer_device_type(s.obj_type, s.group),
            )
            slots.append((s, d))
        for sw in (self.param_leaves + self.param_spines + self.param_cores +
                   self.storage_leaves + self.storage_spines + self.storage_cores):
            slots.append((sw, self._make_switch_slot(sw)))

        allocator = RackAllocator(
            rack_type=self.rack_type,
            power_limit=self.power_limit_per_rack,
            naming_prefix=self.naming_prefix,
            gpu_dedicated=getattr(self, 'gpu_dedicated', False),
        )
        allocator.allocate([d for _, d in slots])
        for obj, d in slots:
            self._apply_slot(obj, d)
        self._rack_cabinets = allocator.cabinets

    def _allocate_rack_switches(self, switches):
        """V2.9.0: 追加分配交换机（oob/biz）到网络柜，保持机柜编号连续，并回填连接机柜字段"""
        from rack_allocation import RackAllocator

        if not switches:
            return
        slots = [(sw, self._make_switch_slot(sw)) for sw in switches]
        allocator = RackAllocator(
            rack_type=self.rack_type,
            power_limit=self.power_limit_per_rack,
            naming_prefix=self.naming_prefix,
            gpu_dedicated=getattr(self, 'gpu_dedicated', False),
        )
        allocator.seed(getattr(self, '_rack_cabinets', []) or [])
        allocator.allocate([d for _, d in slots])
        for obj, d in slots:
            self._apply_slot(obj, d)
        self._rack_cabinets = allocator.cabinets
        self._backfill_switch_connections(switches)

    def _make_switch_slot(self, sw):
        """构造交换机 DeviceSlot（oob/biz 未绑定档案时从设备档案补充功率/U位）"""
        from rack_allocation import DeviceSlot, infer_network
        power = sw.power_watts or 0
        u = sw.u_height or 1
        if power <= 0:
            profile = self._switch_profile_for(sw.obj_type)
            if profile:
                power = profile.power_watts or 0
                u = profile.u_height or u
        return DeviceSlot(
            name=sw.name, obj_type=sw.obj_type, group=sw.group,
            power_watts=power, u_height=u,
            device_type='network', network=infer_network(sw.obj_type),
        )

    def _switch_profile_for(self, obj_type):
        """交换机 obj_type → 设备档案 key"""
        key = None
        if obj_type.startswith('param_'):
            key = 'param_switch'
        elif obj_type.startswith('storage_'):
            key = 'storage_switch'
        elif obj_type.startswith('oob_'):
            key = 'oob_access_switch' if obj_type.endswith('access') else 'oob_agg_switch'
        elif obj_type.startswith('biz_'):
            key = 'biz_access_switch' if obj_type.endswith('access') else 'biz_agg_switch'
        if key:
            return self._device_profiles.get(key)
        return None

    def _apply_slot(self, obj, d):
        """将 DeviceSlot 分配结果回填到 NetworkObject"""
        obj.cabinet_id = d.cabinet_id
        obj.cabinet_name = d.cabinet_name
        obj.start_u = d.start_u
        obj.end_u = d.end_u

    def _backfill_switch_connections(self, switches):
        """交换机分配机柜后，回填其参与连接的机柜字段（连接生成时交换机机柜未分配）"""
        name_to_sw = {sw.name: sw for sw in switches}
        seen = set()
        for sw in switches:
            for conn in sw.connections:
                key = (conn.a_device, conn.z_device, conn.a_port)
                if key in seen:
                    continue
                seen.add(key)
                a_sw = name_to_sw.get(conn.a_device)
                if a_sw:
                    conn.a_cabinet_id = a_sw.cabinet_id
                    conn.a_cabinet_name = a_sw.cabinet_name
                    conn.a_start_u = a_sw.start_u
                    conn.a_end_u = a_sw.end_u
                z_sw = name_to_sw.get(conn.z_device)
                if z_sw:
                    conn.z_cabinet_id = z_sw.cabinet_id
                    conn.z_cabinet_name = z_sw.cabinet_name
                    conn.z_start_u = z_sw.start_u
                    conn.z_end_u = z_sw.end_u

    def _apply_switch_port_prefixes(self, switches, profile=None):
        """为交换机设置端口命名前缀"""
        for sw in switches:
            if profile:
                sw.downlink_prefix = profile.downlink_prefix or ""
                sw.uplink_prefix = profile.uplink_prefix or ""
                sw.port_prefix = profile.name_prefix or ""
            else:
                sw.downlink_prefix = self._param_switch_downlink_prefix or ""
                sw.uplink_prefix = self._param_switch_uplink_prefix or ""
                sw.port_prefix = ""

    def _create_param_2tier_switches(self, profile=None):
        for group in range(1, self.param_groups + 1):
            for leaf_idx in range(1, self.param_leaf_per_group + 1):
                sw = NetworkObject(name=f"参数Leaf_G{group}_{leaf_idx}",
                                   obj_type='param_leaf', group=f"参数Leaf组{group}",
                                   max_ports=self.param_switch_ports, podid=f"pod-gpu-{group}",
                                   device_profile=profile)
                sw.downlink_limit = self.param_dl
                if profile:
                    sw.downlink_prefix = profile.downlink_prefix or ""
                    sw.uplink_prefix = profile.uplink_prefix or ""
                else:
                    sw.downlink_prefix = self._param_switch_downlink_prefix or ""
                    sw.uplink_prefix = self._param_switch_uplink_prefix or ""
                self.param_leaves.append(sw)
                self.switch_groups[sw.name] = sw.group
                self.podid_map[sw.name] = sw.podid
        for i in range(1, self.param_spine_count + 1):
            sw = NetworkObject(name=f"参数Spine_{i}", obj_type='param_spine',
                               group="参数Spine组", max_ports=self.param_switch_ports,
                               podid="superpod", device_profile=profile)
            if profile:
                sw.downlink_prefix = profile.downlink_prefix or ""
                sw.uplink_prefix = profile.uplink_prefix or ""
            else:
                sw.downlink_prefix = self._param_switch_downlink_prefix or ""
                sw.uplink_prefix = self._param_switch_uplink_prefix or ""
            self.param_spines.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid

    def _create_rail_optimized_switches(self, profile=None):
        """V2.4.6: 创建 Rail-Optimized 参数网交换机（NVIDIA SuperPOD 8-Rail）"""
        self._rail_topology = RailOptimizedTopology(
            num_servers=self.num_servers,
            num_rails=self.rail_count,
            switch_ports=self.param_switch_ports,
            ports_per_server=self.param_ports_per_server,
            network_speed=self.param_speed,
            network_type="param",
        )
        self._rail_topology.create_network_objects()

        self.param_leaves = self._rail_topology.leaves
        self.param_spines = self._rail_topology.spines
        self.param_cores = self._rail_topology.cores

        # 注册 switch_groups 和 podid_map
        for sw in self.param_leaves + self.param_spines + self.param_cores:
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid

        # 为 GPU 服务器标注 rail_id 和 rail_role
        # v2.7.2 B4: 交错分配(idx % rail_count),与 rail_topology.py 保持一致
        # 符合 NVIDIA SuperPOD 规范:server_i → rail = i % num_rails
        for idx, server in enumerate(self.servers[:self.num_servers]):
            server.rail_id = idx % self.rail_count
            server.rail_role = "server_rail_endpoint"

        # 应用交换机端口前缀
        self._apply_switch_port_prefixes(
            self.param_leaves + self.param_spines + self.param_cores, profile
        )

    def _create_storage_switches(self, profile=None):
        for group in range(1, self.storage_groups + 1):
            for leaf_idx in range(1, self.storage_leaf_per_group + 1):
                sw = NetworkObject(name=f"存储Leaf_{group}_{leaf_idx}",
                                   obj_type='storage_leaf', group=f"存储Leaf组{group}",
                                   max_ports=self.storage_switch_ports,
                                   podid=f"pod-storage-{group}",
                                   device_profile=profile)
                sw.downlink_limit = self.storage_dl
                sw.uplink_counter = self.storage_dl + 1
                if profile:
                    sw.downlink_prefix = profile.downlink_prefix or ""
                    sw.uplink_prefix = profile.uplink_prefix or ""
                else:
                    sw.downlink_prefix = self._storage_switch_downlink_prefix or ""
                    sw.uplink_prefix = self._storage_switch_uplink_prefix or ""
                self.storage_leaves.append(sw)
                self.switch_groups[sw.name] = sw.group
                self.podid_map[sw.name] = sw.podid
        for i in range(1, self.storage_spine_count + 1):
            sw = NetworkObject(name=f"存储Spine_{i}", obj_type='storage_spine',
                               group="存储Spine组", max_ports=self.storage_switch_ports,
                               podid="superpod", device_profile=profile)
            if profile:
                sw.downlink_prefix = profile.downlink_prefix or ""
                sw.uplink_prefix = profile.uplink_prefix or ""
            else:
                sw.downlink_prefix = self._storage_switch_downlink_prefix or ""
                sw.uplink_prefix = self._storage_switch_uplink_prefix or ""
            self.storage_spines.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid
        # V2.7.2-T9: 3-tier 模式下创建 Core 层
        if self.storage_3tier_needed:
            for i in range(1, self.storage_core_count + 1):
                sw = NetworkObject(name=f"存储Core_{i}", obj_type='storage_core',
                                   group="存储Core组", max_ports=self.storage_switch_ports,
                                   podid="superpod", device_profile=profile)
                if profile:
                    sw.downlink_prefix = profile.downlink_prefix or ""
                    sw.uplink_prefix = profile.uplink_prefix or ""
                else:
                    sw.downlink_prefix = self._storage_switch_downlink_prefix or ""
                    sw.uplink_prefix = self._storage_switch_uplink_prefix or ""
                self.storage_cores.append(sw)
                self.switch_groups[sw.name] = sw.group
                self.podid_map[sw.name] = sw.podid

    # ================================================================
    #  连接生成
    # ================================================================
    def generate_connections(self):
        gpu_servers = self.servers[:self.num_servers]

        if self.rail_mode == 'rail_optimized':
            # V2.4.6: Rail-Optimized 拓扑连接
            self._wire_rail_optimized(gpu_servers)
        elif self.param_3tier_needed:
            pt = FatTreeTopology(self.param_ports_per_server, self.param_switch_ports,
                                 self.param_speed, self.cable_types['param'], "param")
            pt.leaves = self.param_leaves
            pt.spines = self.param_spines
            pt.cores = self.param_cores
            pt.generate_connections(gpu_servers, self.param_pods, self.param_servers_per_pod)
        else:
            self._wire_param_2tier(gpu_servers)
        if self.storage_enabled:
            self._wire_storage()

    def _wire_rail_optimized(self, gpu_servers):
        """V2.4.6: 生成 Rail-Optimized 连接（复用 RailOptimizedTopology）"""
        server_names = [s.name for s in gpu_servers]
        conns = self._rail_topology.generate_connections(server_names)

        # 将 Connection 关联到 NetworkObject.connections
        name_to_obj = {s.name: s for s in gpu_servers}
        for sw in self.param_leaves + self.param_spines + self.param_cores:
            name_to_obj[sw.name] = sw

        for conn in conns:
            a_obj = name_to_obj.get(conn.a_device)
            z_obj = name_to_obj.get(conn.z_device)
            if a_obj:
                a_obj.connections.append(conn)
            if z_obj:
                z_obj.connections.append(conn)

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
                    sp = f"{server.port_prefix or '参数网卡'}{pi}"
                    lp = leaf.get_downlink_port()
                    self._add_conn(server, sp, self.param_speed, leaf, lp, self.param_speed,
                                   self.cable_types['param']['server_leaf'], "服务器到参数Leaf",
                                   network_type='param')
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
                    lf = f"{leaf.uplink_prefix or '端口'}{po}"
                    spn = ((po - self.param_dl - 1) % spine.downlink_limit) + 1
                    spine.downlink_counter = max(spine.downlink_counter, spn + 1)
                    po += 1
                    self._add_conn(leaf, lf, self.param_speed, spine, f"{spine.downlink_prefix or '端口'}{spn}",
                                   self.param_speed,
                                   self.cable_types['param']['leaf_spine'],
                                   "参数Leaf到Spine",
                                   network_type='param')

    def _wire_storage(self):
        """存储网络: 所有服务器→Leaf + Leaf→Spine (+ Spine→Core 当 3-tier)"""
        # Server → Leaf: 轮转分配, 每服务器 storage_ports_per_server 条连接
        # (v2.9.1-T7 修复: 此前固定 1 条, storage_ports_per_server=2 时只连一半)
        servers_per_leaf = math.ceil(self.total_servers / self.storage_leaf_count)
        ports_per_leaf_block = max(1, servers_per_leaf * self.storage_ports_per_server)
        for si, server in enumerate(self.servers):
            for pi in range(1, self.storage_ports_per_server + 1):
                li = (si * self.storage_ports_per_server + (pi - 1)) // ports_per_leaf_block
                if li >= len(self.storage_leaves):
                    li = len(self.storage_leaves) - 1
                leaf = self.storage_leaves[li]
                try:
                    lp = leaf.get_downlink_port()
                    self._add_conn(server, f"存储网卡{pi}", self.storage_speed,
                                   leaf, lp, self.storage_speed,
                                   self.cable_types['storage']['server_leaf'],
                                   "服务器到存储Leaf",
                                   network_type='storage')
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
                    lf = f"{leaf.uplink_prefix or '端口'}{po}"
                    spn = ((po - self.storage_dl - 1) % spine.downlink_limit) + 1
                    spine.downlink_counter = max(spine.downlink_counter, spn + 1)
                    po += 1
                    self._add_conn(leaf, lf, self.storage_speed, spine, f"{spine.downlink_prefix or '端口'}{spn}",
                                   self.storage_speed,
                                   self.cable_types['storage']['leaf_spine'],
                                   "存储Leaf到Spine",
                                   network_type='storage')

        # V2.7.2-T9: Spine → Core (仅 3-tier 模式)
        if self.storage_3tier_needed and self.storage_cores:
            # Spine 上联端口: downlink_limit 之后为上联区域
            spine_uplink_start = self.storage_dl + 1
            spine_uplink_avail = self.storage_switch_ports - spine_uplink_start + 1
            # 每 Spine 可用上联端口数,分配给 Core
            uplinks_per_spine = max(1, spine_uplink_avail // max(self.storage_core_count, 1))
            for spine_idx, spine in enumerate(self.storage_spines):
                spine.uplink_counter = spine_uplink_start
                spine.uplink_limit = self.storage_switch_ports
                for _ in range(uplinks_per_spine):
                    # 轮转分配 Core,避免单 Core 端口溢出
                    core_idx = spine_idx % len(self.storage_cores)
                    core = self.storage_cores[core_idx]
                    try:
                        sp = spine.get_uplink_port()
                        cp = core.get_core_port()
                        self._add_conn(spine, sp, self.storage_speed, core, cp, self.storage_speed,
                                       self.cable_types['storage']['spine_core'],
                                       "存储Spine到Core",
                                       network_type='storage')
                    except ValueError:
                        break

    def _add_conn(self, a_dev, a_port, a_mod, z_dev, z_port, z_mod, cable, desc, network_type=""):
        c1 = Connection(a_dev.name, a_port, a_mod, z_dev.name, z_port, z_mod, cable, desc,
                        a_cabinet_id=a_dev.cabinet_id, a_cabinet_name=a_dev.cabinet_name,
                        a_start_u=a_dev.start_u, a_end_u=a_dev.end_u,
                        z_cabinet_id=z_dev.cabinet_id, z_cabinet_name=z_dev.cabinet_name,
                        z_start_u=z_dev.start_u, z_end_u=z_dev.end_u,
                        network_type=network_type)
        c2 = Connection(z_dev.name, z_port, z_mod, a_dev.name, a_port, a_mod, cable, desc,
                        a_cabinet_id=z_dev.cabinet_id, a_cabinet_name=z_dev.cabinet_name,
                        a_start_u=z_dev.start_u, a_end_u=z_dev.end_u,
                        z_cabinet_id=a_dev.cabinet_id, z_cabinet_name=a_dev.cabinet_name,
                        z_start_u=a_dev.start_u, z_end_u=a_dev.end_u,
                        network_type=network_type)
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
        # V2.9.0: OOB 交换机机柜分配（网络柜）并回填连接机柜字段
        self._allocate_rack_switches(self.oob_access + self.oob_agg)

    def _calc_biz_chassis_frames(self):
        """V2.7.2-T12: 根据 total_servers 和 biz_chassis_frames_map 计算框数

        frames_map 格式: [[阈值, 框数], ...] 按升序,取第一个满足 total_servers <= 阈值 的框数
        默认: ≤512→4框, ≤1024→8框, >1024→16框
        """
        for threshold, frames in self.biz_chassis_frames_map:
            if self.total_servers <= threshold:
                return frames
        # 兜底:返回最后一个框数
        return self.biz_chassis_frames_map[-1][1] if self.biz_chassis_frames_map else 4

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
        # V2.7.2-T12: 框式阈值参数化(不再硬编码 128/512/1024 → 4/8/18)
        # 默认阈值: >128 启用, ≤512→4框, ≤1024→8框, >1024→16框
        if self.total_servers > self.biz_chassis_threshold:
            frames = self._calc_biz_chassis_frames()
            chassis_config = {'enabled': True, 'frames': frames}
            topo.agg_down_ports = self.biz_agg_chassis_ports
        self.biz_info = topo.calculate(self.total_servers, chassis_config)
        topo.create_and_connect(self.servers, self.biz_info['num_access'],
                                self.biz_info['num_agg'])
        self.biz_access = topo.access_switches
        self.biz_agg = topo.agg_switches
        self.switch_groups.update(topo.switch_groups)
        self.podid_map.update(topo.podid_map)
        # V2.9.0: 业务交换机机柜分配（网络柜）并回填连接机柜字段
        self._allocate_rack_switches(self.biz_access + self.biz_agg)

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
                    if conn.network_type == "param":
                        pc += 1; sp.add(server.name)
                    elif conn.network_type == "storage":
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
        return {"valid": len(errors) == 0, "errors": errors}

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