/**
 * M2（AL-D2/D3）：机柜设计独立子视图测试（RackDesignTab）
 * - 定稿门槛：未定稿显示引导（"请先完成机房设计并定稿"），不进入机柜设计
 * - 已定稿 → 渲染机柜设计工具栏（导出机柜设计 Excel / 归档 占位，M7 接入）与 RackTab
 * - RackTab 上架/移动/功率/批量模板 + isometric 等距立体保留（视图切换器存在）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RackDesignTab } from '@/components/workspace/tabs/RackDesignTab'
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
})
