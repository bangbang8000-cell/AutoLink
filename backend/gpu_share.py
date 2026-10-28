"""B5-01 / FR-A26：GPU 共柜三档开关的唯一定义（后端）。

镜像前端 ``src/shared/gpuShare.ts``，保证预检（rack_feasibility）与落位
（rack_allocation）同输入同输出。

三档：
  - ``fixed1``  固定 1 台/柜（默认，最保守，等价旧行为）
  - ``byPower`` 按功率计算：min(⌊单柜功率上限 ÷ 单机功率⌋, ⌊可用 U ÷ 机高⌋)，下限 1
  - ``manual``  人工指定正整数（0/负数/超 U 位容量由 UI 拒绝，此处只做下限保护）

口径（O2 已闭合）：单柜功率上限取项目 ``power_limit_per_rack``（缺省 12000 W）；
单机功率取设备 ``power_watts``，缺失或 ≤0 时按单柜上限计（退化为 1 台/柜）并告警。
"""

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import logging

GPU_SHARE_MODES = ('fixed1', 'byPower', 'manual')
DEFAULT_POWER_LIMIT_W = 12000

logger = logging.getLogger(__name__)


def normalize_gpu_share_mode(raw: Any) -> str:
    """非法/缺省的档位一律回退 ``fixed1``。"""
    return raw if raw in ('byPower', 'manual') else 'fixed1'


def infer_gpu_share_mode(raw_mode: Any, gpu_per_cabinet: Optional[int] = None) -> str:
    """旧项目兼容：未写 ``gpu_share_mode`` 但 ``gpu_per_cabinet > 1`` → 视为人工指定。"""
    if raw_mode in GPU_SHARE_MODES:
        return str(raw_mode)
    try:
        n = int(gpu_per_cabinet or 1)
    except (TypeError, ValueError):
        n = 1
    return 'manual' if n > 1 else 'fixed1'


def gpu_per_cabinet_by_power(
    powers: Sequence[int],
    heights: Sequence[int],
    power_limit: Optional[int],
    usable_u: int,
) -> int:
    """按功率档的每柜台数（不含告警）。"""
    limit = int(power_limit) if power_limit and int(power_limit) > 0 else DEFAULT_POWER_LIMIT_W
    if not powers:
        return 1
    cap = 1 << 30
    for idx, power in enumerate(powers):
        p = int(power or 0)
        # O2：缺失/非法功率按单柜上限计 → 该设备功率容量退化为 1 台
        power_cap = limit // p if p > 0 else 1
        height = max(1, int(heights[idx] or 1) if idx < len(heights) else 1)
        u_cap = max(0, int(usable_u) // height)
        cap = min(cap, power_cap, u_cap)
    return max(1, cap)


def _physical_cap(powers: Sequence[int], heights: Sequence[int],
                  power_limit: Optional[int], usable_u: int) -> int:
    """人工指定的物理上限（功率 + U 位）。

    与 ``gpu_per_cabinet_by_power`` 同口径，但功率缺失（≤0）的设备**不参与功率收敛**
    ——人工档下无功率数据不推翻用户选择。无设备时返回极大值（不收敛）。
    """
    limit = int(power_limit) if power_limit and int(power_limit) > 0 else DEFAULT_POWER_LIMIT_W
    cap = 1 << 30
    for idx, power in enumerate(powers):
        p = int(power or 0)
        if p > 0:
            cap = min(cap, limit // p)
        height = max(1, int(heights[idx] or 1) if idx < len(heights) else 1)
        cap = min(cap, max(1, int(usable_u) // height))
    return max(1, cap)


def resolve_gpu_per_cabinet(
    mode: Any,
    manual_per_cabinet: Optional[int],
    powers: Sequence[int],
    heights: Sequence[int],
    power_limit: Optional[int],
    usable_u: int,
) -> Tuple[int, List[str]]:
    """三档统一解析 → (每柜台数, 告警列表)。

    ``mode`` 为 None（未声明）时保持旧口径：直接用 ``manual_per_cabinet``。
    """
    warnings: List[str] = []
    limit = int(power_limit) if power_limit and int(power_limit) > 0 else DEFAULT_POWER_LIMIT_W
    # 只有依赖功率上限的档位才提示回退（fixed1 / 旧口径不读该字段）
    limit_missing = not power_limit or int(power_limit) <= 0
    has_known_power = any(int(p or 0) > 0 for p in powers)

    if mode == 'byPower':
        if limit_missing:
            warnings.append(f'单柜功率上限缺失或非法，已回退 {limit} W')
        if any(not (int(p or 0) > 0) for p in powers):
            warnings.append(f'存在单机功率缺失/≤0 的 GPU，按 {limit} W 计（等价 1 台/柜）')
        per = gpu_per_cabinet_by_power(powers, heights, power_limit, usable_u)
        for w in warnings:
            logger.warning('[GPU共柜] %s', w)
        return per, warnings
    if mode == 'fixed1':
        return 1, warnings
    try:
        requested = max(1, int(manual_per_cabinet or 1))
    except (TypeError, ValueError):
        requested = 1
    if mode == 'manual':
        if limit_missing and has_known_power:
            warnings.append(f'单柜功率上限缺失或非法，已回退 {limit} W')
        # 人工值仍受物理约束（功率 / U 位）收敛，避免预检柜数少于实际可落位柜数
        cap = _physical_cap(powers, heights, power_limit, usable_u)
        if requested > cap:
            warnings.append(f'人工指定 {requested} 台/柜超出功率/U 约束，落位按 {cap} 台/柜计算')
            for w in warnings:
                logger.warning('[GPU共柜] %s', w)
            return cap, warnings
    return requested, warnings


def _node_power(node: Dict[str, Any]) -> int:
    for key in ('power_watts', 'powerWatts', 'power'):
        if key in node and node[key] is not None:
            try:
                return int(node[key] or 0)
            except (TypeError, ValueError):
                return 0
    return 0


def _node_height(node: Dict[str, Any]) -> int:
    for key in ('height', 'u_height', 'uHeight'):
        if key in node and node[key] is not None:
            try:
                return max(1, int(node[key] or 1))
            except (TypeError, ValueError):
                return 1
    return 1


def resolve_for_nodes(
    mode: Any,
    manual_per_cabinet: Optional[int],
    nodes: Iterable[Dict[str, Any]],
    power_limit: Optional[int],
    usable_u: int,
) -> Tuple[int, List[str]]:
    """便捷封装：直接吃设备节点 dict 列表（键兼容 power_watts/powerWatts）。"""
    node_list = list(nodes)
    powers = [_node_power(n) for n in node_list]
    heights = [_node_height(n) for n in node_list]
    return resolve_gpu_per_cabinet(mode, manual_per_cabinet, powers, heights, power_limit, usable_u)
