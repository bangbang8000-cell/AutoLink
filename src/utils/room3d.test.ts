/**
 * AL v5.0.6「3D 可视化」— 机房矩阵 → 3D 世界坐标纯函数单元测试
 */
import { describe, it, expect } from 'vitest'
import {
  roomToWorld,
  powerToHeatColor,
  ROOM_CABINET_WIDTH,
  ROOM_CABINET_DEPTH,
  ROOM_CABINET_GAP,
  ROOM_AISLE_SPACING,
} from './room3d'

describe('roomToWorld（矩阵行/列 → 3D 世界中心坐标）', () => {
  it('单柜网格居中于原点', () => {
    expect(roomToWorld(0, 0, 1, 1)).toEqual({ x: 0, z: 0 })
  })

  it('2×2 网格四角坐标对称且正确', () => {
    const tl = roomToWorld(0, 0, 2, 2)
    const br = roomToWorld(1, 1, 2, 2)
    // 同行不同列 → X 相差 (宽 + 柜间距)
    expect(br.x - tl.x).toBe(ROOM_CABINET_WIDTH + ROOM_CABINET_GAP)
    // 同列不同行 → Z 相差 (深 + 通道间距)
    expect(br.z - tl.z).toBe(ROOM_CABINET_DEPTH + ROOM_AISLE_SPACING)
    // 网格围绕原点对称
    expect(tl.x).toBe(-br.x)
    expect(tl.z).toBe(-br.z)
  })

  it('列沿 X 单调递增', () => {
    const c0 = roomToWorld(0, 0, 1, 3)
    const c1 = roomToWorld(0, 1, 1, 3)
    const c2 = roomToWorld(0, 2, 1, 3)
    expect(c0.x).toBeLessThan(c1.x)
    expect(c1.x).toBeLessThan(c2.x)
    // 中心列居中于原点
    expect(c1.x).toBeCloseTo(0)
  })

  it('行沿 Z 单调递增（排间留有冷/热通道）', () => {
    const r0 = roomToWorld(0, 0, 3, 1)
    const r1 = roomToWorld(1, 0, 3, 1)
    const r2 = roomToWorld(2, 0, 3, 1)
    expect(r0.z).toBeLessThan(r1.z)
    expect(r1.z).toBeLessThan(r2.z)
    // 中间排居中于原点 → 排间为 通道间距
    expect(r2.z - r1.z).toBe(ROOM_CABINET_DEPTH + ROOM_AISLE_SPACING)
    expect(r1.z).toBeCloseTo(0)
  })

  it('15×15 网格坐标落在合理范围内（适配画布）', () => {
    const tl = roomToWorld(0, 0, 15, 15)
    const br = roomToWorld(14, 14, 15, 15)
    expect(tl.x).toBe(-br.x)
    expect(tl.z).toBe(-br.z)
    // 首末列中心距 = (cols-1) × (柜宽 + 柜间距)；首末行中心距 = (rows-1) × (柜深 + 通道间距)
    expect(br.x - tl.x).toBe(14 * (ROOM_CABINET_WIDTH + ROOM_CABINET_GAP))
  })
})

describe('powerToHeatColor（功率占比 → 热力色）', () => {
  it('percent 为 undefined 时返回中性灰', () => {
    expect(powerToHeatColor(undefined)).toBe('#9ca3af')
  })

  it('< 60% 绿色（复用 getPowerColor 阈值）', () => {
    expect(powerToHeatColor(0)).toBe('#16a34a')
    expect(powerToHeatColor(59)).toBe('#16a34a')
  })

  it('60-79% 黄色', () => {
    expect(powerToHeatColor(60)).toBe('#d97706')
    expect(powerToHeatColor(70)).toBe('#d97706')
    expect(powerToHeatColor(79)).toBe('#d97706')
  })

  it('≥ 80% 红色', () => {
    expect(powerToHeatColor(80)).toBe('#dc2626')
    expect(powerToHeatColor(100)).toBe('#dc2626')
  })
})