import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDeviceLibraryStore } from '@/stores/device-library.store'

const mockDevice = (overrides = {}) => ({
  id: 'dev1',
  vendor: 'NVIDIA',
  model: 'H100-SXM',
  category: 'gpu_servers',
  description: 'Test GPU',
  power_watts: 700,
  weight_kg: 30,
  u_height: 4,
  depth_mm: 800,
  cooling: 'air',
  name_prefix: 'GPU',
  interface_models: [],
  port_count: null,
  port_speed: null,
  port_type: null,
  downlink_prefix: null,
  uplink_prefix: null,
  tags: ['GPU', 'H100'],
  applicable_networks: ['param'],
  source: 'builtin' as const,
  verified: true,
  datasheet_url: null,
  added_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...overrides,
})

describe('DeviceLibraryStore', () => {
  beforeEach(() => {
    useDeviceLibraryStore.setState({
      categories: [],
      allDevices: [],
      loading: false,
      error: null,
      selectedDevice: null,
      compareDevices: [],
      filter: {
        category: 'all',
        vendor: '',
        search: '',
        networkType: 'all',
        minPower: null,
        maxPower: null,
        minPorts: null,
        maxPorts: null,
      },
      filteredDevices: [],
      editingDevice: null,
      showServerForm: false,
      showSwitchForm: false,
      showImportModal: false,
      showExportModal: false,
    })
    vi.clearAllMocks()
  })

  describe('loadLibrary', () => {
    it('应该加载设备库并扁平化设备列表', async () => {
      const categories = [
        { id: 'gpu_servers', name: 'GPU Servers', devices: [mockDevice(), mockDevice({ id: 'dev2' })] },
      ]
      window.electron.deviceLibrary.list = vi.fn().mockResolvedValue({ categories })

      await useDeviceLibraryStore.getState().loadLibrary()

      const state = useDeviceLibraryStore.getState()
      expect(state.categories).toEqual(categories)
      expect(state.allDevices).toHaveLength(2)
      expect(state.loading).toBe(false)
    })

    it('应该处理加载错误', async () => {
      window.electron.deviceLibrary.list = vi.fn().mockRejectedValue(new Error('加载失败'))

      await useDeviceLibraryStore.getState().loadLibrary()

      expect(useDeviceLibraryStore.getState().error).toContain('加载失败')
    })

    it('应该在IPC不可用时有fallback', async () => {
      const saved = window.electron
      // @ts-expect-error 测试IPC不可用场景
      delete window.electron

      await useDeviceLibraryStore.getState().loadLibrary()

      expect(useDeviceLibraryStore.getState().categories).toEqual([])
      window.electron = saved
    })
  })

  describe('applyFilter', () => {
    it('应该按分类过滤', () => {
      const devices = [
        mockDevice({ id: 'gpu1', category: 'gpu_servers' }),
        mockDevice({ id: 'sw1', category: 'switches_param' }),
      ]
      useDeviceLibraryStore.setState({ allDevices: devices })

      useDeviceLibraryStore.getState().setFilter({ category: 'switches' })

      const filtered = useDeviceLibraryStore.getState().filteredDevices
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('sw1')
    })

    it('应该按搜索文本过滤', () => {
      const devices = [
        mockDevice({ id: 'd1', model: 'H100', tags: ['GPU'] }),
        mockDevice({ id: 'd2', model: 'A100', tags: ['GPU'] }),
      ]
      useDeviceLibraryStore.setState({ allDevices: devices })

      useDeviceLibraryStore.getState().setFilter({ search: 'H100' })

      const filtered = useDeviceLibraryStore.getState().filteredDevices
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('d1')
    })

    it('应该按功率范围过滤', () => {
      const devices = [
        mockDevice({ id: 'd1', power_watts: 500 }),
        mockDevice({ id: 'd2', power_watts: 1000 }),
      ]
      useDeviceLibraryStore.setState({ allDevices: devices })

      useDeviceLibraryStore.getState().setFilter({ minPower: 600, maxPower: 1200 })

      const filtered = useDeviceLibraryStore.getState().filteredDevices
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('d2')
    })
  })

  describe('toggleCompare', () => {
    it('应该添加设备到对比列表', () => {
      const device = mockDevice()
      useDeviceLibraryStore.getState().toggleCompare(device)
      expect(useDeviceLibraryStore.getState().compareDevices).toHaveLength(1)
    })

    it('应该取消对比', () => {
      const device = mockDevice()
      useDeviceLibraryStore.getState().toggleCompare(device)
      useDeviceLibraryStore.getState().toggleCompare(device)
      expect(useDeviceLibraryStore.getState().compareDevices).toHaveLength(0)
    })

    it('应该限制最多3个对比设备', () => {
      useDeviceLibraryStore.getState().toggleCompare(mockDevice({ id: 'd1' }))
      useDeviceLibraryStore.getState().toggleCompare(mockDevice({ id: 'd2' }))
      useDeviceLibraryStore.getState().toggleCompare(mockDevice({ id: 'd3' }))
      useDeviceLibraryStore.getState().toggleCompare(mockDevice({ id: 'd4' }))
      expect(useDeviceLibraryStore.getState().compareDevices).toHaveLength(3)
    })
  })

  describe('saveDevice', () => {
    it('应该保存设备并重新加载库', async () => {
      window.electron.deviceLibrary.save = vi.fn().mockResolvedValue(undefined)
      window.electron.deviceLibrary.list = vi.fn().mockResolvedValue({ categories: [] })

      await useDeviceLibraryStore.getState().saveDevice(mockDevice())

      expect(window.electron.deviceLibrary.save).toHaveBeenCalled()
      expect(window.electron.deviceLibrary.list).toHaveBeenCalled()
    })
  })
})