"""
AutoLink V2.9.0-T1 - 机柜分配算法（多约束装箱）

核心目标: 让机柜规划贴近现实物理约束
  - 功率约束优先: 每柜设备总功率 ≤ power_limit_per_rack
  - U 位约束次优: 已用 U + u_height ≤ rack_type
  - 类型约束:
      * GPU 服务器 (功率 ≥ 上限 50%) 独占机柜 (1 台/柜), 覆盖 DGX H100/H200 场景
      * GPU 服务器 (功率 < 上限 50%) 按功率装箱 (如 MLU590 3.8KW 在 12KW 柜 → 3 台)
      * 通算/存储服务器 功率 + U 位联合装箱 (多台共柜)
      * 网络设备 (param/storage/oob/biz 交换机) 按网段聚柜 (网络柜), 多台共柜
  - gpu_dedicated 开关: 开启时 GPU 服务器无条件 1 台/柜 (硬约束)

用法:
    allocator = RackAllocator(rack_type=42, power_limit=12000, naming_prefix='机柜')
    devices = [DeviceSlot(name='GPU服务器_1', obj_type='server', group='GPU服务器组1',
                          power_watts=10200, u_height=8, device_type='gpu')]
    allocator.allocate(devices)   # 就地回填 cabinet_id/cabinet_name/start_u/end_u
    cabinets = allocator.cabinets # 机柜分配结果
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from rack_feasibility import (
    DEMAND_CABINET_TYPES,
    RackCapacityError,
    check_rack_feasibility_by_capacity,
    slot_to_node,
)
# B5-01 / B5-02（FR-A26）：GPU 共柜三档（与前端 shared/gpuShare.ts 同口径）
from gpu_share import resolve_gpu_per_cabinet
# B4-04 / FR-A23：预留按柜型查表（与前端 RACK_RESERVE_BY_TYPE 同源）
from room_taxonomy import rack_reserve_for

# --- 设备类型 ---
DEVICE_TYPE_GPU = 'gpu'          # GPU 服务器
DEVICE_TYPE_COMPUTE = 'compute'  # 通算服务器
DEVICE_TYPE_STORAGE = 'storage'  # 存储服务器
DEVICE_TYPE_NETWORK = 'network'  # 网络设备(交换机)

# --- 机柜类型 ---
CABINET_TYPE_GPU = 'gpu'
CABINET_TYPE_COMPUTE = 'compute'
CABINET_TYPE_STORAGE = 'storage'
CABINET_TYPE_NETWORK = 'network'
CABINET_TYPE_SCALEUP = 'scaleup'   # V2.9.3-T3: Scale-Up GPU 节点柜
# 5.2.5-525-c：前端 8 种机柜类型与后端收敛——补齐 security/custom/power 语义（分配器不主动生成，
# 但标记/校验/导出/回写可识别，避免前端标记类型在后端无对应）
CABINET_TYPE_SECURITY = 'security'   # 安全柜（合规/堡垒机等，自定义标记域）
CABINET_TYPE_CUSTOM = 'custom'       # 自定义柜（任意设备域）
CABINET_TYPE_POWER = 'power'         # 电源柜（无设备，仅占位标记）

# 交换机 obj_type 前缀 → 网段
_NETWORK_PREFIXES = ('param_', 'storage_', 'oob_', 'biz_', 'combined_')

# GPU 独占阈值: 功率 ≥ 上限 * GPU_DEDICATE_RATIO 时独占机柜
GPU_DEDICATE_RATIO = 0.5

# 机柜类型全集（分桶索引用，v2.9.1-T6；5.2.5-525-c 扩为前端 8 种）
_CABINET_TYPES = (CABINET_TYPE_GPU, CABINET_TYPE_COMPUTE, CABINET_TYPE_STORAGE,
                  CABINET_TYPE_NETWORK, CABINET_TYPE_SCALEUP,
                  CABINET_TYPE_SECURITY, CABINET_TYPE_CUSTOM, CABINET_TYPE_POWER)


@dataclass
class DeviceSlot:
    """待分配设备（分配结果就地回填）"""
    name: str
    obj_type: str = 'server'
    group: str = ''
    power_watts: int = 0
    u_height: int = 1
    device_type: str = DEVICE_TYPE_GPU   # gpu/compute/storage/network
    network: str = ''                    # 网段标识 (param/storage/oob/biz)，网络设备用
    # V2.9.3-T3: Scale-Up GPU 域 ID (-1=非 Scale-Up 节点)
    scaleup_domain: int = -1
    # V3.0.0-T0-5: GPU 池 ID (''=非池化，走原逻辑)；同池 GPU 聚柜不混池
    pool: str = ''
    # 分配结果
    cabinet_id: int = 0
    cabinet_name: str = ''
    start_u: int = 0
    end_u: int = 0


@dataclass
class CabinetAllocation:
    """机柜分配结果"""
    id: int
    name: str
    type: str
    power_limit: int
    total_power: int = 0
    used_u_bottom: int = 0  # 底部上架区已用 U（服务器类）
    used_u_top: int = 0     # 顶部上架区已用 U（网络类，从机柜顶部向下）
    devices: List[DeviceSlot] = field(default_factory=list)

    @property
    def used_u(self) -> int:
        """总已用 U（底部 + 顶部）"""
        return self.used_u_bottom + self.used_u_top

    @property
    def device_count(self) -> int:
        return len(self.devices)

    @property
    def percent(self) -> float:
        """功率利用率 (%)"""
        if self.power_limit <= 0:
            return 0.0
        return round(self.total_power / self.power_limit * 100, 1)

    @property
    def exceeded(self) -> bool:
        return self.total_power > self.power_limit


def infer_device_type(obj_type: str, group: str = '') -> str:
    """根据 obj_type + group 推断设备类型"""
    # V2.9.3-T3: Scale-Up GPU 节点 → GPU 类型 (走 GPU 分配逻辑)
    if obj_type == 'scaleup_gpu':
        return DEVICE_TYPE_GPU
    if obj_type != 'server':
        return DEVICE_TYPE_NETWORK
    g = group or ''
    if 'GPU' in g:
        return DEVICE_TYPE_GPU
    if '存储' in g:
        return DEVICE_TYPE_STORAGE
    return DEVICE_TYPE_COMPUTE


def infer_network(obj_type: str) -> str:
    """从交换机 obj_type 前缀推断网段 (param/storage/oob/biz)"""
    for prefix in _NETWORK_PREFIXES:
        if obj_type.startswith(prefix):
            return prefix.rstrip('_')
    return ''


class RackAllocator:
    """多约束机柜装箱分配器"""

    def __init__(self, rack_type: int = 42, power_limit: int = 12000,
                 naming_prefix: str = '机柜', gpu_dedicated: bool = False,
                 top_reserved_u: int = 2, server_mount_from: str = 'bottom',
                 network_mount_from: str = 'top',
                 gpu_per_cabinet: int = 1,
                 gpu_share_mode: Optional[str] = None,
                 capacity_by_type: Optional[Dict[str, int]] = None,
                 slot_count: Optional[int] = None):
        self.rack_type = max(1, int(rack_type or 42))
        self.power_limit = max(1, int(power_limit or 12000))
        self.naming_prefix = naming_prefix or '机柜'
        self.gpu_dedicated = bool(gpu_dedicated)
        # 5.2.4-524-d: GPU 每柜台数上限（默认 1 柜 1 台，与前端矩阵硬约束对齐；显式 >1 才多台共柜）
        self.gpu_per_cabinet = max(1, int(gpu_per_cabinet or 1))
        # B5-01 / FR-A26：GPU 共柜档位（None = 旧口径，直接按 gpu_per_cabinet）
        self.gpu_share_mode = gpu_share_mode
        # 实际每柜上限：allocate() 内按档位解析（byPower 需设备功率/机高）
        self._gpu_cap = self.gpu_per_cabinet
        # B5-02：档位降级告警（功率上限/单机功率缺失时）
        self.gpu_share_warnings: List[str] = []
        # M5: 顶部预留 U 数（默认 2U）+ 上架方向（服务器从底部向上、网络从顶部向下）
        self.top_reserved_u = max(0, int(top_reserved_u or 0))
        self.server_mount_from = server_mount_from or 'bottom'
        self.network_mount_from = network_mount_from or 'top'
        # B4-04 / FR-A23：可用 U 按柜型查表（服务器类底留 4U、网络柜顶留 2U）；
        # 未知柜型回退 self.top_reserved_u。_usable_u 仅作兼容保留（全局口径）。
        self._usable_u = max(1, self.rack_type - self.top_reserved_u)
        # B1-08 / FR-A01: 柜位上限（各柜型可建柜数）。None = 不设限（designer 无矩阵场景保持原行为）
        self.capacity_by_type: Optional[Dict[str, int]] = (
            None if capacity_by_type is None
            else {t: max(0, int(capacity_by_type.get(t) or 0)) for t in DEMAND_CABINET_TYPES}
        )
        self.slot_count = None if slot_count is None else max(0, int(slot_count))
        # 本次 allocate 内已占用的柜位数（含 seed 预置），_new_cabinet 超限即抛
        self._capacity_used: Dict[str, int] = {}
        self.cabinets: List[CabinetAllocation] = []
        # v2.9.1-T6: 按机柜类型分桶索引（保持创建顺序），U 位满的柜惰性移除
        self._buckets: dict = {t: [] for t in _CABINET_TYPES}
        # V3.4.1-H-P1: 网段 → 网络柜二级索引（_allocate_network 只在同网段柜内均摊，
        # 消除 O(交换机数×网络柜数×柜内设备) 的线性扫描；2048 规模下约 330 万次操作降为 O(S)）
        self._network_index: dict = {}

    # ------------------------------------------------------------------
    # 对外接口
    # ------------------------------------------------------------------
    def allocate(self, devices: List[DeviceSlot]) -> List[DeviceSlot]:
        """分配全部设备到机柜，就地回填 cabinet 信息，返回设备列表。

        分配顺序: GPU 独占 → GPU 装箱 → 通算 → 存储 → 网络(按网段聚柜)。
        B1-06 / FR-A02：通算/存储/网络按整批 round-robin 均摊（同柜型各柜设备数极差 ≤1），
        设备按输入顺序落位，保证结果可复现。

        B1-05 / B1-08：配置了 ``capacity_by_type`` 时先跑与前端同一个预检
        （``rack_feasibility.check_rack_feasibility``），不足则一次性抛
        ``RackCapacityError``——不产生任何部分落位结果。
        """
        self._capacity_used = {}
        for existing in self.cabinets:
            self._capacity_used[existing.type] = self._capacity_used.get(existing.type, 0) + 1
        if self.capacity_by_type is not None:
            result = self.preflight(devices)
            if not result['ok']:
                raise RackCapacityError(result)
        if not self.cabinets:
            self.cabinets = []
        # 分类（保持组内输入顺序）
        gpu_devs = [d for d in devices if d.device_type == DEVICE_TYPE_GPU]
        compute_devs = [d for d in devices if d.device_type == DEVICE_TYPE_COMPUTE]
        storage_devs = [d for d in devices if d.device_type == DEVICE_TYPE_STORAGE]
        network_devs = [d for d in devices if d.device_type == DEVICE_TYPE_NETWORK]

        # B5-01 / B5-02（FR-A26）：按档位解析本次落位的每柜 GPU 上限
        self._gpu_cap, gpu_warnings = resolve_gpu_per_cabinet(
            self.gpu_share_mode,
            self.gpu_per_cabinet,
            [int(d.power_watts or 0) for d in gpu_devs],
            [int(d.u_height or 1) for d in gpu_devs],
            self.power_limit,
            self._usable_u_for(CABINET_TYPE_GPU),
        )
        self.gpu_share_warnings = gpu_warnings
        for d in gpu_devs:
            self._assign_gpu(d)
        self._allocate_batch(compute_devs, CABINET_TYPE_COMPUTE)
        self._allocate_batch(storage_devs, CABINET_TYPE_STORAGE)
        self._build_network_index()
        self._allocate_network(network_devs)

        return devices

    def preflight(self, devices: List[DeviceSlot]) -> Dict:
        """柜位可行性预检（与前端 checkRackFeasibility 同输入同输出）。

        剩余容量 = capacity_by_type - 已存在柜数（seed 预置的柜也占柜位），
        因此分阶段分配（先服务器、后交换机）时不会重复计算。
        """
        configured = self.capacity_by_type or {t: 0 for t in DEMAND_CABINET_TYPES}
        remaining = {
            t: max(0, configured.get(t, 0) - self._capacity_used.get(t, 0))
            for t in DEMAND_CABINET_TYPES
        }
        return check_rack_feasibility_by_capacity(
            [slot_to_node(d) for d in devices],
            remaining,
            self.slot_count or 0,
            self._packing_opts(),
        )

    def _packing_opts(self) -> Dict:
        """预检参数：与前端 cabinetDemand 同口径。

        分配器按 ``_can_fit``（功率 + 可用 U 按柜型查表）装箱、不考虑理线间隔，
        故这里传 ``interSwitchGapU=0``；``topReservedU`` 只作未知柜型回退值，
        gpu/compute/storage/network 的预留由共享 JSON 的 ``rackReserveByType`` 决定。
        """
        return {
            'rackType': self.rack_type,
            'topReservedU': self.top_reserved_u,
            'powerLimit': self.power_limit,
            'gpuPerCabinet': self.gpu_per_cabinet,
            'gpuShareMode': self.gpu_share_mode,
            'interSwitchGapU': 0,
        }

    # ------------------------------------------------------------------
    # B4-04 / FR-A23：按柜型的预留与可用 U
    # ------------------------------------------------------------------
    def _reserve_for(self, cabinet_type: str) -> Dict[str, int]:
        """柜型预留：表中有的以表为准，未知柜型回退全局 top_reserved_u（底部不预留）。"""
        return rack_reserve_for(cabinet_type, self.top_reserved_u)

    def _usable_u_for(self, cabinet_type: str) -> int:
        """柜型可用 U = 总 U − 底部预留 − 顶部预留（至少 1）。"""
        reserve = self._reserve_for(cabinet_type)
        return max(1, self.rack_type - reserve['bottomReservedU'] - reserve['topReservedU'])

    def seed(self, cabinets: List[CabinetAllocation]) -> None:
        """预置已有机柜，用于分阶段分配（保持机柜编号连续）"""
        self.cabinets = list(cabinets)
        self._buckets = {t: [] for t in _CABINET_TYPES}
        self._network_index = {}
        for c in self.cabinets:
            if c.used_u < self._usable_u_for(c.type):
                self._buckets[c.type].append(c)

    # ------------------------------------------------------------------
    # GPU 分配
    # ------------------------------------------------------------------
    def _assign_gpu(self, device: DeviceSlot) -> None:
        """GPU 服务器分配：
        - Scale-Up GPU 节点 (scaleup_domain >= 0) → 独占机柜 (1 台/柜, 类型 scaleup)
        - V3.0.0-T0-5: 池化 GPU (pool 非空) → 同池聚柜优先（池间不混柜）
        - gpu_dedicated 或 功率 ≥ 上限*ratio → 独占机柜 (1 台/柜)
        - 否则 → GPU 柜装箱：每柜最多 gpu_per_cabinet 台（5.2.4-524-d，默认 1 柜 1 台；
          显式 gpu_per_cabinet>1 才多台共柜，仍受功率+U 位约束）
        """
        if device.scaleup_domain >= 0:
            # V2.9.3-T3: 1 台/柜; 输入顺序(域内 GPU 连续)保证域内柜号相邻
            cab = self._new_cabinet(CABINET_TYPE_SCALEUP)
            self._place(cab, device)
            return
        if device.pool:
            # 池化：优先放入同池已有 GPU 柜（功率+U 位约束），找不到则新开（保持池隔离）
            for c in self._buckets.get(CABINET_TYPE_GPU, []):
                if any(d.pool == device.pool for d in c.devices) and self._can_fit(c, device):
                    self._place(c, device)
                    return
            cab = self._new_cabinet(CABINET_TYPE_GPU)
            self._place(cab, device)
            return
        dedicated = self.gpu_dedicated or device.power_watts >= self.power_limit * GPU_DEDICATE_RATIO
        if dedicated:
            cab = self._new_cabinet(CABINET_TYPE_GPU)
            self._place(cab, device)
            return
        # 5.2.4-524-d: 找已有 GPU 柜——需未达每柜 GPU 上限且可放下（多台共柜仅在 gpu_per_cabinet>1 时发生）
        cab = self._find_gpu_fit_cabinet(device)
        if cab is None:
            cab = self._new_cabinet(CABINET_TYPE_GPU)
        self._place(cab, device)

    def _find_gpu_fit_cabinet(self, device: DeviceSlot) -> Optional[CabinetAllocation]:
        """在 GPU 桶中找可放下且未达每柜 GPU 上限的柜（上限按档位解析，默认 1 柜 1 台）"""
        for c in self._buckets.get(CABINET_TYPE_GPU, []):
            gpu_in_cab = sum(1 for d in c.devices if d.device_type == DEVICE_TYPE_GPU)
            if gpu_in_cab >= self._gpu_cap:
                continue
            if self._can_fit(c, device):
                return c
        return None

    # ------------------------------------------------------------------
    # 通用装箱（B1-06 / FR-A02：同柜型内跨柜均摊，替代柜内贪心）
    # ------------------------------------------------------------------
    def _allocate_batch(self, devices: List[DeviceSlot], cabinet_type: str,
                        network: str = '',
                        existing: Optional[List[CabinetAllocation]] = None) -> None:
        """整批均摊：先按 first-fit 试算新柜数并预建，再 round-robin 轮转落位。

        均摊是分配顺序变更：同柜型各柜设备数极差 ≤1，总落位数与贪心版一致。
        ``network`` 非空时把新建网络柜登记进网段索引（保持同网段聚柜）。
        """
        if not devices:
            return
        targets = list(self._buckets.get(cabinet_type, []) if existing is None
                       else existing)
        created = [self._new_cabinet(cabinet_type)
                   for _ in range(self._count_new_cabinets(targets, devices, cabinet_type))]
        if network:
            for cab in created:
                self._network_index.setdefault(network, []).append(cab)
        targets.extend(created)

        cursor = 0
        for device in devices:
            size = len(targets)
            for attempt in range(size):
                idx = (cursor + attempt) % size
                cab = targets[idx]
                if self._fits_state(cab.used_u, cab.total_power, device, cabinet_type):
                    self._place(cab, device)
                    cursor = (idx + 1) % size
                    break
            else:
                # 均摊后仍装不下（U 位碎片/超柜高）→ 按需补柜，仍受柜位上限约束
                cab = self._new_cabinet(cabinet_type)
                targets.append(cab)
                if network:
                    self._network_index.setdefault(network, []).append(cab)
                self._place(cab, device)
                cursor = len(targets) - 1
        self._prune_empty_tail(created)

    def _allocate_network(self, devices: List[DeviceSlot]) -> None:
        """网络设备：严格按网段聚柜（不同网段不混柜），网段内跨柜均摊。"""
        groups: Dict[str, List[DeviceSlot]] = {}
        for d in devices:
            groups.setdefault(d.network, []).append(d)
        for net, group in groups.items():
            if net:
                existing = list(self._network_index.get(net, []))
            else:
                existing = list(self._buckets.get(CABINET_TYPE_NETWORK, []))
            self._allocate_batch(group, CABINET_TYPE_NETWORK, network=net,
                                 existing=existing)

    def _count_new_cabinets(self, existing: List[CabinetAllocation],
                            devices: List[DeviceSlot], cabinet_type: str) -> int:
        """first-fit 试算：给定已同型柜，装下这批设备所需的新柜数（不产生副作用）。"""
        states = [(c.used_u, c.total_power) for c in existing]
        new_cabinets = 0
        for device in devices:
            for i, (used_u, total_power) in enumerate(states):
                if self._fits_state(used_u, total_power, device, cabinet_type):
                    states[i] = (used_u + device.u_height, total_power + device.power_watts)
                    break
            else:
                states.append((device.u_height, device.power_watts))
                new_cabinets += 1
        return new_cabinets

    def _prune_empty_tail(self, created: List[CabinetAllocation]) -> None:
        """裁掉本批预建却未用到的空柜（只裁尾部，保证柜号连续）。"""
        while created and not created[-1].devices:
            cab = created.pop()
            if self.cabinets and self.cabinets[-1] is cab:
                self.cabinets.pop()
            bucket = self._buckets.get(cab.type)
            if bucket and cab in bucket:
                bucket.remove(cab)
            for cabs in self._network_index.values():
                if cab in cabs:
                    cabs.remove(cab)
            self._capacity_used[cab.type] = max(0, self._capacity_used.get(cab.type, 0) - 1)

    def _build_network_index(self) -> None:
        """从活跃网络柜重建 网段 → 柜 二级索引（覆盖 seed 预置的柜）"""
        self._network_index = {}
        for c in self._buckets.get(CABINET_TYPE_NETWORK, []):
            if c.devices:
                net = c.devices[0].network
                if net:
                    self._network_index.setdefault(net, []).append(c)

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------
    def _new_cabinet(self, cabinet_type: str) -> CabinetAllocation:
        # B1-08 / FR-A01: 兜底守卫——预检已放过时理论上不会触发；一旦触发说明
        # 装箱算法比预检更悲观，必须结构化报错而不是静默多建柜。
        limit = self._type_limit(cabinet_type)
        used = self._capacity_used.get(cabinet_type, 0)
        if limit is not None and used >= limit:
            raise RackCapacityError(self._capacity_shortage_result(cabinet_type))
        cab = CabinetAllocation(
            id=len(self.cabinets) + 1,
            name=f"{self.naming_prefix}{len(self.cabinets) + 1}",
            type=cabinet_type,
            power_limit=self.power_limit,
        )
        self.cabinets.append(cab)
        self._buckets[cab.type].append(cab)
        self._capacity_used[cabinet_type] = used + 1
        return cab

    def _type_limit(self, cabinet_type: str) -> Optional[int]:
        """该柜型可建柜上限；未配置柜位约束或非需求柜型（scaleup/security/custom/power）返回 None。"""
        if self.capacity_by_type is None:
            return None
        return self.capacity_by_type.get(cabinet_type)

    def _capacity_shortage_result(self, cabinet_type: str) -> Dict:
        """建柜超限时的结构化拒绝结果（与 check_rack_feasibility 同结构）。"""
        capacity = self.capacity_by_type or {}
        by_type: Dict[str, Dict[str, int]] = {}
        for t in DEMAND_CABINET_TYPES:
            used = self._capacity_used.get(t, 0) + (1 if t == cabinet_type else 0)
            limit = capacity.get(t, 0)
            by_type[t] = {'required': used, 'available': limit, 'missing': max(0, used - limit)}
        return {
            'ok': False,
            'reason': 'cabinet_capacity_exceeded',
            'cabinetType': cabinet_type,
            'required': {t: self._capacity_used.get(t, 0) + (1 if t == cabinet_type else 0)
                         for t in DEMAND_CABINET_TYPES},
            'requiredCabinets': sum(v['required'] for v in by_type.values()),
            'capacity': {
                'byType': {t: capacity.get(t, 0) for t in DEMAND_CABINET_TYPES},
                'total': sum(capacity.get(t, 0) for t in DEMAND_CABINET_TYPES),
                'slots': self.slot_count or 0,
            },
            'shortage': {
                'cabinets': by_type[cabinet_type]['missing'] or 1,
                'u': 0,
                'power': 0,
                'byType': by_type,
            },
            'suggestions': [
                f'{cabinet_type} 柜位不足：已建 {self._capacity_used.get(cabinet_type, 0)} 柜 / '
                f'上限 {capacity.get(cabinet_type, 0)} 柜，请扩容柜位或提高单柜密度'
            ],
            'gpuPerCabinetSuggest': None,
            'unplaceable': [],
            'totalRequiredU': 0,
            'totalRequiredPowerW': 0,
        }

    def _can_fit(self, cab: CabinetAllocation, device: DeviceSlot) -> bool:
        """判断设备能否放入柜（功率 + 按柜型可用 U 双约束）"""
        return self._fits_state(cab.used_u, cab.total_power, device, cab.type)

    def _fits_state(self, used_u: int, total_power: int, device: DeviceSlot,
                    cabinet_type: str) -> bool:
        """纯状态可放判定（供 round-robin 试算复用，避免构造临时柜对象）。

        B4-04 / FR-A24：可用 U 与 ``_place`` 完全同口径——按柜型扣除底部/顶部预留，
        设备必须落在 ``[bottom+1, rack_type-top]`` 区间内（修复 N13：越界落到顶部预留区）。
        """
        usable_u = self._usable_u_for(cabinet_type)
        if used_u + device.u_height > usable_u:
            return False
        if total_power + device.power_watts > self.power_limit:
            return False
        return True

    def _place(self, cab: CabinetAllocation, device: DeviceSlot) -> None:
        """将设备放入柜并回填 U 位（B4-04：网络设备从顶部预留上方向下，其余从底部预留上方向上）。"""
        device.cabinet_id = cab.id
        device.cabinet_name = cab.name
        reserve = self._reserve_for(cab.type)
        from_top = device.device_type == DEVICE_TYPE_NETWORK
        if from_top:
            top_u = self.rack_type - reserve['topReservedU']
            device.start_u = top_u - cab.used_u_top - device.u_height + 1
            cab.used_u_top += device.u_height
        else:
            device.start_u = reserve['bottomReservedU'] + cab.used_u_bottom + 1
            cab.used_u_bottom += device.u_height
        device.end_u = device.start_u + device.u_height - 1
        cab.total_power += device.power_watts
        cab.devices.append(device)
        # 可用 U 已满 → 从活跃桶移除（任何设备都无法再放入）
        if cab.used_u >= self._usable_u_for(cab.type):
            bucket = self._buckets.get(cab.type)
            if bucket and cab in bucket:
                bucket.remove(cab)
