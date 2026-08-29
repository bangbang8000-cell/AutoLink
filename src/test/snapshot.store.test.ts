/**
 * M2（AL-SNAP1-3）：设计快照 store 测试（TDD）
 * - P-2 管理/持久化：save/restore/delete/list + localStorage 持久化
 * - 容量限制：单快照序列化超过阈值 → 跳过并提示
 * - P-3 导出/导入往返：JSON 文本 → validate → 导入恢复
 * - P-5 导入前备份：导入前把当前设计备份到快照列表
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useSnapshotStore } from '@/stores/snapshot.store'
import { serializeDesignState, SNAPSHOT_VERSION } from '@/utils/designSnapshot'

const PERSIST_KEY = 'autolink-design-snapshots'

const makeMatrix = (finalized = true): RoomMatrixData => ({
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

const applyToStores = (_name?: string) => {
  useRoomStore.setState({ matrix: makeMatrix() })
  useRackStore.setState({
    cabinets: makeCabinets(), unplacedDevices: [], selectedCabinetId: 1,
    topReservedU: 2, gpuPerCabinet: 1,
  })
}

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
  useSnapshotStore.setState({ snapshots: [] })
  localStorage.removeItem(PERSIST_KEY)
  vi.clearAllMocks()
}

beforeEach(() => {
  resetStores()
  ;(window as unknown as { electron: { project: { saveFile: ReturnType<typeof vi.fn> } } }).electron.project.saveFile =
    vi.fn().mockResolvedValue(true)
})

describe('saveSnapshot / list（P-2 管理）', () => {
  it('保存快照（默认名含时间戳）→ 出现在列表', () => {
    applyToStores('A')
    const r = useSnapshotStore.getState().saveSnapshot()
    expect(r.ok).toBe(true)
    const list = useSnapshotStore.getState().list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toContain('快照')
    expect(list[0].createdAt).toBeTruthy()
    expect(list[0].state.matrix?.name).toBe('机房 A')
  })

  it('命名保存 → 使用传入名称', () => {
    applyToStores('A')
    useSnapshotStore.getState().saveSnapshot('定稿检查点')
    const list = useSnapshotStore.getState().list()
    expect(list[0].name).toBe('定稿检查点')
  })

  it('无设计数据（无矩阵且无机柜）→ ok:false 且不新增', () => {
    const r = useSnapshotStore.getState().saveSnapshot()
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('no_data')
    expect(useSnapshotStore.getState().list()).toHaveLength(0)
  })

  it('超过容量阈值 → 跳过并提示', () => {
    applyToStores('A')
    // 用小阈值触发容量拒绝（默认 2MB 不方便构造）
    const r = useSnapshotStore.getState().saveSnapshot(undefined, 1)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('too_large')
    expect(useSnapshotStore.getState().list()).toHaveLength(0)
  })
})

describe('restoreSnapshot（P-1 保存/恢复一致）', () => {
  it('恢复后矩阵↔柜内/配置一致', () => {
    applyToStores('A')
    const { id } = useSnapshotStore.getState().saveSnapshot('点1')
    // 污染 store 后恢复
    useRoomStore.setState({ matrix: null })
    useRackStore.setState({ cabinets: [], topReservedU: 3, gpuPerCabinet: 2 })
    const r = useSnapshotStore.getState().restoreSnapshot(id!)
    expect(r.ok).toBe(true)
    expect(useRoomStore.getState().matrix?.cells.some((c) => c.cabinetId === 1)).toBe(true)
    expect(useRackStore.getState().cabinets).toHaveLength(2)
    expect(useRackStore.getState().topReservedU).toBe(2)
    expect(useRackStore.getState().gpuPerCabinet).toBe(1)
  })

  it('未知 id → ok:false', () => {
    const r = useSnapshotStore.getState().restoreSnapshot('nope')
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('not_found')
  })

  it('快照数据损坏（版本不兼容）→ ok:false 不应用', () => {
    applyToStores('A')
    const { id } = useSnapshotStore.getState().saveSnapshot('点1')
    // 篡改列表中快照的版本
    useSnapshotStore.setState((s) => ({
      snapshots: s.snapshots.map((it) =>
        it.id === id ? { ...it, state: { ...it.state, version: SNAPSHOT_VERSION + 1 } } : it,
      ),
    }))
    useRoomStore.setState({ matrix: null })
    const r = useSnapshotStore.getState().restoreSnapshot(id!)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBeTruthy()
    expect(useRoomStore.getState().matrix).toBeNull()
  })
})

describe('deleteSnapshot（P-2 管理）', () => {
  it('删除指定快照', () => {
    applyToStores('A')
    const a = useSnapshotStore.getState().saveSnapshot('a')
    useSnapshotStore.getState().saveSnapshot('b')
    expect(useSnapshotStore.getState().list()).toHaveLength(2)
    useSnapshotStore.getState().deleteSnapshot(a.id!)
    const list = useSnapshotStore.getState().list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('b')
  })
})

describe('持久化（P-2 会话内持久化 → localStorage）', () => {
  it('保存后写入 localStorage（autolink-design-snapshots）', () => {
    applyToStores('A')
    useSnapshotStore.getState().saveSnapshot('持久化点')
    const raw = localStorage.getItem(PERSIST_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    const saved = Array.isArray(parsed) ? parsed : parsed?.state?.snapshots ?? []
    expect(saved.some((it: { name: string }) => it.name === '持久化点')).toBe(true)
  })
})

describe('导入快照 JSON（P-3 往返 + P-5 导入前备份）', () => {
  it('导入合法 JSON → 校验通过、应用恢复、列表出现「导入前备份」', () => {
    // 当前设计 A
    applyToStores('A')
    // 构造一个"外部快照"（设计 B：柜1 功率改为 2000）
    const external = serializeDesignState(
      { matrix: makeMatrix() },
      {
        cabinets: makeCabinets().map((c) =>
          c.id === 1
            ? { ...c, devices: [{ ...c.devices[0], power_watts: 2000 }] }
            : c,
        ),
        unplacedDevices: [],
        topReservedU: 3,
        gpuPerCabinet: 2,
      },
      { name: '外部快照' },
    )
    const r = useSnapshotStore.getState().importFromJson(JSON.stringify(external))
    expect(r.ok).toBe(true)
    // 应用了外部快照
    expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.devices[0].power_watts).toBe(2000)
    expect(useRackStore.getState().topReservedU).toBe(3)
    // 导入前备份了当前设计 A
    const list = useSnapshotStore.getState().list()
    const backup = list.find((it) => it.name.includes('导入前备份'))
    expect(backup).toBeTruthy()
    expect(backup!.state.cabinets.find((c) => c.id === 1)!.devices[0].power_watts).toBe(1000)
  })

  it('非法 JSON 文本 → ok:false 且不备份不应用', () => {
    applyToStores('A')
    const r = useSnapshotStore.getState().importFromJson('{bad json')
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('invalid_json')
    expect(useSnapshotStore.getState().list()).toHaveLength(0)
    expect(useRoomStore.getState().matrix?.name).toBe('机房 A')
  })

  it('不兼容快照（版本不符）→ ok:false 且不备份', () => {
    applyToStores('A')
    const external = serializeDesignState(
      { matrix: makeMatrix() },
      { cabinets: makeCabinets(), unplacedDevices: [], topReservedU: 2, gpuPerCabinet: 1 },
    ) as { version: number }
    external.version = SNAPSHOT_VERSION + 5
    const r = useSnapshotStore.getState().importFromJson(JSON.stringify(external))
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('版本')
    expect(useSnapshotStore.getState().list()).toHaveLength(0)
  })

  it('结构不合法（缺 cabinets）→ ok:false', () => {
    applyToStores('A')
    const r = useSnapshotStore.getState().importFromJson(
      JSON.stringify({ version: SNAPSHOT_VERSION, meta: { format: 'autolink-design-snapshot', version: SNAPSHOT_VERSION, savedAt: 'x' }, matrix: null, cabinets: 'bad' }),
    )
    expect(r.ok).toBe(false)
    expect(useSnapshotStore.getState().list()).toHaveLength(0)
  })
})
