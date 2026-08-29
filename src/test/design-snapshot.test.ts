/**
 * M2（AL-SNAP1）：设计快照 序列化/校验/应用（TDD）
 * - P-1 保存/恢复一致：serialize → JSON 字符串 → parse → validate → apply → 矩阵↔柜内/功率一致
 * - P-4 不兼容提示：版本/结构缺失 → validate 返回 { ok:false, reason }
 * - 应用策略：整状态替换 + syncCabinetToCell 联动重算（矩阵↔柜内类型一致）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import {
  serializeDesignState,
  validateSnapshot,
  applyDesignState,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  type DesignSnapshot,
} from '@/utils/designSnapshot'

/** 2 行×2 列矩阵：A1↔柜1(gpu)、B2↔柜2(network)、B1 空调占位 */
const makeMatrix = (finalized = false): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: ['A', 'B'],
  cols: [1, 2],
  cells: [
    { row: 'A', col: 1, type: 'gpu', placeholder: null, cabinetId: 1 },
    { row: 'A', col: 2, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 1, type: 'empty', placeholder: 'ac', cabinetId: null },
    { row: 'B', col: 2, type: 'network', placeholder: null, cabinetId: 2 },
  ],
  finalized,
})

const makeCabinets = (): RackCabinet[] => [
  {
    id: 1, name: '机柜 A1', totalU: 42, type: 'gpu', power_limit: 6000,
    devices: [{ id: 'd1', name: 'GPU1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 1000 }],
  },
  { id: 2, name: '机柜 B2', totalU: 42, type: 'network', power_limit: 6000, devices: [] },
]

const buildSnap = (name = '测试快照'): DesignSnapshot =>
  serializeDesignState(
    { matrix: makeMatrix() },
    { cabinets: makeCabinets(), unplacedDevices: [], topReservedU: 2, gpuPerCabinet: 1 },
    { name, savedAt: new Date('2026-08-29T00:00:00Z') },
  )

const apply = (snap: DesignSnapshot) =>
  applyDesignState(useRoomStore.getState(), useRackStore.getState(), snap)

const resetStores = () => {
  useRoomStore.setState({
    matrix: null, selectedPosition: null, multiSelected: [],
    undoStack: [], redoStack: [], canUndo: false, canRedo: false,
  })
  useRackStore.setState({
    cabinets: [], unplacedDevices: [], selectedCabinetId: null,
    undoStack: [], redoStack: [], canUndo: false, canRedo: false,
    topReservedU: 2, gpuPerCabinet: 1,
  })
  vi.clearAllMocks()
}

beforeEach(() => {
  resetStores()
  ;(window as unknown as { electron: { project: { saveFile: ReturnType<typeof vi.fn> } } }).electron.project.saveFile =
    vi.fn().mockResolvedValue(true)
})

describe('serializeDesignState', () => {
  it('生成 {version, meta, matrix, cabinets, config} 结构', () => {
    const s = buildSnap()
    expect(s.version).toBe(SNAPSHOT_VERSION)
    expect(s.meta.format).toBe(SNAPSHOT_FORMAT)
    expect(s.meta.version).toBe(SNAPSHOT_VERSION)
    expect(s.meta.name).toBe('测试快照')
    expect(s.meta.savedAt).toBe('2026-08-29T00:00:00.000Z')
    expect(s.matrix).toEqual(makeMatrix())
    expect(s.cabinets).toEqual(makeCabinets())
    expect(s.config).toEqual({ topReservedU: 2, gpuPerCabinet: 1 })
    expect(s.unplacedDevices).toEqual([])
  })

  it('从 store 状态序列化（传入 state 句柄）', () => {
    useRoomStore.setState({ matrix: makeMatrix() })
    useRackStore.setState({ cabinets: makeCabinets(), topReservedU: 2, gpuPerCabinet: 1 })
    const s = serializeDesignState(useRoomStore.getState(), useRackStore.getState())
    expect(s.matrix?.cells.some((c) => c.cabinetId === 1)).toBe(true)
    expect(s.cabinets).toHaveLength(2)
  })
})

describe('validateSnapshot', () => {
  it('合法快照 → ok:true', () => {
    expect(validateSnapshot(buildSnap())).toEqual({ ok: true })
  })

  it('null / 非对象 → ok:false', () => {
    expect(validateSnapshot(null).ok).toBe(false)
    expect(validateSnapshot('x').ok).toBe(false)
    expect(validateSnapshot({}).ok).toBe(false)
  })

  it('版本不兼容 → ok:false 且 reason 含「版本」', () => {
    const s = buildSnap() as { version: number }
    s.version = SNAPSHOT_VERSION + 1
    const r = validateSnapshot(s)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('版本')
  })

  it('结构缺失（matrix 无 cells / cabinets 非数组）→ ok:false', () => {
    const s1 = buildSnap() as { matrix: Partial<RoomMatrixData> }
    delete (s1.matrix as Partial<RoomMatrixData>).cells
    expect(validateSnapshot(s1).ok).toBe(false)

    const s2 = buildSnap() as { cabinets: unknown }
    s2.cabinets = {}
    expect(validateSnapshot(s2).ok).toBe(false)
  })
})

describe('applyDesignState（P-1 保存/恢复一致）', () => {
  it('JSON 往返：serialize → stringify → parse → validate → apply → 状态一致', () => {
    const snap = buildSnap()
    const json = JSON.stringify(snap)
    const parsed = JSON.parse(json) as DesignSnapshot
    expect(validateSnapshot(parsed).ok).toBe(true)
    const r = apply(parsed)
    expect(r.ok).toBe(true)
    const room = useRoomStore.getState()
    const rack = useRackStore.getState()
    expect(room.matrix).toEqual(makeMatrix())
    expect(rack.cabinets).toEqual(makeCabinets())
    expect(rack.topReservedU).toBe(2)
    expect(rack.gpuPerCabinet).toBe(1)
  })

  it('恢复后矩阵↔柜内/功率一致', () => {
    // 先污染 store（模拟恢复到不同状态）
    useRoomStore.setState({ matrix: null })
    useRackStore.setState({ cabinets: [], topReservedU: 3, gpuPerCabinet: 2 })
    const r = apply(buildSnap())
    expect(r.ok).toBe(true)
    const room = useRoomStore.getState()
    const rack = useRackStore.getState()
    // 矩阵挂载 id ↔ 柜内存在
    const mountedIds = room.matrix!.cells.filter((c) => c.cabinetId != null).map((c) => c.cabinetId)
    expect(mountedIds.sort()).toEqual([1, 2])
    for (const id of mountedIds) {
      expect(rack.cabinets.some((c) => c.id === id)).toBe(true)
    }
    // 功率汇总重算（柜1 1000W）
    expect(rack.getPowerUsageAll().total).toBe(1000)
  })

  it('联动重算：柜类型与格子类型不一致时 syncCabinetToCell 收敛', () => {
    // 构造不一致快照：柜1 实际 storage，但格子 A1 标记 gpu
    const snap = buildSnap()
    snap.cabinets = snap.cabinets.map((c) => (c.id === 1 ? { ...c, type: 'storage' as const } : c))
    apply(snap)
    const cell = useRoomStore.getState().matrix!.cells.find((c) => c.cabinetId === 1)!
    expect(cell.type).toBe('storage')
    expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.type).toBe('storage')
  })

  it('空矩阵快照 → room matrix 置 null，柜清空', () => {
    const snap = buildSnap()
    snap.matrix = null
    snap.cabinets = []
    const r = apply(snap)
    expect(r.ok).toBe(true)
    expect(useRoomStore.getState().matrix).toBeNull()
    expect(useRackStore.getState().cabinets).toEqual([])
  })

  it('不兼容快照 → { ok:false, reason }，store 不被改写', () => {
    const snap = buildSnap()
    ;(snap as { version: number }).version = SNAPSHOT_VERSION + 10
    const r = apply(snap)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBeTruthy()
    // store 保持原状（污染状态未被覆盖）
    expect(useRoomStore.getState().matrix).toBeNull()
    expect(useRackStore.getState().cabinets).toEqual([])
  })
})
