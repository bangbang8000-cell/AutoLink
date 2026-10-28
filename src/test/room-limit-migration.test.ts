/**
 * AL v5.5.7（A22 / FR-A22）— 机房列上限 24 + 旧项目阻断式迁移
 *
 * 覆盖测试计划 T-B4-08~11：
 *   - 08 超限且含非空 → 阻断（当前 N 列 / 超出 M 列 / 受影响柜位清单），不得静默截断
 *   - 09 超出列全 empty → 可直接裁剪并写回
 *   - 10 迁移一次性（再次载入不再提示、不重复写盘）
 *   - 11 ≤24 列数据逐字段不变
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useRoomStore,
  ROOM_COL_LIMIT,
  ROOM_SCHEMA_VERSION,
  overflowColNumbers,
  occupiedOverflowCells,
  trimOverflowCols,
  type RoomCellData,
  type RoomMatrixData,
} from '@/stores/room.store'
import { useToastStore } from '@/stores/toast.store'

const ROWS = ['A', 'B']

/** 构造 rows×cols 全量矩阵；typeAt 可对个别格子打柜型/占位/机柜 */
function buildMatrix(
  colCount: number,
  typeAt: (row: string, col: number) => Partial<RoomCellData> | null = () => null,
): RoomMatrixData {
  const cols = Array.from({ length: colCount }, (_, i) => i + 1)
  const cells: RoomCellData[] = []
  for (const row of ROWS) {
    for (const col of cols) {
      cells.push({ row, col, type: 'empty', placeholder: null, cabinetId: null, ...(typeAt(row, col) ?? {}) })
    }
  }
  return { schemaVersion: 1, name: '机房', rows: ROWS, cols, cells }
}

/** room_layout.json 返回指定内容；其余文件（撤销栈）返回 null */
function mockLayoutFile(data: RoomMatrixData | null) {
  window.electron.project.getFile = vi.fn().mockImplementation(async (_p: string, file: string) => {
    if (file !== 'room_layout.json') return null
    return data ? JSON.stringify(data) : null
  })
}

function layoutSaves(): unknown[][] {
  const saveFile = window.electron.project.saveFile as unknown as { mock: { calls: unknown[][] } }
  return saveFile.mock.calls.filter((c) => c[1] === 'room_layout.json')
}

describe('A22 机房列上限 24（T-B4-08~11）', () => {
  beforeEach(() => {
    useRoomStore.getState().reset()
    useToastStore.setState({ toasts: [] })
    vi.clearAllMocks()
    window.electron.project.getFile = vi.fn().mockResolvedValue(null)
    window.electron.project.saveFile = vi.fn().mockResolvedValue(true)
    window.electron.room.createMatrix = vi.fn()
    window.electron.room.validateLayout = vi.fn().mockResolvedValue({ valid: true, errors: [] })
  })

  it('T-B4-08：30 列且第 25 列有已落柜 → 阻断且列出受影响柜位，不写盘', async () => {
    const data = buildMatrix(30, (row, col) =>
      row === 'A' && col === 25 ? { type: 'gpu', cabinetId: 7 } : null,
    )
    mockLayoutFile(data)

    await useRoomStore.getState().loadMatrix('P')

    const s = useRoomStore.getState()
    expect(s.matrix).toBeNull()
    expect(s.limitBlock).not.toBeNull()
    expect(s.limitBlock!.currentCols).toBe(30)
    expect(s.limitBlock!.overflowCols).toBe(6)
    expect(s.limitBlock!.limit).toBe(ROOM_COL_LIMIT)
    expect(s.limitBlock!.affected).toEqual([
      { position: 'A25', type: 'gpu', cabinetId: 7, placeholder: null },
    ])
    // 不得静默截断：阻断态下不写 room_layout.json
    expect(layoutSaves()).toHaveLength(0)
    expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true)
  })

  it('T-B4-08：新建矩阵填 25 列 → 直接拒绝，不调用后端', async () => {
    const cols = Array.from({ length: 25 }, (_, i) => i + 1)
    const ok = await useRoomStore.getState().createMatrix('P', ['A'], cols, '机房')

    expect(ok).toBe(false)
    expect(window.electron.room.createMatrix).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true)
  })

  it('T-B4-09：30 列全 empty → 自动裁剪到 24 列并写回', async () => {
    const data = buildMatrix(30)
    mockLayoutFile(data)

    await useRoomStore.getState().loadMatrix('P')

    const s = useRoomStore.getState()
    expect(s.limitBlock).toBeNull()
    const m = s.matrix!
    expect(m.cols).toEqual(Array.from({ length: 24 }, (_, i) => i + 1))
    expect(m.cells).toHaveLength(ROWS.length * 24)
    expect(m.cells.every((c) => c.col <= ROOM_COL_LIMIT)).toBe(true)
    // 迁移后落为 v2，且几何参数每排列数同步为 24
    expect(m.schemaVersion).toBe(ROOM_SCHEMA_VERSION)
    expect(m.geometry?.cabinetsPerRow).toBe(ROOM_COL_LIMIT)

    const saves = layoutSaves()
    expect(saves).toHaveLength(1)
    const persisted = JSON.parse(saves[0][2] as string) as RoomMatrixData
    expect(persisted.cols).toHaveLength(24)
    expect(persisted.cells).toHaveLength(ROWS.length * 24)
    expect(persisted.schemaVersion).toBe(ROOM_SCHEMA_VERSION)
  })

  it('T-B4-10：迁移一次性——再次载入不再提示、不重复写盘', async () => {
    const data = buildMatrix(30)
    mockLayoutFile(data)
    await useRoomStore.getState().loadMatrix('P')

    const persisted = JSON.parse(layoutSaves()[0][2] as string) as RoomMatrixData
    vi.clearAllMocks()
    useToastStore.setState({ toasts: [] })
    window.electron.project.getFile = vi.fn().mockResolvedValue(null)
    window.electron.project.saveFile = vi.fn().mockResolvedValue(true)
    mockLayoutFile(persisted)

    await useRoomStore.getState().loadMatrix('P')

    expect(useRoomStore.getState().limitBlock).toBeNull()
    expect(useRoomStore.getState().matrix?.cols).toHaveLength(24)
    expect(layoutSaves()).toHaveLength(0)
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('裁剪'))).toBe(false)
  })

  it('T-B4-11：≤24 列数据逐字段不变（不补 geometry、不改 schemaVersion、不写盘）', async () => {
    const data = buildMatrix(24, (row, col) =>
      row === 'B' && col === 3 ? { type: 'network', typeAuto: false } : null,
    )
    mockLayoutFile(data)

    await useRoomStore.getState().loadMatrix('P')

    expect(useRoomStore.getState().matrix).toEqual(data)
    expect(useRoomStore.getState().limitBlock).toBeNull()
    expect(layoutSaves()).toHaveLength(0)
  })

  it('阻断态可清空超出列并迁移：受影响柜位被清空、裁剪到 24 列并写回', async () => {
    const data = buildMatrix(30, (row, col) => {
      if (row === 'A' && col === 25) return { type: 'gpu', cabinetId: 7 }
      if (row === 'B' && col === 27) return { placeholder: 'ac' }
      return null
    })
    mockLayoutFile(data)
    await useRoomStore.getState().loadMatrix('P')
    expect(useRoomStore.getState().limitBlock?.affected).toHaveLength(2)

    const ok = await useRoomStore.getState().dropOverflowCols('P')

    expect(ok).toBe(true)
    const s = useRoomStore.getState()
    expect(s.limitBlock).toBeNull()
    expect(s.matrix?.cols).toHaveLength(24)
    expect(s.matrix?.cells).toHaveLength(ROWS.length * 24)
    expect(s.matrix!.cells.some((c) => c.col === 25 || c.col === 27)).toBe(false)

    const saves = layoutSaves()
    const persisted = JSON.parse(saves[saves.length - 1][2] as string) as RoomMatrixData
    expect(persisted.cols).toHaveLength(24)
    expect(persisted.schemaVersion).toBe(ROOM_SCHEMA_VERSION)
  })

  it('工具函数：溢出列/非空柜位识别与裁剪口径一致', () => {
    const data = buildMatrix(26, (row, col) =>
      row === 'A' && col === 26 ? { type: 'storage', cabinetId: 3 } : null,
    )
    expect(overflowColNumbers(data)).toEqual([25, 26])
    expect(occupiedOverflowCells(data).map((c) => c.position)).toEqual(['A26'])

    const trimmed = trimOverflowCols(data)
    expect(trimmed.cols).toHaveLength(ROOM_COL_LIMIT)
    expect(trimmed.cells.every((c) => c.col <= ROOM_COL_LIMIT)).toBe(true)
    // ≤24 列内的格子逐字段不变
    const before = data.cells.filter((c) => c.col <= ROOM_COL_LIMIT)
    expect(trimmed.cells).toEqual(before)
  })
})
