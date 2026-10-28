"""B1-05 / B1-08 / FR-A01：后端预检与柜位上限用例。

1) 契约部分与前端 src/test/rackFeasibilityContract.test.ts 共读同一份夹具，
   断言「同输入同输出」（含建议文案逐字）；
2) 分配器部分断言「预检不过 → 一次性结构化拒绝、不产生任何落位结果」，
   以及拒绝了就不再多建柜（B1-08）。
"""
import json
from pathlib import Path

import pytest

import rack_feasibility
from rack_allocation import DEVICE_TYPE_GPU, DeviceSlot, RackAllocator

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_JSON = REPO_ROOT / 'src' / 'test' / 'fixtures' / 'rackFeasibilityContract.json'


def _load_cases():
    with CONTRACT_JSON.open('r', encoding='utf-8') as fh:
        return json.load(fh)['cases']


def _build_matrix(spec):
    """行优先铺格（与前端测试同一解释）：fill 依次占用格子，未铺到的为 empty。"""
    rows = [chr(ord('A') + i) for i in range(spec['rows'])]
    cols = list(range(1, spec['cols'] + 1))
    flat = []
    for seg in spec.get('fill') or []:
        flat.extend([seg['type']] * seg['count'])
    cells = []
    index = 0
    for row in rows:
        for col in cols:
            cell_type = flat[index] if index < len(flat) else 'empty'
            cells.append({'row': row, 'col': col, 'type': cell_type,
                          'placeholder': None, 'cabinetId': None})
            index += 1
    return {'schemaVersion': 1, 'name': '契约矩阵', 'rows': rows, 'cols': cols, 'cells': cells}


def _expand_devices(specs):
    devices = []
    for spec in specs:
        for i in range(spec['count']):
            devices.append({
                'id': f"{spec['idPrefix']}-{i + 1}",
                'type': spec['type'],
                'domain': spec['domain'],
                'group': spec['group'],
                'uHeight': spec['uHeight'],
                'powerWatts': spec['powerWatts'],
            })
    return devices


class TestContract:
    """前后端同输入同输出（夹具与前端共读）"""

    @pytest.mark.parametrize('case', _load_cases(), ids=lambda c: c['name'])
    def test_case(self, case):
        result = rack_feasibility.check_rack_feasibility(
            _build_matrix(case['matrix']),
            _expand_devices(case['devices']),
            case.get('opts') or {},
        )
        assert result == case['expected']


def _gpu_devices(count, power=10200, u_height=8):
    return [
        DeviceSlot(name=f'gpu_{i}', obj_type='server', group='GPU服务器组1',
                   power_watts=power, u_height=u_height, device_type=DEVICE_TYPE_GPU)
        for i in range(1, count + 1)
    ]


class TestAllocatorCapacity:
    """B1-08：建柜受柜位约束（60 柜位/128 台 → 拒绝；168 柜位 → 建柜数 ≤168）"""

    def test_rejects_when_cabinets_insufficient(self):
        allocator = RackAllocator(capacity_by_type={'gpu': 60}, slot_count=60)
        devices = _gpu_devices(128)

        with pytest.raises(rack_feasibility.RackCapacityError) as exc:
            allocator.allocate(devices)

        result = exc.value.result
        assert result['ok'] is False
        assert result['shortage']['cabinets'] == 68
        # 一次性拒绝：不产生任何机柜与落位结果
        assert allocator.cabinets == []
        assert all(d.cabinet_id == 0 for d in devices)

    def test_accepts_when_cabinets_sufficient(self):
        allocator = RackAllocator(capacity_by_type={'gpu': 168}, slot_count=168)
        devices = _gpu_devices(128)

        allocator.allocate(devices)

        assert len(allocator.cabinets) <= 168
        assert all(d.cabinet_id != 0 for d in devices)

    def test_no_capacity_configured_keeps_legacy_behavior(self):
        """未配置柜位（designer 无矩阵场景）→ 不预检、不拒绝。"""
        allocator = RackAllocator()
        devices = _gpu_devices(5)

        allocator.allocate(devices)

        assert len(allocator.cabinets) == 5
        assert all(d.cabinet_id != 0 for d in devices)

    def test_new_cabinet_guard_raises_on_overflow(self):
        """兜底守卫：绕过预检直接建柜，超上限即结构化报错。"""
        allocator = RackAllocator(capacity_by_type={'gpu': 1}, slot_count=1)
        allocator._new_cabinet('gpu')

        with pytest.raises(rack_feasibility.RackCapacityError) as exc:
            allocator._new_cabinet('gpu')

        assert exc.value.result['shortage']['byType']['gpu']['missing'] == 1

    def test_scaleup_cabinet_not_limited(self):
        """Scale-Up 柜不属于 4 类需求柜型，不受柜位上限约束（与前端同口径）。"""
        allocator = RackAllocator(capacity_by_type={'gpu': 0}, slot_count=0)
        allocator._new_cabinet('scaleup')
        assert len(allocator.cabinets) == 1


class TestSharedDefaults:
    """常量单源：后端与共享 JSON 同值（前端 cabinetDemand 读同一份）"""

    def test_defaults_loaded_from_shared_json(self):
        defaults = rack_feasibility.RACK_PACKING_DEFAULTS
        assert defaults['rackTypeU'] == 42
        assert defaults['topReservedU'] == 2
        assert defaults['powerLimitW'] == 12000
        assert defaults['gpuPerCabinet'] == 1
        assert defaults['maxCabinetsPerRow'] == 24
