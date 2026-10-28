import { describe, it, expect } from 'vitest'
import { layoutRacksFromMatrix, type RackMatrixLayoutOptions } from '@/utils/rackMatrixLayout'
import type { RoomMatrixData } from '@/stores/room.store'
import type { RackTopologyNode } from '@/stores/rack.store'

/** 构造矩阵：传入格子定义（type/placeholder），行/列自动去重排序 */
const makeMatrix = (
  cells: Array<{
    row: string
    col: number
    type: string
    placeholder?: string | null
    cabinetId?: number | null
    typeAuto?: boolean
  }>,
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
    ...(c.typeAuto != null ? { typeAuto: c.typeAuto } : {}),
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
  it('GPU 1柜1台：3 gpu 格 + 3 台 GPU 服务器 → 3 柜，每柜 1 台，底留 4U → U5..U12，格子落位', () => {
    const res = layoutRacksFromMatrix(gpuCells(), [
      makeNode({ id: 'gpu-1' }),
      makeNode({ id: 'gpu-2' }),
      makeNode({ id: 'gpu-3' }),
    ])
    expect(res.cabinets).toHaveLength(3)
    expect(res.cabinets.every((c) => c.type === 'gpu' && c.devices.length === 1)).toBe(true)
    expect(res.cabinets.map((c) => c.id)).toEqual([1, 2, 3])
    expect(res.cabinets.map((c) => c.name)).toEqual(['机柜 A1', '机柜 A2', '机柜 A3'])
    // B4-04 / FR-A23：GPU 柜底留 4U → 首台 startU=5（8U 高 → endU=12）
    for (const c of res.cabinets) {
      expect(c.devices[0].startU).toBe(5)
      expect(c.devices[0].endU).toBe(12)
    }
    // 格子 cabinetId 落位（A1/A2/A3）
    const mounted = res.cells.filter((c) => c.cabinetId != null)
    expect(mounted.map((c) => `${c.row}${c.col}`).sort()).toEqual(['A1', 'A2', 'A3'])
    expect(res.stats).toEqual({ gpu: 3, network: 0, storage: 0, compute: 0, mounted: 3, overflow: 0 })
  })

  it('B1-04：GPU 服务器多于 gpu 格 → 预检拒绝，不产生任何落位', () => {
    const res = layoutRacksFromMatrix(gpuCells(), [
      makeNode({ id: 'gpu-1' }), makeNode({ id: 'gpu-2' }), makeNode({ id: 'gpu-3' }),
      makeNode({ id: 'gpu-4' }),
    ])
    expect(res.ok).toBe(false)
    expect(res.cabinets).toHaveLength(0)
    expect(res.unplacedDevices).toHaveLength(0)
    expect(res.stats.overflow).toBe(0)
    expect(res.feasibility.shortage.byType.gpu).toEqual({ required: 4, available: 3, missing: 1 })
    expect(res.feasibility.suggestions.length).toBeGreaterThanOrEqual(2)
  })

  it('GPU 单柜功率上限 ≥ 柜内设备功率和（设备功率和超上限时抬高）', () => {
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

  it('网络设备超单柜容量 → 柜数不足即拒绝；间隔调小后柜数够用则正常落位', () => {
    const matrix = makeMatrix([
      { row: 'A', col: 1, type: 'network' },
      { row: 'A', col: 2, type: 'network' },
    ])
    const switches = Array.from({ length: 50 }, (_, i) =>
      makeNode({ id: `sw-${i}`, type: 'leaf', group: '参数Leaf组1', uHeight: 1, powerWatts: 100 }))
    // F6（5.4.4）：默认交换机间隔 1U —— 42U 柜（无预留）可装 21 台 → 50 台需 3 柜，现有 2 柜 → 拒绝
    const res = layoutRacksFromMatrix(matrix, switches, { topReservedU: 0 })
    expect(res.ok).toBe(false)
    expect(res.cabinets).toHaveLength(0)
    expect(res.unplacedDevices).toHaveLength(0)
    expect(res.feasibility.shortage.byType.network.missing).toBe(1)

    // interSwitchGapU=0（紧密堆叠）42 台/柜 → 2 柜够用，恢复旧行为
    // B1-06：同一柜型跨格 round-robin 均摊 → 50 台均分 25/25（极差 0）
    const res2 = layoutRacksFromMatrix(matrix, switches, { topReservedU: 0, interSwitchGapU: 0 })
    expect(res2.ok).toBe(true)
    expect(res2.cabinets[0].devices).toHaveLength(25)
    expect(res2.cabinets[1].devices).toHaveLength(25)
    expect(res2.stats.overflow).toBe(0)
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

  it('ac/pillar/power/combined/empty 格：空白格按需改判后仍不足 → 预检拒绝（B1-07）', () => {
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
    // B1-07：唯一的空白格 A1 自动改判为 gpu（需求 2 → 仅够 1）
    expect(res.ok).toBe(false)
    expect(res.cabinets).toHaveLength(0)
    expect(res.unplacedDevices).toHaveLength(0)
    expect(res.feasibility.capacity.total).toBe(1)
    expect(res.feasibility.shortage.byType.gpu).toEqual({ required: 2, available: 1, missing: 1 })
    // 拒绝时原矩阵逐字段不变（不写回改判结果）
    expect(res.cells).toBe(matrix.cells)
    expect(matrix.cells.map((c) => c.type)).toEqual(['empty', 'power', 'combined', 'gpu', 'gpu'])
  })

  it('B1-07：全空白矩阵 + 多类型设备 → 按 GPU→网络→存储→通算 改判，unplaced=0 且标 typeAuto', () => {
    const matrix = makeMatrix([
      { row: 'A', col: 1, type: 'empty' },
      { row: 'A', col: 2, type: 'empty' },
      { row: 'A', col: 3, type: 'empty' },
      { row: 'A', col: 4, type: 'empty' },
    ])
    const nodes = [
      makeNode({ id: 'gpu-1' }),
      makeNode({ id: 'sw-1', type: 'leaf', group: '参数Leaf组1', uHeight: 1, powerWatts: 300 }),
      makeNode({ id: 'storage-1', group: '存储服务器组', uHeight: 2, powerWatts: 300 }),
      makeNode({ id: 'compute-1', group: '通算服务器组', uHeight: 2, powerWatts: 400 }),
    ]
    const res = layoutRacksFromMatrix(matrix, nodes)
    expect(res.ok).toBe(true)
    expect(res.unplacedDevices).toHaveLength(0)
    expect(res.stats).toEqual({ gpu: 1, network: 1, storage: 1, compute: 1, mounted: 4, overflow: 0 })
    const byPos = new Map(res.cells.map((c) => [`${c.row}${c.col}`, c]))
    expect(['A1', 'A2', 'A3', 'A4'].map((p) => byPos.get(p)!.type)).toEqual(['gpu', 'network', 'storage', 'compute'])
    expect(['A1', 'A2', 'A3', 'A4'].every((p) => byPos.get(p)!.typeAuto === true)).toBe(true)
  })

  it('B1-07：人工改型格恒定跳过；自动改判格按需求回落（改判幂等）', () => {
    // A1 人工标 storage（typeAuto=false），A2/A3 空白
    const matrix = makeMatrix([
      { row: 'A', col: 1, type: 'storage' },
      { row: 'A', col: 2, type: 'empty' },
      { row: 'A', col: 3, type: 'empty' },
    ])
    const nodes = [
      makeNode({ id: 'gpu-1' }),
      makeNode({ id: 'gpu-2' }),
      makeNode({ id: 'storage-1', group: '存储服务器组', uHeight: 2, powerWatts: 300 }),
    ]
    const res1 = layoutRacksFromMatrix(matrix, nodes)
    expect(res1.ok).toBe(true)
    const types1 = res1.cells.map((c) => c.type)
    // 人工 storage 格保留；空白格按 GPU→网络→存储→通算 改判为 2 个 gpu
    expect(types1).toEqual(['storage', 'gpu', 'gpu'])
    expect(res1.cells[0].typeAuto).toBeUndefined()
    expect(res1.cells[1].typeAuto).toBe(true)

    // 以第一次结果为输入再跑一次 → 结果逐字段一致（幂等，不重复翻转）
    const matrix2: RoomMatrixData = { ...matrix, cells: res1.cells }
    const res2 = layoutRacksFromMatrix(matrix2, nodes)
    expect(res2.ok).toBe(true)
    expect(res2.cells.map((c) => [c.type, c.typeAuto])).toEqual(res1.cells.map((c) => [c.type, c.typeAuto]))
    expect(res2.cells.map((c) => c.cabinetId)).toEqual(res1.cells.map((c) => c.cabinetId))
  })

  it('B1-07：占位格（ac/pillar）与 power 格数量位置不变', () => {
    const matrix = makeMatrix([
      { row: 'A', col: 1, type: 'gpu' },
      { row: 'A', col: 2, type: 'empty', placeholder: 'ac' },
      { row: 'A', col: 3, type: 'power' },
      { row: 'A', col: 4, type: 'empty' },
    ])
    const before = matrix.cells.map((c) => ({ ...c }))
    const res = layoutRacksFromMatrix(matrix, [makeNode({ id: 'gpu-1' })])
    expect(res.ok).toBe(true)
    const byPos = new Map(res.cells.map((c) => [`${c.row}${c.col}`, c]))
    expect(byPos.get('A2')!.placeholder).toBe('ac')
    expect(byPos.get('A2')!.type).toBe('empty')
    expect(byPos.get('A3')!.type).toBe('power')
    expect(byPos.get('A2')!.typeAuto).toBeUndefined()
    expect(byPos.get('A3')!.typeAuto).toBeUndefined()
    // 空白 A4 不需要改判（GPU 需求已由 A1 满足）→ 保持 empty
    expect(byPos.get('A4')!.type).toBe('empty')
    expect(before.map((c) => c.type)).toEqual(['gpu', 'empty', 'power', 'empty'])
  })

  it('scaleup_gpu 等不可标记柜类型设备直接进池', () => {
    const res = layoutRacksFromMatrix(gpuCells(), [
      makeNode({ id: 'scale-1', type: 'scaleup_gpu', group: '超节点域1' }),
    ])
    expect(res.cabinets).toHaveLength(0)
    expect(res.unplacedDevices.map((d) => d.id)).toEqual(['scale-1'])
  })

  it('设备 uHeight > rackType → 预检判定不可落位并拒绝', () => {
    const res = layoutRacksFromMatrix(gpuCells(), [
      makeNode({ id: 'big', uHeight: 48 }),
    ])
    expect(res.ok).toBe(false)
    expect(res.cabinets).toHaveLength(0)
    expect(res.unplacedDevices).toHaveLength(0)
    expect(res.feasibility.unplaceable).toEqual(['big'])
  })

  it('B1-04：预检拒绝时返回原矩阵引用与 EmptyStats（原布局逐字段不变）', () => {
    const matrix = gpuCells()
    matrix.cells[0].cabinetId = 7
    const before = matrix.cells.map((c) => ({ ...c }))
    const res = layoutRacksFromMatrix(matrix, [
      makeNode({ id: 'gpu-1' }), makeNode({ id: 'gpu-2' }), makeNode({ id: 'gpu-3' }), makeNode({ id: 'gpu-4' }),
    ])
    expect(res.ok).toBe(false)
    expect(res.cells).toBe(matrix.cells)
    expect(res.cells).toEqual(before)
    expect(res.stats).toEqual({ gpu: 0, network: 0, storage: 0, compute: 0, mounted: 0, overflow: 0 })
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
    // 通算服务器：B4-04 / FR-A23 底留 4U → 从 U5 向上
    expect(comp.devices[0].startU).toBe(5)
    expect(comp.devices[0].endU).toBe(6)
    // 均不越过顶部预留
    for (const cab of res.cabinets) {
      for (const d of cab.devices) expect(d.endU).toBeLessThanOrEqual(40)
    }
  })

  it('B4-04：柜型表优先——network 柜 topReservedU=0 仍保留顶部 2U（最高位 40）', () => {
    const res = layoutRacksFromMatrix(
      makeMatrix([{ row: 'A', col: 1, type: 'network' }]),
      [makeNode({ id: 'sw-1', type: 'leaf', group: '参数Leaf组1', uHeight: 1, powerWatts: 300 })],
      { topReservedU: 0 },
    )
    expect(res.cabinets[0].devices[0].startU).toBe(40)
    expect(res.cabinets[0].devices[0].endU).toBe(40)
  })

  it('B4-04：柜型表优先——compute 柜 topReservedU=2 仍按底留 4U/顶留 0 落位', () => {
    const res = layoutRacksFromMatrix(
      makeMatrix([{ row: 'A', col: 1, type: 'compute' }]),
      [makeNode({ id: 'c-1', group: '通算服务器组', uHeight: 1, powerWatts: 400 })],
      { topReservedU: 2 },
    )
    expect(res.cabinets[0].devices[0].startU).toBe(5)
    expect(res.cabinets[0].devices[0].endU).toBe(5)
  })
})
