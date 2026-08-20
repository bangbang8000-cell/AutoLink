"""
打磨轮（v1.5 / AL-R1b）：柜内智能落位优化器（rack:optimize）

输入：现有机柜 [{id, type, totalU, power_limit, devices:[{id,startU,endU,power_watts}]}]
      + 待上架设备池 [{id, name, type, height, power_watts}]
输出：placements[{deviceId, cabinetId, startU, endU}] + unplaced[] + issues[] + stats

约束：U 位不溢出、功率不超限、槽位不冲突、GPU 每柜台数上限（默认 1柜1台）
目标：按设备类型偏好对应柜型放置、紧凑（最低可用 U 起）、设备高度降序提高装箱率
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def _device_cab_type(dtype: str) -> str:
    """设备类型 → 偏好柜型（gpu/storage/compute/network）"""
    t = (dtype or '').lower()
    if '存储' in t or 'storage' in t:
        return 'storage'
    if '通算' in t or 'compute' in t:
        return 'compute'
    if any(k in t for k in ('switch', '交换机', 'leaf', 'spine', 'core', 'access', 'agg')):
        return 'network'
    return 'gpu'


def _find_slot(cab: Dict[str, Any], height: int, power: int, gpu_count: int, gpu_per_cabinet: int) -> Optional[int]:
    """在柜内找最低可用 U 位（height 起，U 不冲突 + 功率不超 + GPU 台数上限）"""
    total_u = int(cab.get('totalU') or 42)
    power_limit = int(cab.get('power_limit') or 6000)
    devices = list(cab.get('devices') or [])
    if height <= 0 or height > total_u:
        return None
    if gpu_count >= gpu_per_cabinet:
        return None
    power_used = sum(int(d.get('power_watts') or 0) for d in devices)
    if power_used + power > power_limit:
        return None
    ranges = [(int(d['startU']), int(d['endU'])) for d in devices
              if d.get('startU') is not None and d.get('endU') is not None]
    for start in range(1, total_u - height + 2):
        end = start + height - 1
        if all(end < s or start > e for s, e in ranges):
            return start
    return None


def optimize_rack_placements(
    cabinets: List[Dict[str, Any]],
    unplaced_devices: List[Dict[str, Any]],
    gpu_per_cabinet: int = 1,
) -> Dict[str, Any]:
    """柜内智能落位主函数"""
    # 工作副本（就地更新以反映放置结果）
    work: List[Dict[str, Any]] = []
    for cab in cabinets or []:
        work.append({
            'id': cab.get('id'),
            'type': cab.get('type'),
            'totalU': int(cab.get('totalU') or 42),
            'power_limit': int(cab.get('power_limit') or 6000),
            'devices': [dict(d) for d in (cab.get('devices') or [])],
        })

    def gpu_in(cab: Dict[str, Any]) -> int:
        return sum(1 for d in cab['devices'] if _device_cab_type(d.get('type') or '') == 'gpu')

    placements: List[Dict[str, Any]] = []
    unplaced_ids: List[str] = []
    issues: List[str] = []

    # 高度降序 → 装箱率更高；同类聚集
    devices = sorted(unplaced_devices or [], key=lambda d: -(int(d.get('height') or 0)))
    for d in devices:
        did = d.get('id')
        height = int(d.get('height') or 4)
        power = int(d.get('power_watts') or 0)
        pref = _device_cab_type(d.get('type') or '')
        # 偏好柜型优先（GPU 受每柜台数上限约束），其次任意柜型
        preferred = [c for c in work if c['type'] == pref]
        others = [c for c in work if c['type'] != pref]
        placed = False
        for cab in preferred + others:
            gc = gpu_in(cab)
            # 仅 GPU 设备受每柜台数上限约束；网络/存储/通算不受
            cap = gpu_per_cabinet if pref == 'gpu' and cab['type'] == 'gpu' else 10 ** 9
            start = _find_slot(cab, height, power, gc, cap)
            if start is not None:
                end = start + height - 1
                cab['devices'].append({
                    'id': did, 'type': d.get('type') or '', 'startU': start, 'endU': end,
                    'power_watts': power,
                })
                placements.append({'deviceId': did, 'cabinetId': cab['id'], 'startU': start, 'endU': end})
                placed = True
                break
        if not placed:
            unplaced_ids.append(did)

    return {
        'success': True,
        'placements': placements,
        'unplaced': unplaced_ids,
        'issues': issues,
        'stats': {'placed': len(placements), 'unplaced': len(unplaced_ids)},
    }
