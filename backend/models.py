"""
AutoLink V2.1 - 数据模型
Connection: 连接关系数据类
NetworkObject: 网络设备抽象（服务器、交换机）
"""

import math
from typing import Optional, Dict, Any


class NetworkObject:
    """网络设备（服务器、Leaf/Spine/Core交换机）"""

    def __init__(self, name, obj_type, group=None, max_ports=64, podid=None,
                 device_profile=None, power_watts=0, u_height=1, layer_hint=None,
                 rail_id=None, rail_role="none", domain_id=None, protocol="",
                 network_type="",
                 # V3.0.0-T0-4: 端口容量显式化（None = 沿用"半口下联"兼容行为）
                 downlink_limit=None, uplink_limit=None, ports_per_nic=1):
        self.name = name
        self.obj_type = obj_type  # 'server', 'param_leaf', 'param_spine', 'param_core', 'storage_leaf', 'storage_spine'
        self.group = group
        self.podid = podid
        self.connections = []
        self.max_ports = max_ports

        # V2.9.3-T2: Scale-Up GPU 节点字段
        self.domain_id = domain_id       # Scale-Up 域 ID
        self.protocol = protocol         # NVLink / UALink / UB
        self.network_type = network_type # 'scale_up'

        # 设备档案信息 (V2.1新增)
        self.device_profile = device_profile  # LibraryDevice or None
        self.power_watts = power_watts
        self.u_height = u_height

        # V3.0.2-T2-11: 端口 1 分 2 扇出（breakout）逻辑口模型
        # 从设备档案 breakout 读取（如 Q3200 800G→2×400G）；缺省 1 = 1:1 物理口
        _bk = getattr(device_profile, 'breakout', None) if device_profile else None
        if not isinstance(_bk, dict):
            _bk = None
        self.breakout_info = _bk
        self.breakout_count = int((_bk or {}).get('count', 1) or 1)
        # 逻辑输出速率兼容两种档案键：交换机用 logical_speed，光模块用 output_speed
        self.breakout_output_speed = ((_bk or {}).get('logical_speed')
                                      or (_bk or {}).get('output_speed')) if _bk else None
        # 接线标注统一为 input_speed/output_speed（选型/导出消费）：
        # 交换机档案 physical_speed/logical_speed → input_speed/output_speed
        if _bk:
            self.breakout_link_info = {
                'input_speed': _bk.get('input_speed') or _bk.get('physical_speed') or '',
                'output_speed': _bk.get('output_speed') or _bk.get('logical_speed') or '',
                'count': self.breakout_count,
            }
        else:
            self.breakout_link_info = None

        # 机柜信息 (V2.1新增)
        self.cabinet_id: Optional[int] = None
        self.cabinet_name: str = ""
        self.start_u: Optional[int] = None
        self.end_u: Optional[int] = None

        # 端口命名前缀 (V2.1新增，从设备档案读取)
        self.downlink_prefix: str = ""
        self.uplink_prefix: str = ""
        self.port_prefix: str = ""
        # V2.9.3-T7: 各类网络独立端口命名前缀 (服务器网卡)
        self.storage_prefix: Optional[str] = None
        self.oob_prefix: Optional[str] = None
        self.biz_prefix: Optional[str] = None

        # V2.4.2: 布局层级提示，显式指定拓扑图Y轴分层
        # 取值: 'core'(L5) / 'spine'(L4) / 'leaf'(L3) / 'server'(L2) / 'access'(L1) / 'agg'(L0)
        # 若未指定，则根据 obj_type 自动推断
        self.layer_hint = layer_hint or self._infer_layer_hint(obj_type)

        # V2.4.6: Rail-Optimized 架构字段
        # rail_id: 1-8，标识所属 Rail（NVIDIA 标准 8 Rail）
        # rail_role: "rail_leaf" / "rail_spine" / "server_rail_endpoint" / "none"
        self.rail_id: Optional[int] = rail_id
        self.rail_role: str = rail_role

        # 根据设备类型初始化端口计数器
        # V3.0.0-T0-4: 支持显式 downlink/uplink 容量与每网卡端口数（缺省保持"半口下联"）
        if "leaf" in obj_type:
            # Leaf: 下联端口用于服务器，上联用于Spine
            self.downlink_counter = 1
            if downlink_limit is not None:
                self.downlink_limit = downlink_limit
                self.uplink_counter = downlink_limit + 1
            else:
                self.downlink_limit = math.floor(max_ports / 2)
                self.uplink_counter = math.ceil(max_ports / 2) + 1
            self.uplink_limit = uplink_limit if uplink_limit is not None else max_ports
            self.ports_per_nic = ports_per_nic
        elif "spine" in obj_type:
            # Spine: 下联用于Leaf，上联用于Core
            self.downlink_counter = 1
            if downlink_limit is not None:
                self.downlink_limit = downlink_limit
                self.uplink_counter = downlink_limit + 1
            else:
                self.downlink_limit = math.floor(max_ports / 2)
                self.uplink_counter = math.ceil(max_ports / 2) + 1
            self.uplink_limit = uplink_limit if uplink_limit is not None else max_ports
            self.ports_per_nic = ports_per_nic
        elif "core" in obj_type:
            # Core: 所有端口用于Spine连接
            self.core_counter = 1
            self.core_limit = max_ports
            self.ports_per_nic = ports_per_nic
        else:
            # 服务器使用普通端口计数器
            self.port_counter = 1
            self.port_limit = max_ports
            self.ports_per_nic = ports_per_nic  # 每网卡端口数（双平面=2）

    @staticmethod
    def _infer_layer_hint(obj_type: str) -> str:
        """根据 obj_type 推断 layer_hint (V2.4.2)"""
        if obj_type == 'server':
            return 'server'
        if 'core' in obj_type:
            return 'core'
        if 'spine' in obj_type:
            return 'spine'
        if 'leaf' in obj_type:
            return 'leaf'
        if 'access' in obj_type:
            return 'access'
        if 'agg' in obj_type:
            return 'agg'
        return 'server'

    def add_connection(self, connection):
        """添加连接关系"""
        self.connections.append(connection)

    def get_downlink_port(self):
        """获取下联端口(用于连接服务器或Leaf)

        V3.0.2-T2-11: 支持 1 分 2 扇出（breakout）——物理口内按 count 拆分为逻辑口。
        count=1 时行为不变（每物理口 1 逻辑口）；count>1 时命名如 "端口1-1/端口1-2"。
        端口上限 = 物理口数 × 扇出数（与 V016 逻辑口容量校验一致）。
        """
        total = self.downlink_limit * self.breakout_count
        if self.downlink_limit <= 0:
            raise ValueError(f"{self.name}的下联端口限制为0，无法分配端口")
        if self.downlink_counter > total:
            raise ValueError(f"{self.name}的下联端口数量超过限制({total})")
        port_num = self.downlink_counter
        self.downlink_counter += 1
        prefix = self.downlink_prefix or "端口"
        if self.breakout_count > 1:
            physical = (port_num - 1) // self.breakout_count + 1
            sub = (port_num - 1) % self.breakout_count + 1
            return f"{prefix}{physical}-{sub}"
        return f"{prefix}{port_num}"

    def get_uplink_port(self):
        """获取上联端口(用于连接Spine或Core)"""
        if self.uplink_counter > self.uplink_limit:
            raise ValueError(f"{self.name}的上联端口数量超过限制({self.uplink_limit})")
        port_num = self.uplink_counter
        self.uplink_counter += 1
        prefix = self.uplink_prefix or "端口"
        return f"{prefix}{port_num}"

    def get_core_port(self):
        """获取Core交换机端口"""
        if self.core_limit <= 0:
            raise ValueError(f"{self.name}的Core端口限制为0，无法分配端口")
        if self.core_counter > self.core_limit:
            raise ValueError(f"{self.name}的端口数量超过最大值{self.core_limit}")
        port_num = self.core_counter
        self.core_counter += 1
        prefix = self.port_prefix or "端口"
        return f"{prefix}{port_num}"

    def get_server_port(self):
        """获取服务器端口"""
        if self.port_counter > self.port_limit:
            raise ValueError(f"{self.name}的端口数量超过最大值{self.port_limit}")
        port_num = self.port_counter
        self.port_counter += 1
        prefix = self.port_prefix or "端口"
        return f"{prefix}{port_num}"

    def get_next_port(self, start=None):
        """兼容旧方法，获取下一个可用端口号"""
        if "leaf" in self.obj_type or "spine" in self.obj_type:
            try:
                return self.get_downlink_port()
            except ValueError:
                return self.get_uplink_port()
        elif "core" in self.obj_type:
            return self.get_core_port()
        else:
            return self.get_server_port()


class Connection:
    """网络连接关系"""

    def __init__(self, a_device, a_port, a_module, z_device, z_port, z_module, cable_type, description,
                 a_cabinet_id=None, a_cabinet_name="", a_start_u=None, a_end_u=None,
                 z_cabinet_id=None, z_cabinet_name="", z_start_u=None, z_end_u=None,
                 network_type="", breakout=None):
        self.a_device = a_device
        self.a_port = a_port
        self.a_module = a_module
        self.z_device = z_device
        self.z_port = z_port
        self.z_module = z_module
        self.cable_type = cable_type
        self.description = description
        self.network_type = network_type  # 'param', 'storage', 'oob', 'biz'
        # V3.0.2-T2-11: 1 分 2 扇出标注（如 {"input_speed":"800G","output_speed":"400G","count":2}）
        # a_module/z_module 为逻辑速率；分裂线缆选型按 breakout.input_speed（物理速率）匹配
        self.breakout = breakout
        # 机柜信息 (V2.1新增)
        self.a_cabinet_id = a_cabinet_id
        self.a_cabinet_name = a_cabinet_name
        self.a_start_u = a_start_u
        self.a_end_u = a_end_u
        self.z_cabinet_id = z_cabinet_id
        self.z_cabinet_name = z_cabinet_name
        self.z_start_u = z_start_u
        self.z_end_u = z_end_u
