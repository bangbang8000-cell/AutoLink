import { describe, it, expect } from 'vitest'
import { layoutRacksFromMatrix, type RackMatrixLayoutOptions } from '@/utils/rackMatrixLayout'
import type { RoomMatrixData } from '@/stores/room.store'
import type { RackTopologyNode } from '@/stores/rack.store'

/** 构造矩阵：传入格子定义（type/placeholder），行/列自动去重排序 */
const makeMatrix = (
  cells: Array<{ row: string; col: number; type: string; placeholder?: string | null; cabinetId?: number | null }>,
): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: [...new Set(cells.map((c) => c.row))].sort(),
  cols: [...new Set(cells.map((c) => c.col))].sort((a, b) => a - b),
  cells: cells.map((c) => ({
    row: c.row,
    col: c.col,
    type: c.type,
    placeholder: c.placeholder ?? null,
    cabinetId: c.cabinetId ?? null,
  })),
})

const makeNode = (overrides: Partial<RackTopologyNode> & { id: string }): RackTopologyNode => ({
  type: 'server',
  group: 'GPU服务器组1',
  podid: 'pod-1',
  uHeight: 8,
  powerWatts: 1000,
  ...overrides,
})

/** 3 个 gpu 格（A1/A2/A3） */
const gpuCells = (): RoomMatrixData =>
  makeMatrix([
    { row: 'A', col: 1, type: 'gpu' },
    { row: 'A', col: 2, type: 'gpu' },
    { row: 'A', col: 3, type: 'gpu' },
  ])

describe('layoutRacksFromMatrix', () => {
  it('GPU 1柜1台：3 gpu 格 + 3 台 GPU 服务器 → 3 柜，每柜 1 台，U1..U8，格子落位', () => {
    const res = layoutRacksFromMatrix(gpuCells(), [
      makeNode({ id: 'gpu-1' }),
      makeNode({ id: 'gpu-2' }),
      makeNode({ id: 'gpu-3' }),
    ])
    expect(res.cabinets).toHaveLength(3)
    expect(res.cabinets.every((c) => c.type === 'gpu' && c.devices.length === 1)).toBe(true)
    expect(res.cabinets.map((c) => c.id)).toEqual([1, 2, 3])
    expect(res.cabinets.map((c) => c.name)).toEqual(['机柜 A1', '机柜 A2', '机柜 A3'])
    for (const c of res.cabinets) {
      expect(c.devices[0].startU).toBe(1)
      expect(c.devices[0].endU).toBe(8)
    }
    // 格子 cabinetId 落位（A1/A2/A3）
    const mounted = res.cells.filter((c) => c.cabinetId != null)
    expect(mounted.map((c) => `${c.row}${c.col}`).sort()).toEqual(['A1', 'A2', 'A3'])
    expect(res.stats).toEqual({ gpu: 3, network: 0, storage: 0, compute: 0, mounted: 3, overflow: 0 })
  })

  it('GPU 服务器多于 gpu 格 → 溢出进待上架池', () => {
    const res = layoutRacksFromMatrix(gpuCells(), [
      makeNode({ id: 'gpu-1' }), makeNode({ id: 'gpu-2' }), makeNode({ id: 'gpu-3' }),
      makeNode({ id: 'gpu-4' }),
    ])
    expect(res.cabinets).toHaveLength(3)
    expect(res.unplacedDevices.map((d) => d.id)).toEqual(['gpu-4'])
    expect(res.stats.overflow).toBe(1)
  })

  it('GPU 单柜功率上限 ≥ 柜内设备功率和（超默认 6000 时抬高上限）', () => {
    const res = layoutRacksFromMatrix(
      makeMatrix([{ row: 'A', col: 1, type: 'gpu' }]),
      [makeNode({ id: 'gpu-hot', powerWatts: 7500 })],
    )
    expect(res.cabinets[0].power_limit).toBeGreaterThanOrEqual(7500)
  })

  it('网络设备按 U 打包：10 台 1U 交换机进 1 网络格 → 单柜 10 设备', () => {
    const matrix = makeMatrix([{ row: 'A', col: 1, type: 'network' }])
    const switches = Array.from({ length: 10 }, (_, i) =>
      makeNode({ id: `sw-${i}`, type: 'leaf', group: '参数Leaf组1', uHeight: 1, powerWatts: 300 }))
    const res = layoutRacksFromMatrix(matrix, switches)
    expect(res.cabinets).toHaveLength(1)
    expect(res.cabinets[0].type).toBe('network')
    expect(res.cabinets[0].devices).toHaveLength(10)
    expect(res.stats.network).toBe(1)
    expect(res.stats.overflow).toBe(0)
  })

  it('网络设备超单柜容量 → 跨格填充，格子耗尽进池', () => {
    const matrix = makeMatrix([
      { row: 'A', col: 1, type: 'network' },
      { row: 'A', col: 2, type: 'network' },
    ])
    const switches = Array.from({ length: 50 }, (_, i) =>
      makeNode({ id: `sw-${i}`, type: 'leaf', group: '参数Leaf组1', uHeight: 1, powerWatts: 100 }))
    const res = layoutRacksFromMatrix(matrix, switches, { topReservedU: 0 })
    // 42U 容量（无预留）：第 1 柜 42 台，第 2 柜 8 台
    expect(res.cabinets).toHaveLength(2)
    expect(res.cabinets[0].devices).toHaveLength(42)
    expect(res.cabinets[1].devices).toHaveLength(8)
    expect(res.stats.overflow).toBe(0)
  })

  it('存储/通算服务器按 U 打包进对应类型格', () => {
    const matrix = makeMatrix([
      { row: 'A', col: 1, type: 'storage' },
      { row: 'A', col: 2, type: 'compute' },
    ])
    const nodes = [
      makeNode({ id: 'storage-1', group: '存储服务器组', uHeight: 2, powerWatts: 300 }),
      makeNode({ id: 'storage-2', group: '存储服务器组', uHeight: 2, powerWatts: 300 }),
      makeNode({ id: 'compute-1', group: '通算服务器组', uHeight: 2, powerWatts: 400 }),
    ]
    const res = layoutRacksFromMatrix(matrix, nodes)
    expect(res.cabinets).toHaveLength(2)
    const storage = res.cabinets.find((c) => c.type === 'storage')!
    const compute = res.cabinets.find((c) => c.type === 'compute')!
    expect(storage.devices).toHaveLength(2)
    expect(compute.devices).toHaveLength(1)
    expect(res.stats.storage).toBe(1)
    expect(res.stats.compute).toBe(1)
  })

  it('ac/pillar/power/empty/combined 格不建柜；无可用格时设备进池', () => {
    const matrix = makeMatrix([
      { row: 'A', col: 1, type: 'empty' },
      { row: 'A', col: 2, type: 'power' },
      { row: 'A', col: 3, type: 'combined' },
      { row: 'B', col: 1, type: 'gpu', placeholder: 'ac' },
      { row: 'B', col: 2, type: 'gpu', placeholder: 'pillar' },
    ])
    const res = layoutRacksFromMatrix(matrix, [
      makeNode({ id: 'gpu-1' }),
      makeNode({ id: 'gpu-2' }),
    ])
    expect(res.cabinets).toHaveLength(0)
    expect(res.unplacedDevices.map((d) => d.id).sort()).toEqual(['gpu-1', 'gpu-2'])
    expect(res.stats.overflow).toBe(2)
  })

  it('scaleup_gpu 等不可标记柜类型设备直接进池', () => {
    const res = layoutRacksFromMatrix(gpuCells(), [
      makeNode({ id: 'scale-1', type: 'scaleup_gpu', group: '超节点域1' }),
    ])
    expect(res.cabinets).toHaveLength(0)
    expect(res.unplacedDevices.map((d) => d.id)).toEqual(['scale-1'])
  })

  it('设备 uHeight > rackType → 进池（不撑破柜）', () => {
    const res = layoutRacksFromMatrix(gpuCells(), [
      makeNode({ id: 'big', uHeight: 48 }),
    ])
    expect(res.cabinets).toHaveLength(0)
    expect(res.unplacedDevices.map((d) => d.id)).toEqual(['big'])
  })

  it('nodes 为空 → 清空全部 cabinetId、无柜', () => {
    const matrix = gpuCells()
    // 预置一个旧 cabinetId（模拟整表重建清空）
    matrix.cells[0].cabinetId = 99
    const res = layoutRacksFromMatrix(matrix, [])
    expect(res.cabinets).toHaveLength(0)
    expect(res.cells.every((c) => c.cabinetId == null)).toBe(true)
  })

  it('gpuPerCabinet 可配置（如 2）', () => {
    const opts: RackMatrixLayoutOptions = { gpuPerCabinet: 2 }
    const res = layoutRacksFromMatrix(
      makeMatrix([{ row: 'A', col: 1, type: 'gpu' }]),
      [makeNode({ id: 'gpu-1' }), makeNode({ id: 'gpu-2' })],
      opts,
    )
    expect(res.cabinets).toHaveLength(1)
    expect(res.cabinets[0].devices).toHaveLength(2)
  })

  it('M5 方向化：网络设备从顶部向下、服务器从底部向上、顶部预留 2U', () => {
    const matrix = makeMatrix([
      { row: 'A', col: 1, type: 'network' },
      { row: 'A', col: 2, type: 'compute' },
    ])
    const res = layoutRacksFromMatrix(matrix, [
      makeNode({ id: 'sw-1', type: 'leaf', group: '参数Leaf组1', uHeight: 2, powerWatts: 300 }),
      makeNode({ id: 'c-1', group: '通算服务器组', uHeight: 2, powerWatts: 400 }),
    ])
    const net = res.cabinets.find((c) => c.type === 'network')!
    const comp = res.cabinets.find((c) => c.type === 'compute')!
    // 网络设备：42U 柜预留 2U → 可用 40U，从 40 向下
    expect(net.devices[0].startU).toBe(39)
    expect(net.devices[0].endU).toBe(40)
    // 服务器：从底部 U1 向上
    expect(comp.devices[0].startU).toBe(1)
    expect(comp.devices[0].endU).toBe(2)
    // 均不越过顶部预留
    for (const cab of res.cabinets) {
      for (const d of cab.devices) expect(d.endU).toBeLessThanOrEqual(40)
    }
  })

  it('M5 topReservedU=0 时网络设备占满顶部（最高位 42）', () => {
    const res = layoutRacksFromMatrix(
      makeMatrix([{ row: 'A', col: 1, type: 'network' }]),
      [makeNode({ id: 'sw-1', type: 'leaf', group: '参数Leaf组1', uHeight: 1, powerWatts: 300 })],
      { topReservedU: 0 },
    )
    expect(res.cabinets[0].devices[0].endU).toBe(42)
  })
})
