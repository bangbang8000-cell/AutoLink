"""
AutoLink 5.2.2-522-f: 推理加速平面（D4，独立精简参数面）

定义（PRD F522-7）：
  推理 4 合 1 = 管理&业务&存储 3 合 1（eth_combined）+ 推理加速平面。
  推理加速平面 = 独立精简参数面：小型单层 Leaf 交换机域，承载推理 GPU 服务器间的
  高速互连；收敛比 1:1~3:1（oversubscription），收敛比越高单 Leaf 可承载下行越多、
  Leaf 越精简。

层次计算：
  downlink_per_leaf = max(1, round(switch_ports * convergence / (1 + convergence)))
    - 1:1 → 50% 端口下行（无收敛，Leaf 更多）
    - 3:1 → 75% 端口下行（收敛，Leaf 更精简）
  leaf_count = max(1, ceil(num_inference_servers * nics_per_server / downlink_per_leaf))

连接规则：
  - 推理服务器 → 推理 Leaf：轮转均摊（单层，无 Spine），network_type='inference'。
"""
import math
from typing import Dict, List, Any, Optional

from models import NetworkObject, Connection


class InferencePlaneTopology:
    """推理加速平面（单层精简参数面）设计器（5.2.2-522-f）"""

    def __init__(self, nics_per_server: int, switch_ports: int,
                 convergence: int = 3, speed: str = '400G',
                 network_type: str = 'inference', prefix: str = '推理'):
        self.nics_per_server = max(1, int(nics_per_server))
        self.switch_ports = max(1, int(switch_ports))
        self.convergence = max(1, int(convergence))
        self.speed = speed
        self.network_type = network_type
        self.prefix = prefix

        self.leaves: List[NetworkObject] = []
        self.switch_groups: Dict[str, str] = {}
        self.podid_map: Dict[str, str] = {}

    def calculate_hierarchy(self, num_inference_servers: int) -> Dict[str, Any]:
        """计算推理域层次（单层 Leaf）"""
        n = max(0, int(num_inference_servers))
        # 收敛比 → 单 Leaf 可用下行端口（1:1=50%、3:1=75%）
        downlink_per_leaf = max(1, round(
            self.switch_ports * self.convergence / (1 + self.convergence)))
        required = n * self.nics_per_server
        leaf_count = max(1, math.ceil(required / downlink_per_leaf)) if downlink_per_leaf > 0 else 0
        if n == 0:
            leaf_count = 0
        return {
            'leaf_count': leaf_count,
            'downlink_per_leaf': downlink_per_leaf if n > 0 else 0,
            'switch_ports': self.switch_ports,
            'speed': self.speed,
            'convergence': self.convergence,
        }

    def create_network_objects(self, stat: Dict[str, Any], profile=None) -> None:
        """创建推理 Leaf（单层）"""
        self.leaves = []
        leaf_count = int(stat.get('leaf_count', 0))
        downlink_per_leaf = int(stat.get('downlink_per_leaf', 0))
        for g in range(1, leaf_count + 1):
            sw = NetworkObject(name=f"推理Leaf_{g}", obj_type='inference_leaf',
                               group=f"推理Leaf组{g}", max_ports=self.switch_ports,
                               podid=f"pod-inference-{g}", device_profile=profile)
            sw.downlink_limit = max(1, downlink_per_leaf)
            sw.uplink_counter = sw.downlink_limit + 1
            if profile:
                sw.downlink_prefix = profile.downlink_prefix or ""
                sw.uplink_prefix = profile.uplink_prefix or ""
            self.leaves.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid

    def generate_connections(self, servers: List[NetworkObject]) -> List[Connection]:
        """推理服务器 → 推理 Leaf 接线（轮转均摊，单层无 Spine）"""
        if not self.leaves:
            return []
        connections: List[Connection] = []
        leaf_idx = 0
        for server in servers:
            sidx = getattr(server, 'server_index', None)
            if sidx is None:
                continue
            for port_idx in range(1, self.nics_per_server + 1):
                leaf = self.leaves[leaf_idx % len(self.leaves)]
                leaf_idx += 1
                try:
                    leaf_port = leaf.get_downlink_port()
                except ValueError:
                    continue
                srv_port = f"{server.storage_prefix or f'{self.prefix}网卡'}{port_idx}"
                self._connect_pair(server, srv_port, self.speed,
                                   leaf, leaf_port, self.speed,
                                   cable='MPO', desc=f"服务器到{self.prefix}Leaf",
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
