import { create } from 'zustand'
import type {
  LibraryDevice,
  DeviceCategory,
  NetworkType,
} from '@/types/device-profile'

/* ---------- types ---------- */

export type DeviceCategoryFilter =
  | 'all'
  | 'gpu_servers'
  | 'storage_servers'
  | 'compute_servers'
  | 'switches'
  | 'custom'

/** Sub-category for fine-grained filtering: switches_param, switches_storage, switches_biz, switches_oob */
export type DeviceSubCategory = string

export interface DeviceLibraryFilter {
  category: DeviceCategoryFilter
  subCategory: string
  vendor: string
  search: string
  networkType: NetworkType | 'all'
  minPower: number | null
  maxPower: number | null
  minPorts: number | null
  maxPorts: number | null
}

/* ---------- defaults ---------- */

const defaultFilter: DeviceLibraryFilter = {
  category: 'all',
  subCategory: '',
  vendor: '',
  search: '',
  networkType: 'all',
  minPower: null,
  maxPower: null,
  minPorts: null,
  maxPorts: null,
}

/* ---------- store ---------- */

interface DeviceLibraryState {
  // Data
  categories: DeviceCategory[]
  allDevices: LibraryDevice[]
  loading: boolean
  error: string | null

  // Selection
  selectedDevice: LibraryDevice | null
  compareDevices: LibraryDevice[]

  // Filter
  filter: DeviceLibraryFilter
  filteredDevices: LibraryDevice[]

  // Editing
  editingDevice: LibraryDevice | null
  showServerForm: boolean
  showSwitchForm: boolean
  showImportModal: boolean
  showExportModal: boolean

  // Actions
  loadLibrary: () => Promise<void>
  setFilter: (partial: Partial<DeviceLibraryFilter>) => void
  resetFilter: () => void
  applyFilter: () => void
  selectDevice: (device: LibraryDevice | null) => void
  toggleCompare: (device: LibraryDevice) => void
  clearCompare: () => void

  // Add/Edit
  openAddServerForm: () => void
  openAddSwitchForm: () => void
  openEditDevice: (device: LibraryDevice) => void
  closeForm: () => void
  saveDevice: (device: LibraryDevice) => Promise<void>
  deleteDevice: (deviceId: string) => Promise<void>
  copyToCustom: (device: LibraryDevice) => Promise<void>

  // Import/Export
  openImportModal: () => void
  closeImportModal: () => void
  importDevices: (devices: LibraryDevice[]) => Promise<void>
  openExportModal: () => void
  closeExportModal: () => void
  exportDevices: (deviceIds: string[], format: 'json' | 'excel' | 'zip') => Promise<void>
  // 48-c（F8-3）：设备库跨端可移植格式（MC↔AL）
  exportPortable: (deviceIds: string[]) => Promise<void>
  importPortable: () => Promise<void>
}

export const useDeviceLibraryStore = create<DeviceLibraryState>()((set, get) => ({
  categories: [],
  allDevices: [],
  loading: false,
  error: null,

  selectedDevice: null,
  compareDevices: [],

  filter: { ...defaultFilter },
  filteredDevices: [],

  editingDevice: null,
  showServerForm: false,
  showSwitchForm: false,
  showImportModal: false,
  showExportModal: false,

  /* ---------- data loading ---------- */

  loadLibrary: async () => {
    set({ loading: true, error: null })
    try {
      if (window.electron?.deviceLibrary?.list) {
        const data = await window.electron.deviceLibrary.list()
        const categories: DeviceCategory[] = data.categories ?? []
        const allDevices = categories.flatMap((c) => c.devices)
        set({ categories, allDevices, loading: false })
        // Re-apply filter
        get().applyFilter()
      } else {
        // Fallback: load from local static data
        set({ categories: [], allDevices: [], loading: false })
      }
    } catch (err) {
      set({ error: `加载设备库失败: ${(err as Error).message}`, loading: false })
    }
  },

  /* ---------- filter ---------- */

  setFilter: (partial) => {
    set((s) => ({ filter: { ...s.filter, ...partial } }))
    get().applyFilter()
  },

  resetFilter: () => {
    set({ filter: { ...defaultFilter } })
    get().applyFilter()
  },

  applyFilter: () => {
    const { allDevices, filter } = get()
    let result = [...allDevices]

    // Category filter
    if (filter.category !== 'all') {
      if (filter.category === 'switches') {
        result = result.filter((d) => d.category.startsWith('switches_'))
      } else if (filter.category === 'storage_servers') {
        result = result.filter((d) => d.category.startsWith('storage_servers_'))
      } else {
        result = result.filter((d) => d.category === filter.category)
      }
    }

    // Sub-category filter (finer-grained: switches_param, switches_storage, etc.)
    if (filter.subCategory) {
      result = result.filter((d) => d.category === filter.subCategory)
    }

    // Vendor filter
    if (filter.vendor) {
      result = result.filter((d) => d.vendor.toLowerCase().includes(filter.vendor.toLowerCase()))
    }

    // Search filter
    if (filter.search) {
      const q = filter.search.toLowerCase()
      result = result.filter(
        (d) =>
          d.model.toLowerCase().includes(q) ||
          d.vendor.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }

    // Network type filter
    if (filter.networkType !== 'all') {
      result = result.filter((d) => d.applicable_networks.includes(filter.networkType as NetworkType))
    }

    // Power range filter
    if (filter.minPower !== null) {
      result = result.filter((d) => d.power_watts >= filter.minPower!)
    }
    if (filter.maxPower !== null) {
      result = result.filter((d) => d.power_watts <= filter.maxPower!)
    }

    // Port count filter (switches)
    if (filter.minPorts !== null || filter.maxPorts !== null) {
      result = result.filter((d) => {
        if (!d.port_count) return false
        if (filter.minPorts !== null && d.port_count < filter.minPorts) return false
        if (filter.maxPorts !== null && d.port_count > filter.maxPorts) return false
        return true
      })
    }

    set({ filteredDevices: result })
  },

  /* ---------- selection ---------- */

  selectDevice: (device) => set({ selectedDevice: device }),

  toggleCompare: (device) => {
    const { compareDevices } = get()
    const exists = compareDevices.find((d) => d.id === device.id)
    if (exists) {
      set({ compareDevices: compareDevices.filter((d) => d.id !== device.id) })
    } else if (compareDevices.length < 3) {
      set({ compareDevices: [...compareDevices, device] })
    }
  },

  clearCompare: () => set({ compareDevices: [] }),

  /* ---------- add/edit ---------- */

  openAddServerForm: () => set({ showServerForm: true, editingDevice: null }),
  openAddSwitchForm: () => set({ showSwitchForm: true, editingDevice: null }),

  openEditDevice: (device) => {
    if (device.source === 'builtin') {
      // Built-in: trigger copy to custom
      get().copyToCustom(device)
      return
    }
    const isServer = !!device.interface_models && device.interface_models.length > 0
    set({
      editingDevice: device,
      showServerForm: isServer,
      showSwitchForm: !isServer,
    })
  },

  closeForm: () =>
    set({
      editingDevice: null,
      showServerForm: false,
      showSwitchForm: false,
    }),

  saveDevice: async (device) => {
    try {
      if (window.electron?.deviceLibrary?.save) {
        await window.electron.deviceLibrary.save(device)
      }
      await get().loadLibrary()
      get().closeForm()
    } catch (err) {
      set({ error: `保存设备失败: ${(err as Error).message}` })
    }
  },

  deleteDevice: async (deviceId) => {
    try {
      if (window.electron?.deviceLibrary?.delete) {
        await window.electron.deviceLibrary.delete(deviceId)
      }
      await get().loadLibrary()
      set({ selectedDevice: null })
    } catch (err) {
      set({ error: `删除设备失败: ${(err as Error).message}` })
    }
  },

  copyToCustom: async (device) => {
    try {
      const newId = `${device.id}_copy_${Date.now()}`
      const copied: LibraryDevice = {
        ...device,
        id: newId,
        source: 'custom',
        category: 'custom',
        verified: false,
        added_at: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString().slice(0, 10),
      }
      if (window.electron?.deviceLibrary?.save) {
        await window.electron.deviceLibrary.save(copied)
      }
      await get().loadLibrary()
      // Open the copied device for editing
      const isServer = !!copied.interface_models && copied.interface_models.length > 0
      set({
        editingDevice: copied,
        showServerForm: isServer,
        showSwitchForm: !isServer,
      })
    } catch (err) {
      set({ error: `复制设备失败: ${(err as Error).message}` })
    }
  },

  /* ---------- import/export ---------- */

  openImportModal: () => set({ showImportModal: true }),
  closeImportModal: () => set({ showImportModal: false }),

  importDevices: async (devices) => {
    try {
      if (window.electron?.deviceLibrary?.import) {
        await window.electron.deviceLibrary.import(devices)
      }
      await get().loadLibrary()
      get().closeImportModal()
    } catch (err) {
      set({ error: `导入设备失败: ${(err as Error).message}` })
    }
  },

  openExportModal: () => set({ showExportModal: true }),
  closeExportModal: () => set({ showExportModal: false }),

  exportDevices: async (deviceIds, format) => {
    try {
      if (window.electron?.deviceLibrary?.export) {
        await window.electron.deviceLibrary.export(deviceIds, format)
      }
      get().closeExportModal()
    } catch (err) {
      set({ error: `导出设备失败: ${(err as Error).message}` })
    }
  },

  // 48-c（F8-3）：设备库跨端可移植格式导出（带 schema/版本清单，MC 可导入）
  exportPortable: async (deviceIds) => {
    try {
      if (window.electron?.deviceLibrary?.exportPortable) {
        await window.electron.deviceLibrary.exportPortable(deviceIds)
      }
      get().closeExportModal()
    } catch (err) {
      set({ error: `导出设备库（可移植）失败: ${(err as Error).message}` })
    }
  },

  // 48-c（F8-3）：设备库跨端可移植格式导入（MC 扁平数组 / AL 可移植格式 → 归一化 → 导入）
  importPortable: async () => {
    try {
      if (!window.electron?.deviceLibrary?.importPortable) return
      const res = await window.electron.deviceLibrary.importPortable()
      if (res.canceled || !res.content) return
      const { parsePortableLibrary } = await import('@/utils/deviceLibraryPortable')
      const parsed = parsePortableLibrary(res.content)
      if (!parsed.ok) {
        set({ error: `导入设备库失败: ${parsed.reason}` })
        return
      }
      await get().importDevices(parsed.devices)
    } catch (err) {
      set({ error: `导入设备库失败: ${(err as Error).message}` })
    }
  },
}))