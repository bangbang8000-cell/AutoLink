"""
AutoLink V2.4 - 光模块智能选型器
根据速率、距离、线缆类型自动选择最优光模块
"""
import re
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from device_library import DeviceLibrary, LibraryDevice, get_device_library


@dataclass
class OpticalSelection:
    """光模块选型结果"""
    module_id: str
    speed: str
    form_factor: str
    spec: str
    distance_m: int
    fiber_type: str
    price_range: str
    description: str
    vendors: List[str]
    estimated_length_m: float
    match_reason: str
    # V2.7.4-T3: 新增功耗/供货周期/成本估算字段
    power_w: float = 0.0
    lead_time_weeks: str = ""
    unit_cost_lo: int = 0
    unit_cost_hi: int = 0
    tech_route: str = ""
    # V3.0.2-T2-11: 1 分 2 扇出（breakout）标注（分裂线缆时携带，如 {"input_speed":"800G","output_speed":"400G","count":2}）
    breakout: Optional[Dict[str, Any]] = None


def _parse_speed(speed_str: str) -> int:
    """从速率字符串解析数字（Gbps），如 '400G' -> 400, '800G' -> 800"""
    if not speed_str:
        return 0
    m = re.search(r'(\d+)', str(speed_str))
    return int(m.group(1)) if m else 0


def _estimate_distance(a_cabinet: str, z_cabinet: str, a_start_u: Optional[int], z_start_u: Optional[int]) -> float:
    """根据机柜位置估算线缆长度（米）"""
    if not a_cabinet and not z_cabinet:
        return 10.0  # 默认 10m

    if a_cabinet == z_cabinet and a_cabinet:
        return 3.0  # 同机柜：3m DAC

    # 尝试从机柜名提取编号
    a_num = _extract_cabinet_number(a_cabinet)
    z_num = _extract_cabinet_number(z_cabinet)

    if a_num is not None and z_num is not None:
        diff = abs(a_num - z_num)
        if diff <= 1:
            return 5.0   # 相邻机柜：5m
        elif diff <= 3:
            return 10.0  # 同区域：10m
        elif diff <= 6:
            return 20.0  # 跨区域：20m
        else:
            return 50.0  # 跨排：50m

    return 10.0  # 默认


def _extract_cabinet_number(name: str) -> Optional[int]:
    """从机柜名提取编号，如 '机柜01' -> 1, 'Cabinet-A3' -> 3"""
    if not name:
        return None
    m = re.search(r'(\d+)', str(name))
    return int(m.group(1)) if m else None


def _get_preferred_spec(distance_m: float, cable_type: str) -> str:
    """根据距离和线缆类型推荐光模块规格"""
    # DAC 直连铜缆
    if cable_type.upper() in ('DAC', '铜缆') or (distance_m <= 3 and cable_type.upper() not in ('MPO', 'AOC')):
        return 'DAC'

    # AOC 有源光缆
    if cable_type.upper() == 'AOC':
        return 'AOC'

    # 光纤：根据距离选择
    if distance_m <= 3:
        return 'DAC'
    elif distance_m <= 100:
        return 'SR8' if distance_m > 30 else 'SR4'
    elif distance_m <= 500:
        return 'DR4'
    elif distance_m <= 2000:
        return 'FR4'
    elif distance_m <= 10000:
        return 'LR4'
    else:
        return 'LR4'


# V2.7.4-T2: spec → fiber_type 映射表（严格匹配）
_SPEC_FIBER_MAP: Dict[str, str] = {
    'SR4': 'MMF', 'SR8': 'MMF', 'AOC': 'MMF',
    'DR4': 'SMF', 'DR8': 'SMF', 'FR4': 'SMF', 'LR4': 'SMF', 'LR8': 'SMF', 'CWDM4': 'SMF',
    'DAC': 'copper',
}


def _infer_fiber_type(spec: str) -> str:
    """根据 spec 推断光纤类型（MMF/SMF/copper）"""
    return _SPEC_FIBER_MAP.get(spec.upper(), '')


def select_optical_module(
    speed: str,
    distance_m: float,
    cable_type: str = '',
    fiber_type: str = '',
    library: Optional[DeviceLibrary] = None,
    require_breakout: bool = False,
) -> Optional[OpticalSelection]:
    """根据速率、距离、线缆类型选择最优光模块

    V2.7.4-T2: 增加 fiber_type 参数，支持 MMF/SMF 严格匹配
    V2.7.4-T3: 返回结果包含功耗/供货周期/成本估算

    Args:
        speed: 速率字符串，如 '400G', '800G'
        distance_m: 估算距离（米）
        cable_type: 线缆类型提示，如 'MPO', 'AOC', 'DAC'
        fiber_type: 光纤类型约束，如 'MMF', 'SMF', 'copper'（V2.7.4-T2）
            - 空字符串：自动从 preferred_spec 推断
            - 指定值：严格过滤，SR4 只匹配 MMF, DR4/FR4/LR4 只匹配 SMF
        library: 设备库实例（可选）

    Returns:
        OpticalSelection 或 None（未找到匹配）
    """
    if library is None:
        try:
            library = get_device_library()
        except Exception:
            return None

    target_speed = _parse_speed(speed)
    if target_speed == 0:
        return None

    preferred_spec = _get_preferred_spec(distance_m, cable_type)

    # V2.7.4-T2: 如果未指定 fiber_type，从 preferred_spec 自动推断
    if not fiber_type:
        fiber_type = _infer_fiber_type(preferred_spec)

    # 获取所有光模块
    all_modules = library.get_by_category('optical_modules')
    if not all_modules:
        return None

    # 筛选：速率匹配 + 距离足够 + V2.7.4-T2 fiber_type 严格匹配
    candidates = []
    for mod in all_modules:
        # V3.0.2-T2-11: 分裂线缆（breakout）按 input_speed 匹配物理速率，否则按 speed 字段/ID
        bk = getattr(mod, 'breakout', None)
        if not isinstance(bk, dict):
            bk = {}
        # V3.0.2-T2-11: 分裂连接只允许匹配分裂线缆（常规 800G 模块无法 1 分 2）
        if require_breakout and not bk:
            continue
        mod_speed_str = bk.get('input_speed') or (getattr(mod, 'speed', None) or mod.id)
        mod_speed = _parse_speed(mod_speed_str)
        if mod_speed != target_speed:
            continue
        mod_distance = getattr(mod, 'distance_m', 0) or 0
        if mod_distance < distance_m:
            continue
        # V2.7.4-T2: fiber_type 严格匹配
        if fiber_type:
            mod_fiber = getattr(mod, 'fiber_type', '') or ''
            if mod_fiber and mod_fiber != fiber_type:
                continue
        candidates.append(mod)

    if not candidates:
        # 降级：忽略速率，选距离足够的（仍保持 fiber_type 约束）
        candidates = [m for m in all_modules
                      if (getattr(m, 'distance_m', 0) or 0) >= distance_m
                      and (not require_breakout or isinstance(getattr(m, 'breakout', None), dict))
                      and (not fiber_type or not getattr(m, 'fiber_type', '') or getattr(m, 'fiber_type', '') == fiber_type)]
        if not candidates:
            return None

    # 优先选择规格匹配的
    preferred = [m for m in candidates if preferred_spec.upper() in (
        (getattr(m, 'spec', '') or '') + (getattr(m, 'id', '') or '') + (m.description or '')
    ).upper()]

    # 如果有偏好匹配，选距离最小的（成本最低）
    pool = preferred if preferred else candidates
    best = min(pool, key=lambda m: getattr(m, 'distance_m', 9999) or 9999)

    # V2.7.4-T3: 填充功耗/供货周期/成本估算
    price_range = getattr(best, 'price_range', '') or ''
    cost_lo, cost_hi = estimate_module_cost(price_range)

    # V3.0.2-T2-11: 分裂线缆标注（1 分 2 时携带 input/output 速率与逻辑口数）
    best_breakout = getattr(best, 'breakout', None)
    if not isinstance(best_breakout, dict):
        best_breakout = None
    if best_breakout:
        match_reason = (f"速率={speed}, 距离≈{distance_m:.0f}m, 推荐={preferred_spec}, 光纤={fiber_type or '不限'}, "
                        f"1分{best_breakout.get('count', 2)} ({best_breakout.get('input_speed', '')}→{best_breakout.get('output_speed', '')})")
    else:
        match_reason = f"速率={speed}, 距离≈{distance_m:.0f}m, 推荐={preferred_spec}, 光纤={fiber_type or '不限'}"

    return OpticalSelection(
        module_id=best.id,
        speed=speed,
        form_factor=getattr(best, 'form_factor', '') or '',
        spec=getattr(best, 'spec', '') or '',
        distance_m=getattr(best, 'distance_m', 0) or 0,
        fiber_type=getattr(best, 'fiber_type', '') or '',
        price_range=price_range,
        description=best.description or '',
        vendors=getattr(best, 'vendors', [])[:3],
        estimated_length_m=distance_m,
        match_reason=match_reason,
        # V2.7.4-T3 新增字段
        power_w=float(getattr(best, 'power_watts', 0) or 0),
        lead_time_weeks=LEAD_TIME_MAP.get(price_range, ''),
        unit_cost_lo=cost_lo,
        unit_cost_hi=cost_hi,
        tech_route=getattr(best, 'tech_route', '') or '',
        # V3.0.2-T2-11: breakout 标注
        breakout=best_breakout,
    )


def select_module_for_connection(conn, library: Optional[DeviceLibrary] = None) -> Optional[OpticalSelection]:
    """为单条连接选择光模块

    V3.0.2-T2-11: 1 分 2 分裂线缆（conn.breakout 携带）时按 input_speed（物理速率）
    匹配分裂光模块（如 800G 物理口 → 2×400G 线缆），否则按逻辑速率匹配常规模块。
    """
    speed = conn.a_module or ''
    # V3.0.2-T2-11: 分裂线缆按物理速率匹配（input_speed）且只匹配分裂线缆
    bk = getattr(conn, 'breakout', None)
    require_breakout = False
    if isinstance(bk, dict) and bk.get('input_speed'):
        speed = bk['input_speed']
        require_breakout = True
    distance = _estimate_distance(
        conn.a_cabinet_name or '', conn.z_cabinet_name or '',
        conn.a_start_u, conn.z_start_u,
    )
    return select_optical_module(speed, distance, conn.cable_type, library,
                                 require_breakout=require_breakout)


# 价格区间映射（人民币估算）
PRICE_RANGE_MAP: Dict[str, tuple] = {
    '低': (500, 2000),
    '中': (2000, 8000),
    '高': (8000, 30000),
    '极高': (30000, 100000),
}

# V2.7.4-T3: 供货周期映射（基于价格区间估算）
LEAD_TIME_MAP: Dict[str, str] = {
    '低': '2-4周',
    '中': '4-8周',
    '高': '8-12周',
    '极高': '12-24周',
}


def estimate_module_cost(price_range: str) -> tuple:
    """根据价格区间返回 (最低价, 最高价) 估算"""
    return PRICE_RANGE_MAP.get(price_range, (1000, 5000))
