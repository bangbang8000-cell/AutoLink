import { describe, it, expect } from 'vitest'
import { checkRackFeasibility } from '@/utils/rackFeasibility'
import { layoutRacksFromMatrix } from '@/utils/rackMatrixLayout'
import type { RoomMatrixData } from '@/stores/room.store'
import type { RackTopologyNode } from '@/stores/rack.store'

const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** 构造 rows × cols 全标记矩阵 */
const makeMatrix = (rows: number, cols: number, type: string): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: ROW_LETTERS.slice(0, rows).split(''),
  cols: Array.from({ length: cols }, (_, i) => i + 1),
  cells: Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({
      row: ROW_LETTERS[r],
      col: c + 1,
      type,
      placeholder: null,
      cabinetId: null,
    })),
  ).flat(),
})

const gpuNodes = (count: number): RackTopologyNode[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `gpu-${i + 1}`,
    type: 'server',
    group: 'GPU服务器组1',
    podid: 'pod-gpu',
    domain: 'gpu' as const,
    uHeight: 8,
    powerWatts: 5250,
  }))

describe('checkRackFeasibility（FR-A01 全局可行性预检）', () => {
  it('168 柜位 / 128 台 GPU → ok:true，且落位后 unplacedDevices 为空', () => {
    const matrix = makeMatrix(7, 24, 'gpu')
    const nodes = gpuNodes(128)
    const res = checkRackFeasibility(matrix, nodes)

    expect(res.ok).toBe(true)
    expect(res.shortage.cabinets).toBe(0)
    expect(res.required.gpu).toBe(128)
    expect(res.capacity.slots).toBe(168)
    expect(res.capacity.byType.gpu).toBe(168)

    const layout = layoutRacksFromMatrix(matrix, nodes)
    expect(layout.unplacedDevices).toHaveLength(0)
    expect(layout.cabinets).toHaveLength(128)
  })

  it('60 柜位 / 128 台 GPU → ok:false，shortage.cabinets>0，且提示含两种解法', () => {
    const matrix = makeMatrix(5, 12, 'gpu')
    const res = checkRackFeasibility(matrix, gpuNodes(128))

    expect(res.ok).toBe(false)
    expect(res.shortage.cabinets).toBe(68)
    expect(res.shortage.byType.gpu).toEqual({ required: 128, available: 60, missing: 68 })
    expect(res.suggestions.length).toBeGreaterThanOrEqual(2)
    expect(res.suggestions.some((s) => s.includes('排 × 24 列'))).toBe(true)
    expect(res.suggestions.some((s) => s.includes('台/柜'))).toBe(true)
  })

  it('不缓存：同一入参对象改柜位后重算，结果随之变化', () => {
    const matrix = makeMatrix(5, 12, 'gpu')
    const nodes = gpuNodes(128)
    expect(checkRackFeasibility(matrix, nodes).ok).toBe(false)

    matrix.rows = makeMatrix(7, 24, 'gpu').rows
    matrix.cols = makeMatrix(7, 24, 'gpu').cols
    matrix.cells = makeMatrix(7, 24, 'gpu').cells
    expect(checkRackFeasibility(matrix, nodes).ok).toBe(true)
  })

  it('占位格（pillar/ac）不写入柜位容量', () => {
    const matrix = makeMatrix(1, 4, 'gpu')
    matrix.cells[0].placeholder = 'pillar'
    matrix.cells[1].placeholder = 'ac'
    const res = checkRackFeasibility(matrix, gpuNodes(3))

    expect(res.capacity.byType.gpu).toBe(2)
    expect(res.capacity.total).toBe(2)
    expect(res.shortage.cabinets).toBe(1)
  })

  it('网络/存储/通算分别计缺口，不互借柜位', () => {
    const matrix = makeMatrix(1, 2, 'network')
    const nodes: RackTopologyNode[] = [
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `sw-${i}`, type: 'switch', group: '网络', podid: 'p', domain: 'network' as const,
        uHeight: 1, powerWatts: 300,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `st-${i}`, type: 'server', group: '存储服务器组', podid: 'p', domain: 'storage' as const,
        uHeight: 2, powerWatts: 300,
      })),
    ]
    // 每网络柜可用 40U：首台 1U，之后每台占 1U + 1U 理线间隔 ⇒ 20 台/柜；2 格 = 40 台
    const res = checkRackFeasibility(matrix, nodes)
    expect(res.required.network).toBe(2)
    expect(res.required.storage).toBe(1)
    expect(res.shortage.byType.network.missing).toBe(0)
    expect(res.shortage.byType.storage.missing).toBe(1)
    expect(res.shortage.cabinets).toBe(1)
    expect(res.ok).toBe(false)
  })

  it('柜高超过可用 U 的设备 → 预检失败并在提示中具名', () => {
    const res = checkRackFeasibility(makeMatrix(1, 2, 'gpu'), [
      { id: 'huge-1', type: 'server', group: 'GPU服务器组1', domain: 'gpu', uHeight: 48, powerWatts: 1000 },
    ])
    expect(res.ok).toBe(false)
    expect(res.unplaceable).toEqual(['huge-1'])
    expect(res.suggestions.some((s) => s.includes('huge-1'))).toBe(true)
  })
})
