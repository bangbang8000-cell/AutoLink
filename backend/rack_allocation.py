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
from typing import List

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

# 交换机 obj_type 前缀 → 网段
_NETWORK_PREFIXES = ('param_', 'storage_', 'oob_', 'biz_')

# GPU 独占阈值: 功率 ≥ 上限 * GPU_DEDICATE_RATIO 时独占机柜
GPU_DEDICATE_RATIO = 0.5


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
    used_u: int = 0
    devices: List[DeviceSlot] = field(default_factory=list)

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

    def __init__(self, rack_type: int = 42, power_limit: int = 6000,
                 naming_prefix: str = '机柜', gpu_dedicated: bool = False):
        self.rack_type = max(1, int(rack_type or 42))
        self.power_limit = max(1, int(power_limit or 6000))
        self.naming_prefix = naming_prefix or '机柜'
        self.gpu_dedicated = bool(gpu_dedicated)
        self.cabinets: List[CabinetAllocation] = []

    # ------------------------------------------------------------------
    # 对外接口
    # ------------------------------------------------------------------
    def allocate(self, devices: List[DeviceSlot]) -> List[DeviceSlot]:
        """分配全部设备到机柜，就地回填 cabinet 信息，返回设备列表。

        分配顺序: GPU 独占 → GPU 装箱 → 通算 → 存储 → 网络(按网段聚柜)。
        同类型设备按输入顺序装箱，保证结果可复现。
        """
        if not self.cabinets:
            self.cabinets = []
        # 分类（保持组内输入顺序）
        gpu_devs = [d for d in devices if d.device_type == DEVICE_TYPE_GPU]
        compute_devs = [d for d in devices if d.device_type == DEVICE_TYPE_COMPUTE]
        storage_devs = [d for d in devices if d.device_type == DEVICE_TYPE_STORAGE]
        network_devs = [d for d in devices if d.device_type == DEVICE_TYPE_NETWORK]

        for d in gpu_devs:
            self._assign_gpu(d)
        for d in compute_devs:
            self._assign(d, CABINET_TYPE_COMPUTE)
        for d in storage_devs:
            self._assign(d, CABINET_TYPE_STORAGE)
        for d in network_devs:
            self._assign_network(d)

        return devices

    def seed(self, cabinets: List[CabinetAllocation]) -> None:
        """预置已有机柜，用于分阶段分配（保持机柜编号连续）"""
        self.cabinets = list(cabinets)

    # ------------------------------------------------------------------
    # GPU 分配
    # ------------------------------------------------------------------
    def _assign_gpu(self, device: DeviceSlot) -> None:
        """GPU 服务器分配：
        - gpu_dedicated 或 功率 ≥ 上限*ratio → 独占机柜 (1 台/柜)
        - 否则 → GPU 柜功率装箱 (可多台共柜)
        """
        dedicated = self.gpu_dedicated or device.power_watts >= self.power_limit * GPU_DEDICATE_RATIO
        if dedicated:
            cab = self._new_cabinet(CABINET_TYPE_GPU)
            self._place(cab, device)
            return
        cab = self._find_fit_cabinet(CABINET_TYPE_GPU, device)
        if cab is None:
            cab = self._new_cabinet(CABINET_TYPE_GPU)
        self._place(cab, device)

    # ------------------------------------------------------------------
    # 通用装箱
    # ------------------------------------------------------------------
    def _assign(self, device: DeviceSlot, cabinet_type: str) -> None:
        """通算/存储装箱：功率 + U 位约束"""
        cab = self._find_fit_cabinet(cabinet_type, device)
        if cab is None:
            cab = self._new_cabinet(cabinet_type)
        self._place(cab, device)

    def _assign_network(self, device: DeviceSlot) -> None:
        """网络设备装箱：严格按网段聚柜（不同网段不混柜，运维隔离常见做法）"""
        if device.network:
            for c in self.cabinets:
                if c.type != CABINET_TYPE_NETWORK:
                    continue
                if any(d.network == device.network for d in c.devices):
                    if self._can_fit(c, device):
                        self._place(c, device)
                        return
                    # 同网段柜放不下 → 继续找其他同网段柜，不混入其他网段
            cab = self._new_cabinet(CABINET_TYPE_NETWORK)
            self._place(cab, device)
            return
        cab = self._find_fit_cabinet(CABINET_TYPE_NETWORK, device)
        if cab is None:
            cab = self._new_cabinet(CABINET_TYPE_NETWORK)
        self._place(cab, device)

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------
    def _new_cabinet(self, cabinet_type: str) -> CabinetAllocation:
        cab = CabinetAllocation(
            id=len(self.cabinets) + 1,
            name=f"{self.naming_prefix}{len(self.cabinets) + 1}",
            type=cabinet_type,
            power_limit=self.power_limit,
        )
        self.cabinets.append(cab)
        return cab

    def _can_fit(self, cab: CabinetAllocation, device: DeviceSlot) -> bool:
        """判断设备能否放入柜（功率 + U 位双约束）"""
        if cab.total_power + device.power_watts > cab.power_limit:
            return False
        if cab.used_u + device.u_height > self.rack_type:
            return False
        return True

    def _find_fit_cabinet(self, cabinet_type: str, device: DeviceSlot):
        """找第一个可放入的同类型柜（功率 + U 位双约束）"""
        for c in self.cabinets:
            if c.type != cabinet_type:
                continue
            if not self._can_fit(c, device):
                continue
            return c
        return None

    def _place(self, cab: CabinetAllocation, device: DeviceSlot) -> None:
        """将设备放入柜并回填 U 位"""
        device.cabinet_id = cab.id
        device.cabinet_name = cab.name
        device.start_u = cab.used_u + 1
        device.end_u = device.start_u + device.u_height - 1
        cab.used_u += device.u_height
        cab.total_power += device.power_watts
        cab.devices.append(device)
