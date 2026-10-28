"""B5-01 / B5-02 / B5-03（FR-A26）：GPU 共柜三档开关（后端唯一真源）。

与前端 ``src/test/gpuShare.test.ts`` 覆盖同一组验收判据：
  - 档① fixed1：128 台 GPU 占 128 柜；
  - 档③ manual：填 3 → 每柜 ≤3 台；
  - 档② byPower：min(⌊单柜上限 ÷ 单机功率⌋, ⌊可用 U ÷ 机高⌋)，下限 1；
  - 缺失功率按单柜上限计（退化 1 台/柜）并告警；
  - 旧项目未写 ``gpu_share_mode`` + ``gpu_per_cabinet>1`` → 视为人工指定。
"""
import pytest

from gpu_share import (
    GPU_SHARE_MODES,
    gpu_per_cabinet_by_power,
    infer_gpu_share_mode,
    normalize_gpu_share_mode,
    resolve_for_nodes,
    resolve_gpu_per_cabinet,
)
from rack_allocation import DEVICE_TYPE_GPU, DeviceSlot, RackAllocator
from rack_feasibility import pack_cabinets_by_type


def _gpu_nodes(count, power=5250, height=8):
    return [
        {'id': f'gpu-{i + 1}', 'type': 'server', 'domain': 'gpu',
         'powerWatts': power, 'uHeight': height}
        for i in range(count)
    ]


class TestNormalize:
    def test_modes(self):
        assert GPU_SHARE_MODES == ('fixed1', 'byPower', 'manual')

    def test_invalid_fallback(self):
        assert normalize_gpu_share_mode(None) == 'fixed1'
        assert normalize_gpu_share_mode('auto') == 'fixed1'
        assert normalize_gpu_share_mode('byPower') == 'byPower'
        assert normalize_gpu_share_mode('manual') == 'manual'

    def test_infer_legacy(self):
        assert infer_gpu_share_mode(None, 3) == 'manual'
        assert infer_gpu_share_mode(None, 1) == 'fixed1'
        assert infer_gpu_share_mode(None, None) == 'fixed1'
        assert infer_gpu_share_mode('fixed1', 3) == 'fixed1'
        assert infer_gpu_share_mode('byPower', 3) == 'byPower'


class TestFixed1:
    def test_per_cabinet_is_one(self):
        per, warnings = resolve_gpu_per_cabinet('fixed1', 8, [5250], [8], 12000, 38)
        assert per == 1
        assert warnings == []

    def test_preflight_128_gpus_128_cabinets(self):
        packing = pack_cabinets_by_type(_gpu_nodes(128), {'gpuShareMode': 'fixed1'})
        assert packing['byType']['gpu'] == 128


class TestManual:
    def test_three_per_cabinet(self):
        # 3800 W × 3 = 11400 W ≤ 12 kW，U 位 24U ≤ 38U
        packing = pack_cabinets_by_type(
            _gpu_nodes(128, power=3800), {'gpuShareMode': 'manual', 'gpuPerCabinet': 3})
        assert packing['gpuPerCabinet'] == 3
        assert packing['byType']['gpu'] == 43  # ceil(128/3)

    def test_manual_capped_by_power_with_warning(self):
        # 5250 W × 3 = 15750 W > 12 kW → 收敛到 2 台/柜并告警
        packing = pack_cabinets_by_type(
            _gpu_nodes(128), {'gpuShareMode': 'manual', 'gpuPerCabinet': 3})
        assert packing['gpuPerCabinet'] == 2
        assert packing['byType']['gpu'] == 64
        assert any('功率' in w for w in packing['warnings'])

    def test_zero_and_negative_clamped(self):
        assert resolve_gpu_per_cabinet('manual', 0, [], [], 12000, 38)[0] == 1
        assert resolve_gpu_per_cabinet('manual', -5, [], [], 12000, 38)[0] == 1

    def test_legacy_undefined_mode_keeps_value(self):
        packing = pack_cabinets_by_type(_gpu_nodes(10), {'gpuPerCabinet': 5})
        assert packing['byType']['gpu'] == 2


class TestByPower:
    def test_matches_formula(self):
        per = gpu_per_cabinet_by_power([5250], [8], 12000, 38)
        assert per == min(12000 // 5250, 38 // 8) == 2

    def test_power_limited(self):
        assert gpu_per_cabinet_by_power([8000], [8], 12000, 38) == 1

    def test_u_limited(self):
        assert gpu_per_cabinet_by_power([3000], [20], 12000, 38) == 1

    def test_mixed_takes_strictest(self):
        assert gpu_per_cabinet_by_power([5250, 8000], [8, 8], 12000, 38) == 1

    def test_preflight_128_gpus_64_cabinets(self):
        packing = pack_cabinets_by_type(_gpu_nodes(128), {'gpuShareMode': 'byPower'})
        assert packing['byType']['gpu'] == 64

    def test_empty_returns_one(self):
        assert gpu_per_cabinet_by_power([], [], 12000, 38) == 1


class TestDegrade:
    """B5-02：缺失字段回退 12 kW 并告警"""

    def test_missing_power_degrades_to_one(self):
        per, warnings = resolve_gpu_per_cabinet('byPower', None, [0], [8], 12000, 38)
        assert per == 1
        assert any('12000' in w for w in warnings)

    def test_missing_power_limit_fallback(self):
        per, warnings = resolve_gpu_per_cabinet('byPower', None, [5250], [8], 0, 38)
        assert per == 2
        assert any('12000' in w for w in warnings)

    def test_resolve_for_nodes_accepts_camel_case(self):
        nodes = [{'id': 'g1', 'powerWatts': 0, 'uHeight': 8}]
        per, warnings = resolve_for_nodes('byPower', None, nodes, 12000, 38)
        assert per == 1
        assert warnings

    def test_preflight_reports_warnings(self):
        packing = pack_cabinets_by_type(
            _gpu_nodes(2, power=0), {'gpuShareMode': 'byPower'})
        assert packing['byType']['gpu'] == 2
        assert packing['gpuPerCabinet'] == 1
        assert any('12000' in w for w in packing['warnings'])


class TestAllocatorIntegration:
    """落位（RackAllocator）与预检同口径"""

    def _devices(self, count, power=5250, height=8):
        return [
            DeviceSlot(name=f'gpu_{i}', obj_type='server', group='GPU服务器组1',
                       power_watts=power, u_height=height, device_type=DEVICE_TYPE_GPU)
            for i in range(1, count + 1)
        ]

    def _alloc(self, devices, **kwargs):
        alloc = RackAllocator(rack_type=42, power_limit=12000, **kwargs)
        alloc.allocate(devices)
        return alloc

    def test_fixed1_one_per_cabinet(self):
        alloc = self._alloc(self._devices(4), gpu_per_cabinet=8, gpu_share_mode='fixed1')
        assert len(alloc.cabinets) == 4
        assert all(sum(1 for d in c.devices if d.device_type == DEVICE_TYPE_GPU) == 1
                   for c in alloc.cabinets)

    def test_manual_three_per_cabinet(self):
        # 3800 W × 3 = 11400 W ≤ 12 kW，U 位 24U ≤ 38U，功率与 U 位均允许 3 台共柜
        alloc = self._alloc(self._devices(9, power=3800), gpu_per_cabinet=3, gpu_share_mode='manual')
        assert len(alloc.cabinets) == 3

    def test_by_power_two_per_cabinet(self):
        alloc = self._alloc(self._devices(6), gpu_share_mode='byPower')
        assert len(alloc.cabinets) == 3
        assert alloc._gpu_cap == 2

    def test_by_power_missing_power_falls_back_to_one(self):
        alloc = self._alloc(self._devices(2, power=0), gpu_share_mode='byPower')
        assert len(alloc.cabinets) == 2
        assert alloc.gpu_share_warnings

    def test_legacy_no_mode_keeps_gpu_per_cabinet(self):
        alloc = self._alloc(self._devices(6, power=3800), gpu_per_cabinet=3)
        assert len(alloc.cabinets) == 2
