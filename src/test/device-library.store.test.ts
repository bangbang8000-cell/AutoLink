import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import type { NetworkType, LibraryDevice } from '@/types/device-profile'

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
  cooling: 'air' as const,
  name_prefix: 'GPU',
  interface_models: [],
  port_count: undefined,
  port_speed: undefined,
  port_type: undefined,
  downlink_prefix: undefined,
  uplink_prefix: undefined,
  tags: ['GPU', 'H100'],
  applicable_networks: ['param'] as NetworkType[],
  source: 'builtin' as const,
  verified: true,
  added_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...overrides,
} as LibraryDevice)

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
        subCategory: '',
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

  describe('exportPortable / importPortable（48-c 跨端可移植）', () => {
    it('导出可移植格式 → 调 deviceLibrary.exportPortable 并关闭弹窗', async () => {
      window.electron.deviceLibrary.exportPortable = vi.fn().mockResolvedValue({ canceled: false, path: '/tmp/lib.json', count: 1 })
      useDeviceLibraryStore.setState({ showExportModal: true })
      await useDeviceLibraryStore.getState().exportPortable(['dev1'])
      expect(window.electron.deviceLibrary.exportPortable).toHaveBeenCalledWith(['dev1'])
      expect(useDeviceLibraryStore.getState().showExportModal).toBe(false)
    })

    it('导出失败 → 记录 error 不抛', async () => {
      window.electron.deviceLibrary.exportPortable = vi.fn().mockRejectedValue(new Error('写盘失败'))
      await useDeviceLibraryStore.getState().exportPortable(['dev1'])
      expect(useDeviceLibraryStore.getState().error).toContain('写盘失败')
    })

    it('导入 MC 扁平数组 → 归一化 → importDevices', async () => {
      const mcJson = JSON.stringify([{ id: 'h3c_s9827', vendor: 'H3C', model: 'S9827', port_count: 128, port_speed: '400G', applicable_networks: ['param'] }])
      window.electron.deviceLibrary.importPortable = vi.fn().mockResolvedValue({ canceled: false, content: mcJson })
      window.electron.deviceLibrary.import = vi.fn().mockResolvedValue(undefined)
      window.electron.deviceLibrary.list = vi.fn().mockResolvedValue({ categories: [] })
      await useDeviceLibraryStore.getState().importPortable()
      expect(window.electron.deviceLibrary.import).toHaveBeenCalled()
      const devices = (window.electron.deviceLibrary.import as ReturnType<typeof vi.fn>).mock.calls[0][0] as LibraryDevice[]
      expect(devices[0].id).toBe('h3c_s9827')
      expect(devices[0].category).toBe('switches_param')
      expect(devices[0].source).toBe('custom')
    })

    it('导入取消 → 不做任何事', async () => {
      window.electron.deviceLibrary.importPortable = vi.fn().mockResolvedValue({ canceled: true, content: '' })
      const importSpy = vi.fn()
      window.electron.deviceLibrary.import = importSpy
      await useDeviceLibraryStore.getState().importPortable()
      expect(importSpy).not.toHaveBeenCalled()
    })

    it('导入格式非法 → 记录 error', async () => {
      window.electron.deviceLibrary.importPortable = vi.fn().mockResolvedValue({ canceled: false, content: 'not-json' })
      await useDeviceLibraryStore.getState().importPortable()
      expect(useDeviceLibraryStore.getState().error).toContain('导入设备库失败')
    })
  })
})