/**
 * M-F2（F2-2）：撤销/重做栈跨会话持久化单测（room.store）
 *
 * 覆盖（PRD v3.6 F2-2 验收）：
 * - R-1 写盘：矩阵编辑后 persistRoomUndoHistory → render.saveOutputFile 落盘到项目目录
 * - R-2 重启模拟：写盘 → 清空撤销栈 → restoreRoomUndoHistory → undo 可回退到重启前
 * - R-3 容量受控：栈深只持久化最近 ROOM_UNDO_PERSIST_LIMIT 条 + 字节阈值纯函数
 * - R-5 落盘受阻 → 退化 localStorage 兜底（方案B）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRoomStore, type RoomMatrixData } from '../stores/room.store'
import {
  ROOM_UNDO_PERSIST_LIMIT,
  ROOM_UNDO_PERSIST_FILE,
  persistRoomUndoHistory,
  restoreRoomUndoHistory,
  buildRoomUndoPersistFile,
  truncateRoomUndoByBytes,
} from '../stores/room.store'

const mockElectron = {
  project: { getFile: vi.fn(), saveFile: vi.fn() },
  render: { saveOutputFile: vi.fn(), readOutputFile: vi.fn() },
}

// @ts-expect-error - mock window.electron
window.electron = mockElectron

const makeMatrix = (): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: ['A', 'B'],
  cols: [1, 2],
  cells: [
    { row: 'A', col: 1, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'A', col: 2, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 1, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 2, type: 'empty', placeholder: null, cabinetId: null },
  ],
})

const decodeBase64 = (b64: string): string => Buffer.from(b64, 'base64').toString('utf-8')

const lastWrittenFile = (): string => {
  const calls = mockElectron.render.saveOutputFile.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return decodeBase64(calls[calls.length - 1][2] as string)
}

const cellOf = (s: ReturnType<typeof useRoomStore.getState>, pos: string) =>
  s.matrix!.cells.find((c) => `${c.row}${c.col}` === pos)!

describe('M-F2 F2-2 撤销跨会话持久化（room）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
    useRoomStore.setState({
      matrix: null,
      markTool: 'select',
      selectedPosition: null,
      multiSelected: [],
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    })
    vi.clearAllMocks()
    mockElectron.project.getFile.mockResolvedValue(null)
  })

  it('R-1 写盘：矩阵编辑后 persistRoomUndoHistory → 落盘 output/undo_room.json', async () => {
    useRoomStore.setState({ matrix: makeMatrix(), markTool: 'gpu' })
    useRoomStore.getState().markCell('A1')
    await persistRoomUndoHistory('projA')

    expect(mockElectron.render.saveOutputFile).toHaveBeenCalledWith(
      'projA',
      ROOM_UNDO_PERSIST_FILE,
      expect.any(String),
    )
    const file = JSON.parse(lastWrittenFile())
    expect(file.store).toBe('room')
    expect(file.undoStack.length).toBeGreaterThan(0)
  })

  it('R-2 重启模拟：写盘 → 清空撤销栈 → restore → undo 可回退到重启前', async () => {
    // 会话1：两次矩阵编辑并落盘
    useRoomStore.setState({ matrix: makeMatrix(), markTool: 'gpu' })
    useRoomStore.getState().markCell('A1') // empty → gpu（压快照：empty）
    useRoomStore.getState().markCell('B1') // empty → gpu（压快照：A1=gpu, B1=empty）
    await persistRoomUndoHistory('projA')
    const persisted = lastWrittenFile()

    // 会话2：重启模拟——矩阵已最新（A1=gpu, B1=gpu），撤销栈清空
    const latest = makeMatrix()
    latest.cells[0].type = 'gpu'
    latest.cells[2].type = 'gpu'
    useRoomStore.setState({ matrix: latest, undoStack: [], redoStack: [], canUndo: false, canRedo: false })
    mockElectron.project.getFile.mockImplementation(async (_name: string, filePath: string) =>
      filePath === `output/${ROOM_UNDO_PERSIST_FILE}` ? persisted : null,
    )
    await restoreRoomUndoHistory('projA')

    expect(useRoomStore.getState().canUndo).toBe(true)
    // 重启后 Ctrl+Z 回退到上一次编辑前（B1 回到 empty）
    useRoomStore.getState().undo()
    expect(cellOf(useRoomStore.getState(), 'B1').type).toBe('empty')
    expect(cellOf(useRoomStore.getState(), 'A1').type).toBe('gpu')
  })

  it('R-3 容量受控：只持久化最近 ROOM_UNDO_PERSIST_LIMIT 条（超限丢弃最旧）', async () => {
    useRoomStore.setState({ matrix: makeMatrix(), markTool: 'gpu' })
    for (let i = 0; i < 25; i++) useRoomStore.getState().markCell('A1')
    expect(useRoomStore.getState().undoStack.length).toBe(25)
    await persistRoomUndoHistory('projA')
    const file = JSON.parse(lastWrittenFile())
    expect(file.undoStack.length).toBe(ROOM_UNDO_PERSIST_LIMIT)
  })

  it('R-3b 容量受控：字节阈值截断纯函数（truncateRoomUndoByBytes）', () => {
    const snap = () => ({
      matrix: {
        schemaVersion: 1,
        name: 'm',
        rows: ['A'],
        cols: [1],
        cells: [{ row: 'A', col: 1, type: 'empty', placeholder: null, cabinetId: null }],
      },
      selectedPosition: null,
      multiSelected: [] as string[],
    })
    const stack = Array.from({ length: 6 }, snap)
    const capped = truncateRoomUndoByBytes(stack, [], 400)
    expect(capped).not.toBeNull()
    expect(capped!.undoStack.length).toBeLessThan(stack.length)
    expect(capped!.undoStack.length).toBeGreaterThan(0)
    expect(truncateRoomUndoByBytes(stack, [], 10)).toBeNull()
  })

  it('R-5 落盘受阻 → 退化 localStorage（方案B）且可恢复', async () => {
    const saveSpy = mockElectron.render.saveOutputFile
    // @ts-expect-error - 模拟 render 通道不可用
    delete mockElectron.render.saveOutputFile
    useRoomStore.setState({ matrix: makeMatrix(), markTool: 'gpu' })
    useRoomStore.getState().markCell('A1')
    await persistRoomUndoHistory('projA')
    expect(localStorage.getItem('autolink-room-undo:projA')).toContain('"store":"room"')
    useRoomStore.setState({ undoStack: [], redoStack: [], canUndo: false, canRedo: false })
    await restoreRoomUndoHistory('projA')
    expect(useRoomStore.getState().canUndo).toBe(true)
    mockElectron.render.saveOutputFile = saveSpy
  })

  it('R-7 buildRoomUndoPersistFile 栈深截断到最近 N 条', () => {
    const snap = () => ({ matrix: makeMatrix(), selectedPosition: null, multiSelected: [] })
    const stack = Array.from({ length: 30 }, snap)
    const file = buildRoomUndoPersistFile(stack, [])
    expect(file.undoStack.length).toBe(ROOM_UNDO_PERSIST_LIMIT)
  })
})
