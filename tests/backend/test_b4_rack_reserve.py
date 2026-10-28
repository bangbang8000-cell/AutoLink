"""B4-04 / B4-05：柜型预留表（FR-A23）与 U 位边界口径（FR-A24）

覆盖：
  - 共享 JSON 单源：gpu/compute/storage 底留 4U、network 顶留 2U
  - 表外柜型（scaleup/security/custom/power）回退「底部不预留 + 全局 topReservedU」
  - 1 ≤ startU ≤ endU ≤ rackType：服务器从底留上方起、网络从顶留下方起
  - ``_can_fit`` 与 ``_place`` 同口径：可用 U 判满后不再落位（N13 回归）
"""
import pytest

from rack_allocation import (
    RackAllocator, DeviceSlot,
    DEVICE_TYPE_COMPUTE, DEVICE_TYPE_STORAGE, DEVICE_TYPE_NETWORK,
)
from room_taxonomy import rack_reserve_for, rack_usable_u_for


class TestRackReserveTable:
    """FR-A23：预留按柜型查表"""

    @pytest.mark.parametrize('cabinet_type', ['gpu', 'compute', 'storage'])
    def test_server_types_reserve_bottom_4u(self, cabinet_type):
        assert rack_reserve_for(cabinet_type) == {'bottomReservedU': 4, 'topReservedU': 0}

    def test_network_reserves_top_2u(self):
        assert rack_reserve_for('network') == {'bottomReservedU': 0, 'topReservedU': 2}

    @pytest.mark.parametrize('cabinet_type', ['scaleup', 'security', 'custom', 'power'])
    def test_unknown_type_falls_back_to_global_top(self, cabinet_type):
        """表外柜型：底部不预留，顶部取调用方回退值"""
        assert rack_reserve_for(cabinet_type, 0) == {'bottomReservedU': 0, 'topReservedU': 0}
        assert rack_reserve_for(cabinet_type, 3) == {'bottomReservedU': 0, 'topReservedU': 3}

    def test_usable_u(self):
        assert rack_usable_u_for('gpu', 42) == 38
        assert rack_usable_u_for('network', 42) == 40
        assert rack_usable_u_for('custom', 42, fallback_top_reserved_u=2) == 40


class TestAllocatorReserve:
    """分配器按柜型取预留（FR-A23）+ U 位边界（FR-A24）"""

    def _compute(self, count, u_height=2, power=500):
        return [DeviceSlot(name=f'通算服务器_{i}', obj_type='server', group='通算服务器组',
                           power_watts=power, u_height=u_height, device_type=DEVICE_TYPE_COMPUTE)
                for i in range(1, count + 1)]

    def _switches(self, count, u_height=1, power=200):
        return [DeviceSlot(name=f'参数Leaf_{i}', obj_type='param_leaf', group='参数Leaf组',
                           power_watts=power, u_height=u_height,
                           device_type=DEVICE_TYPE_NETWORK, network='param')
                for i in range(1, count + 1)]

    def test_usable_u_per_type(self):
        allocator = RackAllocator(rack_type=42, power_limit=12000, top_reserved_u=2)
        assert allocator._usable_u_for('compute') == 38
        assert allocator._usable_u_for('storage') == 38
        assert allocator._usable_u_for('network') == 40
        # 表外柜型：回退全局 top_reserved_u、底部不预留
        assert allocator._usable_u_for('custom') == 40

    def test_compute_fills_from_bottom_reserve_up(self):
        """通算柜底留 4U → 首台 U5 起，满柜末台 U42 止（19 台 × 2U = 38U）"""
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(self._compute(19))
        cab = allocator.cabinets[0]
        assert cab.type == 'compute'
        assert cab.used_u == 38
        assert sorted(d.start_u for d in cab.devices)[0] == 5
        assert max(d.end_u for d in cab.devices) == 42
        assert all(5 <= d.start_u <= d.end_u <= 42 for d in cab.devices)
        # 底留 4U 不被占用
        assert all(d.start_u > 4 for d in cab.devices)

    def test_network_fills_from_top_reserve_down(self):
        """网络柜顶留 2U → 最高位 U40 向下，底留不生效（可到 U1）"""
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(self._switches(40))
        cab = allocator.cabinets[0]
        assert cab.type == 'network'
        assert cab.used_u == 40
        assert max(d.end_u for d in cab.devices) == 40
        assert min(d.start_u for d in cab.devices) == 1
        assert all(1 <= d.start_u <= d.end_u <= 40 for d in cab.devices)

    def test_storage_keeps_bottom_reserve(self):
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        devices = [DeviceSlot(name=f'存储服务器_{i}', obj_type='server', group='存储服务器组',
                              power_watts=500, u_height=2, device_type=DEVICE_TYPE_STORAGE)
                   for i in range(1, 4)]
        allocator.allocate(devices)
        cab = allocator.cabinets[0]
        assert cab.type == 'storage'
        assert min(d.start_u for d in cab.devices) == 5
        assert max(d.end_u for d in cab.devices) <= 42

    def test_can_fit_matches_place_when_usable_u_exhausted(self):
        """N13 回归：可用 U 判满后 ``_can_fit`` 必为 False，不再出现越界落位"""
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(self._compute(19))
        cab = allocator.cabinets[0]
        extra = DeviceSlot(name='通算服务器_20', obj_type='server', group='通算服务器组',
                           power_watts=500, u_height=2, device_type=DEVICE_TYPE_COMPUTE)
        assert allocator._can_fit(cab, extra) is False
        # 可用 U = 38 = 底留 4 + 顶留 0 之外的净空间，恰好无余量
        assert cab.used_u + extra.u_height > allocator._usable_u_for(cab.type)

    def test_power_limit_still_blocks(self):
        """预留收紧不影响功率约束（FR-A24 双约束）"""
        allocator = RackAllocator(rack_type=42, power_limit=1000)
        devices = self._compute(2, u_height=1, power=600)
        allocator.allocate(devices)
        cabs = allocator.cabinets
        # 600W + 600W > 1000W → 每柜只放 1 台，两台各占一柜
        assert len(cabs) == 2
        assert [len(c.devices) for c in cabs] == [1, 1]
        assert all(c.total_power <= 1000 for c in cabs)
