import { describe, expect, it } from 'vitest'
import { MATRIX_WORKER_THRESHOLD, runMatrixRackLayout } from './matrixRackLayoutRunner'
import { layoutRacksFromMatrix } from './rackMatrixLayout'
import type { RoomMatrixData } from '@/stores/room.store'
import type { RackTopologyNode } from '@/stores/rack.store'

const makeMatrix = (): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房',
  rows: ['A', 'B'],
  cols: [1, 2, 3],
  cells: [
    { row: 'A', col: 1, type: 'gpu', placeholder: null, cabinetId: null },
    { row: 'A', col: 2, type: 'gpu', placeholder: null, cabinetId: null },
    { row: 'A', col: 3, type: 'network', placeholder: null, cabinetId: null },
    { row: 'B', col: 1, type: 'gpu', placeholder: null, cabinetId: null },
    { row: 'B', col: 2, type: 'storage', placeholder: null, cabinetId: null },
    { row: 'B', col: 3, type: 'gpu', placeholder: null, cabinetId: null },
  ],
})

const makeNodes = (n: number): RackTopologyNode[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `GPU_${i + 1}`,
    name: `GPU_${i + 1}`,
    type: 'server',
    group: 'GPU 服务器',
    podid: 'pod-1',
  }))

describe('matrixRackLayoutRunner', () => {
  it('阈值常量存在（对齐 topologyLayout 500）', () => {
    expect(MATRIX_WORKER_THRESHOLD).toBe(500)
  })

  it('小规模同步执行，结果与 layoutRacksFromMatrix 一致', async () => {
    const matrix = makeMatrix()
    const nodes = makeNodes(4) // ≤500 → 同步路径
    const { result, cancel } = await runMatrixRackLayout(matrix, nodes, { powerLimit: 12000 })
    expect(cancel).toBeTypeOf('function')
    const direct = layoutRacksFromMatrix(matrix, nodes, { powerLimit: 12000 })
    expect(result.cabinets.length).toBe(direct.cabinets.length)
    expect(result.unplacedDevices.length).toBe(direct.unplacedDevices.length)
    expect(result.stats).toEqual(direct.stats)
  })

  it('小规模空拓扑返回空结果', async () => {
    const matrix = makeMatrix()
    const { result } = await runMatrixRackLayout(matrix, [], {})
    expect(result.cabinets.length).toBe(0)
    expect(result.cells.length).toBe(matrix.cells.length)
  })
})
