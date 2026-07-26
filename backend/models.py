"""
AutoLink V2.0 - 数据模型
Connection: 连接关系数据类
NetworkObject: 网络设备抽象（服务器、交换机）
"""

import math


class NetworkObject:
    """网络设备（服务器、Leaf/Spine/Core交换机）"""

    def __init__(self, name, obj_type, group=None, max_ports=64, podid=None):
        self.name = name
        self.obj_type = obj_type  # 'server', 'param_leaf', 'param_spine', 'param_core', 'storage_leaf', 'storage_spine'
        self.group = group
        self.podid = podid
        self.connections = []
        self.max_ports = max_ports

        # 根据设备类型初始化端口计数器
        if "leaf" in obj_type:
            # Leaf: 前一半端口用于服务器，后一半端口用于Spine
            self.downlink_counter = 1
            self.uplink_counter = math.ceil(max_ports / 2) + 1
            self.downlink_limit = math.floor(max_ports / 2)
            self.uplink_limit = max_ports
        elif "spine" in obj_type:
            # Spine: 前一半端口用于Leaf，后一半端口用于Core
            self.downlink_counter = 1
            self.uplink_counter = math.ceil(max_ports / 2) + 1
            self.downlink_limit = math.floor(max_ports / 2)
            self.uplink_limit = max_ports
        elif "core" in obj_type:
            # Core: 所有端口用于Spine连接
            self.core_counter = 1
            self.core_limit = max_ports
        else:
            # 服务器使用普通端口计数器
            self.port_counter = 1
            self.port_limit = max_ports

    def add_connection(self, connection):
        """添加连接关系"""
        self.connections.append(connection)

    def get_downlink_port(self):
        """获取下联端口(用于连接服务器或Leaf)"""
        if self.downlink_counter > self.downlink_limit:
            raise ValueError(f"{self.name}的下联端口数量超过限制({self.downlink_limit})")
        port_num = self.downlink_counter
        self.downlink_counter += 1
        return f"端口{port_num}"

    def get_uplink_port(self):
        """获取上联端口(用于连接Spine或Core)"""
        if self.uplink_counter > self.uplink_limit:
            raise ValueError(f"{self.name}的上联端口数量超过限制({self.uplink_limit - math.floor(self.max_ports / 2)})")
        port_num = self.uplink_counter
        self.uplink_counter += 1
        return f"端口{port_num}"

    def get_core_port(self):
        """获取Core交换机端口"""
        if self.core_counter > self.core_limit:
            raise ValueError(f"{self.name}的端口数量超过最大值{self.core_limit}")
        port_num = self.core_counter
        self.core_counter += 1
        return f"端口{port_num}"

    def get_server_port(self):
        """获取服务器端口"""
        if self.port_counter > self.port_limit:
            raise ValueError(f"{self.name}的端口数量超过最大值{self.port_limit}")
        port_num = self.port_counter
        self.port_counter += 1
        return f"端口{port_num}"

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

    def __init__(self, a_device, a_port, a_module, z_device, z_port, z_module, cable_type, description):
        self.a_device = a_device
        self.a_port = a_port
        self.a_module = a_module
        self.z_device = z_device
        self.z_port = z_port
        self.z_module = z_module
        self.cable_type = cable_type
        self.description = description
