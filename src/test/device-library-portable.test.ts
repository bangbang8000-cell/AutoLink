/**
 * 48-c（F8-3）：设备库跨端可移植格式（MC ↔ AL）
 * - buildPortableLibrary：AL 设备 → 可移植 JSON（format/schemaVersion/exportedAt/devices）
 * - parsePortableLibrary：解析 → 归一化（兼容 AL 可移植格式与 MC 扁平数组）
 * - normalizeMcDevice：MC device_library.json 结构（无 category）→ AL LibraryDevice
 */
import { describe, it, expect } from 'vitest'
import type { LibraryDevice } from '@/types/device-profile'
import {
  DEVICE_LIBRARY_PORTABLE_FORMAT,
  DEVICE_LIBRARY_PORTABLE_VERSION,
  buildPortableLibrary,
  parsePortableLibrary,
  normalizeMcDevice,
  deriveCategory,
} from '@/utils/deviceLibraryPortable'

const alDevice: LibraryDevice = {
  id: 'h3c_s9827_al',
  vendor: 'H3C', model: 'S9827', description: '参数网交换机',
  power_watts: 1000, weight_kg: 20, u_height: 1, depth_mm: 800, cooling: 'air',
  name_prefix: 'h3c', port_count: 128, port_speed: '400G', port_type: 'OSFP',
  category: 'switches_param', tags: ['H3C'], applicable_networks: ['param'],
  source: 'custom', verified: false, added_at: '2026-01-01', updated_at: '2026-01-01',
}

// MC backend/intent/device_library.json 结构（无 category）
const mcDevice = {
  id: 'h3c_s9825_128b',
  vendor: 'H3C',
  model: 'S9825-128B',
  port_count: 128,
  port_speed: '200G',
  port_type: 'QSFP56',
  description: '存储网交换机',
  applicable_networks: ['storage'],
}

describe('buildPortableLibrary（设备库导出可移植格式）', () => {
  it('生成含 schema/版本清单的可移植 JSON', () => {
    const json = buildPortableLibrary([alDevice])
    const parsed = JSON.parse(json)
    expect(parsed.format).toBe(DEVICE_LIBRARY_PORTABLE_FORMAT)
    expect(parsed.schemaVersion).toBe(DEVICE_LIBRARY_PORTABLE_VERSION)
    expect(parsed.exportedAt).toBeTruthy()
    expect(parsed.devices).toHaveLength(1)
    expect(parsed.devices[0].id).toBe('h3c_s9827_al')
  })
})

describe('parsePortableLibrary（设备库可移植格式回导）', () => {
  it('解析 AL 可移植格式 → 归一化设备列表', () => {
    const r = parsePortableLibrary(buildPortableLibrary([alDevice]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.devices).toHaveLength(1)
      expect(r.devices[0].id).toBe('h3c_s9827_al')
      expect(r.devices[0].source).toBe('custom')
    }
  })

  it('兼容 MC 扁平数组（backend/intent/device_library.json 结构）', () => {
    const r = parsePortableLibrary(JSON.stringify([mcDevice]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const dev = r.devices[0]
      expect(dev.id).toBe('h3c_s9825_128b')
      expect(dev.category).toBe('switches_storage')
      expect(dev.applicable_networks).toEqual(['storage'])
      expect(dev.source).toBe('custom')
      expect(dev.port_count).toBe(128)
      expect(dev.port_speed).toBe('200G')
    }
  })

  it('兼容 {devices:[...]} 外壳（无格式标识）', () => {
    const r = parsePortableLibrary(JSON.stringify({ devices: [mcDevice] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.devices[0].category).toBe('switches_storage')
  })

  it('非法 JSON / 格式不符 / 版本不符 / 空列表 → 失败', () => {
    expect(parsePortableLibrary('x').ok).toBe(false)
    expect(parsePortableLibrary(JSON.stringify({ format: 'other', schemaVersion: 1, devices: [] })).ok).toBe(false)
    expect(parsePortableLibrary(JSON.stringify({ format: DEVICE_LIBRARY_PORTABLE_FORMAT, schemaVersion: 9, devices: [alDevice] })).ok).toBe(false)
    expect(parsePortableLibrary(JSON.stringify({ format: DEVICE_LIBRARY_PORTABLE_FORMAT, schemaVersion: 1, devices: [] })).ok).toBe(false)
  })
})

describe('normalizeMcDevice / deriveCategory（MC 设备 → AL）', () => {
  it('MC 交换机设备归一化为 AL 设备（无 interface_models → 交换机）', () => {
    const dev = normalizeMcDevice(mcDevice)
    expect(dev.id).toBe('h3c_s9825_128b')
    expect(dev.category).toBe('switches_storage')
    expect(dev.source).toBe('custom')
    expect(dev.verified).toBe(false)
    expect(dev.port_count).toBe(128)
    expect(dev.port_speed).toBe('200G')
    expect(dev.tags).toContain('S9825-128B')
  })

  it('缺 id/model 时兜底生成', () => {
    const dev = normalizeMcDevice({ vendor: 'H3C', applicable_networks: ['biz'] })
    expect(dev.id).toBeTruthy()
    expect(dev.category).toBe('switches_biz')
    expect(dev.model).toBe('')
  })

  it('deriveCategory 按网络类型派生分类', () => {
    expect(deriveCategory(['param'])).toBe('switches_param')
    expect(deriveCategory(['storage'])).toBe('switches_storage')
    expect(deriveCategory(['biz'])).toBe('switches_biz')
    expect(deriveCategory(['oob'])).toBe('switches_oob')
    expect(deriveCategory([])).toBe('custom')
  })
})
