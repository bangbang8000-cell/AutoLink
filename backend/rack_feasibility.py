"""全局可行性预检（B1-03 / B1-05 · FR-A01）。

逐字镜像前端 ``src/utils/rackFeasibility.ts`` + ``src/utils/cabinetDemand.ts``：
同一份设备清单 + 同一张矩阵，前后端必须得到逐字段一致的结论
（契约夹具 ``src/test/fixtures/rackFeasibilityContract.json`` 被两侧测试同时读取）。

边界：
  - 纯函数：不读盘、不写盘、无缓存（设备清单或柜位任一变化即重算）；
  - 拒绝（ok=False）时调用方不得写入任何落位结果；
  - 常量全部取自 ``room_taxonomy.RACK_PACKING_DEFAULTS``（共享 JSON），禁止本地另写数值；
  - 取整统一 half-up（``floor(x + 0.5)``），与 JS ``Math.round`` 对齐。

用法：
    result = check_rack_feasibility(matrix_dict, [slot_to_node(d) for d in devices])
    if not result['ok']:
        raise RackCapacityError(result)          # 一次性拒绝，不产生部分结果
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

from room_taxonomy import PLACEABLE_CABINET_TYPES, RACK_PACKING_DEFAULTS, rack_reserve_for

from gpu_share import resolve_for_nodes

# 设备域遍历顺序（与前端 DEMAND_CABINET_TYPES 一致）
DEMAND_CABINET_TYPES: tuple = ('gpu', 'network', 'storage', 'compute')

TYPE_LABELS: Dict[str, str] = {
    'gpu': 'GPU柜',
    'network': '网络柜',
    'storage': '存储柜',
    'compute': '通算柜',
}

_DOMAIN_TO_CABINET: Dict[str, str] = {
    'gpu': 'gpu',
    'compute': 'compute',
    'storage': 'storage',
    'network': 'network',
}

_GPU_DEFAULT_U_HEIGHT = 4


# ----------------------------------------------------------------------
# 柜型判定（镜像前端 rackCabinetTypes.toCabinetType）
# ----------------------------------------------------------------------
def to_cabinet_type(node: Dict[str, Any]) -> str:
    """从节点推断柜型：domain 优先，缺失时用中文 group 兜底（与前端同口径）。"""
    if node.get('type') == 'scaleup_gpu':
        return 'scaleup'
    if node.get('type') != 'server':
        return 'network'

    domain = node.get('domain')
    if domain and domain in _DOMAIN_TO_CABINET:
        return _DOMAIN_TO_CABINET[domain]

    group = node.get('group') or ''
    if '存储' in group:
        return 'storage'
    if '通算' in group:
        return 'compute'
    return 'gpu'


def slot_to_node(slot: Any) -> Dict[str, Any]:
    """``DeviceSlot`` → 预检节点（保持与前端 RackTopologyNode 精简字段一致）。"""
    return {
        'id': getattr(slot, 'name', ''),
        'type': getattr(slot, 'obj_type', 'server'),
        'group': getattr(slot, 'group', ''),
        'domain': getattr(slot, 'device_type', ''),
        'uHeight': int(getattr(slot, 'u_height', 0) or 0),
        'powerWatts': int(getattr(slot, 'power_watts', 0) or 0),
    }


# ----------------------------------------------------------------------
# 柜内装箱（镜像前端 packCabinets / packCabinetsByType）
# ----------------------------------------------------------------------
def _opt(opts: Dict[str, Any], key: str) -> Any:
    return opts.get(key)


def _resolve_power_limit(opts: Dict[str, Any]) -> int:
    value = _opt(opts, 'powerLimit')
    return max(1, int(RACK_PACKING_DEFAULTS['powerLimitW'] if value is None else value))


def _resolve_usable_u(opts: Dict[str, Any]) -> int:
    rack_type = _opt(opts, 'rackType')
    rack_type = max(1, int(RACK_PACKING_DEFAULTS['rackTypeU'] if rack_type is None else rack_type))
    top_reserved = _opt(opts, 'topReservedU')
    top_reserved = max(0, int(RACK_PACKING_DEFAULTS['topReservedU'] if top_reserved is None else top_reserved))
    return max(1, rack_type - top_reserved)


def _resolve_usable_u_for(opts: Dict[str, Any], cabinet_type: str) -> int:
    """按柜型取可用 U（B4-04 / FR-A23）：预留查共享 JSON，``topReservedU`` 仅作未知柜型回退。"""
    rack_type = _opt(opts, 'rackType')
    rack_type = max(1, int(RACK_PACKING_DEFAULTS['rackTypeU'] if rack_type is None else rack_type))
    top_opt = _opt(opts, 'topReservedU')
    reserve = rack_reserve_for(
        cabinet_type,
        None if top_opt is None else max(0, int(top_opt)),
    )
    return max(1, rack_type - reserve['bottomReservedU'] - reserve['topReservedU'])


def _u_height(node: Dict[str, Any]) -> int:
    value = node.get('uHeight')
    return max(1, int(_GPU_DEFAULT_U_HEIGHT if value is None else value))


def _power_watts(node: Dict[str, Any]) -> int:
    value = node.get('powerWatts')
    return max(0, int(0 if value is None else value))


def _pack_cabinets(
    devices: Sequence[Dict[str, Any]],
    opts: Dict[str, Any],
    power_limited: bool,
    gap_per_extra_u: int,
    cabinet_type: str,
) -> Dict[str, Any]:
    """单个柜型的装箱：U 与功率双约束（等价于前端 packCabinets）。"""
    usable_u = _resolve_usable_u_for(opts, cabinet_type)
    power_limit = _resolve_power_limit(opts)
    unplaceable: List[str] = []
    cabinets = 0
    used_u = 0
    used_power = 0
    count = 0
    required_u = 0
    required_power_w = 0

    for device in devices:
        height = _u_height(device)
        power = _power_watts(device)
        if height > usable_u or (power_limited and power > power_limit):
            unplaceable.append(str(device.get('id') or ''))
            continue
        required_u += height
        required_power_w += power

        gap = gap_per_extra_u if count > 0 else 0
        u_fits = used_u + gap + height <= usable_u
        power_fits = (not power_limited) or used_power + power <= power_limit
        if count > 0 and (not u_fits or not power_fits):
            cabinets += 1
            used_u = 0
            used_power = 0
            count = 0
        used_u += height + (gap_per_extra_u if count > 0 else 0)
        used_power += power
        count += 1
    if count > 0:
        cabinets += 1

    return {
        'cabinets': cabinets,
        'deviceCount': len(devices) - len(unplaceable),
        'requiredU': required_u,
        'requiredPowerW': required_power_w,
        'unplaceable': unplaceable,
    }


def pack_cabinets_by_type(
    devices: Sequence[Dict[str, Any]],
    opts: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """设备清单 → 各柜型精确需求柜数（预检唯一算法，镜像前端 packCabinetsByType）。"""
    opts = opts or {}
    usable_u = _resolve_usable_u(opts)
    # B4-04 / FR-A23：可用 U 按柜型拆分（GPU/通算/存储 38U、网络 40U）
    usable_u_by_type: Dict[str, int] = {
        t: _resolve_usable_u_for(opts, t) for t in DEMAND_CABINET_TYPES
    }
    power_limit = _resolve_power_limit(opts)
    gap_opt = opts.get('interSwitchGapU')
    inter_switch_gap_u = max(
        0, int(RACK_PACKING_DEFAULTS['interSwitchGapU'] if gap_opt is None else gap_opt)
    )

    grouped: Dict[str, List[Dict[str, Any]]] = {t: [] for t in DEMAND_CABINET_TYPES}
    for node in devices:
        t = to_cabinet_type(node)
        if t in grouped:
            grouped[t].append(node)

    # GPU：每柜台数按档位解析（B5-01/B5-02 / FR-A26；byPower 需设备功率/机高，故在分组后计算）
    gpu_per_cabinet, gpu_share_warnings = resolve_for_nodes(
        opts.get('gpuShareMode'),
        opts.get('gpuPerCabinet'),
        grouped['gpu'],
        power_limit,
        usable_u_by_type['gpu'],
    )

    by_type: Dict[str, int] = {t: 0 for t in DEMAND_CABINET_TYPES}
    detail: Dict[str, Dict[str, Any]] = {
        t: {'cabinets': 0, 'deviceCount': 0, 'requiredU': 0, 'requiredPowerW': 0, 'unplaceable': []}
        for t in DEMAND_CABINET_TYPES
    }
    unplaceable: List[str] = []
    required_u = 0
    required_power_w = 0

    # GPU：每柜固定台数，柜高不足的设备单独计入不可落位
    gpu_fitting: List[Dict[str, Any]] = []
    for device in grouped['gpu']:
        if _u_height(device) > usable_u_by_type['gpu']:
            unplaceable.append(str(device.get('id') or ''))
            continue
        gpu_fitting.append(device)
    by_type['gpu'] = int(math.ceil(len(gpu_fitting) / gpu_per_cabinet))
    for device in gpu_fitting:
        detail['gpu']['requiredU'] += _u_height(device)
        detail['gpu']['requiredPowerW'] += _power_watts(device)
    detail['gpu']['cabinets'] = by_type['gpu']
    detail['gpu']['deviceCount'] = len(gpu_fitting)

    for t in ('network', 'storage', 'compute'):
        res = _pack_cabinets(
            grouped[t],
            opts,
            power_limited=True,
            gap_per_extra_u=inter_switch_gap_u if t == 'network' else 0,
            cabinet_type=t,
        )
        by_type[t] = res['cabinets']
        detail[t] = res
        required_u += res['requiredU']
        required_power_w += res['requiredPowerW']
        unplaceable.extend(res['unplaceable'])
    for device in gpu_fitting:
        required_u += _u_height(device)
        required_power_w += _power_watts(device)

    return {
        'byType': by_type,
        'detail': detail,
        'totalCabinets': sum(by_type[t] for t in DEMAND_CABINET_TYPES),
        'requiredU': required_u,
        'requiredPowerW': required_power_w,
        'unplaceable': unplaceable,
        'usableU': usable_u,
        'usableUByType': usable_u_by_type,
        'powerLimit': power_limit,
        # B5-01/B5-02（FR-A26）：落位同口径的每柜台数 + 降级告警
        'gpuPerCabinet': gpu_per_cabinet,
        'warnings': gpu_share_warnings,
    }


# ----------------------------------------------------------------------
# 柜位容量（矩阵 → 各柜型格数）
# ----------------------------------------------------------------------
def capacity_from_matrix(matrix: Dict[str, Any]) -> Dict[str, int]:
    """矩阵中「非占位 + 可落位柜型」的格子计数（镜像前端 checkRackFeasibility 的统计口径）。"""
    capacity: Dict[str, int] = {t: 0 for t in DEMAND_CABINET_TYPES}
    for cell in matrix.get('cells') or []:
        if cell.get('placeholder') is not None:
            continue
        cell_type = cell.get('type')
        if cell_type not in PLACEABLE_CABINET_TYPES:
            continue
        if cell_type in capacity:
            capacity[cell_type] += 1
    return capacity


def slots_from_matrix(matrix: Dict[str, Any]) -> int:
    """矩阵名义柜位 = 行数 × 列数。"""
    return len(matrix.get('rows') or []) * len(matrix.get('cols') or [])


def _round_half_up(value: float) -> int:
    """与 JS Math.round 对齐（Python round 是银行家舍入）。"""
    return int(math.floor(value + 0.5))


# ----------------------------------------------------------------------
# 预检主体
# ----------------------------------------------------------------------
def check_rack_feasibility(
    matrix: Dict[str, Any],
    nodes: Sequence[Dict[str, Any]],
    opts: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """矩阵 + 设备清单 → 可行性结论（镜像前端 checkRackFeasibility）。"""
    return _check(
        nodes,
        capacity_from_matrix(matrix),
        slots_from_matrix(matrix),
        opts,
    )


def check_rack_feasibility_by_capacity(
    nodes: Sequence[Dict[str, Any]],
    capacity_by_type: Dict[str, int],
    slots: int = 0,
    opts: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """柜位容量直给版预检（后端分配器用：无矩阵实体，只有每柜型格数）。"""
    return _check(nodes, capacity_by_type, slots, opts)


def _check(
    nodes: Sequence[Dict[str, Any]],
    capacity_by_type: Dict[str, int],
    slots: int,
    opts: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    packing = pack_cabinets_by_type(nodes, opts)

    capacity: Dict[str, int] = {
        t: int(capacity_by_type.get(t) or 0) for t in DEMAND_CABINET_TYPES
    }
    capacity_total = sum(capacity[t] for t in DEMAND_CABINET_TYPES)

    by_type: Dict[str, Dict[str, int]] = {}
    missing_cabinets = 0
    missing_u = 0
    missing_power = 0
    missing_cabinets_other_than_gpu = 0

    for t in DEMAND_CABINET_TYPES:
        required = packing['byType'][t]
        available = capacity[t]
        missing = max(0, required - available)
        by_type[t] = {'required': required, 'available': available, 'missing': missing}
        missing_cabinets += missing
        if t != 'gpu':
            missing_cabinets_other_than_gpu += missing

        # U 缺口：该柜型设备总 U vs 现有格可提供的 U（按柜型可用 U，B4-04）
        missing_u += max(
            0,
            packing['detail'][t]['requiredU'] - available * packing['usableUByType'][t],
        )

        # 功率缺口：GPU 柜按柜内设备抬高上限，不做功率拒绝
        if t != 'gpu':
            available_power = available * packing['powerLimit']
            missing_power += max(0, packing['detail'][t]['requiredPowerW'] - available_power)

    ok = (
        missing_cabinets == 0
        and missing_u == 0
        and missing_power == 0
        and not packing['unplaceable']
    )

    suggestions: List[str] = []
    gpu_per_cabinet_suggest: Optional[int] = None
    if not ok:
        max_per_row = int(RACK_PACKING_DEFAULTS['maxCabinetsPerRow'])
        if missing_cabinets > 0:
            rows_needed = int(math.ceil(packing['totalCabinets'] / max_per_row))
            suggestions.append(
                f'扩容至 {rows_needed} 排 × {max_per_row} 列'
                f'（共 {rows_needed * max_per_row} 柜位，'
                f'当前可落位 {capacity_total} 柜位，缺 {missing_cabinets} 柜）'
            )

        # GPU 共柜档位解法：仅当 GPU 柜位不足时给出明确档位
        if by_type['gpu']['missing'] > 0 and capacity['gpu'] > 0:
            gpu_device_count = packing['detail']['gpu']['deviceCount']
            target_per_cabinet = int(math.ceil(gpu_device_count / capacity['gpu']))
            gpu_per_cabinet_suggest = target_per_cabinet
            suggestions.append(
                f'调整 GPU 共柜档位至 {target_per_cabinet} 台/柜'
                f'（{gpu_device_count} 台 GPU 仅需 {capacity["gpu"]} 个 GPU 柜位）'
            )
        elif missing_cabinets_other_than_gpu > 0:
            bottleneck = sorted(
                (t for t in DEMAND_CABINET_TYPES if t != 'gpu' and by_type[t]['missing'] > 0),
                key=lambda t: by_type[t]['missing'],
                reverse=True,
            )[0]
            suggestions.append(
                f'或提高 {TYPE_LABELS[bottleneck]} 单柜密度（单柜功率上限 / 每柜台数），'
                f'补足 {by_type[bottleneck]["missing"]} 柜'
            )

        if missing_u > 0:
            suggestions.append(
                f'单柜可用 U 不足：需 {packing["requiredU"]} U，'
                f'现有格位仅可提供 {packing["requiredU"] - missing_u} U，'
                f'建议提高机柜 U 数或减少高 U 设备'
            )
        if missing_power > 0:
            suggestions.append(
                f'单柜功率不足：需 {_round_half_up(packing["requiredPowerW"] / 1000)} kW，'
                f'现有格位仅可承载 '
                f'{_round_half_up((packing["requiredPowerW"] - missing_power) / 1000)} kW，'
                f'建议提高单柜功率上限'
            )
        if packing['unplaceable']:
            head = '、'.join(packing['unplaceable'][:5])
            usable_desc = '、'.join(
                f'{TYPE_LABELS[t]} {packing["usableUByType"][t]}U'
                for t in DEMAND_CABINET_TYPES
            )
            suggestions.append(
                f'有 {len(packing["unplaceable"])} 台设备超出单柜可用 U'
                f'（{usable_desc}）或超单柜功率上限，无法落位：{head}'
            )

    return {
        'ok': ok,
        'required': packing['byType'],
        'requiredCabinets': packing['totalCabinets'],
        'capacity': {
            'byType': capacity,
            'total': capacity_total,
            'slots': slots,
        },
        'shortage': {
            'cabinets': missing_cabinets,
            'u': missing_u,
            'power': missing_power,
            'byType': by_type,
        },
        'suggestions': suggestions,
        'gpuPerCabinetSuggest': gpu_per_cabinet_suggest,
        'unplaceable': list(packing['unplaceable']),
        'totalRequiredU': packing['requiredU'],
        'totalRequiredPowerW': packing['requiredPowerW'],
    }


class RackCapacityError(RuntimeError):
    """柜位不足的结构化拒绝（B1-08）：一次性失败，不产生部分落位结果。"""

    def __init__(self, result: Dict[str, Any]):
        self.result = result
        shortage = result.get('shortage') or {}
        capacity = result.get('capacity') or {}
        super().__init__(
            f'柜位不足：缺 {shortage.get("cabinets", 0)} 柜'
            f'（需求 {result.get("requiredCabinets", 0)} 柜 / '
            f'现有可落位 {capacity.get("total", 0)} 柜位）'
        )
