import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ensureMatrixRacks } from '@/utils/ensureMatrixRacks'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackTopologyNode } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'

const makeMatrix = (): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: ['A'],
  cols: [1, 2],
  cells: [
    { row: 'A', col: 1, type: 'gpu', placeholder: null, cabinetId: null },
    { row: 'A', col: 2, type: 'network', placeholder: null, cabinetId: null },
  ],
})

const nodes: RackTopologyNode[] = [
  { id: 'GPU服务器_1', type: 'server', group: 'GPU服务器组1', podid: 'pod-1', uHeight: 8, powerWatts: 1000 },
  { id: 'param_leaf_1', type: 'param_leaf', group: '参数Leaf组1', podid: 'pod-1', uHeight: 1, powerWatts: 300 },
]

describe('ensureMatrixRacks', () => {
  beforeEach(() => {
    useRoomStore.setState({ matrix: null, selectedPosition: null })
    useRackStore.setState({
      cabinets: [],
      unplacedDevices: [],
      selectedCabinetId: null,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
    })
    useToastStore.setState({ toasts: [] })
    vi.clearAllMocks()
    window.electron.project.getFile = vi.fn().mockResolvedValue(null)
    window.electron.project.saveFile = vi.fn().mockResolvedValue(true)
    window.electron.room.validateLayout = vi.fn().mockResolvedValue({ valid: true, errors: [] })
  })

  it('store 有矩阵 → 矩阵落位：建柜 + 写格子 + 双文件持久化', async () => {
    useRoomStore.setState({ matrix: makeMatrix() })
    const saveFile = window.electron.project.saveFile as unknown as ReturnType<typeof vi.fn>
    const res = await ensureMatrixRacks('P', nodes)

    expect(res.usedMatrix).toBe(true)
    const racks = useRackStore.getState().cabinets
    expect(racks.length).toBeGreaterThan(0)
    expect(useRoomStore.getState().matrix!.cells.some((c) => c.cabinetId != null)).toBe(true)
    const saved = saveFile.mock.calls.map((c) => c[1] as string)
    expect(saved).toContain('rack_layout.json')
    expect(saved).toContain('room_layout.json')
  })

  it('store 无矩阵但文件有 → loadMatrix 兜底后走矩阵路径', async () => {
    window.electron.project.getFile = vi.fn().mockImplementation(
      async (_proj: string, file: string) => (file === 'room_layout.json' ? JSON.stringify(makeMatrix()) : null),
    )
    const res = await ensureMatrixRacks('P', nodes)
    expect(res.usedMatrix).toBe(true)
    expect(useRackStore.getState().cabinets.length).toBeGreaterThan(0)
  })

  it('无矩阵无文件 → initFromTopology 回退（usedMatrix:false）', async () => {
    const res = await ensureMatrixRacks('P', nodes)
    expect(res.usedMatrix).toBe(false)
    // 回退路径仍初始化机柜（无 cabinetId 的服务器进待上架池）
    expect(useRackStore.getState().unplacedDevices.length).toBeGreaterThan(0)
  })
})
