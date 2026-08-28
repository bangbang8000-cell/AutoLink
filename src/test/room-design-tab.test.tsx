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
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
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

/** M3（AL-D3b）：带已上架机柜的矩阵——A1↔柜1、B2↔柜2，供双向联动测试 */
const makeMatrixWithCabinet = (finalized = false): RoomMatrixData => {
  const m = makeMatrix(finalized)
  m.cells = m.cells.map((c) => {
    if (c.row === 'A' && c.col === 1) return { ...c, type: 'gpu', cabinetId: 1 }
    if (c.row === 'B' && c.col === 2) return { ...c, type: 'gpu', cabinetId: 2 }
    return c
  })
  return m
}

const makeCabinet = (id: number, name = `机柜 ${id}`): RackCabinet => ({
  id,
  name,
  totalU: 42,
  type: 'gpu',
  power_limit: 6000,
  devices: [],
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

  it('M3 选中已上架柜格 → 切到「机柜设计」子视图并选中该柜（格→柜联动）', async () => {
    mockGetFile(makeMatrixWithCabinet(false))
    useRackStore.setState({ cabinets: [makeCabinet(1), makeCabinet(2)], unplacedDevices: [], selectedCabinetId: null })
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    await screen.findByText('机房 A')
    // 模拟点击矩阵格 A1（select 工具下 markCell 仅更新选中位）
    useRoomStore.getState().selectPosition('A1')
    await waitFor(() => {
      expect(useRackStore.getState().selectedCabinetId).toBe(1)
      expect(useUIStore.getState().workbenchSubview).toBe('rackdesign' as WorkbenchSubview)
    })
  })

  it('M3 已定稿 → 「前往机柜设计」按钮切到 rackdesign 子视图', async () => {
    mockGetFile(makeMatrix(true))
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    const btn = await screen.findByText('前往机柜设计')
    fireEvent.click(btn)
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('rackdesign' as WorkbenchSubview))
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

  it('M3 旧 rack 子视图已收敛：不再渲染两段式 RackWorkbenchView', async () => {
    mockGetFile(makeMatrix(false))
    render(<WorkbenchTab />)
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
    useUIStore.getState().setWorkbenchSubview('rack' as WorkbenchSubview)
    // 旧两段式切换按钮（① 机房-机柜布局 / ② 柜内设备布放）不再渲染
    expect(screen.queryByText('① 机房-机柜布局')).not.toBeInTheDocument()
    expect(screen.queryByText('② 柜内设备布放')).not.toBeInTheDocument()
    // 两个独立子视图入口仍在 main 视图中（设计步骤）
    expect(screen.getAllByText(/机房设计/).length).toBeGreaterThan(0)
  })
})
