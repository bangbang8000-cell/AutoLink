"""AutoLink v3.1.4-T8-1 机房智能落位优化器（room optimize CLI 内核）

约束满足 + 多目标优化（PRD 5.11 R8.1 / 开发计划 T8-1 细化）：

  - 输入双模式：
      ① counts（类型→数量，如 {gpu:120, network:60, storage:45}，对话场景）
      ② cabinets（具体机柜 [{id, type, power_watts}]，从 rack 机柜落位）
  - 约束：占位不可放 / 机柜类型域匹配（combined/empty 任意）/ 功率上限（复用 RoomConstraints）
  - 算法：贪心分簇（按类型聚簇 + 功率降序 + 区域负载最低优先）+ 时间预算内迭代重分配
  - 目标评分（可配置权重，0~1 越高越好）：
      功率均衡（区域功率变异系数）/ 散热分区（高功率柜靠近空调柱）
      网络就近（网络柜簇聚度）/ 布线最短（同类型簇内聚度）
  - 输出 {placements, scores, issues}；225 柜 ≤5s
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from room import (
    ROOM_TYPE_COMBINED,
    ROOM_TYPE_EMPTY,
    ROOM_TYPE_GPU,
    ROOM_TYPE_NETWORK,
    ROOM_TYPE_STORAGE,
    ROOM_TYPE_COMPUTE,
    ROOM_TYPES,
    PLACEHOLDER_AC,
    LAYOUT_FILENAME,
    RoomConstraints,
    RoomMatrix,
)

# 默认优化目标权重（可配置覆盖）
DEFAULT_OBJECTIVES = {
    'power_balance': 1.0,
    'thermal_zones': 1.0,
    'network_locality': 1.0,
    'shortest_cable': 1.0,
}

# 默认时间预算（秒）
DEFAULT_TIME_BUDGET_S = 5.0

# 高功率柜判定阈值（W，超过视为高密度，参与散热分区目标）
HIGH_POWER_THRESHOLD_W = 8000

# 区域划分（行/列分块数）——功率均衡粒度
ZONE_BLOCKS = 3


class PlaceItem:
    """待落位单元：类型 + 功率 + 可选机柜 id"""

    __slots__ = ('type', 'power_watts', 'cabinet_id')

    def __init__(self, item_type: str, power_watts: int = 0,
                 cabinet_id: Optional[int] = None) -> None:
        self.type = item_type
        self.power_watts = int(power_watts or 0)
        self.cabinet_id = cabinet_id


# ================================================================
# 输入解析
# ================================================================

def _norm_type(t: str) -> str:
    """规范化机柜类型（大小写/别名 → room 类型；未知类型回落 combined 语义）"""
    key = str(t or '').strip().lower()
    aliases = {'gpu': ROOM_TYPE_GPU, 'network': ROOM_TYPE_NETWORK,
               'net': ROOM_TYPE_NETWORK, 'storage': ROOM_TYPE_STORAGE,
               'compute': ROOM_TYPE_COMPUTE, 'combined': ROOM_TYPE_COMBINED}
    if key in aliases:
        return aliases[key]
    # counts 可能用中文键（对话抽取）
    zh = {'gpu': 'gpu', '网络': ROOM_TYPE_NETWORK, '存储': ROOM_TYPE_STORAGE,
          '通算': ROOM_TYPE_COMPUTE, '组合': ROOM_TYPE_COMBINED}
    if key in zh:
        return zh[key]
    return ROOM_TYPE_COMBINED


def parse_items(params: dict) -> Tuple[List[PlaceItem], List[str]]:
    """解析待落位单元（counts / cabinets 双模式），返回 (items, issues)"""
    items: List[PlaceItem] = []
    issues: List[str] = []

    cabinets = params.get('cabinets')
    counts = params.get('counts')

    if isinstance(cabinets, list) and cabinets:
        # 具体机柜模式（优先）：[{id, type, power_watts}]
        for i, c in enumerate(cabinets):
            if not isinstance(c, dict):
                issues.append(f"cabinets[{i}] 不是对象")
                continue
            item_type = _norm_type(c.get('type') or ROOM_TYPE_COMBINED)
            try:
                power = int(c.get('power_watts') or 0)
            except (TypeError, ValueError):
                power = 0
            items.append(PlaceItem(item_type, power, c.get('id')))
    elif isinstance(counts, dict):
        # 类型数量模式：{gpu: 120, network: 60, ...}
        for key, n in counts.items():
            item_type = _norm_type(key)
            try:
                count = int(n or 0)
            except (TypeError, ValueError):
                issues.append(f"counts.{key} 数量非法: {n!r}")
                continue
            if count < 0:
                issues.append(f"counts.{key} 数量为负: {count}")
                continue
            items.extend(PlaceItem(item_type) for _ in range(count))
    else:
        issues.append("缺少落位输入：需提供 counts（类型→数量）或 cabinets（机柜列表）")

    return items, issues


def parse_objectives(params: dict) -> Dict[str, float]:
    """解析优化目标权重（缺省 DEFAULT_OBJECTIVES；非法值回落默认）"""
    raw = params.get('objectives')
    objectives = dict(DEFAULT_OBJECTIVES)
    if isinstance(raw, dict):
        for key, val in raw.items():
            if key in objectives:
                try:
                    objectives[key] = max(0.0, float(val))
                except (TypeError, ValueError):
                    pass
    return objectives


def parse_matrix(params: dict) -> Tuple[Optional[RoomMatrix], List[str]]:
    """解析矩阵：params.matrix（dict）优先，否则按 params.project 读 room_layout.json"""
    issues: List[str] = []
    data = params.get('matrix')
    if isinstance(data, dict):
        try:
            matrix = RoomMatrix.from_dict(data)
        except (KeyError, TypeError, ValueError) as e:
            issues.append(f"matrix 解析失败: {e}")
            return None, issues
        errs = matrix.validate()
        if errs:
            issues.extend(errs)
        return matrix, issues

    project = params.get('project')
    if project:
        try:
            from manage import workspace_dir
            layout_path = os.path.join(workspace_dir(), str(project), LAYOUT_FILENAME)
            matrix = RoomMatrix.from_dict(_load_json(layout_path))
            issues.extend(matrix.validate())
            return matrix, issues
        except FileNotFoundError:
            issues.append(f"项目 {project} 无 {LAYOUT_FILENAME}（请先创建机房矩阵）")
        except (OSError, ValueError, TypeError) as e:
            issues.append(f"读取 {project} 机房矩阵失败: {e}")
        return None, issues

    issues.append("缺少矩阵：需提供 matrix 或 project")
    return None, issues


def _load_json(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


# ================================================================
# 网格辅助（区域划分 / 坐标）
# ================================================================

class Grid:
    """矩阵网格索引：行/列 → 区域 id；提供曼哈顿距离"""

    def __init__(self, rows: List[str], cols: List[int]) -> None:
        self.rows = [str(r) for r in rows]
        self.cols = [int(c) for c in cols]
        self.row_idx = {r: i for i, r in enumerate(self.rows)}
        self.col_idx = {c: i for i, c in enumerate(self.cols)}
        self._zones: Dict[Tuple[int, int], int] = {}
        self._build_zones()

    def _build_zones(self) -> None:
        n_r, n_c = len(self.rows), len(self.cols)
        block_r = max(1, n_r // ZONE_BLOCKS)
        block_c = max(1, n_c // ZONE_BLOCKS)
        for ri in range(n_r):
            for ci in range(n_c):
                zr = min(ZONE_BLOCKS - 1, ri // block_r)
                zc = min(ZONE_BLOCKS - 1, ci // block_c)
                self._zones[(ri, ci)] = zr * ZONE_BLOCKS + zc

    def coords(self, position: str) -> Optional[Tuple[int, int]]:
        for r in self.rows:
            if position.startswith(r):
                ci = self.col_idx.get(int(position[len(r):]))
                if ci is not None:
                    return self.row_idx[r], ci
        return None

    def zone(self, position: str) -> Optional[int]:
        c = self.coords(position)
        return self._zones.get(c) if c else None

    def distance(self, a: str, b: str) -> Optional[float]:
        ca, cb = self.coords(a), self.coords(b)
        if ca is None or cb is None:
            return None
        return float(abs(ca[0] - cb[0]) + abs(ca[1] - cb[1]))


# ================================================================
# 落位求解
# ================================================================

def optimize(params: dict) -> dict:
    """room optimize 主入口：解析输入 → 约束过滤 → 贪心分簇 → 局部搜索 → 评分

    返回 {success, placements, scores, issues, stats}
    """
    issues: List[str] = []
    matrix, m_issues = parse_matrix(params)
    issues.extend(m_issues)
    if matrix is None:
        return {'success': False, 'error': issues[0] if issues else '矩阵解析失败',
                'issues': issues, 'placements': [], 'scores': _neutral_scores()}

    items, i_issues = parse_items(params)
    issues.extend(i_issues)
    if not items:
        return {'success': False, 'error': issues[0] if issues else '无待落位单元',
                'issues': issues, 'placements': [], 'scores': _neutral_scores()}

    constraints = RoomConstraints.from_dict(params.get('constraints')) \
        if isinstance(params.get('constraints'), dict) else RoomConstraints()
    objectives = parse_objectives(params)
    time_budget_s = float(params.get('time_budget_s') or DEFAULT_TIME_BUDGET_S)
    reset_existing = bool(params.get('reset_existing'))

    grid = Grid(matrix.rows, matrix.cols)

    # 1) 全局可用格子（约束过滤：占位不可用；fill 模式保留手动放置）
    available: List[str] = [
        pos for pos, cell in matrix.cells.items()
        if cell.is_available() and (reset_existing or cell.cabinet_id is None)
    ]
    item_types = {it.type for it in items}

    # 2) 贪心分簇放置（全局互斥：available 随放置收缩，每类型只取类型域匹配的剩余格）
    placements: Dict[str, PlaceItem] = {}
    unplaced: List[PlaceItem] = []
    zone_load = {z: 0 for z in range(ZONE_BLOCKS * ZONE_BLOCKS)}

    # 功率上限约束：单柜功率超限的 item 整体不可放置
    over_power = [it for it in items if it.power_watts > constraints.power_limit_per_rack]
    for it in over_power:
        issues.append(
            f"机柜 {it.cabinet_id or it.type} 功率 {it.power_watts}W 超过单柜上限 "
            f"{constraints.power_limit_per_rack}W，未放置")
        unplaced.append(it)

    # 各类型簇中心（基于该类型兼容的可用格，中位数；网络柜集中优先）
    centroids: Dict[str, Tuple[float, float]] = {}
    for t in item_types:
        coords = []
        for p in available:
            c = grid.coords(p)
            if c and _type_allowed(matrix.cells[p].type, t):
                coords.append(c)
        if coords:
            centroids[t] = (sum(c[0] for c in coords) / len(coords),
                            sum(c[1] for c in coords) / len(coords))

    # 分组并按功率降序（高功率先放）
    by_type: Dict[str, List[PlaceItem]] = {}
    for it in items:
        if it in unplaced:
            continue
        by_type.setdefault(it.type, []).append(it)
    # 类型可用格数（约束域大小）：可用格越少的类型越先放（约束最多优先），
    # 避免灵活类型（如 network 同时可用专用格+空格）抢占空格导致受限类型无处可放
    type_cap: Dict[str, int] = {}
    for t in by_type:
        by_type[t].sort(key=lambda i: -i.power_watts)
        type_cap[t] = sum(1 for p in available if _type_allowed(matrix.cells[p].type, t))
        # 位置不足提示（类型域匹配的剩余格）
        if type_cap[t] < len(by_type[t]):
            issues.append(
                f"类型 {t} 可用位置不足：需要 {len(by_type[t])} 柜，可用 {type_cap[t]} 柜")
    type_order = sorted(by_type, key=lambda t: type_cap[t])

    ref_dist = max(1, len(grid.rows) + len(grid.cols))
    for t in type_order:
        for item in by_type[t]:
            # 当前该类型可用的剩余格（全局互斥）
            cand = [p for p in available if _type_allowed(matrix.cells[p].type, t)]
            if not cand:
                unplaced.append(item)
                continue
            best_pos, best_key = None, None
            centroid_pos = _nearest_centroid_pos(grid, centroids.get(t))
            for pos in cand:
                z = grid.zone(pos)
                if z is None:
                    continue
                # 功率均衡优先（区域负载低）+ 布线就近（离类型簇中心近）
                dist = grid.distance(pos, centroid_pos) or 0.0
                load_key = zone_load[z] / max(1, len(items))
                dist_key = dist / ref_dist
                key = load_key + 0.5 * dist_key
                if best_key is None or key < best_key:
                    best_pos, best_key = pos, key
            if best_pos is None:
                unplaced.append(item)
                continue
            placements[best_pos] = item
            available.remove(best_pos)
            z = grid.zone(best_pos)
            if z is not None:
                zone_load[z] += item.power_watts

    # 3) 时间预算内迭代重分配（局部改善）
    placements, zone_load = _iterative_improve(
        matrix, grid, placements, zone_load, objectives, time_budget_s)

    # 4) 评分 + 输出
    scores = _score_placement(grid, placements, objectives, matrix)
    placed = [{'position': p, 'type': it.type, 'cabinetId': it.cabinet_id,
               'powerWatts': it.power_watts}
              for p, it in sorted(placements.items())]
    for it in unplaced:
        issues.append(f"未放置：{it.type}（{it.cabinet_id or '数量柜'}）")

    return {
        'success': True,
        'placements': placed,
        'scores': scores,
        'issues': issues,
        'stats': {
            'total_items': len(items),
            'placed': len(placements),
            'unplaced': len(unplaced),
            'elapsed_ms': None,  # 由 action 层填充
        },
    }


def _nearest_centroid_pos(grid: Grid, centroid: Optional[Tuple[float, float]]) -> Optional[str]:
    """找到离簇中心最近的格子位置（评分距离基准；无簇时返回 None）"""
    if centroid is None:
        return None
    best, best_d = None, None
    for r in grid.rows:
        for c in grid.cols:
            pos = f"{r}{c}"
            coord = grid.coords(pos)
            if coord is None:
                continue
            d = abs(coord[0] - centroid[0]) + abs(coord[1] - centroid[1])
            if best_d is None or d < best_d:
                best, best_d = pos, d
    return best


def _type_allowed(cell_type: str, item_type: str) -> bool:
    """类型域匹配：combined/empty 任意；其余需类型一致"""
    if cell_type in (ROOM_TYPE_COMBINED, ROOM_TYPE_EMPTY):
        return True
    return cell_type == item_type


def _iterative_improve(matrix: RoomMatrix, grid: Grid,
                       placements: Dict[str, PlaceItem], zone_load: Dict[int, int],
                       objectives: Dict[str, float], time_budget_s: float) -> Tuple[Dict[str, PlaceItem], Dict[int, int]]:
    """迭代重分配：把 item 从负载高的区域搬到同类型兼容、负载更低的空位，
    直到一轮无改善或超时。保持约束（只移动不新增/移除）。
    """
    start = time.monotonic()
    # 收集每类型剩余空位（可搬移目标）
    free_slots: Dict[str, List[str]] = {}
    for t in {it.type for it in placements.values()}:
        free_slots[t] = []
    for pos, cell in matrix.cells.items():
        if not cell.is_available() or pos in placements:
            continue
        if cell.cabinet_id is not None:
            continue
        for t in free_slots:
            if _type_allowed(cell.type, t):
                free_slots[t].append(pos)

    improved = True
    rounds = 0
    while improved and time.monotonic() - start < time_budget_s and rounds < 50:
        improved = False
        rounds += 1
        for pos, item in list(placements.items()):
            if time.monotonic() - start >= time_budget_s:
                break
            z = grid.zone(pos)
            if z is None:
                continue
            cur_load = zone_load.get(z, 0)
            # 找负载显著更低的同类型空位（功率均衡驱动）
            best_move, best_load = None, None
            for fp in free_slots.get(item.type, []):
                fz = grid.zone(fp)
                if fz is None:
                    continue
                load = zone_load.get(fz, 0)
                if best_load is None or load < best_load:
                    best_load, best_move = load, fp
            if best_move is not None and best_load < cur_load - 1:
                zone_load[z] = max(0, cur_load - item.power_watts)
                zone_load[grid.zone(best_move)] += item.power_watts
                del placements[pos]
                placements[best_move] = item
                free_slots[item.type].remove(best_move)
                free_slots[item.type].append(pos)
                improved = True
    return placements, zone_load


# ================================================================
# 目标评分
# ================================================================

def _neutral_scores() -> Dict[str, float]:
    return {k: 0.0 for k in DEFAULT_OBJECTIVES} | {'total': 0.0}


def _score_placement(grid: Grid, placements: Dict[str, PlaceItem],
                     objectives: Dict[str, float], matrix: RoomMatrix) -> Dict[str, float]:
    """计算各分目标评分（0~1，1 最优）与加权总分"""
    scores: Dict[str, float] = {}

    # 功率均衡：区域功率变异系数 cv = std/mean → 1 - cv
    zone_power: Dict[int, int] = {}
    for pos, it in placements.items():
        z = grid.zone(pos)
        if z is not None:
            zone_power[z] = zone_power.get(z, 0) + it.power_watts
    values = list(zone_power.values())
    if values and sum(values) > 0:
        mean = sum(values) / len(values)
        std = (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5
        cv = std / mean if mean > 0 else 0.0
        scores['power_balance'] = max(0.0, min(1.0, 1.0 - cv))
    else:
        scores['power_balance'] = 1.0  # 无功率信息（counts 模式）→ 中性

    # 散热分区：高功率柜到最近空调柱（ac）的平均距离（近 → 散热好）
    ac_positions = [pos for pos, cell in matrix.cells.items() if cell.placeholder == PLACEHOLDER_AC]
    high_power = [pos for pos, it in placements.items() if it.power_watts >= HIGH_POWER_THRESHOLD_W]
    if ac_positions and high_power:
        dists = []
        for pos in high_power:
            d = min((grid.distance(pos, a) or 0.0) for a in ac_positions)
            dists.append(d)
        avg_d = sum(dists) / len(dists)
        ref = max(1.0, grid.rows.__len__() + grid.cols.__len__())
        scores['thermal_zones'] = max(0.0, min(1.0, 1.0 - avg_d / ref))
    else:
        scores['thermal_zones'] = 1.0  # 无 ac 占位或无数高功率 → 中性

    # 网络就近 + 布线最短：同类型簇聚度（离簇中心平均距离的倒数）
    by_type: Dict[str, List[str]] = {}
    for pos, it in placements.items():
        by_type.setdefault(it.type, []).append(pos)
    dist_terms = []
    for t, positions in by_type.items():
        coords = [c for c in (grid.coords(p) for p in positions) if c]
        if not coords:
            continue
        cy = sum(c[0] for c in coords) / len(coords)
        cx = sum(c[1] for c in coords) / len(coords)
        for p in positions:
            c = grid.coords(p)
            if c:
                dist_terms.append(abs(c[0] - cy) + abs(c[1] - cx))
    if dist_terms:
        avg_d = sum(dist_terms) / len(dist_terms)
        ref = max(1.0, grid.rows.__len__() + grid.cols.__len__())
        cluster = max(0.0, min(1.0, 1.0 - avg_d / ref))
    else:
        cluster = 1.0
    # 网络簇聚度（network 独立项）
    net_positions = by_type.get(ROOM_TYPE_NETWORK, [])
    if len(net_positions) >= 2:
        net_d = sum((grid.distance(a, b) or 0.0)
                    for i, a in enumerate(net_positions) for b in net_positions[i + 1:])
        n = len(net_positions)
        ref_d = max(1.0, grid.rows.__len__() + grid.cols.__len__())
        scores['network_locality'] = max(0.0, min(1.0, 1.0 - net_d / (n * ref_d)))
    else:
        scores['network_locality'] = 1.0
    scores['shortest_cable'] = cluster

    total = sum(objectives.get(k, 1.0) * scores[k] for k in DEFAULT_OBJECTIVES)
    total_w = sum(objectives.get(k, 1.0) for k in DEFAULT_OBJECTIVES)
    scores['total'] = total / max(1e-9, total_w)
    return scores


# ================================================================
# action 层入口（供 engine.py room:optimize 调用）
# ================================================================

def optimize_from_params(params: dict) -> dict:
    """room:optimize action 入口：执行优化 + 填充耗时统计"""
    start = time.monotonic()
    result = optimize(params)
    if result.get('success'):
        result['stats']['elapsed_ms'] = round((time.monotonic() - start) * 1000, 1)
    return result
