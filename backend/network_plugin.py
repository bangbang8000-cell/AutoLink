"""
AutoLink V2.7.6 - 网络类型插件化接口
定义 NetworkPlugin 抽象接口，网络类型通过插件注册

内置插件:
  - ParamNetworkPlugin (参数网, RoCE/IB)
  - StorageNetworkPlugin (存储网)
  - BizNetworkPlugin (业务网)
  - OOBNetworkPlugin (带外管理网)
  - ScaleUpNetworkPlugin (Scale-Up, NVLink/UALink/UB)

插件架构:
  1. 每种网络类型实现 NetworkPlugin 抽象接口的 4 个方法:
     - get_info()         返回插件元信息 (名称/层级/协议)
     - validate_config()  校验用户配置, 返回错误列表
     - generate_topology() 生成拓扑数据 (nodes/edges/stats)
     - get_default_config() 返回默认配置
  2. 通过 register_plugin() 注册到全局插件表
  3. 通过 get_plugin() / list_plugins() 查询已注册插件

典型用法:
  >>> register_builtin_plugins()
  >>> plugin = get_plugin("param")
  >>> cfg = plugin.get_default_config()
  >>> topo = plugin.generate_topology(cfg)
"""
import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Type, Any
from enum import Enum


class NetworkTier(Enum):
    """网络层级"""
    SCALE_UP = "scale_up"      # Pod 内 scale-up
    SCALE_OUT = "scale_out"    # Pod 间 scale-out
    MANAGEMENT = "management"  # 管理网络


@dataclass
class NetworkPluginInfo:
    """插件信息

    Attributes:
        name: 插件唯一标识 (如 "param" / "storage" / "scale_up")
        display_name: 显示名称 (如 "参数网")
        tier: 网络层级
        protocols: 支持的协议列表
        description: 插件描述
    """
    name: str
    display_name: str
    tier: NetworkTier
    protocols: List[str]       # 支持的协议列表
    description: str = ""


@dataclass
class NetworkDomain:
    """网络域抽象（V3.0.0-T0-3）

    描述一个可独立配置/校验/渲染的网络域（组网形态的最小表达单元），
    与插件、集群正交：组网形态（横向）由 type/planes/tiers 表达，
    GPU 池/集群（纵向）由 cluster_id/network_mode 表达。

    Attributes:
        type: 网络域类型（param/storage/biz/oob/scale_up，或新组网 dual_plane/zcube...）
        planes: 平面数（双平面=2，缺省 1）
        tiers: 层级数（2/3）
        protocol: 协议（RoCE/IB/UEC/NVLink/UALink/UB/Ethernet）
        speed: 端口速率（如 "400G"）
        ports_per_server: 每服务器端口数
        leaf_count: Leaf 交换机数量
        cluster_id: 所属集群 id（正交模型；空 = 全局域）
        network_mode: 所属集群的组网模式（正交模型；空 = 未启用多集群）
    """
    type: str
    planes: int = 1
    tiers: int = 0
    protocol: str = ''
    speed: str = ''
    ports_per_server: int = 0
    leaf_count: int = 0
    cluster_id: str = ''
    network_mode: str = ''

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 dict（供 engine/AIHUB 上下文消费）"""
        return {
            'type': self.type,
            'planes': self.planes,
            'tiers': self.tiers,
            'protocol': self.protocol,
            'speed': self.speed,
            'ports_per_server': self.ports_per_server,
            'leaf_count': self.leaf_count,
            'cluster_id': self.cluster_id,
            'network_mode': self.network_mode,
        }


class NetworkPlugin(ABC):
    """网络类型插件抽象接口

    所有网络类型 (参数网/存储网/业务网/带外网/Scale-Up 网) 均需实现本接口,
    通过 register_plugin() 注册后即可被引擎统一调度。
    """

    @abstractmethod
    def get_info(self) -> NetworkPluginInfo:
        """返回插件信息"""
        ...

    @abstractmethod
    def validate_config(self, config: Dict[str, Any]) -> List[str]:
        """校验配置，返回错误列表（空=通过）"""
        ...

    @abstractmethod
    def generate_topology(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """生成拓扑数据

        Returns:
            含 network_type / nodes / edges / stats 的字典
        """
        ...

    @abstractmethod
    def get_default_config(self) -> Dict[str, Any]:
        """返回默认配置"""
        ...


# Plugin registry
_plugin_registry: Dict[str, NetworkPlugin] = {}


def register_plugin(name: str, plugin: NetworkPlugin) -> None:
    """注册网络插件

    Args:
        name: 插件唯一标识
        plugin: NetworkPlugin 实例
    """
    _plugin_registry[name] = plugin


def get_plugin(name: str) -> Optional[NetworkPlugin]:
    """获取已注册的插件

    Args:
        name: 插件唯一标识

    Returns:
        NetworkPlugin 实例, 未注册时返回 None
    """
    return _plugin_registry.get(name)


def list_plugins() -> List[str]:
    """列出所有已注册插件名

    Returns:
        插件名列表
    """
    return list(_plugin_registry.keys())


def unregister_plugin(name: str) -> bool:
    """注销插件

    Args:
        name: 插件唯一标识

    Returns:
        是否成功注销 (未注册时返回 False)
    """
    if name in _plugin_registry:
        del _plugin_registry[name]
        return True
    return False


# ==================================================================
#  V3.0.0-T0-3: 组网模式（network_mode）解析 —— engine 分派接缝
# ==================================================================

# 传统 designer 原生支持的组网模式（无需插件，走 NetworkDesignerV2 既有路径）。
# 组合形态：standard / fat_tree（同义）与 rail / rail_optimized（同义，Rail-Optimized）。
# 网络域级：param/storage/biz/oob/scale_up（对应既有四网 + Scale-Up）。
NATIVE_NETWORK_MODES = frozenset({
    'standard', 'fat_tree', 'rail', 'rail_optimized',
    'param', 'storage', 'biz', 'oob', 'scale_up',
})


def resolve_network_mode(network_mode: Optional[str]) -> str:
    """解析组网模式 → 处理路径（V3.0.0-T0-3 engine 分派接缝）

    Args:
        network_mode: 集群的 network_mode 值（缺失/空 = 未显式指定）

    Returns:
        'native'  → 传统 NetworkDesignerV2 原生路径（结果与 2.9.9 一致）
        'plugin'  → 插件注册表可处理（3.0.1+ 新组网插件：dual_plane/zcube/huawei_supernode...）
        'unknown' → 未注册的未知模式（engine 应明确报错，防止静默走错路径）
    """
    mode = (network_mode or '').strip().lower()
    if not mode or mode in NATIVE_NETWORK_MODES:
        return 'native'
    if get_plugin(mode) is not None:
        return 'plugin'
    return 'unknown'


# ==================================================================
#  内部辅助函数
# ==================================================================

def _generate_leaf_spine_topology(
    network_type: str,
    num_servers: int,
    switch_ports: int,
    speed: str,
    protocol: str,
) -> Dict[str, Any]:
    """生成 Leaf-Spine 两层拓扑 (供 param/storage/biz/oob 插件共用)

    拓扑结构:
      - Leaf 层: 每 leaf 下行端口数 = switch_ports // 2, 上行端口数 = switch_ports // 2
      - Spine 层: Spine 数 = Leaf 数 (Leaf↔Spine 全互联)
      - 下行链路: Server → Leaf (DAC 短距线缆)
      - 上行链路: Leaf → Spine (AOC 有源光缆)

    Args:
        network_type: 网络类型标识 (如 "param" / "storage")
        num_servers: 服务器数量
        switch_ports: 交换机端口数
        speed: 端口速率 (如 "400G")
        protocol: 协议 (如 "RoCEv2")

    Returns:
        含 network_type / nodes / edges / stats 的拓扑字典
    """
    downlink_per_leaf = switch_ports // 2 if switch_ports > 0 else 1
    num_leaves = max(1, math.ceil(num_servers / downlink_per_leaf)) if downlink_per_leaf > 0 else 1
    num_spines = num_leaves  # Leaf↔Spine 全互联, Spine 数 = Leaf 数

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    # 1. 服务器节点
    for i in range(num_servers):
        nodes.append({
            "id": f"Server_{i}",
            "type": "server",
            "network_type": network_type,
        })

    # 2. Leaf 交换机节点
    for i in range(num_leaves):
        nodes.append({
            "id": f"{network_type}_Leaf_{i}",
            "type": "switch",
            "role": "leaf",
            "network_type": network_type,
            "max_ports": switch_ports,
        })

    # 3. Spine 交换机节点
    for i in range(num_spines):
        nodes.append({
            "id": f"{network_type}_Spine_{i}",
            "type": "switch",
            "role": "spine",
            "network_type": network_type,
            "max_ports": switch_ports,
        })

    # 4. 下行链路: Server → Leaf
    for i in range(num_servers):
        leaf_idx = i // downlink_per_leaf if downlink_per_leaf > 0 else 0
        edges.append({
            "source": f"Server_{i}",
            "target": f"{network_type}_Leaf_{leaf_idx}",
            "speed": speed,
            "aSpeed": speed,
            "zSpeed": speed,
            "cableType": "DAC",
            "cable_type": "DAC",
            "networkType": network_type,
            "network_type": network_type,
            "description": f"{network_type} 下行链路: Server_{i} → Leaf_{leaf_idx}",
        })

    # 5. 上行链路: Leaf → Spine (全互联)
    for li in range(num_leaves):
        for si in range(num_spines):
            edges.append({
                "source": f"{network_type}_Leaf_{li}",
                "target": f"{network_type}_Spine_{si}",
                "speed": speed,
                "aSpeed": speed,
                "zSpeed": speed,
                "cableType": "AOC",
                "cable_type": "AOC",
                "networkType": network_type,
                "network_type": network_type,
                "description": f"{network_type} 上行链路: Leaf_{li} → Spine_{si}",
            })

    # 6. 统计信息
    total_switches = num_leaves + num_spines
    uplink_per_leaf = switch_ports - downlink_per_leaf
    convergence_ratio = (
        round(downlink_per_leaf / uplink_per_leaf, 2) if uplink_per_leaf > 0 else 0
    )

    stats = {
        "num_servers": num_servers,
        "num_leaves": num_leaves,
        "num_spines": num_spines,
        "total_switches": total_switches,
        "total_nodes": num_servers + total_switches,
        "total_edges": len(edges),
        "switch_ports": switch_ports,
        "speed": speed,
        "protocol": protocol,
        "convergence_ratio": convergence_ratio,
    }

    return {
        "network_type": network_type,
        "nodes": nodes,
        "edges": edges,
        "stats": stats,
    }


def _validate_switch_config(
    config: Dict[str, Any],
    valid_speeds: List[str],
    valid_protocols: List[str],
) -> List[str]:
    """校验交换机类网络配置 (供 param/storage/biz/oob 插件共用)

    Args:
        config: 用户配置字典
        valid_speeds: 合法速率列表 (如 ["400G", "200G"])
        valid_protocols: 合法协议列表 (如 ["RoCEv2", "IB"])

    Returns:
        错误信息列表, 空列表表示校验通过
    """
    errors: List[str] = []

    if config.get("num_servers", 0) <= 0:
        errors.append("num_servers 必须大于 0")

    if config.get("switch_ports", 0) <= 0:
        errors.append("switch_ports 必须大于 0")

    speed = config.get("speed", "")
    if not speed:
        errors.append("缺少必填字段: speed")
    elif valid_speeds and speed not in valid_speeds:
        errors.append(f"不支持的速率: {speed} (支持 {', '.join(valid_speeds)})")

    protocol = config.get("protocol", "")
    if not protocol:
        errors.append("缺少必填字段: protocol")
    elif valid_protocols and protocol not in valid_protocols:
        errors.append(f"不支持的协议: {protocol} (支持 {', '.join(valid_protocols)})")

    return errors


# ==================================================================
#  内置插件实现
# ==================================================================

class ParamNetworkPlugin(NetworkPlugin):
    """参数网插件 (RoCE/IB/UEC)

    用于 GPU 训练参数同步 (AllReduce/AllGather), 是 AI 智算中心核心网络。
    典型配置: 400G RoCEv2, 64 端口交换机, Rail-Optimized 架构。
    V2.7.6-T2: 新增 UEC (Ultra Ethernet Consortium) 协议支持。
    """

    _VALID_SPEEDS = ["400G", "800G", "200G", "1600G"]
    _VALID_PROTOCOLS = ["RoCEv2", "IB", "UEC"]

    def get_info(self) -> NetworkPluginInfo:
        return NetworkPluginInfo(
            name="param",
            display_name="参数网",
            tier=NetworkTier.SCALE_OUT,
            protocols=["RoCEv2", "IB", "UEC"],
            description="GPU 训练参数同步网络 (RoCEv2/IB/UEC), Rail-Optimized 架构",
        )

    def validate_config(self, config: Dict[str, Any]) -> List[str]:
        return _validate_switch_config(config, self._VALID_SPEEDS, self._VALID_PROTOCOLS)

    def generate_topology(self, config: Dict[str, Any]) -> Dict[str, Any]:
        num_servers = config.get("num_servers", 8)
        switch_ports = config.get("switch_ports", 64)
        speed = config.get("speed", "400G")
        protocol = config.get("protocol", "RoCEv2")
        return _generate_leaf_spine_topology("param", num_servers, switch_ports, speed, protocol)

    def get_default_config(self) -> Dict[str, Any]:
        return {
            "num_servers": 8,
            "switch_ports": 64,
            "speed": "400G",
            "protocol": "RoCEv2",
            "rail_mode": "standard",
            "rail_count": 8,
            "ports_per_server": 8,
        }


class StorageNetworkPlugin(NetworkPlugin):
    """存储网插件

    用于分布式存储 (如 GPFS/Lustre/Ceph) 数据访问, 通常 RoCEv2 组网。
    典型配置: 200G RoCEv2, 48 端口交换机。
    """

    _VALID_SPEEDS = ["200G", "100G", "400G", "25G"]
    _VALID_PROTOCOLS = ["RoCEv2"]

    def get_info(self) -> NetworkPluginInfo:
        return NetworkPluginInfo(
            name="storage",
            display_name="存储网",
            tier=NetworkTier.SCALE_OUT,
            protocols=["RoCEv2"],
            description="分布式存储访问网络 (RoCEv2), 连接存储节点与 GPU 服务器",
        )

    def validate_config(self, config: Dict[str, Any]) -> List[str]:
        return _validate_switch_config(config, self._VALID_SPEEDS, self._VALID_PROTOCOLS)

    def generate_topology(self, config: Dict[str, Any]) -> Dict[str, Any]:
        num_servers = config.get("num_servers", 8)
        switch_ports = config.get("switch_ports", 48)
        speed = config.get("speed", "200G")
        protocol = config.get("protocol", "RoCEv2")
        return _generate_leaf_spine_topology("storage", num_servers, switch_ports, speed, protocol)

    def get_default_config(self) -> Dict[str, Any]:
        return {
            "num_servers": 8,
            "switch_ports": 48,
            "speed": "200G",
            "protocol": "RoCEv2",
            "ports_per_server": 2,
        }


class BizNetworkPlugin(NetworkPlugin):
    """业务网插件

    用于集群业务管理与外部通信, 标准以太网组网。
    典型配置: 25G Ethernet, 48 端口交换机。
    """

    _VALID_SPEEDS = ["25G", "10G", "100G", "1G"]
    _VALID_PROTOCOLS = ["Ethernet"]

    def get_info(self) -> NetworkPluginInfo:
        return NetworkPluginInfo(
            name="biz",
            display_name="业务网",
            tier=NetworkTier.MANAGEMENT,
            protocols=["Ethernet"],
            description="业务管理网络 (Ethernet), 集群对外通信与管理",
        )

    def validate_config(self, config: Dict[str, Any]) -> List[str]:
        return _validate_switch_config(config, self._VALID_SPEEDS, self._VALID_PROTOCOLS)

    def generate_topology(self, config: Dict[str, Any]) -> Dict[str, Any]:
        num_servers = config.get("num_servers", 8)
        switch_ports = config.get("switch_ports", 48)
        speed = config.get("speed", "25G")
        protocol = config.get("protocol", "Ethernet")
        return _generate_leaf_spine_topology("biz", num_servers, switch_ports, speed, protocol)

    def get_default_config(self) -> Dict[str, Any]:
        return {
            "num_servers": 8,
            "switch_ports": 48,
            "speed": "25G",
            "protocol": "Ethernet",
            "ports_per_server": 2,
        }


class OOBNetworkPlugin(NetworkPlugin):
    """带外管理网插件

    用于设备带外管理 (BMC/IPMI/串口), 独立于业务网的物理隔离网络。
    典型配置: 1G Ethernet, 48 端口交换机。
    """

    _VALID_SPEEDS = ["1G", "10G", "100M"]
    _VALID_PROTOCOLS = ["Ethernet"]

    def get_info(self) -> NetworkPluginInfo:
        return NetworkPluginInfo(
            name="oob",
            display_name="带外管理网",
            tier=NetworkTier.MANAGEMENT,
            protocols=["Ethernet"],
            description="带外管理网络 (Ethernet), BMC/IPMI 设备管理, 物理隔离",
        )

    def validate_config(self, config: Dict[str, Any]) -> List[str]:
        return _validate_switch_config(config, self._VALID_SPEEDS, self._VALID_PROTOCOLS)

    def generate_topology(self, config: Dict[str, Any]) -> Dict[str, Any]:
        num_servers = config.get("num_servers", 8)
        switch_ports = config.get("switch_ports", 48)
        speed = config.get("speed", "1G")
        protocol = config.get("protocol", "Ethernet")
        return _generate_leaf_spine_topology("oob", num_servers, switch_ports, speed, protocol)

    def get_default_config(self) -> Dict[str, Any]:
        return {
            "num_servers": 8,
            "switch_ports": 48,
            "speed": "1G",
            "protocol": "Ethernet",
            "ports_per_server": 1,
        }


class ScaleUpNetworkPlugin(NetworkPlugin):
    """Scale-Up 网插件 (NVLink/UALink/UB)

    用于 Pod 内 GPU/NPU 全对等互联, 域内任意 GPU 对间单跳直达。
    支持三种协议: NVLink (NVIDIA) / UALink (开放标准) / UB (华为昇腾)。
    通过 scaleup_topology.ScaleUpTopology 生成域内全对等连接。
    """

    _VALID_PROTOCOLS = ["NVLink", "UALink", "UB"]

    def get_info(self) -> NetworkPluginInfo:
        return NetworkPluginInfo(
            name="scale_up",
            display_name="Scale-Up 互联网",
            tier=NetworkTier.SCALE_UP,
            protocols=["NVLink", "UALink", "UB"],
            description="Pod 内 Scale-Up 互联 (NVLink/UALink/UB), GPU/NPU 全对等互联",
        )

    def validate_config(self, config: Dict[str, Any]) -> List[str]:
        errors: List[str] = []

        protocol = config.get("protocol", "")
        if not protocol:
            errors.append("缺少必填字段: protocol")
        elif protocol not in self._VALID_PROTOCOLS:
            errors.append(f"不支持的协议: {protocol} (支持 {', '.join(self._VALID_PROTOCOLS)})")

        if config.get("num_gpus", 0) <= 0:
            errors.append("num_gpus 必须大于 0")

        if config.get("gpus_per_node", 0) <= 0:
            errors.append("gpus_per_node 必须大于 0")

        return errors

    def generate_topology(self, config: Dict[str, Any]) -> Dict[str, Any]:
        # 延迟导入, 避免 scaleup_topology 不可用时影响其他插件
        from scaleup_topology import (
            ScaleUpConfig, ScaleUpTopology, ScaleUpProtocol,
        )

        protocol_map = {
            "NVLink": ScaleUpProtocol.NVLINK,
            "UALink": ScaleUpProtocol.UALINK,
            "UB": ScaleUpProtocol.UB,
        }
        protocol_str = config.get("protocol", "UALink")
        protocol = protocol_map.get(protocol_str, ScaleUpProtocol.UALINK)

        sc = ScaleUpConfig(
            protocol=protocol,
            num_gpus=config.get("num_gpus", 1024),
            gpus_per_node=config.get("gpus_per_node", 8),
            domain_size=config.get("domain_size", 0),
            bandwidth_per_link_gbps=config.get("bandwidth_per_link_gbps", 0),
            num_links_per_gpu=config.get("num_links_per_gpu", 0),
        )

        topo = ScaleUpTopology(sc)
        topo.plan_domains()
        edges = topo.to_dict_list()
        stats = topo.get_stats()

        # 构建 GPU 节点列表
        nodes: List[Dict[str, Any]] = []
        domain_size = sc.domain_size if sc.domain_size > 0 else sc.num_gpus
        for i in range(sc.num_gpus):
            nodes.append({
                "id": f"GPU_{i}",
                "type": "gpu",
                "network_type": "scale_up",
                "protocol": protocol_str,
                "domain_id": i // domain_size if domain_size > 0 else 0,
            })

        return {
            "network_type": "scale_up",
            "nodes": nodes,
            "edges": edges,
            "stats": stats,
        }

    def get_default_config(self) -> Dict[str, Any]:
        return {
            "protocol": "UALink",
            "num_gpus": 1024,
            "gpus_per_node": 8,
            "domain_size": 1024,
            "bandwidth_per_link_gbps": 0,
            "num_links_per_gpu": 0,
        }


def register_builtin_plugins() -> None:
    """注册所有内置插件

    将 5 个内置网络插件注册到全局插件表:
      - param    参数网 (RoCEv2/IB)
      - storage  存储网 (RoCEv2)
      - biz      业务网 (Ethernet)
      - oob      带外管理网 (Ethernet)
      - scale_up Scale-Up 网 (NVLink/UALink/UB)
    """
    register_plugin("param", ParamNetworkPlugin())
    register_plugin("storage", StorageNetworkPlugin())
    register_plugin("biz", BizNetworkPlugin())
    register_plugin("oob", OOBNetworkPlugin())
    register_plugin("scale_up", ScaleUpNetworkPlugin())
