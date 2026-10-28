/**
 * B5-01 / B5-02 / B5-03（FR-A26）：GPU 共柜三档开关。
 *
 * 覆盖开发计划 B5 验收判据：
 *   - 档① fixed1：128 台 GPU 占 128 柜；
 *   - 档③ manual 填 3：每柜 ≤3 台；0/负数/超 U 位容量被拒并提示；
 *   - 档② byPower：与 ⌊单柜上限 ÷ 单机功率⌋ 且与 U 位容量取小一致；
 *   - 缺失功率按单柜上限计（退化为 1 台/柜）并告警；
 *   - 切换档位只提示柜数变化，不自动落位（estimateGpuCabinets 纯函数）；
 *   - 旧项目未写档位 + gpu_per_cabinet>1 → 视为人工指定。
 */
import { describe, it, expect } from 'vitest'
import {
  GPU_SHARE_MODES,
  estimateGpuCabinets,
  gpuPerCabinetByPower,
  gpuUsableU,
  inferGpuShareMode,
  normalizeGpuShareMode,
  resolveGpuPerCabinet,
  validateManualGpuPerCabinet,
} from '@/shared/gpuShare'
import { packCabinetsByType } from '@/utils/cabinetDemand'
import type { CabinetDemandDevice } from '@/utils/cabinetDemand'

const gpu = (count: number, powerWatts = 5250, uHeight = 8): CabinetDemandDevice[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `gpu-${i + 1}`,
    type: 'server',
    domain: 'gpu',
    uHeight,
    powerWatts,
  }))

describe('gpuShare 档位归一（FR-A26）', () => {
  it('三档枚举固定为 fixed1 / byPower / manual', () => {
    expect(GPU_SHARE_MODES).toEqual(['fixed1', 'byPower', 'manual'])
  })

  it('非法档位一律回退 fixed1', () => {
    expect(normalizeGpuShareMode(undefined)).toBe('fixed1')
    expect(normalizeGpuShareMode(null)).toBe('fixed1')
    expect(normalizeGpuShareMode('auto')).toBe('fixed1')
    expect(normalizeGpuShareMode('byPower')).toBe('byPower')
    expect(normalizeGpuShareMode('manual')).toBe('manual')
  })

  it('旧项目未写档位：gpu_per_cabinet>1 视为人工指定，否则 fixed1', () => {
    expect(inferGpuShareMode(undefined, 3)).toBe('manual')
    expect(inferGpuShareMode(undefined, 1)).toBe('fixed1')
    expect(inferGpuShareMode(undefined, undefined)).toBe('fixed1')
    // 显式档位优先于数值推断
    expect(inferGpuShareMode('fixed1', 3)).toBe('fixed1')
    expect(inferGpuShareMode('byPower', 3)).toBe('byPower')
  })
})

describe('gpuUsableU（FR-A23 预留查表）', () => {
  it('42U GPU 柜底留 4U → 38U', () => {
    expect(gpuUsableU(42)).toBe(38)
  })
  it('非法柜高回退 42U', () => {
    expect(gpuUsableU(undefined)).toBe(38)
    // 0 属非法输入，按 1U 兜底后可用 U 下限保护为 1
    expect(gpuUsableU(0)).toBe(1)
  })
})

describe('档① fixed1：128 台 GPU 占 128 柜', () => {
  it('resolveGpuPerCabinet 返回 1 台/柜，且无告警', () => {
    const res = resolveGpuPerCabinet({
      mode: 'fixed1',
      manualPerCabinet: 8,
      devicePowers: [5250],
      deviceHeights: [8],
    })
    expect(res.perCabinet).toBe(1)
    expect(res.warnings).toEqual([])
  })

  it('128 台 → 128 柜（预检与估算同源）', () => {
    const packing = packCabinetsByType(gpu(128), { gpuShareMode: 'fixed1' })
    expect(packing.byType.gpu).toBe(128)
    expect(estimateGpuCabinets(128, 1)).toBe(128)
  })
})

describe('档③ manual：填 3 → 每柜 ≤3 台', () => {
  it('128 台 / 3 台每柜 → 43 柜（3800 W 时功率与 U 位均允许 3 台）', () => {
    const packing = packCabinetsByType(gpu(128, 3800), { gpuShareMode: 'manual', gpuPerCabinet: 3 })
    expect(packing.gpuPerCabinet).toBe(3)
    expect(packing.byType.gpu).toBe(Math.ceil(128 / 3))
    expect(Math.ceil(128 / 3)).toBe(43)
  })

  it('人工值超物理功率约束时收敛并告警（5250 W → 2 台/柜）', () => {
    const packing = packCabinetsByType(gpu(128, 5250), { gpuShareMode: 'manual', gpuPerCabinet: 3 })
    expect(packing.gpuPerCabinet).toBe(2)
    expect(packing.byType.gpu).toBe(64)
    expect(packing.warnings.join('')).toContain('功率')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '非法值 %s 被拒并提示',
    (value) => {
      const res = validateManualGpuPerCabinet(value, { usableU: 38, maxDeviceHeightU: 8 })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.message).toContain('正整数')
    },
  )

  it('超 U 位容量被拒并提示上限', () => {
    // 38U ÷ 8U = 4 台/柜
    const res = validateManualGpuPerCabinet(5, { usableU: 38, maxDeviceHeightU: 8 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toContain('4')
    expect(validateManualGpuPerCabinet(4, { usableU: 38, maxDeviceHeightU: 8 }).ok).toBe(true)
  })

  it('缺省档位保持旧口径：gpu_per_cabinet 直接生效', () => {
    const packing = packCabinetsByType(gpu(10), { gpuPerCabinet: 5 })
    expect(packing.byType.gpu).toBe(2)
  })
})

describe('档② byPower：与「⌊上限 ÷ 单机功率⌋ 再与 U 位取小」一致', () => {
  it('5250 W / 8U @ 12 kW 38U → 2 台/柜（功率 2 < U 4）', () => {
    const per = gpuPerCabinetByPower({
      devicePowers: [5250],
      deviceHeights: [8],
      powerLimitW: 12000,
      usableU: 38,
    })
    expect(per).toBe(2)
    expect(per).toBe(Math.min(Math.floor(12000 / 5250), Math.floor(38 / 8)))
  })

  it('8000 W / 8U @ 12 kW → 1 台/柜（功率受限）', () => {
    expect(gpuPerCabinetByPower({ devicePowers: [8000], deviceHeights: [8], powerLimitW: 12000, usableU: 38 })).toBe(1)
  })

  it('低功率 3000 W 但机高 20U → 1 台/柜（U 位受限）', () => {
    expect(gpuPerCabinetByPower({ devicePowers: [3000], deviceHeights: [20], powerLimitW: 12000, usableU: 38 })).toBe(1)
  })

  it('128 台 5250 W → 64 柜', () => {
    const packing = packCabinetsByType(gpu(128, 5250), { gpuShareMode: 'byPower' })
    expect(packing.byType.gpu).toBe(64)
  })

  it('混合功率取最严：与逐台取 min 一致', () => {
    const per = gpuPerCabinetByPower({
      devicePowers: [5250, 8000],
      deviceHeights: [8, 8],
      powerLimitW: 12000,
      usableU: 38,
    })
    expect(per).toBe(1)
  })
})

describe('B5-02 缺失字段降级与告警', () => {
  it('单机功率缺失/≤0：按单柜上限计 → 1 台/柜并告警', () => {
    const res = resolveGpuPerCabinet({
      mode: 'byPower',
      devicePowers: [0],
      deviceHeights: [8],
      powerLimitW: 12000,
      usableU: 38,
    })
    expect(res.perCabinet).toBe(1)
    expect(res.warnings.join('')).toContain('12000')
  })

  it('单柜功率上限缺失：回退 12000 W 并告警', () => {
    const res = resolveGpuPerCabinet({
      mode: 'byPower',
      devicePowers: [5250],
      deviceHeights: [8],
      powerLimitW: 0,
      usableU: 38,
    })
    expect(res.perCabinet).toBe(2)
    expect(res.warnings.join('')).toContain('12000')
  })

  it('预检同一下降级路径：缺失功率的 GPU 每柜 1 台', () => {
    const devices: CabinetDemandDevice[] = [
      { id: 'g1', type: 'server', domain: 'gpu', uHeight: 8, powerWatts: 0 },
      { id: 'g2', type: 'server', domain: 'gpu', uHeight: 8, powerWatts: 0 },
    ]
    const packing = packCabinetsByType(devices, { gpuShareMode: 'byPower' })
    expect(packing.byType.gpu).toBe(2)
  })

  it('无 GPU 设备时 byPower 返回 1 台/柜', () => {
    expect(gpuPerCabinetByPower({ devicePowers: [], deviceHeights: [], powerLimitW: 12000, usableU: 38 })).toBe(1)
  })
})

describe('B5-03 档位切换只提示不落位', () => {
  it('柜数估算纯函数：切换前后可比较，且不改动任何输入', () => {
    const before = estimateGpuCabinets(128, 1)
    const after = estimateGpuCabinets(128, 2)
    expect(before).toBe(128)
    expect(after).toBe(64)
    expect(before).not.toBe(after)
  })

  it('0 台设备 → 0 柜', () => {
    expect(estimateGpuCabinets(0, 3)).toBe(0)
  })
})
