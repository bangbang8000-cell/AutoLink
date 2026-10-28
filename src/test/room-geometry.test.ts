/**
 * AL v5.5.7（B4-01 / A19）— 机房平面 mm 逻辑坐标单元测试
 *
 * 覆盖：T-B4-01 柜宽深比 / T-B4-02 三档通道联动 / T-B4-03 每排柜数联动 / T-B4-04 无像素硬编码
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GEOMETRY_AISLE_WIDTHS,
  GEOMETRY_CABINET_DEPTH,
  GEOMETRY_CABINET_HEIGHTS,
  GEOMETRY_CABINET_WIDTH,
  MM_PER_M,
  defaultGeometry,
  planMetrics,
  resolveGeometry,
  type RoomGeometryData,
} from '@/utils/roomGeometry'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'

const LAYOUT_SRC = readFileSync(
  resolve(process.cwd(), 'src/components/datacenter/DataCenterLayout.tsx'),
  'utf-8',
)

function matrix(rows: number, cols: number, geometry?: Partial<RoomGeometryData>): RoomMatrixData {
  return {
    schemaVersion: 2,
    name: '机房',
    rows: Array.from({ length: rows }, (_, i) => String.fromCharCode(65 + i)),
    cols: Array.from({ length: cols }, (_, i) => i + 1),
    cells: [],
    geometry: geometry ? { ...defaultGeometry(rows, cols), ...geometry } : undefined,
  }
}

afterEach(() => {
  useRoomStore.setState({ matrix: null })
})

describe('resolveGeometry（A18/A21：v1 缺省补齐 + 非法值回落）', () => {
  it('默认值与后端 room.py 同源（0.6 / 1.2 / 2.0 / 1.2）', () => {
    const geo = defaultGeometry(10, 12)
    expect(geo.cabinetWidth).toBe(GEOMETRY_CABINET_WIDTH)
    expect(geo.cabinetDepth).toBe(GEOMETRY_CABINET_DEPTH)
    expect(geo.cabinetHeight).toBe(GEOMETRY_CABINET_HEIGHTS[0])
    expect(geo.aisleWidth).toBe(GEOMETRY_AISLE_WIDTHS[0])
    expect(geo.rowCount).toBe(10)
    expect(geo.cabinetsPerRow).toBe(12)
  })

  it('v1 布局无 geometry 时按矩阵行列补齐', () => {
    const geo = resolveGeometry(matrix(6, 8))
    expect(geo.rowCount).toBe(6)
    expect(geo.cabinetsPerRow).toBe(8)
    expect(geo.cabinetWidth).toBe(0.6)
    expect(geo.aisleWidth).toBe(1.2)
  })

  it('矩阵行列数优先于 geometry 冗余字段', () => {
    const geo = resolveGeometry(matrix(4, 7, { rowCount: 99, cabinetsPerRow: 99 }))
    expect(geo.rowCount).toBe(4)
    expect(geo.cabinetsPerRow).toBe(7)
  })

  it('非法/缺失尺寸回落到默认值', () => {
    const geo = resolveGeometry(matrix(3, 6, { cabinetWidth: 0, aisleWidth: -1, cabinetHeight: NaN }))
    expect(geo.cabinetWidth).toBe(GEOMETRY_CABINET_WIDTH)
    expect(geo.aisleWidth).toBe(GEOMETRY_AISLE_WIDTHS[0])
    expect(geo.cabinetHeight).toBe(GEOMETRY_CABINET_HEIGHTS[0])
  })

  it('matrix 为空时返回全默认值', () => {
    const geo = resolveGeometry(null)
    expect(geo.rowCount).toBe(1)
    expect(geo.cabinetsPerRow).toBe(6)
  })
})

describe('planMetrics（A19：柜 600×1200 mm，缩放交 viewBox）', () => {
  it('T-B4-01 柜宽:柜深 = 1:2（±2%）', () => {
    const m = planMetrics(resolveGeometry(matrix(5, 10)), 10, 5)
    expect(m.cellW).toBe(0.6 * MM_PER_M)
    expect(m.cellH).toBe(1.2 * MM_PER_M)
    expect(Math.abs(m.cellW / m.cellH - 0.5)).toBeLessThanOrEqual(0.01)
  })

  it('T-B4-02 三档通道宽逐档映射到 mm 并改变排距', () => {
    const base = planMetrics(resolveGeometry(matrix(5, 10, { aisleWidth: 1.2 })), 10, 5)
    const mid = planMetrics(resolveGeometry(matrix(5, 10, { aisleWidth: 1.35 })), 10, 5)
    const wide = planMetrics(resolveGeometry(matrix(5, 10, { aisleWidth: 1.6 })), 10, 5)

    expect([base.aisle, mid.aisle, wide.aisle]).toEqual([1200, 1350, 1600])
    // 相邻排间距 = 柜深 + 柜间距 + 通道
    expect(base.rowTop(1) - base.rowTop(0)).toBeCloseTo(base.cellH + base.gap + 1200)
    expect(mid.rowTop(1) - mid.rowTop(0)).toBeCloseTo(mid.cellH + mid.gap + 1350)
    expect(wide.heightMm).toBeGreaterThan(mid.heightMm)
    expect(mid.heightMm).toBeGreaterThan(base.heightMm)
  })

  it('T-B4-03 每排柜数变化 → 画布宽度与列坐标同步', () => {
    const small = planMetrics(resolveGeometry(matrix(2, 6)), 6, 2)
    const large = planMetrics(resolveGeometry(matrix(2, 24)), 24, 2)

    expect(large.widthMm - small.widthMm).toBeCloseTo(18 * (large.cellW + large.gap))
    expect(small.widthMm).toBeLessThan(large.widthMm)
    // 同一列索引的绝对位置不随总列数变化（仅画布变宽）
    expect(small.colLeft(5)).toBeCloseTo(large.colLeft(5))
    // 列左边缘间距恒定
    expect(large.colLeft(1) - large.colLeft(0)).toBeCloseTo(large.cellW + large.gap)
  })

  it('同一 geometry 下宽高只随行列数增长', () => {
    const a = planMetrics(resolveGeometry(matrix(3, 6)), 6, 3)
    const b = planMetrics(resolveGeometry(matrix(4, 6)), 6, 4)
    expect(b.widthMm).toBeCloseTo(a.widthMm)
    expect(b.heightMm).toBeGreaterThan(a.heightMm)
  })
})

describe('T-B4-04 无像素硬编码', () => {
  it('平面组件不再持有柜宽/柜深 px 常量', () => {
    expect(LAYOUT_SRC).not.toMatch(/const\s+CELL_W\s*=\s*64/)
    expect(LAYOUT_SRC).not.toMatch(/const\s+CELL_H\s*=\s*48/)
    expect(LAYOUT_SRC).not.toMatch(/const\s+CELL_GAP\s*=\s*3/)
    expect(LAYOUT_SRC).not.toMatch(/const\s+LABEL_W\s*=\s*34/)
    expect(LAYOUT_SRC).not.toMatch(/const\s+LABEL_H\s*=\s*24/)
  })

  it('平面组件改用 viewBox + planMetrics（mm 逻辑坐标）', () => {
    expect(LAYOUT_SRC).toContain('viewBox={`0 0 ${metrics.widthMm} ${metrics.heightMm}`}')
    expect(LAYOUT_SRC).toContain('planMetrics(geo')
    expect(LAYOUT_SRC).toContain('resolveGeometry(matrix)')
  })
})

describe('updateGeometry（A19：几何参数写回矩阵并与 3D 同源）', () => {
  it('三档通道宽写入 matrix.geometry 并保留其余字段', () => {
    useRoomStore.setState({ matrix: matrix(3, 6) })
    useRoomStore.getState().updateGeometry({ aisleWidth: 1.6 })
    const geo = useRoomStore.getState().matrix?.geometry
    expect(geo?.aisleWidth).toBe(1.6)
    expect(geo?.cabinetWidth).toBe(0.6)
    expect(geo?.rowCount).toBe(3)
    expect(geo?.cabinetsPerRow).toBe(6)
  })

  it('无矩阵时为空操作', () => {
    useRoomStore.setState({ matrix: null })
    expect(() => useRoomStore.getState().updateGeometry({ aisleWidth: 1.35 })).not.toThrow()
    expect(useRoomStore.getState().matrix).toBeNull()
  })
})
