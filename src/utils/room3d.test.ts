/**
 * AL v5.5.8「3D 可视化」— 机房矩阵 → 3D 世界坐标纯函数单元测试
 *
 * 覆盖 T-B4-05（3D 柜高映射）/ T-B4-06（3D 排距联动）/ T-B4-07（平面与 3D 同源）
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  roomToWorld,
  roomSceneScale,
  cameraForScale,
  uHeight,
  powerToHeatColor,
  ROOM_CABINET_WIDTH,
  ROOM_CABINET_DEPTH,
  ROOM_CABINET_GAP,
  ROOM_AISLE_SPACING,
  ROOM_U_HEIGHT,
} from './room3d'
import { defaultGeometry, type RoomGeometryData } from './roomGeometry'

const geo = (patch: Partial<RoomGeometryData> = {}): RoomGeometryData => ({
  ...defaultGeometry(15, 15),
  ...patch,
})

const ROOM3D_SRC = readFileSync(resolve(process.cwd(), 'src/utils/room3d.ts'), 'utf-8')
const VIEW_SRC = readFileSync(
  resolve(process.cwd(), 'src/components/workspace/room/Room3DView.tsx'),
  'utf-8',
)

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
    expect(tl.x).toBeCloseTo(-br.x, 6)
    expect(tl.z).toBeCloseTo(-br.z, 6)
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

describe('A20 / T-B4-05：3D 柜高映射（柜高由 geometry 决定）', () => {
  it('42U ↔ 2.0 m：每 U 高度 = 2.0/42，42U 叠满等于柜高', () => {
    const g = geo({ cabinetHeight: 2.0 })
    expect(uHeight(g)).toBeCloseTo(2.0 / 42, 6)
    expect(uHeight(g) * 42).toBeCloseTo(2.0, 6)
    expect(ROOM_U_HEIGHT).toBeCloseTo(2.0 / 42, 6)
  })

  it('47U ↔ 2.2 m：柜高变化后每 U 高度同步变化', () => {
    const g = geo({ cabinetHeight: 2.2 })
    expect(uHeight(g)).toBeCloseTo(2.2 / 47, 6)
    expect(uHeight(g) * 47).toBeCloseTo(2.2, 6)
    // 与 2.0 m 柜相比单 U 高度不同（不是固定常量）
    expect(uHeight(g)).not.toBeCloseTo(ROOM_U_HEIGHT, 4)
  })

  it('缺省 geometry 时回落 42U / 2.0 m', () => {
    expect(uHeight(null)).toBeCloseTo(2.0 / 42, 6)
  })
})

describe('A20 / T-B4-06：3D 排距随通道宽联动', () => {
  it('三档通道宽 1.2 / 1.35 / 1.6 m 逐档改变排间距', () => {
    const [a, b, c] = [1.2, 1.35, 1.6].map((aisle) =>
      roomToWorld(1, 0, 3, 1, geo({ aisleWidth: aisle })).z -
      roomToWorld(0, 0, 3, 1, geo({ aisleWidth: aisle })).z,
    )
    expect(a).toBeCloseTo(ROOM_CABINET_DEPTH + 1.2, 6)
    expect(b).toBeCloseTo(ROOM_CABINET_DEPTH + 1.35, 6)
    expect(c).toBeCloseTo(ROOM_CABINET_DEPTH + 1.6, 6)
  })

  it('不传 geometry 时与默认通道一致', () => {
    const withGeo = roomToWorld(1, 0, 3, 1, geo()).z - roomToWorld(0, 0, 3, 1, geo()).z
    const without = roomToWorld(1, 0, 3, 1).z - roomToWorld(0, 0, 3, 1).z
    expect(without).toBeCloseTo(withGeo, 6)
    expect(without).toBeCloseTo(ROOM_CABINET_DEPTH + ROOM_AISLE_SPACING, 6)
  })

  it('排数与每排柜数按矩阵实际维度参与场景刻度', () => {
    const small = roomSceneScale(geo(), 3, 6)
    const large = roomSceneScale(geo(), 10, 24)
    expect(small.width).toBeCloseTo(6 * (ROOM_CABINET_WIDTH + ROOM_CABINET_GAP) - ROOM_CABINET_GAP, 6)
    expect(large.width).toBeGreaterThan(small.width)
    expect(large.depth).toBeGreaterThan(small.depth)
    expect(large.height).toBeCloseTo(geo().cabinetHeight, 6)
  })

  it('相机随场景跨度自适应（大机房拉远、小机房拉近）', () => {
    const near = cameraForScale(roomSceneScale(geo(), 2, 6))
    const far = cameraForScale(roomSceneScale(geo(), 20, 24))
    expect(far.position[1]).toBeGreaterThan(near.position[1])
    expect(far.maxDistance).toBeGreaterThan(near.maxDistance)
    expect(far.far).toBeGreaterThan(near.far)
    expect(near.minDistance).toBeGreaterThan(0)
  })
})

describe('A20 / T-B4-07：平面与 3D 同一 geometry 事实源', () => {
  it('3D 尺寸常量全部派生自 roomGeometry（无独立世界单位常量）', () => {
    expect(ROOM3D_SRC).toContain("from '@/utils/roomGeometry'")
    expect(ROOM3D_SRC).toContain('GEOMETRY_CABINET_WIDTH')
    expect(ROOM3D_SRC).toContain('GEOMETRY_CABINET_DEPTH')
    expect(ROOM3D_SRC).not.toMatch(/CAB_WIDTH\s*=\s*60/)
    expect(ROOM3D_SRC).not.toMatch(/CAB_DEPTH\s*=\s*40/)
    expect(ROOM_CABINET_WIDTH).toBe(0.6)
    expect(ROOM_CABINET_DEPTH).toBe(1.2)
  })

  it('3D 视图读 matrix.geometry 并把 geo 传入落位函数', () => {
    expect(VIEW_SRC).toContain('resolveGeometry(matrix)')
    expect(VIEW_SRC).toContain('roomToWorld(')
    expect(VIEW_SRC).toContain('roomSceneScale(')
    // 柜高不再按 totalU × 固定 U 高推算，而是直接用 geometry.cabinetHeight
    expect(VIEW_SRC).not.toContain('ROOM_U_HEIGHT')
    expect(VIEW_SRC).toContain('geo.cabinetHeight')
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