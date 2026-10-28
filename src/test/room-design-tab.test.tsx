/**
 * M1（AL-D1）：机房设计独立子视图测试（RoomDesignTab）
 * - 子视图路由渲染（WorkbenchTab subview=roomdesign 分发到 RoomDesignTab）
 * - 矩阵加载 / 无矩阵创建引导（复用 DataCenterLayout）
 * - 5.5.2 / A10：定稿动作已收敛到右上角统一动作条（SubviewActionBar），面板内不再有「定稿布局/撤销定稿」
 * - M4/AL-N3：无「导出机房设计 Excel」按钮，导出统一到「本项目输出」
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RoomDesignTab } from '@/components/workspace/tabs/RoomDesignTab'
import { WorkbenchTab } from '@/components/workspace/tabs/WorkbenchTab'
import { SubviewActionBar } from '@/components/workbench/SubviewActions'
import { ProjectProvider } from '@/stores/ProjectContext'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'
import { useDesignStore, type TopologyNode } from '@/stores/design.store'
import { estimateCabinetDemand } from '@/utils/cabinetDemand'
import { checkRackFeasibility } from '@/utils/rackFeasibility'

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
  useWorkbenchStore.setState({ stepDone: {}, stale: {}, configFingerprint: {}, planHash: {} })
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
  it('有矩阵（未定稿）→ 渲染机房设计标题与矩阵视图；定稿按钮不在面板内；AL-N3 无导出按钮', async () => {
    mockGetFile(makeMatrix(false))
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    expect(await screen.findByText('机房设计')).toBeInTheDocument()
    // 5.5.2 / A10：定稿动作收敛到右上角动作条，面板内不再渲染
    expect(screen.queryByText('定稿布局')).not.toBeInTheDocument()
    expect(screen.queryByText('撤销定稿')).not.toBeInTheDocument()
    // AL-N3 / E-1：设计子视图无导出按钮（导出统一到「本项目输出」）
    expect(screen.queryByText(/导出机房设计/)).not.toBeInTheDocument()
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

  it('A11：无矩阵时动作条禁用并给出原因「请先创建机房矩阵」', async () => {
    useUIStore.setState({ workbenchSubview: 'roomdesign' as WorkbenchSubview })
    render(<SubviewActionBar projectName="p1" />)
    const btn = screen.getByRole('button', { name: /标记完成/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toBe('请先创建机房矩阵')
  })

  it('A10/A12：动作条「标记完成」→ stepDone 与 room.store.finalized 同源置位', async () => {
    mockGetFile(makeMatrix(false))
    useRoomStore.setState({ matrix: makeMatrix(false) })
    useUIStore.setState({ workbenchSubview: 'roomdesign' as WorkbenchSubview })
    render(<SubviewActionBar projectName="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /标记完成/ }))
    await waitFor(() => {
      expect(useWorkbenchStore.getState().stepDone.p1?.roomdesign?.done).toBe(true)
      expect(useRoomStore.getState().matrix?.finalized).toBe(true)
    })
  })

  it('A11：已完成 → 显示「已完成」+「撤销」，撤销后回到可执行态', async () => {
    useRoomStore.setState({ matrix: makeMatrix(true) })
    useWorkbenchStore.getState().markStepDone('p1', 'roomdesign')
    useUIStore.setState({ workbenchSubview: 'roomdesign' as WorkbenchSubview })
    render(<SubviewActionBar projectName="p1" />)
    expect(screen.getByText('已完成')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => {
      expect(useWorkbenchStore.getState().stepDone.p1?.roomdesign).toBeUndefined()
      expect(useRoomStore.getState().matrix?.finalized).toBe(false)
    })
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

  it('AL-N4c 联动校验：矩阵格 cabinetId 在 rack store 不存在 → 仅切到「机柜设计」子视图，不设置选中（避免显示错柜）', async () => {
    mockGetFile(makeMatrixWithCabinet(false))
    // rack store 只含柜 2（id=2）；矩阵 A1 指向柜 1、B2 指向柜 2（柜 1 已不在 rack store，模拟旧数据）
    useRackStore.setState({ cabinets: [makeCabinet(2)], unplacedDevices: [], selectedCabinetId: null })
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    await screen.findByText('机房 A')
    // 点击指向不存在柜的格 A1（cabinetId=1）→ 不设置选中
    useRoomStore.getState().selectPosition('A1')
    await waitFor(() => {
      expect(useUIStore.getState().workbenchSubview).toBe('rackdesign' as WorkbenchSubview)
      expect(useRackStore.getState().selectedCabinetId).toBeNull()
    })
    // 点击存在柜的格 B2（cabinetId=2）→ 正常选中
    useRoomStore.getState().selectPosition('B2')
    await waitFor(() => expect(useRackStore.getState().selectedCabinetId).toBe(2))
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

/** B1-11 / FR-A09：构造 rowCount × colCount 且全部标为同一柜型的矩阵（名义柜位 = rowCount × colCount） */
const makeTypedMatrix = (
  rowCount: number,
  colCount: number,
  type: RoomMatrixData['cells'][number]['type'],
): RoomMatrixData => {
  const rows = Array.from({ length: rowCount }, (_, i) => `R${i + 1}`)
  const cols = Array.from({ length: colCount }, (_, i) => i + 1)
  const cells = rows.flatMap((row) => cols.map((col) => ({ row, col, type, placeholder: null, cabinetId: null })))
  return { schemaVersion: 1, name: '机房 A', rows, cols, cells, finalized: false }
}

const makeGpuNodes = (n: number): TopologyNode[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `gpu-${i + 1}`,
    type: 'server',
    group: 'GPU服务器',
    domain: 'gpu',
    podid: 'p1',
    uHeight: 8,
    powerWatts: 6000,
  }))

describe('B1-11 差额状态条（FR-A09 / T-B1-24、T-B1-25）', () => {
  beforeEach(() => {
    useDesignStore.setState({ topology: null })
  })

  it('柜位 60 / 需求 168 → 红色并显示「缺 108 柜」+ 具名缺口', async () => {
    const matrix = makeTypedMatrix(6, 10, 'gpu')
    mockGetFile(matrix)
    useRoomStore.setState({ matrix })
    useDesignStore.setState({ topology: { nodes: makeGpuNodes(168), edges: [] } })
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    expect(await screen.findByText('柜位 60 / 需求 168')).toBeInTheDocument()
    expect(screen.getByText('⚠ 缺 108 柜')).toBeInTheDocument()
    // 具名缺口：按柜型列出（GPU柜 108）
    expect(screen.getByText('(GPU柜 108)')).toBeInTheDocument()
    // 不足即红色
    expect(screen.getByText('柜位 60 / 需求 168').closest('button')?.className).toContain('text-error')
  })

  it('柜位 168 / 需求 168 → 绿色充足，且需求数 = A07 估算（同一次调用）', async () => {
    const matrix = makeTypedMatrix(14, 12, 'gpu')
    const nodes = makeGpuNodes(168)
    mockGetFile(matrix)
    useRoomStore.setState({ matrix })
    useDesignStore.setState({ topology: { nodes, edges: [] } })
    render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    expect(await screen.findByText('柜位 168 / 需求 168')).toBeInTheDocument()
    expect(screen.getByText('✅ 柜位充足')).toBeInTheDocument()
    expect(screen.getByText('柜位 168 / 需求 168').closest('button')?.className).toContain('text-green')

    // 三处同源（T-B1-26 前置断言）：估算精确需求 === 预检总柜位 === 差额条需求数
    const estimate = estimateCabinetDemand(nodes)
    const feasibility = checkRackFeasibility(matrix, nodes)
    expect(estimate.totalCabinets).toBe(168)
    expect(feasibility.requiredCabinets).toBe(estimate.totalCabinets)
    expect(feasibility.capacity.slots).toBe(168)
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

  it('M3 旧 rack 子视图已收敛 + AL-N1：main 内不再渲染设计入口', async () => {
    mockGetFile(makeMatrix(false))
    render(<WorkbenchTab />)
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
    // 旧两段式切换按钮（① 机房-机柜布局 / ② 柜内设备布放）不再渲染
    expect(screen.queryByText('① 机房-机柜布局')).not.toBeInTheDocument()
    expect(screen.queryByText('② 柜内设备布放')).not.toBeInTheDocument()
    // AL-N1：main（组网渲染）内不再有「设计步骤」行（设计入口已移至中栏独立条目）
    expect(screen.queryByText(/设计步骤/)).not.toBeInTheDocument()
  })
})
