import { describe, it, expect, beforeEach } from 'vitest'
import { roomLayoutArt, roomLayoutSvg, rackElevationSvg, rackElevationSize } from '@/utils/exportGraphics'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'

const makeMatrix = (): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: ['A', 'B'],
  cols: [1, 2],
  cells: [
    { row: 'A', col: 1, type: 'gpu', placeholder: null, cabinetId: 1 },
    { row: 'A', col: 2, type: 'power', placeholder: null, cabinetId: null },
    { row: 'B', col: 1, type: 'empty', placeholder: 'ac', cabinetId: null },
    { row: 'B', col: 2, type: 'network', placeholder: null, cabinetId: null },
  ],
})

const makeCabinet = (): RackCabinet => ({
  id: 1,
  name: '机柜 A1',
  totalU: 42,
  type: 'gpu',
  power_limit: 6000,
  devices: [
    { id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 1000 },
  ],
})

describe('exportGraphics（v1.5 / AL-O1d）', () => {
  beforeEach(() => {
    useRoomStore.setState({ matrix: null })
    useRackStore.setState({ cabinets: [] })
  })

  it('无矩阵 → roomLayoutArt 返回 null、roomLayoutSvg 为空', () => {
    expect(roomLayoutArt()).toBeNull()
    expect(roomLayoutSvg()).toBe('')
  })

  it('有矩阵 → 生成含格子与机柜名的 SVG 及尺寸', () => {
    useRoomStore.setState({ matrix: makeMatrix() })
    useRackStore.setState({ cabinets: [makeCabinet()] })
    const art = roomLayoutArt()!
    expect(art.svg).toContain('<svg')
    expect(art.svg).toContain('机柜 A1') // 已上架机柜名
    expect(art.svg).toContain('A1')      // 格子位置名
    expect(art.width).toBeGreaterThan(0)
    expect(art.height).toBeGreaterThan(0)
    expect(roomLayoutSvg()).toBe(art.svg)
  })

  it('柜上架图 SVG 包含设备名与 U 标尺，尺寸按 totalU 推导', () => {
    const cab = makeCabinet()
    const svg = rackElevationSvg(cab)
    expect(svg).toContain('机柜 A1')
    expect(svg).toContain('GPU服务器_1')
    const size = rackElevationSize(cab)
    expect(size.height).toBe(cab.totalU * 7 + 26)
  })
})
