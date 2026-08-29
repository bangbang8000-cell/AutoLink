/**
 * M2（AL-SNAP1-3）：设计快照 UI 轻量冒烟（组件测试从简，store 纯逻辑已由
 * design-snapshot.test.ts / snapshot.store.test.ts 覆盖 P-1~P-6）
 * - RoomDesignTab：工具栏渲染「保存快照」「快照列表」
 * - RackDesignTab（已定稿）：渲染「保存快照」「快照列表」
 * - OutputResultsView：「导出设计快照 JSON」「导入快照」按钮存在
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { RoomDesignTab } from '@/components/workspace/tabs/RoomDesignTab'
import { RackDesignTab } from '@/components/workspace/tabs/RackDesignTab'
import { OutputResultsView } from '@/components/workbench/OutputResultsView'
import { ProjectProvider } from '@/stores/ProjectContext'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { useSnapshotStore } from '@/stores/snapshot.store'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore } from '@/stores/ui.store'

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

const makeCabinet = (id: number, name = `机柜 ${id}`): RackCabinet => ({
  id, name, totalU: 42, type: 'gpu', power_limit: 6000, devices: [],
})

const mockGetFile = (matrix: RoomMatrixData | null) => {
  ;(window as unknown as { electron: { project: { getFile: ReturnType<typeof vi.fn> } } }).electron.project.getFile.mockImplementation(
    async (_proj: string, file: string) => (file === 'room_layout.json' ? (matrix ? JSON.stringify(matrix) : null) : null),
  )
}

beforeEach(() => {
  useRoomStore.setState({ matrix: null, selectedPosition: null, markTool: 'select' })
  useRackStore.setState({ cabinets: [], unplacedDevices: [], selectedCabinetId: null })
  useToastStore.setState({ toasts: [] })
  useSnapshotStore.setState({ snapshots: [] })
  localStorage.removeItem('autolink-design-snapshots')
  useUIStore.setState({ workbenchSubview: 'main' })
  useProjectStore.setState({
    projects: [{ id: 1, name: 'p1', index: 0, updatedAt: '2026-01-01' }],
    selectedProjectName: 'p1',
  })
  ;(window as unknown as { electron: { app: { getPath: ReturnType<typeof vi.fn> } } }).electron.app.getPath =
    vi.fn().mockResolvedValue('/workspace')
  ;(window as unknown as { electron: { aidc?: { project: { list: ReturnType<typeof vi.fn> } } } }).electron.aidc = {
    project: { list: vi.fn().mockResolvedValue({ ok: true, projects: [] }) },
  }
  ;(window as unknown as { electron: { project: { listOutputBatches: ReturnType<typeof vi.fn> } } }).electron.project.listOutputBatches =
    vi.fn().mockResolvedValue([])
  ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile
    .mockReset()
    .mockResolvedValue('/workspace/p1/output/机房设计.xlsx')
  mockGetFile(null)
})

describe('设计快照 UI 冒烟', () => {
  it('RoomDesignTab 有矩阵 → 工具栏渲染「保存快照」「快照列表」', async () => {
    mockGetFile(makeMatrix(false))
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    expect(await screen.findByText('保存快照')).toBeInTheDocument()
    expect(screen.getByText('快照列表')).toBeInTheDocument()
  })

  it('RackDesignTab 已定稿 → 工具栏渲染「保存快照」「快照列表」', async () => {
    mockGetFile(makeMatrix(true))
    useRackStore.setState({ cabinets: [makeCabinet(1)], unplacedDevices: [] })
    render(<RackDesignTab projectName="p1" />)
    expect(await screen.findByText('保存快照')).toBeInTheDocument()
    expect(screen.getByText('快照列表')).toBeInTheDocument()
  })

  it('OutputResultsView → 渲染「导出设计快照 JSON」「导入快照」按钮', async () => {
    render(<OutputResultsView projectName="p1" />)
    expect(await screen.findByText('导出设计快照 JSON')).toBeInTheDocument()
    expect(screen.getByText('导入快照')).toBeInTheDocument()
  })

  it('RoomDesignTab 点「保存快照」→ 弹命名弹窗，确认后列表新增（UI 集成）', async () => {
    mockGetFile(makeMatrix(false))
    useRoomStore.setState({ matrix: makeMatrix(false) })
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    const saveBtn = await screen.findByText('保存快照')
    saveBtn.click()
    const confirm = await screen.findByText('确认')
    confirm.click()
    await waitFor(() => expect(useSnapshotStore.getState().list()).toHaveLength(1))
  })
})
