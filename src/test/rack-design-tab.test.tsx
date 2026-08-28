/**
 * M2（AL-D2/D3）：机柜设计独立子视图测试（RackDesignTab）
 * - 定稿门槛：未定稿显示引导（"请先完成机房设计并定稿"），不进入机柜设计
 * - 已定稿 → 渲染机柜设计工具栏（导出机柜设计 Excel / 归档 占位，M7 接入）与 RackTab
 * - RackTab 上架/移动/功率/批量模板 + isometric 等距立体保留（视图切换器存在）
 * - M5（AL-ED4/ED6）：柜内机柜信息调整（Modal 保存/冲突阻塞/右键菜单）与同柜批量更新（多选/属性/偏移）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RackDesignTab } from '@/components/workspace/tabs/RackDesignTab'
import { RackTab } from '@/components/workspace/tabs/RackTab'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'

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

/** M3（AL-D3b）：带已上架机柜的矩阵——A1↔柜1、B2↔柜2，供双向联动/回写测试 */
const makeMatrixWithCabinet = (finalized = false): RoomMatrixData => {
  const m = makeMatrix(finalized)
  m.cells = m.cells.map((c) => {
    if (c.row === 'A' && c.col === 1) return { ...c, type: 'gpu', cabinetId: 1 }
    if (c.row === 'B' && c.col === 2) return { ...c, type: 'gpu', cabinetId: 2 }
    return c
  })
  return m
}

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
  useRoomStore.setState({ matrix: null, selectedPosition: null, markTool: 'select' })
  useRackStore.setState({ cabinets: [], unplacedDevices: [], selectedCabinetId: null })
  useToastStore.setState({ toasts: [] })
  mockGetFile(null)
})

describe('RackDesignTab', () => {
  it('无矩阵 → 显示定稿门槛引导，不进入机柜设计', async () => {
    render(<RackDesignTab projectName="p1" />)
    expect(await screen.findByText(/请先完成机房设计并定稿/)).toBeInTheDocument()
    expect(screen.queryByText(/导出机柜设计/)).not.toBeInTheDocument()
  })

  it('未定稿 → 显示定稿门槛引导，不显示机柜设计工具栏', async () => {
    mockGetFile(makeMatrix(false))
    render(<RackDesignTab projectName="p1" />)
    expect(await screen.findByText(/请先完成机房设计并定稿/)).toBeInTheDocument()
    expect(screen.queryByText(/导出机柜设计/)).not.toBeInTheDocument()
  })

  it('已定稿 → 渲染机柜设计工具栏（导出机柜设计 Excel / 归档 占位）与 RackTab（isometric 保留）', async () => {
    mockGetFile(makeMatrix(true))
    useRackStore.setState({ cabinets: [makeCabinet()], unplacedDevices: [], selectedCabinetId: 1 })
    render(<RackDesignTab projectName="p1" />)
    expect(await screen.findByText(/导出机柜设计/)).toBeInTheDocument()
    expect(screen.getByText(/归档/)).toBeInTheDocument()
    // RackTab 已挂载：机柜选择器含机柜名 + isometric 视图切换按钮存在
    expect(screen.getByText(/机柜 1/)).toBeInTheDocument()
    expect(screen.getByText('3D 等距')).toBeInTheDocument()
  })

  it('已定稿 → 点「撤销定稿」回到门槛引导（定稿状态可回退）', async () => {
    mockGetFile(makeMatrix(true))
    useRackStore.setState({ cabinets: [makeCabinet()], unplacedDevices: [], selectedCabinetId: 1 })
    render(<RackDesignTab projectName="p1" />)
    fireEvent.click(await screen.findByText(/撤销定稿/))
    await waitFor(() => expect(useRoomStore.getState().matrix?.finalized).toBe(false))
    expect(screen.getByText(/请先完成机房设计并定稿/)).toBeInTheDocument()
  })

  it('M3 选中柜 → 机房设计矩阵格高亮（selectedPosition 同步，柜→格联动）', async () => {
    mockGetFile(makeMatrixWithCabinet(true))
    useRackStore.setState({
      cabinets: [makeCabinet(), makeCabinet({ id: 2, name: '机柜 2' })],
      unplacedDevices: [],
      selectedCabinetId: 1,
    })
    render(<RackDesignTab projectName="p1" />)
    // 初始选中柜 1 → A1 格高亮
    await waitFor(() => expect(useRoomStore.getState().selectedPosition).toBe('A1'))
    // 切到柜 2 → B2 格高亮
    useRackStore.getState().selectCabinet(2)
    await waitFor(() => expect(useRoomStore.getState().selectedPosition).toBe('B2'))
  })

  it('M3 改柜类型 → 回写矩阵格类型（改类型回写）', async () => {
    mockGetFile(makeMatrixWithCabinet(true))
    useRackStore.setState({ cabinets: [makeCabinet()], unplacedDevices: [], selectedCabinetId: 1 })
    render(<RackDesignTab projectName="p1" />)
    const cell = () => useRoomStore.getState().matrix?.cells.find((c) => c.cabinetId === 1)
    await waitFor(() => expect(cell()?.type).toBe('gpu'))
    useRackStore.getState().updateCabinet(1, { type: 'network' })
    await waitFor(() => expect(cell()?.type).toBe('network'))
  })

  // ===== M5（AL-ED4/ED6）：柜内编辑能力（机柜信息调整 + 同柜批量更新） =====

  it('M5 ED-4 机柜信息调整：点击「机柜信息」打开 Modal，改名称保存生效', async () => {
    mockGetFile(makeMatrixWithCabinet(true))
    useRackStore.setState({ cabinets: [makeCabinet()], unplacedDevices: [], selectedCabinetId: 1 })
    render(<RackDesignTab projectName="p1" />)
    fireEvent.click(await screen.findByText('机柜信息'))
    const nameInput = await screen.findByLabelText('机柜名称')
    fireEvent.change(nameInput, { target: { value: '新柜名' } })
    fireEvent.click(screen.getByLabelText('保存机柜信息'))
    await waitFor(() => expect(useRackStore.getState().cabinets[0].name).toBe('新柜名'))
  })

  it('M5 ED-4 机柜信息调整：改矮总U有设备溢出 → 冲突阻塞不落库并提示', async () => {
    mockGetFile(makeMatrixWithCabinet(true))
    useRackStore.setState({
      cabinets: [makeCabinet({ devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 40, power_watts: 1000 }] })],
      unplacedDevices: [],
      selectedCabinetId: 1,
    })
    render(<RackDesignTab projectName="p1" />)
    fireEvent.click(await screen.findByText('机柜信息'))
    const totalUInput = await screen.findByLabelText('总U高度')
    fireEvent.change(totalUInput, { target: { value: '30' } })
    fireEvent.click(screen.getByLabelText('保存机柜信息'))
    await waitFor(() => expect(screen.getByText(/超过新高度/)).toBeInTheDocument())
    expect(useRackStore.getState().cabinets[0].totalU).toBe(42)
  })

  it('M5 ED-4 机柜信息调整：Header 右键 → 出现机柜信息调整菜单', async () => {
    mockGetFile(makeMatrixWithCabinet(true))
    useRackStore.setState({ cabinets: [makeCabinet()], unplacedDevices: [], selectedCabinetId: 1 })
    render(<RackDesignTab projectName="p1" />)
    const header = await screen.findByTitle(/右键/)
    fireEvent.contextMenu(header, { clientX: 100, clientY: 100 })
    expect(await screen.findByText('机柜信息调整')).toBeInTheDocument()
  })

  it('M5 ED-6 同柜批量：进入批量模式多选设备并批量改名生效（M6 二次确认）', async () => {
    mockGetFile(makeMatrixWithCabinet(true))
    useRackStore.setState({
      cabinets: [makeCabinet({ devices: [
        { id: 'a', name: '设备A', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 1000 },
        { id: 'b', name: '设备B', type: 'GPU Server', cabinetId: 1, startU: 9, endU: 16, power_watts: 1000 },
      ] })],
      unplacedDevices: [],
      selectedCabinetId: 1,
    })
    render(<RackDesignTab projectName="p1" />)
    fireEvent.click(await screen.findByText('批量编辑'))
    fireEvent.click(screen.getAllByTitle(/设备A/)[0])
    fireEvent.click(screen.getAllByTitle(/设备B/)[0])
    expect(await screen.findByText(/已选 2 台设备/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('批量名称'), { target: { value: '统一名' } })
    fireEvent.click(screen.getByText('应用属性'))
    // M6（AL-ED7）：批量操作二次确认
    expect(await screen.findByText(/确认对 2 台设备批量修改属性/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => {
      const ds = useRackStore.getState().cabinets[0].devices
      expect(ds.every((d) => d.name === '统一名')).toBe(true)
    })
  })

  it('M5 ED-6 同柜批量 U 偏移：越界整批拒绝不落库（M6 二次确认）', async () => {
    mockGetFile(makeMatrixWithCabinet(true))
    useRackStore.setState({
      topReservedU: 2,
      cabinets: [makeCabinet({ devices: [
        { id: 'a', name: '设备A', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 1000 },
        { id: 'b', name: '设备B', type: 'GPU Server', cabinetId: 1, startU: 35, endU: 42, power_watts: 1000 },
      ] })],
      unplacedDevices: [],
      selectedCabinetId: 1,
    })
    render(<RackDesignTab projectName="p1" />)
    fireEvent.click(await screen.findByText('批量编辑'))
    fireEvent.click(screen.getAllByTitle(/设备A/)[0])
    fireEvent.click(screen.getAllByTitle(/设备B/)[0])
    fireEvent.click(screen.getByText('上移1U'))
    // M6（AL-ED7）：批量操作二次确认
    expect(await screen.findByText(/确认对 2 台设备执行 U 位偏移/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    // 整批拒绝：a、b 均未落库，且 toast 含「越界」提示
    await waitFor(() => {
      const ds = useRackStore.getState().cabinets[0].devices
      expect(ds.find((d) => d.id === 'a')).toMatchObject({ startU: 1, endU: 8 })
      expect(ds.find((d) => d.id === 'b')).toMatchObject({ startU: 35, endU: 42 })
    })
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('越界'))).toBe(true)
  })

  // ===== M6（AL-ED8）：机柜类型变更 → 矩阵格类型/配色同步（RackTab 独立渲染也回写） =====

  it('M6 ED-8 RackTab 类型下拉变更 → 直接回写矩阵格类型（独立于 RackDesignTab 联动 effect）', async () => {
    mockGetFile(makeMatrixWithCabinet(true))
    useRoomStore.setState({ matrix: makeMatrixWithCabinet(true) })
    useRackStore.setState({ cabinets: [makeCabinet()], unplacedDevices: [], selectedCabinetId: 1 })
    render(<RackTab cabinetId={1} />)
    const typeSelect = await screen.findByLabelText('机柜类型')
    fireEvent.change(typeSelect, { target: { value: 'storage' } })
    await waitFor(() => {
      expect(useRackStore.getState().cabinets[0].type).toBe('storage')
      expect(useRoomStore.getState().matrix?.cells.find((c) => c.cabinetId === 1)?.type).toBe('storage')
    })
  })
})
