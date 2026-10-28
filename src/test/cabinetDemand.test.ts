import { describe, it, expect } from 'vitest'
import { estimateCabinetDemand, packCabinetsByType, MAX_CABINETS_PER_ROW, MIN_CABINETS_PER_ROW } from '@/utils/cabinetDemand'
import type { CabinetDemandDevice } from '@/utils/cabinetDemand'

const gpu = (count: number): CabinetDemandDevice[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `gpu-${i + 1}`, type: 'server', domain: 'gpu', uHeight: 8, powerWatts: 5250,
  }))

describe('estimateCabinetDemand（FR-A07 柜数需求估算）', () => {
  it('perRow 恒定落在 6–24', () => {
    expect(estimateCabinetDemand(gpu(8), { perRowBasis: 3 }).suggested[0].perRow).toBe(MIN_CABINETS_PER_ROW)
    expect(estimateCabinetDemand(gpu(8), { perRowBasis: 999 }).suggested[0].perRow).toBe(MAX_CABINETS_PER_ROW)
    expect(estimateCabinetDemand(gpu(8)).suggested[0].perRow).toBe(MAX_CABINETS_PER_ROW)
  })

  it('rows 为向上取整（余量系数 0 时 = 精确需求）', () => {
    const res = estimateCabinetDemand(gpu(128), { marginRatio: 0, perRowBasis: 24 })
    expect(res.totalCabinets).toBe(128)
    expect(res.totalWithMargin).toBe(128)
    expect(res.suggested).toEqual([{ rows: Math.ceil(128 / 24), perRow: 24 }])
  })

  it('默认余量 +10%：建议柜数 = ceil(精确 × 1.1)，精确需求不变', () => {
    const res = estimateCabinetDemand(gpu(128))
    expect(res.totalCabinets).toBe(128)
    expect(res.totalWithMargin).toBe(Math.ceil(128 * 1.1))
    expect(res.totalWithMargin).toBeGreaterThan(res.totalCabinets)
  })

  it('设备数增加 10% 后建议值随之变化', () => {
    const before = estimateCabinetDemand(gpu(100))
    const after = estimateCabinetDemand(gpu(110))
    expect(after.totalWithMargin).toBeGreaterThan(before.totalWithMargin)
  })

  it('面积/功率/制冷随精确需求与设备功率推导', () => {
    const res = estimateCabinetDemand(gpu(10), { marginRatio: 0 })
    expect(res.totalCabinets).toBe(10)
    expect(res.areaSqm).toBe(30) // 3 m²/柜
    expect(res.powerKw).toBe(52.5)
    expect(res.coolingKw).toBe(res.powerKw)
  })

  it('纯函数：不修改入参设备清单', () => {
    const devices = gpu(4)
    const snapshot = JSON.stringify(devices)
    estimateCabinetDemand(devices)
    expect(JSON.stringify(devices)).toBe(snapshot)
  })

  it('packCabinetsByType 与 estimateCabinetDemand 的精确需求同源', () => {
    const devices = gpu(60)
    expect(packCabinetsByType(devices).totalCabinets).toBe(estimateCabinetDemand(devices).totalCabinets)
  })
})
