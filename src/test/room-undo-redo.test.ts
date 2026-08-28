/**
 * M2（AL-UR1/UR2）：room.store 矩阵编辑撤销/重做命令栈单测
 *
 * 覆盖：
 * - markCell / updateCellsBulk / clearCellsBulk / deleteCellsBulk 撤销重做
 * - mountCabinet / unmountCabinet 撤销
 * - deleteCellsBulk 跨 store 一致（room.undo + rack.undo 同时回退）
 * - U-4 连续多步 + 分支丢弃、setFinalized 不撤销
 * - U-5 栈深上限 50
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'

const makeMatrix = (): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: ['A', 'B'],
  cols: [1, 2, 3],
  cells: [
    { row: 'A', col: 1, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'A', col: 2, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'A', col: 3, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 1, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 2, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 3, type: 'empty', placeholder: null, cabinetId: null },
  ],
})

const makeCabinet = (overrides: Partial<RackCabinet> = {}): RackCabinet => ({
  id: 1,
  name: '机柜 1',
  totalU: 42,
  type: 'gpu',
  power_limit: 6000,
  devices: [],
  ...overrides,
})

const cell = (s: ReturnType<typeof useRoomStore.getState>) => (pos: string) =>
  s.matrix!.cells.find((c) => `${c.row}${c.col}` === pos)!

describe('RoomStore undo/redo（AL-UR1/UR2）', () => {
  beforeEach(() => {
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
    useRackStore.setState({
      cabinets: [],
      unplacedDevices: [],
      selectedCabinetId: null,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    })
    useToastStore.setState({ toasts: [] })
    vi.clearAllMocks()
    ;(window.electron.project.getFile as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(window.electron.project.saveFile as ReturnType<typeof vi.fn>).mockResolvedValue(true)
  })

  it('markCell 类型标记撤销/重做', () => {
    useRoomStore.setState({ matrix: makeMatrix(), markTool: 'gpu' })
    useRoomStore.getState().markCell('A1')
    expect(cell(useRoomStore.getState())('A1').type).toBe('gpu')
    useRoomStore.getState().undo()
    expect(cell(useRoomStore.getState())('A1').type).toBe('empty')
    useRoomStore.getState().redo()
    expect(cell(useRoomStore.getState())('A1').type).toBe('gpu')
  })

  it('markCell 占位标记撤销清除机柜并恢复', () => {
    const m = makeMatrix()
    m.cells[0].cabinetId = 7
    useRoomStore.setState({ matrix: m, markTool: 'pillar' })
    useRoomStore.getState().markCell('A1')
    expect(cell(useRoomStore.getState())('A1')).toMatchObject({ placeholder: 'pillar', cabinetId: null })
    useRoomStore.getState().undo()
    expect(cell(useRoomStore.getState())('A1')).toMatchObject({ placeholder: null, cabinetId: 7 })
  })

  it('updateCellsBulk 批量撤销/重做（联动机柜类型同步一致）', () => {
    const m = makeMatrix()
    m.cells[0].cabinetId = 1
    m.cells[0].type = 'gpu'
    useRoomStore.setState({ matrix: m })
    useRackStore.setState({ cabinets: [makeCabinet({ id: 1, type: 'gpu' })] })
    useRoomStore.getState().updateCellsBulk(['A1'], { type: 'storage' })
    expect(useRoomStore.getState().matrix!.cells[0].type).toBe('storage')
    expect(useRackStore.getState().cabinets[0].type).toBe('storage')

    // 单个撤销（快捷键触发两 store）→ 矩阵与柜内类型同时回退
    useRoomStore.getState().undo()
    useRackStore.getState().undo()
    expect(useRoomStore.getState().matrix!.cells[0].type).toBe('gpu')
    expect(useRackStore.getState().cabinets[0].type).toBe('gpu')

    useRoomStore.getState().redo()
    useRackStore.getState().redo()
    expect(useRoomStore.getState().matrix!.cells[0].type).toBe('storage')
    expect(useRackStore.getState().cabinets[0].type).toBe('storage')
  })

  it('clearCellsBulk 撤销 → 恢复格子标记/占位（机柜保留未上架）', () => {
    const m = makeMatrix()
    m.cells[0] = { ...m.cells[0], type: 'gpu', placeholder: 'ac', cabinetId: 1 }
    useRoomStore.setState({ matrix: m, selectedPosition: 'A1' })
    useRackStore.setState({ cabinets: [makeCabinet({ id: 1 })] })
    useRoomStore.getState().clearCellsBulk(['A1'])
    expect(useRoomStore.getState().matrix!.cells[0]).toMatchObject({ type: 'empty', placeholder: null, cabinetId: null })
    useRoomStore.getState().undo()
    const s = useRoomStore.getState()
    expect(cell(s)('A1')).toMatchObject({ type: 'gpu', placeholder: 'ac', cabinetId: 1 })
    expect(useRackStore.getState().cabinets.map((c) => c.id)).toEqual([1])
  })

  it('deleteCellsBulk 撤销 → 机柜与格子同时恢复（跨 store 一致，AL-UR2）', () => {
    const m = makeMatrix()
    m.cells[0].cabinetId = 1
    useRoomStore.setState({ matrix: m, selectedPosition: 'A1' })
    useRackStore.setState({ cabinets: [makeCabinet({ id: 1 })] })
    useRoomStore.getState().deleteCellsBulk(['A1'])
    expect(useRoomStore.getState().matrix!.cells[0].cabinetId).toBeNull()
    expect(useRackStore.getState().cabinets).toHaveLength(0)

    useRoomStore.getState().undo()
    useRackStore.getState().undo()
    expect(cell(useRoomStore.getState())('A1').cabinetId).toBe(1)
    expect(useRackStore.getState().cabinets.map((c) => c.id)).toEqual([1])

    useRoomStore.getState().redo()
    useRackStore.getState().redo()
    expect(useRoomStore.getState().matrix!.cells[0].cabinetId).toBeNull()
    expect(useRackStore.getState().cabinets).toHaveLength(0)
  })

  it('mountCabinet / unmountCabinet 撤销', () => {
    useRoomStore.setState({ matrix: makeMatrix() })
    useRackStore.setState({ cabinets: [makeCabinet()] })
    useRoomStore.getState().mountCabinet('A1', 1)
    expect(cell(useRoomStore.getState())('A1').cabinetId).toBe(1)
    useRoomStore.getState().undo()
    expect(cell(useRoomStore.getState())('A1').cabinetId).toBeNull()
    useRoomStore.getState().redo()
    expect(cell(useRoomStore.getState())('A1').cabinetId).toBe(1)

    // unmount 再撤销 → 恢复上架
    useRoomStore.getState().unmountCabinet('A1')
    expect(cell(useRoomStore.getState())('A1').cabinetId).toBeNull()
    useRoomStore.getState().undo()
    expect(cell(useRoomStore.getState())('A1').cabinetId).toBe(1)
  })

  it('setFinalized 定稿/撤销定稿不压撤销栈', () => {
    useRoomStore.setState({ matrix: makeMatrix() })
    useRoomStore.getState().setFinalized(true)
    expect(useRoomStore.getState().matrix!.finalized).toBe(true)
    expect(useRoomStore.getState().undoStack).toHaveLength(0)
    expect(useRoomStore.getState().canUndo).toBe(false)
    useRoomStore.getState().setFinalized(false)
    expect(useRoomStore.getState().undoStack).toHaveLength(0)
  })

  it('U-4 连续多步撤销/重做 + 分支丢弃', () => {
    useRoomStore.setState({ matrix: makeMatrix(), markTool: 'gpu' })
    useRoomStore.getState().markCell('A1')
    useRoomStore.getState().markCell('B1')
    expect(useRoomStore.getState().matrix!.cells.filter((c) => c.type === 'gpu')).toHaveLength(2)

    useRoomStore.getState().undo()
    expect(useRoomStore.getState().matrix!.cells.filter((c) => c.type === 'gpu')).toHaveLength(1)
    useRoomStore.getState().undo()
    expect(useRoomStore.getState().matrix!.cells.filter((c) => c.type === 'gpu')).toHaveLength(0)
    expect(useRoomStore.getState().canUndo).toBe(false)

    useRoomStore.getState().redo()
    useRoomStore.getState().redo()
    expect(useRoomStore.getState().matrix!.cells.filter((c) => c.type === 'gpu')).toHaveLength(2)

    // 分支丢弃：撤销后新编辑清空 redo
    useRoomStore.getState().undo()
    useRoomStore.getState().markCell('A2')
    expect(useRoomStore.getState().canRedo).toBe(false)
    expect(useRoomStore.getState().redoStack).toHaveLength(0)
  })

  it('U-5 栈深上限 50', () => {
    useRoomStore.setState({ matrix: makeMatrix(), markTool: 'gpu' })
    for (let i = 0; i < 60; i++) useRoomStore.getState().markCell('A1')
    expect(useRoomStore.getState().undoStack.length).toBe(50)
    for (let i = 0; i < 50; i++) useRoomStore.getState().undo()
    expect(useRoomStore.getState().canUndo).toBe(false)
  })

  it('select 工具 markCell 不压栈（无实际修改）', () => {
    useRoomStore.setState({ matrix: makeMatrix(), markTool: 'select' })
    useRoomStore.getState().markCell('A1')
    expect(useRoomStore.getState().selectedPosition).toBe('A1')
    expect(useRoomStore.getState().undoStack).toHaveLength(0)
  })
})
