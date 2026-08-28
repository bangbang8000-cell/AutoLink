import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRackStore, toCabinetType, validateCabinetPatch, findFirstAvailableU, checkDeviceMove } from '../stores/rack.store'
import type { RackCabinet, RackDevice, CabinetType, UnplacedDevice } from '../stores/rack.store'

// Mock electron API
const mockElectron = {
  project: {
    getFile: vi.fn(),
    saveConfigFile: vi.fn(),
  },
  export: {
    saveFile: vi.fn(),
  },
}

// @ts-expect-error - mock window.electron
window.electron = mockElectron

describe('RackStore', () => {
  beforeEach(() => {
    useRackStore.setState({
      cabinets: [],
      unplacedDevices: [],
      selectedCabinetId: null,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
    })
    vi.clearAllMocks()
  })

  describe('initDefault', () => {
    it('应该初始化默认机柜', () => {
      useRackStore.getState().initDefault(100, 42, 8000)

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBeGreaterThan(0)
      state.cabinets.forEach((cab: RackCabinet) => {
        expect(cab.totalU).toBe(42)
        expect(cab.power_limit).toBe(8000)
      })
    })

    it('应该使用49U机柜类型', () => {
      useRackStore.getState().initDefault(100, 49, 12000)

      const state = useRackStore.getState()
      state.cabinets.forEach((cab: RackCabinet) => {
        expect(cab.totalU).toBe(49)
        expect(cab.power_limit).toBe(12000)
      })
    })

    it('服务器数量为0时不应创建机柜', () => {
      useRackStore.getState().initDefault(0, 42, 8000)

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBe(0)
    })

    it('应该使用默认功率上限', () => {
      useRackStore.getState().initDefault(10, 42)

      const state = useRackStore.getState()
      state.cabinets.forEach((cab: RackCabinet) => {
        expect(cab.power_limit).toBe(6000) // 默认值
      })
    })
  })

  describe('initFromTopology', () => {
    it('应优先采用后端分配的机柜信息并按类型分类', () => {
      const topoNodes = [
        { id: 'GPU服务器_1', type: 'server', group: 'GPU服务器组1', podid: 'pod-gpu-1',
          cabinetId: 1, cabinetName: '机柜1', startU: 1, endU: 8, powerWatts: 10200, uHeight: 8 },
        { id: 'GPU服务器_2', type: 'server', group: 'GPU服务器组1', podid: 'pod-gpu-1',
          cabinetId: 2, cabinetName: '机柜2', startU: 1, endU: 8, powerWatts: 10200, uHeight: 8 },
        { id: '通算服务器_1', type: 'server', group: '通算服务器组', podid: 'pod-general',
          cabinetId: 3, cabinetName: '机柜3', startU: 1, endU: 2, powerWatts: 800, uHeight: 2 },
        { id: '参数Leaf_G1_1', type: 'param_leaf', group: '参数Leaf组1', podid: 'pod-gpu-1',
          cabinetId: 4, cabinetName: '机柜4', startU: 1, endU: 1, powerWatts: 200, uHeight: 1 },
      ]

      useRackStore.getState().initFromTopology(topoNodes, 42, 12000)

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBe(4)
      expect(state.cabinets[0].type).toBe('gpu')
      expect(state.cabinets[2].type).toBe('compute')
      expect(state.cabinets[3].type).toBe('network')
      expect(state.cabinets[0].devices.length).toBe(1)
      expect(state.cabinets[0].devices[0].startU).toBe(1)
      expect(state.unplacedDevices.length).toBe(4)
    })

    it('无 cabinetId 的旧数据节点应进入待分配池', () => {
      const topoNodes = [
        { id: 'GPU服务器_1', type: 'server', group: 'GPU服务器组1', podid: 'pod-gpu-1' },
        { id: 'GPU服务器_2', type: 'server', group: 'GPU服务器组1', podid: 'pod-gpu-1' },
      ]

      useRackStore.getState().initFromTopology(topoNodes, 42, 8000)

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBe(0)
      expect(state.unplacedDevices.length).toBe(2)
    })

    it('空拓扑数据应置为空状态（不虚构机柜）', () => {
      useRackStore.getState().initFromTopology([], 42, 8000)

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBe(0)
      expect(state.unplacedDevices.length).toBe(0)
    })

    it('仅交换机且无 cabinetId 的拓扑应置为空状态', () => {
      const topoNodes = [
        { id: '参数Leaf_G1_1', type: 'param_leaf', group: '参数Leaf组1', podid: 'pod-gpu-1' },
      ]

      useRackStore.getState().initFromTopology(topoNodes, 42, 8000)

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBe(0)
      expect(state.unplacedDevices.length).toBe(0)
    })
  })

  describe('toCabinetType', () => {
    it('服务器按 group 分类为 gpu/storage/compute', () => {
      expect(toCabinetType({ type: 'server', group: 'GPU服务器组1' })).toBe('gpu')
      expect(toCabinetType({ type: 'server', group: '存储服务器组' })).toBe('storage')
      expect(toCabinetType({ type: 'server', group: '通算服务器组' })).toBe('compute')
      expect(toCabinetType({ type: 'param_leaf', group: '参数Leaf组' })).toBe('network')
      expect(toCabinetType({ type: 'oob_access', group: 'OOB接入组' })).toBe('network')
    })
  })

  describe('selectCabinet', () => {
    it('应该选中机柜', () => {
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [] }],
      })

      useRackStore.getState().selectCabinet(1)
      expect(useRackStore.getState().selectedCabinetId).toBe(1)
    })

    it('设置为null应取消选中', () => {
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [] }],
        selectedCabinetId: 1,
      })

      useRackStore.getState().selectCabinet(null)
      expect(useRackStore.getState().selectedCabinetId).toBeNull()
    })
  })

  describe('addCabinet', () => {
    it('应该添加新机柜', () => {
      useRackStore.getState().addCabinet(42, 'gpu', 8000)

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBe(1)
      expect(state.cabinets[0].totalU).toBe(42)
      expect(state.cabinets[0].power_limit).toBe(8000)
    })

    it('连续添加机柜应自动分配ID', () => {
      useRackStore.getState().addCabinet(42, 'gpu', 8000)
      useRackStore.getState().addCabinet(49, 'storage', 12000)

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBe(2)
      expect(state.cabinets[0].id).toBe(1)
      expect(state.cabinets[1].id).toBe(2)
    })
  })

  describe('removeCabinet', () => {
    it('应该移除机柜', () => {
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [] }],
        selectedCabinetId: 1,
      })

      useRackStore.getState().removeCabinet(1)
      expect(useRackStore.getState().cabinets.length).toBe(0)
      expect(useRackStore.getState().selectedCabinetId).toBeNull()
    })
  })

  describe('placeDevice', () => {
    it('应该放置设备到机柜', () => {
      const device = { id: 'dev-1', name: 'GPU服务器_1', type: 'GPU Server', height: 4, power_watts: 2000 }
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [] }],
        unplacedDevices: [device],
      })

      const result = useRackStore.getState().placeDevice(1, device, 1)
      expect(result).toBe(true)
      expect(useRackStore.getState().cabinets[0].devices.length).toBe(1)
      expect(useRackStore.getState().unplacedDevices.length).toBe(0)
    })

    it('超出U位应返回false', () => {
      const device = { id: 'dev-1', name: 'GPU服务器_1', type: 'GPU Server', height: 50, power_watts: 2000 }
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [] }],
        unplacedDevices: [device],
      })

      const result = useRackStore.getState().placeDevice(1, device, 40)
      expect(result).toBe(false)
    })

    it('超出功率上限应返回false', () => {
      const device = { id: 'dev-1', name: 'GPU服务器_1', type: 'GPU Server', height: 4, power_watts: 10000 }
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [] }],
        unplacedDevices: [device],
      })

      const result = useRackStore.getState().placeDevice(1, device, 1)
      expect(result).toBe(false)
    })

    it('U位冲突应返回false', () => {
      const existingDevice: RackDevice = { id: 'existing', name: 's1', type: 'server', cabinetId: 1, startU: 1, endU: 4, power_watts: 2000 }
      const device = { id: 'dev-1', name: 'GPU服务器_1', type: 'GPU Server', height: 4, power_watts: 2000 }
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [existingDevice] }],
        unplacedDevices: [device],
      })

      const result = useRackStore.getState().placeDevice(1, device, 2)
      expect(result).toBe(false)
    })
  })

  describe('removeDevice', () => {
    it('应该移除设备', () => {
      const device: RackDevice = { id: 'dev-1', name: 'GPU服务器_1', type: 'server', cabinetId: 1, startU: 1, endU: 8, power_watts: 10000 }
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [device] }],
        selectedCabinetId: 1,
      })

      useRackStore.getState().removeDevice(1, 'dev-1')
      expect(useRackStore.getState().cabinets[0].devices.length).toBe(0)
    })

    it('移除不存在的设备不应报错', () => {
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [] }],
        selectedCabinetId: 1,
      })

      expect(() => useRackStore.getState().removeDevice(1, 'nonexistent')).not.toThrow()
    })
  })

  describe('getPowerUsage', () => {
    it('应计算功率使用情况', () => {
      const devices: RackDevice[] = [
        { id: 'd1', name: 's1', type: 'server', cabinetId: 1, startU: 1, endU: 8, power_watts: 5000 },
        { id: 'd2', name: 's2', type: 'server', cabinetId: 1, startU: 9, endU: 16, power_watts: 3000 },
      ]
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices }],
      })

      const usage = useRackStore.getState().getPowerUsage(1)
      expect(usage.used).toBe(8000)
      expect(usage.limit).toBe(8000)
      expect(usage.percent).toBe(100)
      expect(usage.exceeded).toBe(false)
    })

    it('不存在的机柜应返回0', () => {
      const usage = useRackStore.getState().getPowerUsage(999)
      expect(usage.used).toBe(0)
      expect(usage.limit).toBe(0)
    })

    it('功率超标应返回exceeded=true', () => {
      const devices: RackDevice[] = [
        { id: 'd1', name: 's1', type: 'server', cabinetId: 1, startU: 1, endU: 8, power_watts: 10000 },
      ]
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices }],
      })

      const usage = useRackStore.getState().getPowerUsage(1)
      expect(usage.exceeded).toBe(true)
    })

    it('功率上限为0时应返回percent=0', () => {
      const devices: RackDevice[] = [
        { id: 'd1', name: 's1', type: 'server', cabinetId: 1, startU: 1, endU: 8, power_watts: 4000 },
      ]
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 0, devices }],
      })

      const usage = useRackStore.getState().getPowerUsage(1)
      expect(usage.percent).toBe(0)
    })
  })

  describe('getPowerUsageAll', () => {
    it('应计算所有机柜的总功率', () => {
      const devices: RackDevice[] = [
        { id: 'd1', name: 's1', type: 'server', cabinetId: 1, startU: 1, endU: 8, power_watts: 5000 },
      ]
      useRackStore.setState({
        cabinets: [
          { id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices },
          { id: 2, name: 'A02', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices: [] },
        ],
      })

      const all = useRackStore.getState().getPowerUsageAll()
      expect(all.total).toBe(5000)
      expect(all.limit).toBe(16000)
      expect(all.percent).toBe(31) // floor(5000/16000*100)
    })
  })

  describe('exportToExcel', () => {
    it('应该导出Excel', async () => {
      mockElectron.export.saveFile.mockResolvedValue('test.xlsx')

      const devices: RackDevice[] = [
        { id: 'd1', name: 'GPU服务器_1', type: 'server', cabinetId: 1, startU: 1, endU: 8, power_watts: 10000 },
      ]
      useRackStore.setState({
        cabinets: [{ id: 1, name: 'A01', totalU: 42, type: 'gpu' as CabinetType, power_limit: 8000, devices }],
      })

      const filePath = await useRackStore.getState().exportToExcel('test-project')
      expect(filePath).toBe('test.xlsx')
      expect(mockElectron.export.saveFile).toHaveBeenCalled()
    })
  })

  describe('importCabinetList', () => {
    it('应该导入CSV机柜列表', () => {
      const csvData = 'A01,42,gpu,8000\nA02,49,storage,12000\n'

      useRackStore.getState().importCabinetList(csvData)

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBe(2)
      expect(state.cabinets[0].name).toBe('A01')
      expect(state.cabinets[0].totalU).toBe(42)
      expect(state.cabinets[0].type).toBe('gpu')
      expect(state.cabinets[0].power_limit).toBe(8000)
      expect(state.cabinets[1].name).toBe('A02')
      expect(state.cabinets[1].totalU).toBe(49)
    })

    it('空CSV不应创建机柜', () => {
      useRackStore.getState().importCabinetList('')

      const state = useRackStore.getState()
      expect(state.cabinets.length).toBe(0)
    })

    it('单列CSV行应跳过', () => {
      const csvData = 'A01\n'

      useRackStore.getState().importCabinetList(csvData)

      const state = useRackStore.getState()
      // 单列不够2列，被跳过
      expect(state.cabinets.length).toBe(0)
    })
  })

  // ===== 打磨轮（v1.4 / AL-R2c）: 整表替换机柜布局 =====

  describe('setRacks', () => {
    it('整表替换 cabinets/unplacedDevices/selectedCabinetId 并清选中/编辑态', () => {
      const cabs: RackCabinet[] = [{ id: 5, name: '机柜 A3', totalU: 42, type: 'gpu', power_limit: 6000, devices: [] }]
      const unplaced: UnplacedDevice[] = [{ id: 'gpu-9', name: 'GPU服务器_9', type: 'GPU Server', height: 8, power_watts: 1000 }]
      useRackStore.setState({
        selectedDevice: { id: 'x', name: 'x', type: 'x', cabinetId: 1, startU: 1, endU: 8, power_watts: 0 },
        addDeviceMode: true,
        editingDevice: 'x',
      })
      useRackStore.getState().setRacks(cabs, unplaced, 5)
      const s = useRackStore.getState()
      expect(s.cabinets).toEqual(cabs)
      expect(s.unplacedDevices).toEqual(unplaced)
      expect(s.selectedCabinetId).toBe(5)
      expect(s.selectedDevice).toBeNull()
      expect(s.addDeviceMode).toBe(false)
      expect(s.editingDevice).toBeNull()
    })

    it('缺省参数 → 空列表 + 空选中', () => {
      useRackStore.getState().setRacks([])
      const s = useRackStore.getState()
      expect(s.cabinets).toEqual([])
      expect(s.unplacedDevices).toEqual([])
      expect(s.selectedCabinetId).toBeNull()
    })
  })

  // ===== 打磨轮（v1.5 / AL-R1d / PRD AL-R6）：批量应用整柜模板（设备/名称/功率复制 + 冲突明细） =====

  describe('applyCabinetTemplate', () => {
    const dev = (id: string, name: string, startU: number, endU: number, power = 1000) => ({
      id, name, type: 'GPU Server', cabinetId: 0, startU, endU, power_watts: power,
    })
    const cab = (id: number, name: string, devices: ReturnType<typeof dev>[], type: 'gpu' | 'network' = 'gpu') => ({
      id, name, totalU: 42, type, power_limit: 6000,
      devices: devices.map((d) => ({ ...d, cabinetId: id })),
    })

    it('无冲突时整体复制源柜设备（名称/功率/类型）到同类柜', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', [dev('gpu-1', 'GPU服务器_1', 2, 9, 5000)]),
          cab(2, '机柜 A2', [dev('gpu-2', 'GPU服务器_2', 20, 27, 1000)]),
          cab(3, '机柜 B1', [], 'network'),
        ],
      })
      const r = useRackStore.getState().applyCabinetTemplate(1)
      expect(r.applied).toBe(1)
      expect(r.skipped).toBe(0)
      expect(r.conflicts).toEqual([])
      const target = useRackStore.getState().cabinets.find((c) => c.id === 2)!
      const copied = target.devices.find((d) => d.name === 'GPU服务器_1')!
      expect(copied).toBeDefined()
      expect(copied.power_watts).toBe(5000)
      expect(copied.type).toBe('GPU Server')
      expect(copied.startU).toBe(2)
      expect(copied.endU).toBe(9)
      expect(copied.cabinetId).toBe(2)
      // 原有设备保留
      expect(target.devices.find((d) => d.id === 'gpu-2')).toBeDefined()
      // 网络柜不受影响
      expect(useRackStore.getState().cabinets.find((c) => c.id === 3)!.devices).toHaveLength(0)
    })

    it('无冲突时复制源柜全部设备并同步 totalU/power_limit', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', [dev('gpu-1', 'GPU服务器_1', 2, 9), dev('sw-1', '交换机_1', 30, 30, 300)]),
          { id: 2, name: '机柜 A2', totalU: 42, type: 'gpu' as const, power_limit: 6000, devices: [] },
        ],
      })
      const r = useRackStore.getState().applyCabinetTemplate(1)
      expect(r.applied).toBe(2)
      expect(r.conflicts).toEqual([])
      const target = useRackStore.getState().cabinets.find((c) => c.id === 2)!
      expect(target.devices.map((d) => d.name).sort()).toEqual(['GPU服务器_1', '交换机_1'])
      expect(target.totalU).toBe(42)
      expect(target.power_limit).toBe(6000)
    })

    it('U 位被占返回冲突明细且不冲突设备照常复制', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', [dev('gpu-1', 'GPU服务器_1', 2, 9), dev('sw-1', '交换机_1', 30, 30)]),
          cab(2, '机柜 A2', [dev('gpu-2', 'GPU服务器_2', 3, 10)]),
        ],
      })
      const r = useRackStore.getState().applyCabinetTemplate(1)
      expect(r.applied).toBe(1)
      expect(r.conflicts).toEqual([
        { cabinetId: 2, deviceName: 'GPU服务器_1', startU: 2, reason: 'occupied' },
      ])
      const target = useRackStore.getState().cabinets.find((c) => c.id === 2)!
      expect(target.devices.find((d) => d.name === '交换机_1')).toBeDefined()
      expect(target.devices.find((d) => d.name === 'GPU服务器_1')).toBeUndefined()
    })

    it('目标槽位冲突则跳过（旧行为兼容）', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', [dev('gpu-1', 'GPU服务器_1', 2, 9)]),
          {
            id: 2, name: '机柜 A2', totalU: 42, type: 'gpu' as const, power_limit: 6000,
            devices: [
              { id: 'gpu-2', name: 'GPU服务器_2', type: 'GPU Server', cabinetId: 2, startU: 1, endU: 8, power_watts: 1000 },
              { id: 'sw-1', name: '交换机_1', type: 'Switch', cabinetId: 2, startU: 10, endU: 10, power_watts: 300 },
            ],
          },
        ],
      })
      const r = useRackStore.getState().applyCabinetTemplate(1)
      expect(r.applied).toBe(0)
      expect(r.skipped).toBeGreaterThan(0)
      expect(r.conflicts[0].reason).toBe('occupied')
    })

    it('柜顶预留区冲突 reason 为 top_reserved', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', [dev('gpu-1', 'GPU服务器_1', 41, 42)]),
          cab(2, '机柜 A2', []),
        ],
      })
      const r = useRackStore.getState().applyCabinetTemplate(1)
      expect(r.conflicts).toEqual([
        { cabinetId: 2, deviceName: 'GPU服务器_1', startU: 41, reason: 'top_reserved' },
      ])
      expect(r.applied).toBe(0)
    })

    it('U 位溢出柜高 reason 为 overflow', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          { id: 1, name: '机柜 A1', totalU: 42, type: 'gpu' as const, power_limit: 6000,
            devices: [dev('gpu-1', 'GPU服务器_1', 40, 43)] },
          cab(2, '机柜 A2', []),
        ],
      })
      const r = useRackStore.getState().applyCabinetTemplate(1)
      expect(r.conflicts).toEqual([
        { cabinetId: 2, deviceName: 'GPU服务器_1', startU: 40, reason: 'overflow' },
      ])
      expect(r.applied).toBe(0)
    })

    it('功率超限冲突 reason 为 power', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', [dev('gpu-1', 'GPU服务器_1', 2, 9, 5000)]),
          { id: 2, name: '机柜 A2', totalU: 42, type: 'gpu' as const, power_limit: 4000,
            devices: [dev('gpu-2', 'GPU服务器_2', 20, 27, 1000)] },
        ],
      })
      const r = useRackStore.getState().applyCabinetTemplate(1)
      // 目标柜已有 1000W，源设备 5000W → 1000 + 5000 > 4000 超限
      expect(r.conflicts).toEqual([
        { cabinetId: 2, deviceName: 'GPU服务器_1', startU: 2, reason: 'power' },
      ])
      expect(r.applied).toBe(0)
      expect(r.skipped).toBe(1)
    })

    it('保留旧字段 applied/skipped 兼容', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', [dev('gpu-1', 'GPU服务器_1', 2, 9)]),
          cab(2, '机柜 A2', [dev('gpu-2', 'GPU服务器_2', 3, 10)]),
        ],
      })
      const r = useRackStore.getState().applyCabinetTemplate(1)
      expect(typeof r.applied).toBe('number')
      expect(typeof r.skipped).toBe('number')
      expect(r.skipped).toBe(r.conflicts.length)
    })
  })

  // ===== 打磨轮（v1.5 / AL-R1e）：跨柜移动功率校验 =====

  describe('moveDevice 功率校验', () => {
    it('跨柜移动超目标柜功率上限被拒', () => {
      useRackStore.setState({
        cabinets: [
          { id: 1, name: '机柜 A1', totalU: 42, type: 'gpu', power_limit: 6000,
            devices: [{ id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 5000 }] },
          { id: 2, name: '机柜 A2', totalU: 42, type: 'gpu', power_limit: 6000,
            devices: [{ id: 'gpu-2', name: 'GPU服务器_2', type: 'GPU Server', cabinetId: 2, startU: 1, endU: 8, power_watts: 4000 }] },
        ],
      })
      // 5000W → 已用 4000W 的柜（上限 6000）→ 超限
      const ok = useRackStore.getState().moveDevice('gpu-1', 1, 2, 10)
      expect(ok).toBe(false)
    })

    it('功率充足时允许跨柜移动', () => {
      useRackStore.setState({
        cabinets: [
          { id: 1, name: '机柜 A1', totalU: 42, type: 'gpu', power_limit: 6000,
            devices: [{ id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 1000 }] },
          { id: 2, name: '机柜 A2', totalU: 42, type: 'gpu', power_limit: 6000, devices: [] },
        ],
      })
      const ok = useRackStore.getState().moveDevice('gpu-1', 1, 2, 1)
      expect(ok).toBe(true)
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(1)
    })
  })

  // ===== M4（AL-ED2/ED7）：机柜批量属性更新 action + 冲突校验 =====

  describe('validateCabinetPatch（M4 冲突校验纯函数）', () => {
    const cab = (over: Partial<RackCabinet> = {}): RackCabinet => ({
      id: 1, name: '机柜 1', totalU: 42, type: 'gpu' as CabinetType, power_limit: 6000,
      devices: [], ...over,
    })

    it('无设备时改矮高度无冲突', () => {
      const issues = validateCabinetPatch(cab({ devices: [] }), { totalU: 30 })
      expect(issues).toEqual([])
    })

    it('设备占用超过新高度 → overflow 冲突', () => {
      const issues = validateCabinetPatch(
        cab({ devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 40, power_watts: 1000 }] }),
        { totalU: 30 },
      )
      expect(issues).toHaveLength(1)
      expect(issues[0].reason).toBe('overflow')
    })

    it('设备功率超过新上限 → power 冲突', () => {
      const issues = validateCabinetPatch(
        cab({ devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 5000 }] }),
        { power_limit: 3000 },
      )
      expect(issues).toHaveLength(1)
      expect(issues[0].reason).toBe('power')
    })

    it('高度与功率都冲突 → 返回两条', () => {
      const issues = validateCabinetPatch(
        cab({ devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 40, power_watts: 5000 }] }),
        { totalU: 30, power_limit: 3000 },
      )
      expect(issues.map((i) => i.reason).sort()).toEqual(['overflow', 'power'])
    })

    it('改高/提高上限无冲突', () => {
      const issues = validateCabinetPatch(cab(), { totalU: 48, power_limit: 9000 })
      expect(issues).toEqual([])
    })
  })

  describe('updateCabinetsBulk（M4/AL-ED2 批量属性）', () => {
    const cab = (id: number, name: string, over: Partial<RackCabinet> = {}): RackCabinet => ({
      id, name, totalU: 42, type: 'gpu' as CabinetType, power_limit: 6000, devices: [], ...over,
    })

    beforeEach(() => {
      useRackStore.setState({ cabinets: [cab(1, '机柜 1'), cab(2, '机柜 2'), cab(3, '机柜 3')] })
    })

    it('批量改类型：指定 id 全部生效', () => {
      const r = useRackStore.getState().updateCabinetsBulk([1, 2], { type: 'storage' })
      expect(r.applied).toBe(2)
      expect(r.skipped).toBe(0)
      const s = useRackStore.getState().cabinets
      expect(s.find((c) => c.id === 1)!.type).toBe('storage')
      expect(s.find((c) => c.id === 2)!.type).toBe('storage')
      expect(s.find((c) => c.id === 3)!.type).toBe('gpu')
    })

    it('批量改名称/功率/高度', () => {
      const r = useRackStore.getState().updateCabinetsBulk([1, 2], { name: '新柜', power_limit: 8000, totalU: 48 })
      expect(r.applied).toBe(2)
      const s = useRackStore.getState().cabinets
      expect(s.find((c) => c.id === 1)).toMatchObject({ name: '新柜', power_limit: 8000, totalU: 48 })
      expect(s.find((c) => c.id === 2)).toMatchObject({ name: '新柜', power_limit: 8000, totalU: 48 })
    })

    it('功率改小超限 → 该柜跳过并返回 power 冲突', () => {
      useRackStore.setState({ cabinets: [
        cab(1, '机柜 1', { devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 5000 }] }),
        cab(2, '机柜 2'),
      ] })
      const r = useRackStore.getState().updateCabinetsBulk([1, 2], { power_limit: 3000 })
      expect(r.applied).toBe(1)
      expect(r.skipped).toBe(1)
      expect(r.issues[0].reason).toBe('power')
      expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.power_limit).toBe(6000)
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.power_limit).toBe(3000)
    })

    it('改矮高度有设备溢出 → 该柜跳过并返回 overflow 冲突', () => {
      useRackStore.setState({ cabinets: [
        cab(1, '机柜 1', { devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 40, power_watts: 1000 }] }),
        cab(2, '机柜 2'),
      ] })
      const r = useRackStore.getState().updateCabinetsBulk([1, 2], { totalU: 30 })
      expect(r.applied).toBe(1)
      expect(r.issues[0].reason).toBe('overflow')
      expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.totalU).toBe(42)
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.totalU).toBe(30)
    })

    it('空 id 列表 → applied 0', () => {
      const r = useRackStore.getState().updateCabinetsBulk([], { type: 'storage' })
      expect(r.applied).toBe(0)
      expect(useRackStore.getState().cabinets.every((c) => c.type === 'gpu')).toBe(true)
    })
  })

  describe('updateCabinetsByType（M4/AL-ED2 按类型批量）', () => {
    const cab = (id: number, name: string, type: CabinetType): RackCabinet => ({
      id, name, totalU: 42, type, power_limit: 6000, devices: [],
    })

    it('只更新指定类型的机柜', () => {
      useRackStore.setState({ cabinets: [
        cab(1, '机柜 1', 'gpu'),
        cab(2, '机柜 2', 'gpu'),
        cab(3, '机柜 3', 'network'),
        cab(4, '机柜 4', 'storage'),
      ] })
      const r = useRackStore.getState().updateCabinetsByType('gpu', { power_limit: 9000 })
      expect(r.applied).toBe(2)
      const s = useRackStore.getState().cabinets
      expect(s.filter((c) => c.power_limit === 9000).map((c) => c.id)).toEqual([1, 2])
      expect(s.find((c) => c.id === 3)!.power_limit).toBe(6000)
      expect(s.find((c) => c.id === 4)!.power_limit).toBe(6000)
    })

    it('无该类型机柜 → applied 0', () => {
      useRackStore.setState({ cabinets: [cab(1, '机柜 1', 'gpu')] })
      const r = useRackStore.getState().updateCabinetsByType('storage', { power_limit: 9000 })
      expect(r.applied).toBe(0)
    })
  })

  // ===== M5（AL-ED4/ED5/ED6）：柜内编辑能力 =====

  describe('updateCabinetSafe（AL-ED4 单柜信息调整带冲突校验）', () => {
    const cab = (id: number, over: Partial<RackCabinet> = {}): RackCabinet => ({
      id, name: '机柜 1', totalU: 42, type: 'gpu' as CabinetType, power_limit: 6000, devices: [], ...over,
    })

    it('改名称/总U/类型/功率 生效', () => {
      useRackStore.setState({ cabinets: [cab(1)] })
      const r = useRackStore.getState().updateCabinetSafe(1, { name: '新柜', totalU: 48, type: 'storage', power_limit: 9000 })
      expect(r.applied).toBe(1)
      expect(r.skipped).toBe(0)
      expect(useRackStore.getState().cabinets[0]).toMatchObject({ name: '新柜', totalU: 48, type: 'storage', power_limit: 9000 })
    })

    it('改矮总U有设备溢出 → 阻塞不落库', () => {
      useRackStore.setState({ cabinets: [cab(1, { devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 40, power_watts: 1000 }] })] })
      const r = useRackStore.getState().updateCabinetSafe(1, { totalU: 30 })
      expect(r.applied).toBe(0)
      expect(r.issues[0].reason).toBe('overflow')
      expect(useRackStore.getState().cabinets[0].totalU).toBe(42)
    })

    it('功率改小超限 → 阻塞不落库', () => {
      useRackStore.setState({ cabinets: [cab(1, { devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 5000 }] })] })
      const r = useRackStore.getState().updateCabinetSafe(1, { power_limit: 3000 })
      expect(r.applied).toBe(0)
      expect(r.issues[0].reason).toBe('power')
      expect(useRackStore.getState().cabinets[0].power_limit).toBe(6000)
    })

    it('不存在机柜 → applied 0 且无副作用', () => {
      useRackStore.setState({ cabinets: [cab(1)] })
      const r = useRackStore.getState().updateCabinetSafe(999, { name: 'x' })
      expect(r.applied).toBe(0)
      expect(r.issues).toEqual([])
      expect(useRackStore.getState().cabinets[0].name).toBe('机柜 1')
    })
  })

  describe('findFirstAvailableU（AL-ED5 跨柜落点查找）', () => {
    const cab = (devices: RackDevice[], totalU = 42): RackCabinet => ({
      id: 2, name: '机柜 2', totalU, type: 'gpu' as CabinetType, power_limit: 6000, devices,
    })

    it('空柜 → 返回 U1（bottom-up 首空位）', () => {
      expect(findFirstAvailableU(cab([]), 8, { topReservedU: 2 })).toBe(1)
    })

    it('底部被占 → 返回设备上方首个空位', () => {
      const devices: RackDevice[] = [{ id: 'a', name: 'a', type: 'GPU Server', cabinetId: 2, startU: 1, endU: 8, power_watts: 1000 }]
      expect(findFirstAvailableU(cab(devices), 8, { topReservedU: 2 })).toBe(9)
    })

    it('顶部预留保护：预留区不可用（无预留时可放）', () => {
      const devices: RackDevice[] = [{ id: 'a', name: 'a', type: 'GPU Server', cabinetId: 2, startU: 1, endU: 38, power_watts: 1000 }]
      expect(findFirstAvailableU(cab(devices), 4, { topReservedU: 2 })).toBeNull()
      expect(findFirstAvailableU(cab(devices), 4, { topReservedU: 0 })).toBe(39)
    })

    it('无连续空位 → null', () => {
      const devices: RackDevice[] = [{ id: 'a', name: 'a', type: 'GPU Server', cabinetId: 2, startU: 1, endU: 40, power_watts: 1000 }]
      expect(findFirstAvailableU(cab(devices), 4, { topReservedU: 2 })).toBeNull()
    })

    it('功率超限排除该落点', () => {
      const devices: RackDevice[] = [{ id: 'a', name: 'a', type: 'GPU Server', cabinetId: 2, startU: 1, endU: 8, power_watts: 5900 }]
      expect(findFirstAvailableU(cab(devices), 8, { topReservedU: 2, power_watts: 5900 })).toBeNull()
    })

    it('excludeDeviceId 排除自身（同柜重排可用原槽位上方）', () => {
      const devices: RackDevice[] = [{ id: 'a', name: 'a', type: 'GPU Server', cabinetId: 2, startU: 1, endU: 8, power_watts: 1000 }]
      expect(findFirstAvailableU(cab(devices), 4, { topReservedU: 2, excludeDeviceId: 'a' })).toBe(1)
    })
  })

  describe('checkDeviceMove（AL-ED5 拖拽冲突预判，与 moveDevice 同源）', () => {
    const device: RackDevice = { id: 'm', name: 'm', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 2000 }
    const cab = (devices: RackDevice[]): RackCabinet => ({
      id: 1, name: '机柜 1', totalU: 42, type: 'gpu' as CabinetType, power_limit: 6000, devices,
    })

    it('合法落点 → ok', () => {
      expect(checkDeviceMove(cab([]), device, 10, 2).ok).toBe(true)
    })

    it('越界（startU<1）→ overflow', () => {
      expect(checkDeviceMove(cab([]), device, 0, 2)).toMatchObject({ ok: false, reason: 'overflow' })
    })

    it('越界（endU>totalU）→ overflow', () => {
      expect(checkDeviceMove(cab([]), device, 40, 2)).toMatchObject({ ok: false, reason: 'overflow' })
    })

    it('进入顶部预留区 → top_reserved', () => {
      expect(checkDeviceMove(cab([]), device, 34, 2)).toMatchObject({ ok: false, reason: 'top_reserved' })
    })

    it('与其他设备重叠 → occupied（排除自身）', () => {
      const other: RackDevice = { id: 'x', name: 'x', type: 'GPU Server', cabinetId: 1, startU: 5, endU: 12, power_watts: 1000 }
      expect(checkDeviceMove(cab([other]), device, 6, 2)).toMatchObject({ ok: false, reason: 'occupied' })
      const self = { ...device, startU: 6, endU: 13 }
      expect(checkDeviceMove(cab([self]), self, 6, 2).ok).toBe(true)
    })

    it('目标柜功率不足 → power', () => {
      const other: RackDevice = { id: 'x', name: 'x', type: 'GPU Server', cabinetId: 1, startU: 10, endU: 17, power_watts: 5000 }
      expect(checkDeviceMove(cab([other]), device, 20, 2)).toMatchObject({ ok: false, reason: 'power' })
    })
  })

  describe('updateDevicesBulk（AL-ED6 同柜设备批量属性）', () => {
    const dev = (id: string, power = 1000): RackDevice => ({ id, name: `设备 ${id}`, type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: power })
    const cab = (devices: RackDevice[]): RackCabinet => ({
      id: 1, name: '机柜 1', totalU: 42, type: 'gpu' as CabinetType, power_limit: 6000, devices,
    })

    it('批量改名称/类型/功率 生效', () => {
      useRackStore.setState({ cabinets: [cab([dev('a'), dev('b')])] })
      const r = useRackStore.getState().updateDevicesBulk(1, ['a', 'b'], { name: '新名', type: 'Switch', power_watts: 2000 })
      expect(r.applied).toBe(2)
      expect(r.skipped).toBe(0)
      const ds = useRackStore.getState().cabinets[0].devices
      expect(ds.map((d) => ({ name: d.name, type: d.type, power_watts: d.power_watts }))).toEqual([
        { name: '新名', type: 'Switch', power_watts: 2000 },
        { name: '新名', type: 'Switch', power_watts: 2000 },
      ])
    })

    it('批量改功率导致柜总功率超限 → 整批拒绝不落库', () => {
      useRackStore.setState({ cabinets: [cab([dev('a', 1000), dev('b', 1000)])] })
      const r = useRackStore.getState().updateDevicesBulk(1, ['a', 'b'], { power_watts: 5000 })
      expect(r.applied).toBe(0)
      expect(r.skipped).toBe(1)
      expect(r.issues[0].reason).toBe('power')
      const ds = useRackStore.getState().cabinets[0].devices
      expect(ds.find((d) => d.id === 'a')!.power_watts).toBe(1000)
      expect(ds.find((d) => d.id === 'b')!.power_watts).toBe(1000)
    })

    it('不存在设备 id 被忽略', () => {
      useRackStore.setState({ cabinets: [cab([dev('a')])] })
      const r = useRackStore.getState().updateDevicesBulk(1, ['a', 'nope'], { name: 'x' })
      expect(r.applied).toBe(1)
      expect(r.skipped).toBe(0)
    })

    it('空 id 列表 → applied 0', () => {
      useRackStore.setState({ cabinets: [cab([dev('a')])] })
      const r = useRackStore.getState().updateDevicesBulk(1, [], { name: 'x' })
      expect(r.applied).toBe(0)
    })
  })

  describe('shiftDevicesU（AL-ED6 批量 U 位偏移）', () => {
    const dev = (id: string, startU: number, endU: number): RackDevice => ({ id, name: id, type: 'GPU Server', cabinetId: 1, startU, endU, power_watts: 1000 })
    const cab = (devices: RackDevice[]): RackCabinet => ({
      id: 1, name: '机柜 1', totalU: 42, type: 'gpu' as CabinetType, power_limit: 6000, devices,
    })

    it('正偏移：整批上移', () => {
      useRackStore.setState({ topReservedU: 2, cabinets: [cab([dev('a', 1, 8), dev('b', 9, 16)])] })
      const r = useRackStore.getState().shiftDevicesU(1, ['a', 'b'], 2)
      expect(r.applied).toBe(2)
      const ds = useRackStore.getState().cabinets[0].devices
      expect(ds.find((d) => d.id === 'a')).toMatchObject({ startU: 3, endU: 10 })
      expect(ds.find((d) => d.id === 'b')).toMatchObject({ startU: 11, endU: 18 })
    })

    it('负偏移：整批下移', () => {
      useRackStore.setState({ topReservedU: 2, cabinets: [cab([dev('a', 10, 17), dev('b', 18, 25)])] })
      const r = useRackStore.getState().shiftDevicesU(1, ['a', 'b'], -2)
      expect(r.applied).toBe(2)
      const ds = useRackStore.getState().cabinets[0].devices
      expect(ds.find((d) => d.id === 'a')).toMatchObject({ startU: 8, endU: 15 })
    })

    it('越界（endU > totalU）→ 整批拒绝', () => {
      useRackStore.setState({ topReservedU: 2, cabinets: [cab([dev('a', 1, 8), dev('b', 35, 42)])] })
      const r = useRackStore.getState().shiftDevicesU(1, ['a', 'b'], 2)
      expect(r.applied).toBe(0)
      expect(r.skipped).toBeGreaterThan(0)
      expect(r.issues[0].reason).toBe('overflow')
      const ds = useRackStore.getState().cabinets[0].devices
      expect(ds.find((d) => d.id === 'b')).toMatchObject({ startU: 35, endU: 42 })
    })

    it('越界（startU < 1）→ 整批拒绝', () => {
      useRackStore.setState({ topReservedU: 2, cabinets: [cab([dev('a', 1, 8), dev('b', 9, 16)])] })
      const r = useRackStore.getState().shiftDevicesU(1, ['a', 'b'], -2)
      expect(r.applied).toBe(0)
      expect(r.issues[0].reason).toBe('overflow')
    })

    it('与其他设备重叠 → 整批拒绝', () => {
      useRackStore.setState({ topReservedU: 2, cabinets: [cab([dev('a', 1, 8), dev('c', 9, 16)])] })
      const r = useRackStore.getState().shiftDevicesU(1, ['a'], 8)
      expect(r.applied).toBe(0)
      expect(r.issues[0].reason).toBe('occupied')
    })

    it('进入顶部预留区 → 整批拒绝', () => {
      useRackStore.setState({ topReservedU: 2, cabinets: [cab([dev('a', 1, 8), dev('b', 9, 16)])] })
      const r = useRackStore.getState().shiftDevicesU(1, ['b'], 26)
      // b 9-16 + 26 = 35-42，endU=42 > totalU-topReserved(40) → top_reserved
      expect(r.applied).toBe(0)
      expect(r.issues[0].reason).toBe('top_reserved')
    })

    it('不选中任何设备 → applied 0', () => {
      useRackStore.setState({ topReservedU: 2, cabinets: [cab([dev('a', 1, 8)])] })
      const r = useRackStore.getState().shiftDevicesU(1, [], 2)
      expect(r.applied).toBe(0)
    })
  })
})