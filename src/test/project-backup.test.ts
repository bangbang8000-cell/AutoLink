/**
 * F2-3（42-c / S-4）：项目备份加固 单测（TDD）
 * - B-1 备份轮转：addBackup 追加超过 maxCount → 淘汰最旧，返回被淘汰数，列表长度受控
 * - B-2 恢复校验：verifyBackup 结构/校验和一致通过；篡改/版本不符/元数据缺失 → 拒绝
 * - B-3 一键恢复一致：restoreBackup → 矩阵↔柜内/功率一致；恢复前自动生成安全备份；可撤销
 * - B-4 数据一致：computeBackupConsistency 检出校验和不一致的损坏备份
 * - B-5 与既有快照协同：restoreBackup 不影响快照体系（复用 designSnapshot 原语，无冲突）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import {
  createBackup,
  addBackup,
  verifyBackup,
  restoreBackup,
  backupStats,
  computeBackupConsistency,
  checksum,
  defaultBackupName,
  BACKUP_MAX_COUNT,
  type BackupEntry,
} from '@/utils/projectBackup'

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

const stubEntry = (over: Partial<BackupEntry> = {}): BackupEntry => {
  const e = createBackup(
    { matrix: makeMatrix() },
    { cabinets: makeCabinets(), unplacedDevices: [], topReservedU: 2, gpuPerCabinet: 1 },
    { kind: 'auto', name: '自动备份', savedAt: new Date('2026-08-29T00:00:00Z') },
  )
  if (!e.ok) throw new Error(e.reason)
  return { ...e.entry, ...over }
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
  vi.clearAllMocks()
}

beforeEach(() => {
  resetStores()
  ;(window as unknown as { electron: { project: { saveFile: ReturnType<typeof vi.fn> } } }).electron.project.saveFile =
    vi.fn().mockResolvedValue(true)
})

describe('createBackup / checksum', () => {
  it('生成含校验和的合法备份条目', () => {
    const e = stubEntry()
    expect(e.kind).toBe('auto')
    expect(e.createdAt).toBe('2026-08-29T00:00:00.000Z')
    expect(e.checksum).toMatch(/^[0-9a-f]{8}$/)
    expect(checksum(JSON.stringify(e.state))).toBe(e.checksum)
    expect(e.state.cabinets).toHaveLength(2)
  })

  it('空设计（无矩阵无机柜）→ 不生成备份', () => {
    const r = createBackup(
      { matrix: null },
      { cabinets: [], unplacedDevices: [], topReservedU: 2, gpuPerCabinet: 1 },
    )
    expect(r.ok).toBe(false)
  })

  it('defaultBackupName 含时间戳', () => {
    const d = new Date('2026-08-29T01:02:03Z')
    const name = defaultBackupName(d)
    expect(name).toContain('备份')
    expect(name).toContain('20260829')
  })
})

describe('addBackup（B-1 自动备份轮转）', () => {
  it('未超限：追加，evicted=0，total 递增', () => {
    const a = stubEntry()
    const r1 = addBackup([], a, 3)
    expect(r1.total).toBe(1)
    expect(r1.evicted).toBe(0)
    const r2 = addBackup(r1.list, stubEntry(), 3)
    expect(r2.total).toBe(2)
    expect(r2.evicted).toBe(0)
  })

  it('超过 maxCount：淘汰最旧，列表长度=maxCount，evicted=溢出数', () => {
    let list: BackupEntry[] = []
    for (let i = 0; i < 3; i++) list = addBackup(list, stubEntry({ id: `b${i}` }), 3).list
    const r = addBackup(list, stubEntry({ id: 'b3' }), 3)
    expect(r.evicted).toBe(1)
    expect(r.total).toBe(3)
    expect(r.list.map((e) => e.id)).toEqual(['b1', 'b2', 'b3'])
  })

  it('默认 BACKUP_MAX_COUNT=20', () => {
    expect(BACKUP_MAX_COUNT).toBe(20)
    let list: BackupEntry[] = []
    for (let i = 0; i < 25; i++) list = addBackup(list, stubEntry({ id: `b${i}` })).list
    expect(list.length).toBe(BACKUP_MAX_COUNT)
    expect(list[0].id).toBe('b5')
  })
})

describe('verifyBackup（B-2 恢复校验）', () => {
  it('合法备份 → ok:true', () => {
    expect(verifyBackup(stubEntry()).ok).toBe(true)
  })

  it('非对象/null → ok:false', () => {
    expect(verifyBackup(null).ok).toBe(false)
    expect(verifyBackup('x').ok).toBe(false)
  })

  it('元数据缺失 → ok:false', () => {
    const e = stubEntry() as Partial<BackupEntry>
    delete e.checksum
    expect(verifyBackup(e).ok).toBe(false)
  })

  it('状态被篡改（校验和不一致）→ ok:false 且 reason 含「校验和」', () => {
    const e = stubEntry()
    e.state.cabinets = []
    const r = verifyBackup(e)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('校验和')
  })

  it('版本不兼容 → ok:false', () => {
    const e = stubEntry()
    ;(e.state as { version: number }).version = 999
    const r = verifyBackup(e)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('版本')
  })
})

describe('restoreBackup（B-3 一键恢复一致）', () => {
  it('恢复后矩阵↔柜内/功率一致，且可用撤销回退', () => {
    // 先污染 store，模拟恢复到不同状态
    useRoomStore.setState({ matrix: null })
    useRackStore.setState({ cabinets: [], topReservedU: 3, gpuPerCabinet: 2 })
    const r = restoreBackup(stubEntry(), useRoomStore.getState(), useRackStore.getState())
    expect(r.ok).toBe(true)
    const room = useRoomStore.getState()
    const rack = useRackStore.getState()
    expect(room.matrix).toEqual(makeMatrix())
    expect(rack.cabinets).toEqual(makeCabinets())
    expect(rack.topReservedU).toBe(2)
    expect(rack.gpuPerCabinet).toBe(1)
    expect(rack.getPowerUsageAll().total).toBe(1000)
    // 恢复写入撤销历史（可回退到恢复前状态）
    expect(rack.canUndo).toBe(true)
  })

  it('恢复前自动生成当前状态的安全备份（pre-restore）', () => {
    useRoomStore.setState({ matrix: makeMatrix(true) })
    useRackStore.setState({ cabinets: makeCabinets(), topReservedU: 2, gpuPerCabinet: 1 })
    const r = restoreBackup(stubEntry(), useRoomStore.getState(), useRackStore.getState())
    if (!r.ok) throw new Error(r.reason)
    expect(r.safetyBackup).toBeDefined()
    expect(r.safetyBackup!.kind).toBe('pre-restore')
    expect(r.safetyBackup!.state.matrix!.finalized).toBe(true)
  })

  it('损坏备份 → 拒绝恢复，store 不被改写', () => {
    useRoomStore.setState({ matrix: makeMatrix() })
    const e = stubEntry()
    e.state.cabinets = []
    const r = restoreBackup(e, useRoomStore.getState(), useRackStore.getState())
    expect(r.ok).toBe(false)
    expect(useRoomStore.getState().matrix).toEqual(makeMatrix())
  })
})

describe('backupStats / computeBackupConsistency（B-4）', () => {
  it('backupStats 按 kind 计数并给出最新/最旧时间', () => {
    const list = [
      stubEntry({ id: 'a', kind: 'auto', createdAt: '2026-08-29T00:00:00Z' }),
      stubEntry({ id: 'b', kind: 'manual', createdAt: '2026-08-29T01:00:00Z' }),
      stubEntry({ id: 'c', kind: 'pre-restore', createdAt: '2026-08-29T02:00:00Z' }),
    ]
    const s = backupStats(list)
    expect(s.total).toBe(3)
    expect(s.byKind.auto).toBe(1)
    expect(s.byKind.manual).toBe(1)
    expect(s.byKind['pre-restore']).toBe(1)
    expect(s.oldest).toBe('2026-08-29T00:00:00Z')
    expect(s.newest).toBe('2026-08-29T02:00:00Z')
  })

  it('computeBackupConsistency 检出损坏备份，健康条目通过', () => {
    const good = stubEntry({ id: 'good' })
    const bad = stubEntry({ id: 'bad' })
    bad.state.cabinets = []
    const r = computeBackupConsistency([good, bad])
    expect(r.checked).toBe(2)
    expect(r.healthy).toBe(1)
    expect(r.issues.map((i) => i.id)).toEqual(['bad'])
  })
})

describe('与既有快照体系协同（B-5）', () => {
  it('备份条目状态与快照同为 DesignSnapshot，可互转（校验兼容）', async () => {
    const { validateSnapshot } = await import('@/utils/designSnapshot')
    const e = stubEntry()
    // 备份内嵌的 state 是标准 DesignSnapshot，快照校验原语可直接验证
    expect(validateSnapshot(e.state).ok).toBe(true)
  })
})
