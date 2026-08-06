/**
 * V3.1.4-T8-2: 机房智能落位向导测试（模式切换/计算方案/评分展示/应用方案）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RoomOptimizeModal } from '@/components/datacenter/RoomOptimizeModal'
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

const mockOptimize = vi.fn()

const RESULT = {
  success: true,
  placements: [
    { position: 'A1', type: 'gpu', cabinetId: null, powerWatts: 0 },
    { position: 'A2', type: 'storage', cabinetId: null, powerWatts: 0 },
  ],
  scores: { power_balance: 0.9, thermal_zones: 0.8, network_locality: 0.7, shortest_cable: 0.6, total: 0.75 },
  issues: ['未放置：compute（1）'],
  stats: { total_items: 2, placed: 2, unplaced: 0, elapsed_ms: 15 },
}

beforeEach(() => {
  useRoomStore.setState({ matrix: makeMatrix(), selectedPosition: null })
  useRackStore.setState({ cabinets: [makeCabinet(), makeCabinet({ id: 2, name: '机柜 2' })] })
  useToastStore.setState({ toasts: [] })
  mockOptimize.mockReset()
  mockOptimize.mockResolvedValue(RESULT)
  ;(window as unknown as { electron: { room: { optimize: typeof mockOptimize } } }).electron.room.optimize = mockOptimize
})

describe('RoomOptimizeModal', () => {
  it('默认按机柜模式，显示未上架机柜数', () => {
    render(<RoomOptimizeModal open onClose={vi.fn()} />)
    expect(screen.getByText('机房智能落位')).toBeInTheDocument()
    expect(screen.getByText(/将 2 个未上架机柜自动填入空格/)).toBeInTheDocument()
  })

  it('按数量落位：填写数量 → 计算 → 展示评分与未放置', async () => {
    render(<RoomOptimizeModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('按数量落位'))
    fireEvent.change(screen.getByLabelText(/GPU 柜/), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/存储柜/), { target: { value: '1' } })
    fireEvent.click(screen.getByText('计算落位方案'))
    expect(await screen.findByText(/已落位/)).toBeInTheDocument()
    expect(mockOptimize).toHaveBeenCalledWith({
      matrix: makeMatrix(),
      counts: { gpu: 1, storage: 1 },
    })
    // 评分展示
    expect(screen.getByText('功率均衡')).toBeInTheDocument()
    expect(screen.getByText('综合评分')).toBeInTheDocument()
    expect(screen.getByText(/75%/)).toBeInTheDocument()
    // issues
    expect(screen.getByText(/未放置：compute/)).toBeInTheDocument()
  })

  it('应用方案 → 更新矩阵并关闭弹窗', async () => {
    const onClose = vi.fn()
    render(<RoomOptimizeModal open onClose={onClose} />)
    fireEvent.click(screen.getByText('按数量落位'))
    fireEvent.change(screen.getByLabelText(/GPU 柜/), { target: { value: '1' } })
    fireEvent.click(screen.getByText('计算落位方案'))
    fireEvent.click(await screen.findByText('应用方案'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const cells = useRoomStore.getState().matrix!.cells
    expect(cells[0].type).toBe('gpu')      // counts 模式类型标记
    expect(cells[1].type).toBe('storage')
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('已应用落位方案'))).toBe(true)
  })

  it('按机柜落位：仅提交未上架机柜', async () => {
    const m = makeMatrix()
    m.cells[0].cabinetId = 2   // 机柜 2 已上架
    useRoomStore.setState({ matrix: m })
    render(<RoomOptimizeModal open onClose={vi.fn()} />)
    expect(screen.getByText(/将 1 个未上架机柜自动填入空格/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('计算落位方案'))
    expect(await screen.findByText(/已落位/)).toBeInTheDocument()
    expect(mockOptimize).toHaveBeenCalledWith({
      matrix: m,
      cabinets: [{ id: 1, type: 'gpu', power_watts: 0 }],
      resetExisting: false,
    })
  })

  it('后端失败 → 无结果且不显示应用按钮', async () => {
    mockOptimize.mockResolvedValue({
      success: false, error: '矩阵解析失败', placements: [], scores: {}, issues: ['矩阵解析失败'],
      stats: { total_items: 0, placed: 0, unplaced: 0, elapsed_ms: null },
    })
    render(<RoomOptimizeModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('按数量落位'))
    fireEvent.change(screen.getByLabelText(/GPU 柜/), { target: { value: '1' } })
    fireEvent.click(screen.getByText('计算落位方案'))
    await waitFor(() => expect(screen.queryByText('应用方案')).not.toBeInTheDocument())
    expect(useToastStore.getState().toasts.some((t) => t.message === '矩阵解析失败')).toBe(true)
  })
})
