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


@dataclass
class SelectionOutcome:
    """V5.2.5-525-f3（AL-F3）：连接级光模块选型的**三态**结果。

    ``status`` 取值域固定为三个，互斥且完备：

    - ``'matched'``        ：同速率档内选到模块（``selection`` 非 None）
    - ``'not_applicable'`` ：链路为双绞线（网线），**本就不需要光模块**（``selection`` 为 None）
    - ``'unmatched'``      ：需要光模块，但库内无同速率档位/距离不足（``selection`` 为 None）

    ``not_applicable`` 与 ``unmatched`` **必须分开统计**：前者是被**正确排除**的（不是缺陷，
    计进光模块总数反而是错的），后者是**需要补齐设备库档位的真实缺口**。混计会让
    「本次报价基数是否完整」无法判定（PRD §3.3）。

    ``reason`` 在 ``status != 'matched'`` 时给出可排期的人类可读原因，取值域见
    ``_unmatched_reason`` 与 PRD §3.3；**不得只给计数不给原因**。
    """

    selection: Optional[OpticalSelection] = None
    status: str = 'unmatched'
    reason: str = ''


def _parse_speed(speed_str: str) -> int:
    """从速率字符串解析数字（Gbps），如 '400G' -> 400, '800G' -> 800, '1.6T' -> 1600。

    V5.2.5-525-f8（AL-F8）：修正 **'1.6T' 被解析为 1** 的缺陷。原实现用
    ``re.search(r'(\\d+)', ...)`` 只取**首个数字段**，'1.6T' 得到 '1'，使设备库中
    8 个 1.6T 光模块在速率维度上**等价于 1G 模块**，从而被 1G 带外网线链路在
    **严格匹配路径**（并非降级路径）直接选中（PRD §1.2 根因一）。

    单位口径与 ``exporter/engine/validation._parse_speed_gbps`` **对齐**（T/TB = ×1000，
    并兼容 'BPS'/'PS' 后缀），避免同仓四处速率解析各说各话。
    """
    if not speed_str:
        return 0
    s = str(speed_str).strip().upper().replace('BPS', '').replace('PS', '')
    for unit, factor in (('GB', 1), ('G', 1), ('TB', 1000), ('T', 1000)):
        if s.endswith(unit):
            try:
                return int(float(s[:-len(unit)]) * factor)
            except ValueError:
                break
    m = re.search(r'(\d+(?:\.\d+)?)', s)
    return int(float(m.group(1))) if m else 0


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


# V5.2.5-525-f1（AL-F1）：双绞线（网线）族线缆**无需光模块**——这类链路的"连线"
# 就是网线本体，设备库里没有、也不应该有对应的光模块档位。
#
# 判定必须在**速率匹配之前**完成，使两种"没选到模块"的语义不混计：
#   - 双绞线   → not_applicable（被正确排除，不是缺陷）
#   - 缺速率档 → unmatched（真实缺口，需补齐设备库）
#
# 注意：``DAC`` / ``铜缆`` **不**属于本族。设备库内有 ``om_*_dac_3m`` 正规档位
# （``fiber_type='copper'``），属正常可选型对象（决策 DP-525-02）。
_TWISTED_PAIR_CABLE_TYPES = frozenset({
    '网线', '双绞线', 'UTP', 'STP', 'FTP', 'SFTP',
    'CAT5', 'CAT5E', 'CAT6', 'CAT6A', 'CAT7', 'CAT7A',
})


def _is_twisted_pair(cable_type) -> bool:
    """判定线缆类型是否为双绞线（网线）。

    V5.2.5-525-f1（AL-F1）：宽进匹配——去空格、转大写、剥离 ``/`` ``-`` ``(`` 等
    分隔符后的首段再比对，兼容 ``"网线/双绞线"``、``"CAT6A 屏蔽"``、``"UTP-6"`` 等写法。
    ``CAT*`` 前缀在网线类目下无歧义，一并纳入。
    """
    raw = str(cable_type or '').strip().upper().replace(' ', '')
    if not raw:
        return False
    for sep in ('/', '-', '（', '(', '，', ','):
        if sep in raw:
            raw = raw.split(sep, 1)[0]
    return raw in _TWISTED_PAIR_CABLE_TYPES or raw.startswith('CAT')


def _module_speed(mod) -> int:
    """模块速率（Gbps）。分裂线缆以 ``breakout.input_speed`` 为准（V3.0.2-T2-11）。"""
    bk = getattr(mod, 'breakout', None)
    if isinstance(bk, dict) and bk.get('input_speed'):
        return _parse_speed(bk['input_speed'])
    return _parse_speed(getattr(mod, 'speed', None) or getattr(mod, 'id', ''))


def _match_modules(all_modules, target_speed: int, distance_m: float,
                   fiber_type: str, require_breakout: bool,
                   relax_fiber: bool = False) -> List[Any]:
    """按**同一速率档**筛选候选模块。

    V5.2.5-525-f2（AL-F2）：**速率恒为硬约束**。原有实现在候选为空时改为
    「忽略速率、选距离最近」，导致 1G 带外网线链路被装配 1.6T 光模块
    （``om_1600g_osfp_xd_sr8_100m`` 在"距离足够"维度恰好最优，见 PRD §1.2）。
    此处把「忽略速率」改为「**仅放宽光纤类型**」，使降级始终发生在同一速率档内。

    Args:
        relax_fiber: ``True`` 时跳过 ``fiber_type`` 一致性检查（T2 同速降级）。

    距离下限（``mod.distance_m >= distance_m``）**任何情况下都不放宽**：装配物理上
    不可达的模块，比报"未匹配"危害更大。
    """
    out = []
    for mod in all_modules:
        # V3.0.2-T2-11: 分裂连接只允许匹配分裂线缆（常规 800G 模块无法 1 分 2）
        bk = getattr(mod, 'breakout', None)
        if require_breakout and not isinstance(bk, dict):
            continue
        if _module_speed(mod) != target_speed:
            continue
        if (getattr(mod, 'distance_m', 0) or 0) < distance_m:
            continue
        # V2.7.4-T2: fiber_type 严格匹配（T2 降级时跳过）
        if not relax_fiber and fiber_type:
            mod_fiber = getattr(mod, 'fiber_type', '') or ''
            if mod_fiber and mod_fiber != fiber_type:
                continue
        out.append(mod)
    return out


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

    ⚠️ 调用约定：``fiber_type`` 是**第 4 个位置参数**，``library`` 是第 5 个。
    历史实现中 ``select_module_for_connection`` 曾把 library 误传到 ``fiber_type``
    （因默认传 ``None`` 而未暴露）；V5.2.5-525-f2 已改为关键字传参，新调用方请同样
    使用 ``library=...``，不要依赖位置顺序。

    Args:
        speed: 速率字符串，如 '400G', '800G'
        distance_m: 估算距离（米）
        cable_type: 线缆类型提示，如 'MPO', 'AOC', 'DAC'
        fiber_type: 光纤类型约束，如 'MMF', 'SMF', 'copper'（V2.7.4-T2）
            - 空字符串：自动从 preferred_spec 推断
            - 指定值：严格过滤，SR4 只匹配 MMF, DR4/FR4/LR4 只匹配 SMF
        library: 设备库实例（可选）

    Returns:
        OpticalSelection 或 None（**同速率档内**未找到匹配）

    V5.2.5-525-f2（AL-F2）: 匹配失败时的降级由「忽略速率、选距离最近」改为
    「**同速率档内放宽光纤类型**」（T2）；同速率档内确无候选时返回 ``None``。
    调用方若需区分"无需光模块"与"缺档未匹配"，请改用 ``resolve_module_selection``。
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

    # T1 严格匹配：速率 == 链路速率 + 距离足够 + fiber_type 一致
    candidates = _match_modules(all_modules, target_speed, distance_m,
                                fiber_type, require_breakout)
    fiber_relaxed = False
    if not candidates:
        # T2 同速降级（V5.2.5-525-f2）：仍要求速率**严格相等**，仅放宽 fiber_type。
        # 原实现此处改为"忽略速率"，是本轮缺陷的根因；不得回退为跨速率匹配。
        candidates = _match_modules(all_modules, target_speed, distance_m,
                                    fiber_type, require_breakout,
                                    relax_fiber=True)
        fiber_relaxed = bool(candidates)
    if not candidates:
        # 同速率档内确无可用模块 → 返回 None，由 resolve_module_selection 归类为
        # 'unmatched' 并给出原因。**绝不**装配其他速率的模块。
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
    # V5.2.5-525-f2（AL-F2）：T2 同速降级的降级痕迹必须留痕——原实现无任何降级标记，
    # 是本次缺陷长期未被发现的原因之一。
    _relax_note = '，光纤放宽' if fiber_relaxed else ''
    if best_breakout:
        match_reason = (f"速率={speed}, 距离≈{distance_m:.0f}m, 推荐={preferred_spec}, 光纤={fiber_type or '不限'}{_relax_note}, "
                        f"1分{best_breakout.get('count', 2)} ({best_breakout.get('input_speed', '')}→{best_breakout.get('output_speed', '')})")
    else:
        match_reason = f"速率={speed}, 距离≈{distance_m:.0f}m, 推荐={preferred_spec}, 光纤={fiber_type or '不限'}{_relax_note}"

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


def _unmatched_reason(speed: str, distance_m: float, require_breakout: bool,
                      library: Optional[DeviceLibrary] = None) -> str:
    """生成"未匹配"的原因（V5.2.5-525-f3 / AL-F3）。

    原因取值域固定为三种（PRD §3.3），**必须可排期**：

    - ``库内无 <速率> 档位（同速率降级后仍无候选）``  → 设备库数据缺口
    - ``距离超出同速率档位上限（需求 <x>m，最长档位 <y>m）`` → 需补长距档位
    - ``分裂链路无 <速率> 分裂档位``                → 分裂档位缺口（含在上一类的语境中）

    前提：调用方已确认该链路**需要**光模块（双绞线链路在更早处被归为 ``not_applicable``，
    不会走到这里）。
    """
    target = _parse_speed(speed)
    if target == 0:
        return f'链路速率缺失或非法（{speed or "空"}）'

    if library is None:
        try:
            library = get_device_library()
        except Exception:
            library = None
    mods: List[Any] = []
    if library is not None:
        try:
            mods = list(library.get_by_category('optical_modules') or [])
        except Exception:
            mods = []

    same_speed = [m for m in mods if _module_speed(m) == target]
    if require_breakout:
        split = [m for m in same_speed if isinstance(getattr(m, 'breakout', None), dict)]
        if not split:
            return f'分裂链路无 {speed} 分裂档位（同速率降级后仍无候选）'
        same_speed = split
    if not same_speed:
        return f'库内无 {speed} 档位（同速率降级后仍无候选）'

    longest = max((getattr(m, 'distance_m', 0) or 0) for m in same_speed)
    return f'距离超出同速率档位上限（需求 {distance_m:.0f}m，最长档位 {longest}m）'


def resolve_module_selection(conn, library: Optional[DeviceLibrary] = None) -> SelectionOutcome:
    """为单条连接解析光模块选型的**三态**结果（V5.2.5-525-f3 / AL-F3）。

    与 ``select_module_for_connection`` 的区别：后者只回答"选到了什么"（保持向后兼容的
    ``Optional`` 语义），本函数额外回答 **"为什么没选到"**，供 ``reportData.module_selection``
    统计"无需光模块"与"缺档未匹配"（PRD §3.3、度量 M3）。

    V3.0.2-T2-11: 1 分 2 分裂线缆（``conn.breakout`` 携带）时按 ``input_speed``（物理速率）
    匹配分裂光模块（如 800G 物理口 → 2×400G 线缆），否则按逻辑速率匹配常规模块。

    分流顺序（**不可调换**）：
      1. 线缆为双绞线（网线）→ ``not_applicable``：本就不需要光模块，在速率匹配之前排除；
      2. 同速率档内有候选     → ``matched``；
      3. 同速率档内无候选     → ``unmatched`` + 原因（缺档 / 距离不足 / 无分裂档位）。
    """
    # 1. 双绞线族豁免（AL-F1）——必须在速率匹配之前，否则会落入 unmatched 而混计
    if _is_twisted_pair(getattr(conn, 'cable_type', '')):
        return SelectionOutcome(
            selection=None,
            status='not_applicable',
            reason='双绞线链路（网线）无需光模块',
        )

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
    sel = select_optical_module(speed, distance, conn.cable_type, library=library,
                                require_breakout=require_breakout)
    if sel is not None:
        # 2. 匹配（`reason` 用 getattr 兜底：允许调用方传入鸭子类型的 selection）
        return SelectionOutcome(selection=sel, status='matched',
                                reason=getattr(sel, 'match_reason', '') or '')

    # 3. 未匹配：给出可排期的原因（AL-F3 要求"必须给出原因，不得只有计数"）
    return SelectionOutcome(
        selection=None,
        status='unmatched',
        reason=_unmatched_reason(speed, distance, require_breakout, library),
    )


def select_module_for_connection(conn, library: Optional[DeviceLibrary] = None) -> Optional[OpticalSelection]:
    """为单条连接选择光模块（**向后兼容入口**）。

    V3.0.2-T2-11: 1 分 2 分裂线缆（conn.breakout 携带）时按 input_speed（物理速率）
    匹配分裂光模块（如 800G 物理口 → 2×400G 线缆），否则按逻辑速率匹配常规模块。

    V5.2.5-525-f3: 改为委派给 ``resolve_module_selection``。**签名与返回类型不变**
    （仍为 ``Optional[OpticalSelection]``），使 ``exporter`` 三处既有调用点零改动。
    需要区分"无需光模块（not_applicable）"与"缺档未匹配（unmatched）"的调用方，
    请直接使用 ``resolve_module_selection``。
    """
    return resolve_module_selection(conn, library).selection


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
