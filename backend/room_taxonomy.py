"""机房柜型分类单一真源（B1-01 / FR-A05）。

与前端 ``src/shared/roomTaxonomy.json`` 共享同一份 JSON：
前端由 ``src/shared/roomTaxonomy.ts`` 包装引用，Python 在此按候选路径探测加载。
打包时 ``package.json`` 的 extraResources 会把 JSON 复制到 ``resources/backend/roomTaxonomy.json``。

禁止在本文件或 ``room.py`` 中重新写字面量集合——任何口径变更只改 JSON。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Tuple

_HERE = Path(__file__).resolve().parent
# 打包态：resources/backend/room_taxonomy.py → resources/backend/roomTaxonomy.json
# 开发态：<repo>/backend/room_taxonomy.py → <repo>/src/shared/roomTaxonomy.json
_CANDIDATES: Tuple[Path, ...] = (
    _HERE / 'roomTaxonomy.json',
    _HERE.parent / 'src' / 'shared' / 'roomTaxonomy.json',
)


def _load() -> Dict[str, Any]:
    for path in _CANDIDATES:
        if path.is_file():
            with path.open('r', encoding='utf-8') as fh:
                data = json.load(fh)
            data['_loaded_from'] = str(path)
            return data
    searched = '、'.join(str(p) for p in _CANDIDATES)
    raise RuntimeError(f'roomTaxonomy.json 未找到（已尝试：{searched}）')


_DATA = _load()

CABINET_TYPES: Tuple[str, ...] = tuple(_DATA['cabinetTypes'])
PLACEABLE_CABINET_TYPES: Tuple[str, ...] = tuple(_DATA['placeableCabinetTypes'])
FREE_DOMAIN_TYPES: Tuple[str, ...] = tuple(_DATA['freeDomainTypes'])
PLACEHOLDER_TYPES: Tuple[str, ...] = tuple(_DATA['placeholderTypes'])
DEVICE_DOMAINS: Tuple[str, ...] = tuple(_DATA['deviceDomains'])

# B1-05 / FR-A01：柜内装箱默认参数（与前端 RACK_PACKING_DEFAULTS 同源）
RACK_PACKING_DEFAULTS: Dict[str, Any] = {
    k: v for k, v in (_DATA.get('rackPackingDefaults') or {}).items() if not k.startswith('_')
}
_REQUIRED_PACKING_KEYS: Tuple[str, ...] = (
    'rackTypeU', 'topReservedU', 'powerLimitW', 'gpuPerCabinet', 'interSwitchGapU',
    'marginRatio', 'areaPerCabinetSqm', 'minCabinetsPerRow', 'maxCabinetsPerRow',
)
_MISSING_PACKING_KEYS = [k for k in _REQUIRED_PACKING_KEYS if k not in RACK_PACKING_DEFAULTS]
if _MISSING_PACKING_KEYS:
    raise RuntimeError(
        f'roomTaxonomy.json rackPackingDefaults 缺少必需键：{_MISSING_PACKING_KEYS}'
    )

# B4-04 / FR-A23：预留按柜型拆分（与前端 RACK_RESERVE_BY_TYPE 同源）
_RACK_RESERVE_BY_TYPE: Dict[str, Dict[str, int]] = {
    k: {
        'bottomReservedU': max(0, int(v.get('bottomReservedU', 0))),
        'topReservedU': max(0, int(v.get('topReservedU', 0))),
    }
    for k, v in (_DATA.get('rackReserveByType') or {}).items()
    if not k.startswith('_')
}
RACK_RESERVE_BY_TYPE: Dict[str, Dict[str, int]] = dict(_RACK_RESERVE_BY_TYPE)


def rack_reserve_for(cabinet_type: str | None, fallback_top_reserved_u: int | None = None) -> Dict[str, int]:
    """取柜型预留：表中有的柜型以表为准；未列出的柜型回退「底部不预留 + 全局 topReservedU」。"""
    hit = _RACK_RESERVE_BY_TYPE.get(cabinet_type or '')
    if hit is not None:
        return dict(hit)
    fallback = RACK_PACKING_DEFAULTS.get('topReservedU', 2) if fallback_top_reserved_u is None else fallback_top_reserved_u
    return {'bottomReservedU': 0, 'topReservedU': max(0, int(fallback or 0))}


def rack_usable_u_for(
    cabinet_type: str | None,
    rack_type_u: int = 42,
    fallback_top_reserved_u: int | None = None,
) -> int:
    """柜型可用 U = 总 U − 底部预留 − 顶部预留（至少 1）。"""
    reserve = rack_reserve_for(cabinet_type, fallback_top_reserved_u)
    return max(1, int(rack_type_u) - reserve['bottomReservedU'] - reserve['topReservedU'])


# 协议常量（与前端 RoomCellData.placeholder / 占位渲染键一致）
PLACEHOLDER_AC = 'ac'
PLACEHOLDER_PILLAR = 'pillar'
if set(PLACEHOLDER_TYPES) != {PLACEHOLDER_AC, PLACEHOLDER_PILLAR}:
    raise RuntimeError(
        f'roomTaxonomy.json placeholderTypes 必须为 [{PLACEHOLDER_AC}, {PLACEHOLDER_PILLAR}]，'
        f'实际为 {list(PLACEHOLDER_TYPES)}'
    )
