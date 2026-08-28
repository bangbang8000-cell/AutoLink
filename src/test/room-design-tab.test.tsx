/**
 * M1（AL-D1）：机房设计独立子视图测试（RoomDesignTab）
 * - 子视图路由渲染（WorkbenchTab subview=roomdesign 分发到 RoomDesignTab）
 * - 矩阵加载 / 无矩阵创建引导（复用 DataCenterLayout）
 * - 定稿 / 撤销定稿状态保留（room.store.finalized）
 * - 工具栏按钮存在（定稿布局 / 导出机房设计 Excel 占位，M7 接入）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RoomDesignTab } from '@/components/workspace/tabs/RoomDesignTab'
import { WorkbenchTab } from '@/components/workspace/tabs/WorkbenchTab'
import { ProjectProvider } from '@/stores/ProjectContext'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'

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

const mockGetFile = (matrix: RoomMatrixData | null) => {
  ;(window as unknown as { electron: { project: { getFile: ReturnType<typeof vi.fn> } } }).electron.project.getFile.mockImplementation(
    async (_proj: string, file: string) => {
      if (file === 'room_layout.json') return matrix ? JSON.stringify(matrix) : null
      return null
    },
  )
}

beforeEach(() => {
  useRoomStore.setState({ matrix: null, selectedPosition: null, markTool: 'select' })
  useRackStore.setState({ cabinets: [], unplacedDevices: [] })
  useToastStore.setState({ toasts: [] })
  useUIStore.setState({ workbenchSubview: 'main' })
  useProjectStore.setState({
    projects: [{ id: 1, name: 'p1', index: 0, updatedAt: '2026-01-01' }],
    selectedProjectName: 'p1',
  })
  // setup.ts 的 electron mock 未覆盖以下两处，测试内补全（真实 Electron 桥接存在）
  ;(window as unknown as { electron: { app: { getPath: ReturnType<typeof vi.fn> } } }).electron.app.getPath =
    vi.fn().mockResolvedValue('/workspace')
  ;(window as unknown as { electron: { aidc?: { project: { list: ReturnType<typeof vi.fn> } } } }).electron.aidc = {
    project: { list: vi.fn().mockResolvedValue({ ok: true, projects: [] }) },
  }
  mockGetFile(null)
})

describe('RoomDesignTab', () => {
  it('有矩阵（未定稿）→ 渲染机房设计工具栏（标题/定稿/导出占位）与矩阵视图', async () => {
    mockGetFile(makeMatrix(false))
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    expect(await screen.findByText('机房设计')).toBeInTheDocument()
    expect(screen.getByText('定稿布局')).toBeInTheDocument()
    expect(screen.getByText('导出机房设计 Excel')).toBeInTheDocument()
    // DataCenterLayout 矩阵视图已挂载（矩阵名）
    expect(screen.getByText('机房 A')).toBeInTheDocument()
  })

  it('无矩阵 → 显示创建矩阵引导（DataCenterLayout 创建面板）', async () => {
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    expect(await screen.findByText('尚未创建机房矩阵，请设置行列后创建')).toBeInTheDocument()
    expect(screen.queryByText('定稿布局')).not.toBeInTheDocument()
  })

  it('点「定稿布局」→ room.store.finalized 置 true（定稿状态保留）', async () => {
    mockGetFile(makeMatrix(false))
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    fireEvent.click(await screen.findByText('定稿布局'))
    await waitFor(() => expect(useRoomStore.getState().matrix?.finalized).toBe(true))
  })

  it('已定稿 → 显示「撤销定稿」；点击后 finalized 置 false', async () => {
    mockGetFile(makeMatrix(true))
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    expect(await screen.findByText('撤销定稿')).toBeInTheDocument()
    expect(screen.queryByText('定稿布局')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('撤销定稿'))
    await waitFor(() => expect(useRoomStore.getState().matrix?.finalized).toBe(false))
  })
})

describe('WorkbenchTab 子视图路由（M1/M2 集成）', () => {
  it('workbenchSubview=roomdesign → 分发到机房设计子视图', async () => {
    mockGetFile(makeMatrix(false))
    render(<WorkbenchTab />)
    // mount 时 selectedProjectName 存在会重置回 main，等稳定后切到 roomdesign
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
    useUIStore.getState().setWorkbenchSubview('roomdesign' as WorkbenchSubview)
    expect((await screen.findAllByText('机房设计')).length).toBeGreaterThan(0)
  })

  it('workbenchSubview=rackdesign → 分发到机柜设计子视图（未定稿引导）', async () => {
    mockGetFile(makeMatrix(false))
    render(<WorkbenchTab />)
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
    useUIStore.getState().setWorkbenchSubview('rackdesign' as WorkbenchSubview)
    expect(await screen.findByText(/请先完成机房设计并定稿/)).toBeInTheDocument()
  })
})
