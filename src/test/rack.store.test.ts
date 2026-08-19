import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRackStore, toCabinetType } from '../stores/rack.store'
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
})