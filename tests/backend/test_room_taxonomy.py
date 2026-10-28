"""B1-01 / FR-A05：机房柜型分类单一真源契约用例。

真源 = src/shared/roomTaxonomy.json（前端 src/shared/roomTaxonomy.ts 引用同一文件）。
本用例断言后端 room_taxonomy 加载的集合与该 JSON 完全一致，且 room.py 的自由域/占位
常量确实来自 room_taxonomy（而非各自字面量），从而保证前后端双向差集为空。
"""
import json
from pathlib import Path

import room
import room_taxonomy

REPO_ROOT = Path(__file__).resolve().parents[2]
TAXONOMY_JSON = REPO_ROOT / 'src' / 'shared' / 'roomTaxonomy.json'


def _load_source() -> dict:
    with TAXONOMY_JSON.open('r', encoding='utf-8') as fh:
        return json.load(fh)


def test_source_json_exists():
    assert TAXONOMY_JSON.is_file(), f'真源缺失：{TAXONOMY_JSON}'


def test_backend_sets_equal_source_json():
    raw = _load_source()
    assert sorted(room_taxonomy.CABINET_TYPES) == sorted(raw['cabinetTypes'])
    assert sorted(room_taxonomy.PLACEABLE_CABINET_TYPES) == sorted(raw['placeableCabinetTypes'])
    assert sorted(room_taxonomy.FREE_DOMAIN_TYPES) == sorted(raw['freeDomainTypes'])
    assert sorted(room_taxonomy.PLACEHOLDER_TYPES) == sorted(raw['placeholderTypes'])
    assert sorted(room_taxonomy.DEVICE_DOMAINS) == sorted(raw['deviceDomains'])


def test_room_module_constants_come_from_taxonomy():
    """room.py 的自由域/占位常量必须与 room_taxonomy 同对象同值（防各自维护副本）。"""
    assert set(room.ROOM_FREE_DOMAIN_TYPES) == set(room_taxonomy.FREE_DOMAIN_TYPES)
    assert set(room.PLACEHOLDER_TYPES) == set(room_taxonomy.PLACEHOLDER_TYPES)
    assert room.PLACEHOLDER_AC == room_taxonomy.PLACEHOLDER_AC
    assert room.PLACEHOLDER_PILLAR == room_taxonomy.PLACEHOLDER_PILLAR


def test_loaded_from_shared_json_in_dev():
    """开发态必须命中 src/shared 真源（而非 backend 下的陈旧副本）。"""
    loaded = Path(room_taxonomy._DATA['_loaded_from']).resolve()
    assert loaded == TAXONOMY_JSON.resolve()


def test_sets_are_mutually_exclusive():
    placeable = set(room_taxonomy.PLACEABLE_CABINET_TYPES)
    free = set(room_taxonomy.FREE_DOMAIN_TYPES)
    placeholders = set(room_taxonomy.PLACEHOLDER_TYPES)
    assert not placeable & free
    assert not placeable & placeholders
    assert not free & placeholders
