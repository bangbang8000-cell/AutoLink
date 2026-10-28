/**
 * B1-01 / FR-A05：自由域 / 可落位 / 占位集合单一同源契约用例
 *
 * 真源 = src/shared/roomTaxonomy.json；前端常量必须与 JSON 完全一致。
 * 后端 tests/backend/test_room_taxonomy.py 断言 Python 侧加载的是同一份 JSON，
 * 因此「前端集合 === 后端集合（双向差集为空）」由两侧共同钉住真源传递保证。
 * 只要有人单边改常量或改 JSON 而不改另一侧，本用例（或后端用例）必红。
 */
import { describe, it, expect } from 'vitest'
import raw from '@/shared/roomTaxonomy.json'
import {
  CABINET_TYPES,
  DEVICE_DOMAINS,
  FREE_DOMAIN_TYPES,
  PLACEABLE_CABINET_TYPES,
  PLACEHOLDER_TYPES,
} from '@/shared/roomTaxonomy'

const sorted = (xs: Iterable<string>) => Array.from(xs).sort()

describe('roomTaxonomy 单一真源（B1-01 / FR-A05）', () => {
  it('前端集合 === JSON 真源（双向差集为空）', () => {
    expect(sorted(CABINET_TYPES)).toEqual(sorted(raw.cabinetTypes))
    expect(sorted(PLACEABLE_CABINET_TYPES)).toEqual(sorted(raw.placeableCabinetTypes))
    expect(sorted(FREE_DOMAIN_TYPES)).toEqual(sorted(raw.freeDomainTypes))
    expect(sorted(PLACEHOLDER_TYPES)).toEqual(sorted(raw.placeholderTypes))
    expect(sorted(DEVICE_DOMAINS)).toEqual(sorted(raw.deviceDomains))
  })

  it('三组口径互斥：可落位 / 自由域 / 占位不重叠', () => {
    const overlaps = [...PLACEABLE_CABINET_TYPES].filter(
      (t) => FREE_DOMAIN_TYPES.has(t) || PLACEHOLDER_TYPES.has(t),
    )
    expect(overlaps).toEqual([])
    expect([...FREE_DOMAIN_TYPES].filter((t) => PLACEHOLDER_TYPES.has(t))).toEqual([])
  })

  it('可落位柜型是柜型全集的子集', () => {
    const missing = [...PLACEABLE_CABINET_TYPES].filter((t) => !(CABINET_TYPES as readonly string[]).includes(t))
    expect(missing).toEqual([])
  })
})
