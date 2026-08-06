"""
AutoLink V3.0.2-T2-1 - ZCube 拓扑（扁平化二部图，无 Spine）

依据（PRD 4.1.2 / 清华 SIGCOMM 2025 ZCube 论文）：
  - 完全扁平化二部图互联：取消 Spine 层，两组 Leaf 直连 GPU；
  - 任意 GPU 间独享最短路径：GPU → 组内 Leaf →（跨组时）另一组 Leaf → GPU；
  - 双口网卡单轨/多轨混合接入：每 GPU 端口分组 A / 组 B（默认双口 = 1+1）；
  - 无 Spine 层级一致性：全部节点仅 param_leaf，无 param_spine/param_core。

V3.2.0-T9-2：新增 build_cube_topology_data —— ATOP 推荐场景的 cube 拓扑可渲染
数据生成（GPU 按 2D/3D cube 维度分组着色 + 链路元数据，输出前端拓扑 schema）。
"""
import math
from typing import Dict, List, Any

from models import NetworkObject, Connection


class ZcubeTopology:
    """ZCube 扁平化二部图拓扑设计器（V3.0.2-T2-1）"""

    def __init__(self, num_gpus: int, nics_per_gpu: int = 2,
                 leaf_count: int = 0, switch_ports: int = 144,
                 cable_type_config: Dict[str, str] = None,
                 network_type: str = "param", prefix: str = "参数"):
        self.num_gpus = int(num_gpus)
        self.nics_per_gpu = int(nics_per_gpu)
        self.leaf_count = int(leaf_count)          # 0 = 自动推导
        self.switch_ports = int(switch_ports)
        self.cable_type_config = cable_type_config or {'server_leaf': 'MPO', 'leaf_spine': 'MPO'}
        self.network_type = network_type
        self.prefix = prefix

        # 组件（仅 Leaf，两组；无 Spine/Core）
        self.leaves: List[NetworkObject] = []
        self.switch_groups: Dict[str, str] = {}
        self.podid_map: Dict[str, str] = {}

        # 统计（calculate 填充）
        self.stats: Dict[str, Any] = {}

    # ================================================================
    #  层次计算
    # ================================================================

    @property
    def ports_to_group_a(self) -> int:
        """每 GPU 连到组 A 的端口数（双口混合：前一半端口给 A）"""
        return max(1, math.ceil(self.nics_per_gpu / 2))

    def calculate(self) -> Dict[str, Any]:
        """推导两组 Leaf 数与端口划分

        Returns:
            stats: {num_gpus, nics_per_gpu, leaf_count(L), ports_to_group_a,
                    downlink_per_leaf, inter_leaf_per_leaf, total_ports}
        """
        p_a = self.ports_to_group_a
        required = max(0, self.num_gpus) * p_a
        # min L 使 L*(switch_ports-L) >= required（无 Spine 扁平二部图容量）
        L = self.leaf_count
        if L <= 0:
            L = 8  # 初始猜测（最小规模）
            while L < self.switch_ports:
                if L * (self.switch_ports - L) >= required:
                    break
                L += 1
            if L >= self.switch_ports:
                L = max(1, self.switch_ports // 2)  # 兜底
        L = max(1, min(int(L), self.switch_ports - 1))
        self.stats = {
            'num_gpus': self.num_gpus,
            'nics_per_gpu': self.nics_per_gpu,
            'leaf_count': L,
            'ports_to_group_a': p_a,
            'downlink_per_leaf': max(1, self.switch_ports - L),
            'inter_leaf_per_leaf': L,
            'total_ports': self.num_gpus * self.nics_per_gpu,
        }
        return self.stats

    # ================================================================
    #  对象创建（两组 Leaf，无 Spine/Core）
    # ================================================================

    def create_objects(self) -> None:
        if not self.stats:
            self.calculate()
        L = self.stats['leaf_count']
        for label in ('A', 'B'):
            for li in range(1, L + 1):
                name = f"{self.prefix}{label}_Leaf_{li}"
                leaf = NetworkObject(
                    name=name,
                    obj_type=f"{self.network_type}_leaf",   # 无 Spine/Core：层级一致性
                    group=f"{self.prefix}{label}Leaf组",
                    max_ports=self.switch_ports,
                    podid=f"zcube-{label}",
                    downlink_limit=self.stats['downlink_per_leaf'],
                    ports_per_nic=1,
                )
                leaf.plane_id = 0 if label == 'A' else 1   # 复用平面 A/B 配色
                leaf.zcube_group = label
                self.leaves.append(leaf)
                self.switch_groups[name] = leaf.group
                self.podid_map[name] = leaf.podid

    # ================================================================
    #  连接生成：GPU→组内 Leaf（混合接入）+ 组 A↔组 B 全二部
    # ================================================================

    def generate_connections(self, servers: List[NetworkObject]) -> List[Connection]:
        connections: List[Connection] = []
        if not self.stats:
            self.calculate()
        L = self.stats['leaf_count']
        p_a = self.stats['ports_to_group_a']
        speed = '400G'
        leaves_a = [l for l in self.leaves if l.zcube_group == 'A']
        leaves_b = [l for l in self.leaves if l.zcube_group == 'B']
        leaf_a_map = {l.name: l for l in leaves_a}
        leaf_b_map = {l.name: l for l in leaves_b}

        # --- GPU → Leaf（双口混合接入：前 p_a 口 → A，余口 → B；组内轮转均摊） ---
        for server in servers:
            sidx = getattr(server, 'server_index', None)
            if sidx is None:
                continue
            sidx0 = sidx - 1
            for port_idx in range(1, self.nics_per_gpu + 1):
                to_a = port_idx <= p_a
                group_leaves = leaves_a if to_a else leaves_b
                # 组内序号（组 A 第 k 口 / 组 B 第 k 口）→ 轮转覆盖组内全部 Leaf
                intra = port_idx - 1 if to_a else (port_idx - 1 - p_a)
                leaf = group_leaves[(sidx0 + intra) % len(group_leaves)]
                srv_port = f"{server.port_prefix or f'{self.prefix}网卡'}{port_idx}"
                try:
                    leaf_port = leaf.get_downlink_port()
                except ValueError as e:
                    print(f"警告: ZCube {str(e)}")
                    continue
                self._connect_pair(server, srv_port, speed, leaf, leaf_port, speed,
                                   self.cable_type_config['server_leaf'],
                                   f"服务器到{self.prefix}{'A' if to_a else 'B'}Leaf",
                                   network_type=self.network_type, out=connections)

        # --- 组 A ↔ 组 B 全二部互联（无 Spine：此即扁平化核心，路径唯一） ---
        for a_leaf in leaves_a:
            for b_leaf in leaves_b:
                try:
                    a_port = a_leaf.get_uplink_port()
                    b_port = b_leaf.get_uplink_port()
                except ValueError as e:
                    print(f"警告: ZCube {str(e)}")
                    continue
                self._connect_pair(a_leaf, a_port, speed, b_leaf, b_port, speed,
                                   self.cable_type_config['leaf_spine'],
                                   f"{self.prefix}A到{self.prefix}B Leaf互联",
                                   network_type=self.network_type, out=connections)

        return connections

    def _connect_pair(self, a_dev, a_port, a_mod, z_dev, z_port, z_mod,
                      cable, desc, network_type, out: List[Connection]) -> None:
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


# ================================================================
#  V3.2.0-T9-2: ATOP cube 拓扑可渲染数据（前端拓扑 schema + 分组着色元数据）
# ================================================================

def build_cube_topology_data(num_gpus: int, nics_per_gpu: int = 2,
                             switch_ports: int = 144, leaf_count: int = 0,
                             cube_dims=None, network_type: str = "param",
                             prefix: str = "参数", speed: str = "400G") -> Dict[str, Any]:
    """生成 ATOP 推荐场景的 cube 拓扑可渲染数据

    复用 ZcubeTopology 的两组 Leaf 扁平二部图，附加 ATOP 渲染元数据：
      - GPU 按 2D/3D cube 维度编号（cube_rank/cube_pos），前半（z 维切分）归组 A、
        后半归组 B（zcube_group + plane_id 复用前端分组着色）；
      - 链路元数据复用前端拓扑 schema（source/target/speed/cableType/description/networkType）。

    Args:
        num_gpus: GPU 数量
        nics_per_gpu: 每 GPU 网卡数（双口/四口混合接入）
        switch_ports: Leaf 交换机端口数
        leaf_count: 每组 Leaf 数（0 = 自动推导）
        cube_dims: cube 维度列表，如 [8, 16]（2D）或 [8, 8, 16]（3D）；缺省按
                   num_gpus 推导为最接近的 2D/3D 因子
        network_type / prefix / speed: 网络类型/命名前缀/链路速率

    Returns:
        {nodes, edges, stats, meta}：
          nodes: [{id,type,group,podid,layerHint,maxPorts,cabinetId?,
                   zcubeGroup,planeId,cubeRank,cubePos}]
          edges: [{source,target,speed,cableType,description,networkType}]
          stats: ZcubeTopology 统计（leaf_count/downlink_per_leaf 等）
          meta:  {cubeDimensions, dim, numGpus, nicsPerGpu, leafCount,
                  switchPorts, groups}
    """
    zc = ZcubeTopology(num_gpus=num_gpus, nics_per_gpu=nics_per_gpu,
                       leaf_count=leaf_count, switch_ports=switch_ports,
                       network_type=network_type, prefix=prefix)
    stats = zc.calculate()
    zc.create_objects()

    # ---- cube 维度推导 ----
    if not cube_dims:
        cube_dims = _derive_cube_dims(num_gpus)
    dims = [max(1, int(d)) for d in cube_dims]
    if len(dims) < 2:
        dims = [dims[0], max(1, int(math.ceil(num_gpus / dims[0])))]
    # 对齐：dims 乘积不足时补最后一维
    while _prod(dims) < num_gpus:
        dims[-1] += 1
    dims[-1] = min(dims[-1], num_gpus)  # 最后一维不超 GPU 数（余数为碎片）

    # ---- GPU 节点（cube 分组着色：GPU 序号前半 → 组 A，后半 → 组 B，A/B 均衡） ----
    split = (num_gpus + 1) // 2
    servers: List[NetworkObject] = []
    nodes: List[Dict[str, Any]] = []
    gpu_nodes_a = 0
    gpu_nodes_b = 0
    for idx in range(1, num_gpus + 1):
        rank = idx - 1
        pos = _unravel(rank, dims)
        group_label = 'A' if rank < split else 'B'
        group_name = f"{prefix}{group_label}组"
        srv = NetworkObject(
            name=f"GPU_{idx}", obj_type='server', group=group_name,
            podid=f"zcube-{group_label}", max_ports=nics_per_gpu,
            layer_hint='server')
        srv.server_index = idx            # wiring 依赖全局序号（与 designer 一致）
        srv.port_prefix = f"{prefix}网卡"
        servers.append(srv)
        if group_label == 'A':
            gpu_nodes_a += 1
        else:
            gpu_nodes_b += 1
        nodes.append({
            'id': f"GPU_{idx}",
            'type': 'server',
            'group': group_name,
            'podid': f"zcube-{group_label}",
            'layerHint': 'server',
            'maxPorts': nics_per_gpu,
            'zcubeGroup': group_label,
            'planeId': 0 if group_label == 'A' else 1,
            'cubeRank': rank,
            'cubePos': pos,
        })

    # ---- Leaf 节点（复用 create_objects 的 zcube_group/plane_id 着色） ----
    for leaf in zc.leaves:
        nodes.append({
            'id': leaf.name,
            'type': leaf.obj_type,
            'group': leaf.group,
            'podid': leaf.podid,
            'layerHint': 'leaf',
            'maxPorts': leaf.max_ports,
            'zcubeGroup': leaf.zcube_group,
            'planeId': leaf.plane_id,
        })

    # ---- 链路（GPU → Leaf + 组 A↔B 全二部，转前端 schema） ----
    conns = zc.generate_connections(servers)
    edges: List[Dict[str, Any]] = []
    seen = set()
    for c in conns:
        key = (c.a_device, c.z_device, c.a_port)  # 双向边各输出一次（与 design 一致）
        if key in seen:
            continue
        seen.add(key)
        edges.append({
            'source': c.a_device,
            'target': c.z_device,
            'speed': speed,
            'aSpeed': speed,
            'zSpeed': speed,
            'cableType': c.cable_type,
            'description': c.description,
            'networkType': network_type,
            'network_type': network_type,
        })

    meta = {
        'cubeDimensions': dims,
        'dim': len(dims),
        'numGpus': num_gpus,
        'nicsPerGpu': nics_per_gpu,
        'leafCount': stats['leaf_count'],
        'switchPorts': switch_ports,
        'groups': {'A': gpu_nodes_a, 'B': gpu_nodes_b},
        'noSpine': True,
    }
    return {'nodes': nodes, 'edges': edges, 'stats': stats, 'meta': meta}


def _derive_cube_dims(num_gpus: int) -> List[int]:
    """GPU 数 → 最接近立方体的 2D/3D 维度（ATOP 推荐）

    - num_gpus ≤ 512 → 2D cube [x, y]（x 尽量接近 sqrt，y = ceil(N/x)）
    - num_gpus > 512 → 3D cube [x, y, z]（x,y 接近三次根，z = ceil(N/(x*y))）
    """
    n = max(1, int(num_gpus))
    if n <= 512:
        x = max(1, int(math.isqrt(n)))
        while n % x != 0 and x > 1:
            x -= 1
        y = n // x if n % x == 0 else max(1, int(math.ceil(n / max(1, math.isqrt(n)))))
        if n % x != 0:
            x = max(1, math.isqrt(n))
            y = max(1, int(math.ceil(n / x)))
        return [x, y]
    base = max(1, int(round(n ** (1 / 3))))
    x = y = base
    while x * y * base < n:
        base += 1
    x = y = max(1, base)
    z = max(1, int(math.ceil(n / (x * y))))
    return [x, y, z]


def _prod(dims: List[int]) -> int:
    p = 1
    for d in dims:
        p *= d
    return p


def _unravel(rank: int, dims: List[int]) -> List[int]:
    """线性索引 → cube 多维坐标（行主序，与 dims 同长）"""
    coords = []
    r = rank
    for d in reversed(dims):
        coords.append(r % d)
        r //= d
    return list(reversed(coords))
