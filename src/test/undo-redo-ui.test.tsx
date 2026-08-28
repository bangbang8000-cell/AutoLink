/**
 * M2（AL-UR1/UR2）：撤销/重做 UI 接线测试（轻量）
 * - RoomDesignTab 工具栏渲染「撤销/重做」按钮，点击触发 room.store undo/redo
 * - RackDesignTab 工具栏渲染「撤销/重做」按钮，点击触发 rack.store undo/redo
 * （store 纯逻辑已由 rack-undo-redo.test.ts / room-undo-redo.test.ts 覆盖）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { RackDesignTab } from '@/components/workspace/tabs/RackDesignTab'
import { RoomDesignTab } from '@/components/workspace/tabs/RoomDesignTab'
import { ProjectProvider } from '@/stores/ProjectContext'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { useProjectStore } from '@/stores/project.store'

const makeMatrix = (finalized = false): RoomMatrixData => ({
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
  finalized,
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

const mockGetFile = (matrix: RoomMatrixData | null) => {
  ;(window as unknown as { electron: { project: { getFile: ReturnType<typeof vi.fn> } } }).electron.project.getFile.mockImplementation(
    async (_proj: string, file: string) => {
      if (file === 'room_layout.json') return matrix ? JSON.stringify(matrix) : null
      return null
    },
  )
}

beforeEach(() => {
  useRoomStore.setState({
    matrix: null, markTool: 'select', selectedPosition: null, multiSelected: [],
    undoStack: [], redoStack: [], canUndo: false, canRedo: false,
  })
  useRackStore.setState({
    cabinets: [], unplacedDevices: [], selectedCabinetId: null, topReservedU: 2,
    undoStack: [], redoStack: [], canUndo: false, canRedo: false,
  })
  useToastStore.setState({ toasts: [] })
  useProjectStore.setState({
    projects: [{ id: 1, name: 'p1', index: 0, updatedAt: '2026-01-01' }],
    selectedProjectName: 'p1',
  })
  ;(window as unknown as { electron: { app: { getPath: ReturnType<typeof vi.fn> } } }).electron.app.getPath =
    vi.fn().mockResolvedValue('/workspace')
  ;(window as unknown as { electron: { aidc?: { project: { list: ReturnType<typeof vi.fn> } } } }).electron.aidc = {
    project: { list: vi.fn().mockResolvedValue({ ok: true, projects: [] }) },
  }
  mockGetFile(null)
})

describe('撤销/重做 UI 接线（AL-UR1 工具栏按钮）', () => {
  it('RackDesignTab 已定稿 → 工具栏含「撤销/重做」按钮，点击撤销上架生效', async () => {
    mockGetFile(makeMatrix(true))
    useRackStore.setState({
      cabinets: [makeCabinet()],
      unplacedDevices: [{ id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', height: 8, power_watts: 1000 }],
      selectedCabinetId: 1,
    })
    render(<RackDesignTab projectName="p1" />)
    await screen.findByText(/归档/)

    // 上架 → 生成撤销点（act 包裹使 React 刷新按钮禁用态）
    act(() => {
      useRackStore.getState().placeDevice(1, useRackStore.getState().unplacedDevices[0], 1)
    })
    expect(useRackStore.getState().canUndo).toBe(true)

    const undoBtn = screen.getByRole('button', { name: '撤销' })
    expect(undoBtn).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重做' })).toBeInTheDocument()

    fireEvent.click(undoBtn)
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(0)
    expect(useRackStore.getState().unplacedDevices.map((d) => d.id)).toEqual(['gpu-1'])

    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(1)
  })

  it('RoomDesignTab 矩阵编辑 → 工具栏「撤销/重做」按钮，点击 markCell 撤销生效', async () => {
    mockGetFile(makeMatrix(false))
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    await screen.findByText('机房 A')

    const undoBtn = screen.getByRole('button', { name: '撤销' })
    expect(undoBtn).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重做' })).toBeInTheDocument()

    useRoomStore.getState().setMarkTool('gpu')
    act(() => {
      useRoomStore.getState().markCell('A1')
    })
    expect(useRoomStore.getState().matrix!.cells[0].type).toBe('gpu')
    expect(useRoomStore.getState().canUndo).toBe(true)

    fireEvent.click(undoBtn)
    expect(useRoomStore.getState().matrix!.cells[0].type).toBe('empty')

    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(useRoomStore.getState().matrix!.cells[0].type).toBe('gpu')
  })

  it('按钮禁用态：无可撤销/重做时禁用', async () => {
    mockGetFile(makeMatrix(true))
    useRackStore.setState({ cabinets: [makeCabinet()], selectedCabinetId: 1 })
    render(<RackDesignTab projectName="p1" />)
    await screen.findByText(/归档/)
    expect(useRackStore.getState().canUndo).toBe(false)
    const undoBtn = screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement
    expect(undoBtn.disabled).toBe(true)
    const redoBtn = screen.getByRole('button', { name: '重做' }) as HTMLButtonElement
    expect(redoBtn.disabled).toBe(true)
  })

  it('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 快捷键触发撤销/重做（RackDesignTab）', async () => {
    mockGetFile(makeMatrix(true))
    useRackStore.setState({
      cabinets: [makeCabinet()],
      unplacedDevices: [{ id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', height: 8, power_watts: 1000 }],
      selectedCabinetId: 1,
    })
    render(<RackDesignTab projectName="p1" />)
    await screen.findByText(/归档/)
    act(() => {
      useRackStore.getState().placeDevice(1, useRackStore.getState().unplacedDevices[0], 1)
    })
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(1)

    // Ctrl+Z → 撤销
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(0)
    // Ctrl+Shift+Z → 重做
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(1)
    // Ctrl+Y → 撤销再重做
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(0)
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(1)
  })

  it('聚焦输入框时快捷键跳过（不与系统输入冲突）', async () => {
    mockGetFile(makeMatrix(true))
    useRackStore.setState({
      cabinets: [makeCabinet()],
      unplacedDevices: [{ id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', height: 8, power_watts: 1000 }],
      selectedCabinetId: 1,
    })
    const { container } = render(<RackDesignTab projectName="p1" />)
    await screen.findByText(/归档/)
    act(() => {
      useRackStore.getState().placeDevice(1, useRackStore.getState().unplacedDevices[0], 1)
    })

    // 焦点在 input 上 → Ctrl+Z 不触发撤销
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(1)
    document.body.removeChild(input)

    // 焦点在 body → 触发撤销
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(0)
    await waitFor(() => {})
    expect(container).toBeTruthy()
  })
})
