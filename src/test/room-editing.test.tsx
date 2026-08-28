/**
 * M4（AL-ED1/ED2/ED3）：机房编辑能力组件测试
 * - ED-1 右键菜单（机柜/空格/空白）结构与查看/编辑入口
 * - ED-2 同类机柜批量更新 + 确认
 * - ED-3 框选/多选批量操作
 * - ED-4 单柜改矮高度冲突提示不落库
 * （store 纯逻辑已由 room.store.test.ts / rack.store.test.ts 覆盖）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { RoomDesignTab } from '@/components/workspace/tabs/RoomDesignTab'
import { ProjectProvider } from '@/stores/ProjectContext'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { useProjectStore } from '@/stores/project.store'

/** 矩阵：A1/A2 gpu柜、A3 network柜、B1 gpu柜、B2/B3 空格 */
const makeMatrix = (): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: ['A', 'B'],
  cols: [1, 2, 3],
  cells: [
    { row: 'A', col: 1, type: 'gpu', placeholder: null, cabinetId: 1 },
    { row: 'A', col: 2, type: 'gpu', placeholder: null, cabinetId: 2 },
    { row: 'A', col: 3, type: 'network', placeholder: null, cabinetId: 3 },
    { row: 'B', col: 1, type: 'gpu', placeholder: null, cabinetId: 4 },
    { row: 'B', col: 2, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 3, type: 'empty', placeholder: null, cabinetId: null },
  ],
})

const makeCabinet = (id: number, over: Partial<RackCabinet> = {}): RackCabinet => ({
  id, name: `机柜 ${id}`, totalU: 42, type: 'gpu', power_limit: 6000, devices: [], ...over,
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
  useRoomStore.setState({ matrix: null, selectedPosition: null, markTool: 'select', multiSelected: [] })
  useRackStore.setState({ cabinets: [], unplacedDevices: [], selectedCabinetId: null, topReservedU: 2 })
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

const renderRoom = async () => {
  mockGetFile(makeMatrix())
  useRackStore.setState({
    cabinets: [
      makeCabinet(1, { type: 'gpu' }),
      makeCabinet(2, { type: 'gpu' }),
      makeCabinet(3, { type: 'network' }),
      makeCabinet(4, { type: 'gpu' }),
    ],
    unplacedDevices: [],
  })
  const utils = render(
    <ProjectProvider>
      <RoomDesignTab projectName="p1" />
    </ProjectProvider>,
  )
  await screen.findByText('机房 A')
  return utils
}

/** 各格中心（SVG 逻辑坐标，jsdom 中 svg rect=0 故 clientX 直接映射）：x=34+ci*67、y=24+ri*51 */
const CELL_CENTER: Record<string, [number, number]> = {
  A1: [66, 48], A2: [133, 48], A3: [200, 48],
  B1: [66, 99], B2: [133, 99], B3: [200, 99],
}

/** 在网格容器（HTML div）上对指定格右键（jsdom 的 SVG contextmenu 事件不触发 React 监听） */
const rightClickPos = (container: HTMLElement, pos: string) => {
  const grid = container.querySelector('.overflow-auto.p-3')!
  const [x, y] = CELL_CENTER[pos] ?? [66, 48]
  fireEvent.contextMenu(grid, { clientX: x, clientY: y })
}

/** 在网格容器空白处右键（svg 逻辑坐标落在格子外 → 机房信息） */
const rightClickBlank = (container: HTMLElement) => {
  const grid = container.querySelector('.overflow-auto.p-3')!
  fireEvent.contextMenu(grid, { clientX: 5, clientY: 5 })
}

describe('RoomEditing（M4/AL-ED1 右键信息编辑）', () => {
  it('ED-1 机柜格右键 → 菜单含查看/编辑/同类/机房信息', async () => {
    const { container } = await renderRoom()
    rightClickPos(container, 'A1')
    expect(screen.getByText('查看机柜信息')).toBeInTheDocument()
    expect(screen.getByText('编辑机柜属性')).toBeInTheDocument()
    expect(screen.getByText('编辑格子')).toBeInTheDocument()
    expect(screen.getByText('全选同类机柜')).toBeInTheDocument()
    expect(screen.getByText('查看机房信息')).toBeInTheDocument()
  })

  it('ED-1 空格右键 → 仅编辑格子 + 机房信息', async () => {
    const { container } = await renderRoom()
    rightClickPos(container, 'B2')
    expect(screen.getByText('编辑格子')).toBeInTheDocument()
    expect(screen.getByText('查看机房信息')).toBeInTheDocument()
    expect(screen.queryByText('编辑机柜属性')).not.toBeInTheDocument()
    expect(screen.queryByText('全选同类机柜')).not.toBeInTheDocument()
  })

  it('ED-1 空白右键 → 仅机房信息', async () => {
    const { container } = await renderRoom()
    rightClickBlank(container)
    expect(screen.getByText('查看机房信息')).toBeInTheDocument()
    expect(screen.queryByText('编辑机柜属性')).not.toBeInTheDocument()
  })

  it('ED-1 查看机柜信息 → 弹出只读信息（名称/类型/总U）', async () => {
    const { container } = await renderRoom()
    rightClickPos(container, 'A1')
    fireEvent.click(screen.getByText('查看机柜信息'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('机柜信息')).toBeInTheDocument()
    expect(within(dialog).getByText('机柜 1')).toBeInTheDocument()
    expect(within(dialog).getByText('GPU柜')).toBeInTheDocument()
    expect(within(dialog).getByText('42U')).toBeInTheDocument()
  })

  it('ED-1 编辑机柜 → 保存后 updateCabinet 生效', async () => {
    const { container } = await renderRoom()
    rightClickPos(container, 'A1')
    fireEvent.click(screen.getByText('编辑机柜属性'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('机柜名称'), { target: { value: 'GPU-01' } })
    fireEvent.click(within(dialog).getByText('保存'))
    await waitFor(() =>
      expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.name).toBe('GPU-01'),
    )
  })

  it('ED-4 单柜改矮高度有设备 → 冲突提示且不落库', async () => {
    mockGetFile(makeMatrix())
    useRackStore.setState({
      cabinets: [makeCabinet(1, { devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 40, power_watts: 1000 }] })],
    })
    const { container } = render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    await screen.findByText('机房 A')
    rightClickPos(container, 'A1')
    fireEvent.click(screen.getByText('编辑机柜属性'))
    const dialog = await screen.findByRole('dialog')
    const spinbuttons = within(dialog).getAllByRole('spinbutton')
    fireEvent.change(spinbuttons[0], { target: { value: '30' } }) // 总U → 30
    fireEvent.click(within(dialog).getByText('保存'))
    await waitFor(() => expect(within(dialog).getByText(/设备最高占用/)).toBeInTheDocument())
    expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.totalU).toBe(42)
  })
})

describe('RoomEditing（M4/AL-ED2 同类机柜批量更新）', () => {
  it('ED-2 全选同类 → multiSelected 命中同类柜并弹出批量弹窗', async () => {
    const { container } = await renderRoom()
    rightClickPos(container, 'A1')
    fireEvent.click(screen.getByText('全选同类机柜'))
    await waitFor(() =>
      expect(useRoomStore.getState().multiSelected).toEqual(['A1', 'A2', 'B1']),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/批量更新机柜/)).toBeInTheDocument()
  })

  it('ED-2 批量改功率 → 同类柜全生效、异类柜不变', async () => {
    const { container } = await renderRoom()
    rightClickPos(container, 'A1')
    fireEvent.click(screen.getByText('全选同类机柜'))
    const dialog = await screen.findByRole('dialog')
    const spinbuttons = within(dialog).getAllByRole('spinbutton')
    fireEvent.change(spinbuttons[1], { target: { value: '9000' } }) // 功率上限
    fireEvent.click(within(dialog).getByText('确认批量更新'))
    await waitFor(() => {
      const cabs = useRackStore.getState().cabinets
      expect(cabs.filter((c) => [1, 2, 4].includes(c.id)).every((c) => c.power_limit === 9000)).toBe(true)
      expect(cabs.find((c) => c.id === 3)!.power_limit).toBe(6000)
    })
  })

  it('ED-2 批量改类型 → 同类柜类型更新且矩阵格子联动', async () => {
    const { container } = await renderRoom()
    rightClickPos(container, 'A1')
    fireEvent.click(screen.getByText('全选同类机柜'))
    const dialog = await screen.findByRole('dialog')
    const select = within(dialog).getAllByRole('combobox')[0]
    fireEvent.change(select, { target: { value: 'storage' } })
    fireEvent.click(within(dialog).getByText('确认批量更新'))
    await waitFor(() => {
      const cabs = useRackStore.getState().cabinets
      expect(cabs.filter((c) => [1, 2, 4].includes(c.id)).every((c) => c.type === 'storage')).toBe(true)
      const cells = useRoomStore.getState().matrix!.cells
      expect(cells.find((c) => c.cabinetId === 1)!.type).toBe('storage')
      expect(cells.find((c) => c.cabinetId === 3)!.type).toBe('network')
    })
  })
})

describe('RoomEditing（M4/AL-ED3 框选批量操作）', () => {
  it('ED-3 Ctrl+点击多选 → 工具条出现 + 批量改格子弹窗', async () => {
    const { container } = await renderRoom()
    fireEvent.click(container.querySelector('g[data-pos="B2"]')!, { ctrlKey: true })
    fireEvent.click(container.querySelector('g[data-pos="B3"]')!, { ctrlKey: true })
    expect(useRoomStore.getState().multiSelected).toEqual(['B2', 'B3'])
    expect(screen.getByText('已选 2 格')).toBeInTheDocument()
    fireEvent.click(screen.getByText('批量改格子'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/批量更新格子/)).toBeInTheDocument()
  })

  it('ED-3 拖拽框选 → 选中矩形内格子', async () => {
    const { container } = await renderRoom()
    const svg = container.querySelector('svg.select-none')!
    fireEvent.mouseDown(svg, { clientX: 35, clientY: 25, button: 0 })
    fireEvent.mouseMove(svg, { clientX: 100, clientY: 70 })
    fireEvent.mouseUp(svg)
    expect(useRoomStore.getState().multiSelected).toEqual(['A1'])
  })

  it('ED-3 框选批量改格子类型 → 全部生效', async () => {
    const { container } = await renderRoom()
    const svg = container.querySelector('svg.select-none')!
    fireEvent.mouseDown(svg, { clientX: 35, clientY: 25, button: 0 })
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 200 })
    fireEvent.mouseUp(svg)
    fireEvent.click(screen.getByText('批量改格子'))
    const dialog = await screen.findByRole('dialog')
    const select = within(dialog).getAllByRole('combobox')[0]
    fireEvent.change(select, { target: { value: 'gpu' } })
    fireEvent.click(within(dialog).getByText('确认批量更新'))
    await waitFor(() => {
      const cells = useRoomStore.getState().matrix!.cells
      const target = cells.filter((c) => ['A1', 'A2', 'A3', 'B1'].includes(`${c.row}${c.col}`))
      expect(target.every((c) => c.type === 'gpu')).toBe(true)
    })
  })
})

describe('RoomDesignTab（M4/AL-N3 导出收敛）', () => {
  it('E-1 机房设计子视图无「导出机房设计 Excel」按钮（导出统一到「本项目输出」）', async () => {
    await renderRoom()
    expect(screen.queryByText(/导出机房设计/)).not.toBeInTheDocument()
  })
})

describe('RoomEditing（M6/AL-ED7 批量二次确认 + 冲突明细）', () => {
  it('ED-7 批量「清空」需二次确认（统一文案：再次点击确认清空）', async () => {
    const { container } = await renderRoom()
    fireEvent.click(container.querySelector('g[data-pos="A1"]')!, { ctrlKey: true })
    fireEvent.click(screen.getByText('批量改格子'))
    const dialog = await screen.findByRole('dialog')
    // 第一次点击 → 进入确认态（不落库）
    fireEvent.click(within(dialog).getByText('清空'))
    expect(within(dialog).getByText('再次点击确认清空')).toBeInTheDocument()
    expect(useRackStore.getState().cabinets).toHaveLength(4)
    // 第二次点击 → 执行清空（机柜保留未上架）
    fireEvent.click(within(dialog).getByText('再次点击确认清空'))
    await waitFor(() => {
      const cell = useRoomStore.getState().matrix!.cells.find((c) => `${c.row}${c.col}` === 'A1')!
      expect(cell).toMatchObject({ type: 'empty', cabinetId: null })
      expect(useRackStore.getState().cabinets).toHaveLength(4)
    })
  })

  it('ED-7 批量「删除」需二次确认（统一文案：再次点击确认删除）', async () => {
    const { container } = await renderRoom()
    fireEvent.click(container.querySelector('g[data-pos="A1"]')!, { ctrlKey: true })
    fireEvent.click(screen.getByText('批量改格子'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText('删除'))
    expect(within(dialog).getByText('再次点击确认删除')).toBeInTheDocument()
    expect(useRackStore.getState().cabinets).toHaveLength(4)
    fireEvent.click(within(dialog).getByText('再次点击确认删除'))
    await waitFor(() => {
      const cell = useRoomStore.getState().matrix!.cells.find((c) => `${c.row}${c.col}` === 'A1')!
      expect(cell.cabinetId).toBeNull()
      expect(useRackStore.getState().cabinets).toHaveLength(3)
    })
  })

  it('ED-7 同类批量改功率：冲突柜逐条展示原因且不静默跳过、合规柜落库', async () => {
    mockGetFile(makeMatrix())
    useRackStore.setState({
      cabinets: [
        makeCabinet(1, { type: 'gpu', power_limit: 6000, devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 5000 }] }),
        makeCabinet(2, { type: 'gpu' }),
        makeCabinet(3, { type: 'network' }),
        makeCabinet(4, { type: 'gpu' }),
      ],
      unplacedDevices: [],
    })
    const { container } = render(
      <ProjectProvider>
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )
    await screen.findByText('机房 A')
    rightClickPos(container, 'A1')
    fireEvent.click(screen.getByText('全选同类机柜'))
    const dialog = await screen.findByRole('dialog')
    const spinbuttons = within(dialog).getAllByRole('spinbutton')
    fireEvent.change(spinbuttons[1], { target: { value: '3000' } }) // 功率上限 → 3000
    fireEvent.click(within(dialog).getByText('确认批量更新'))
    // 冲突明细展示：2 台生效、1 台冲突跳过并逐条原因（不静默跳过）
    await waitFor(() => expect(within(dialog).getByText(/已更新 2 台/)).toBeInTheDocument())
    expect(within(dialog).getByText(/机柜 1 功率 5000W 超过新上限 3000W/)).toBeInTheDocument()
    // 合规柜落库、冲突柜不落库
    expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.power_limit).toBe(6000)
    expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.power_limit).toBe(3000)
    expect(useRackStore.getState().cabinets.find((c) => c.id === 4)!.power_limit).toBe(3000)
  })
})
