import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as XLSX from 'xlsx'

export interface RackDevice {
  id: string
  name: string
  type: string
  cabinetId: number
  startU: number
  endU: number
  power_watts: number
}

export type CabinetType = 'gpu' | 'storage' | 'network' | 'compute' | 'security' | 'custom'

export const CABINET_TYPE_LABELS: Record<CabinetType, string> = {
  gpu: 'GPU柜',
  storage: '存储柜',
  network: '网络柜',
  compute: '通算柜',
  security: '安全柜',
  custom: '自定义',
}

export interface RackCabinet {
  id: number
  name: string
  totalU: number
  type: CabinetType
  power_limit: number
  devices: RackDevice[]
}

export interface UnplacedDevice {
  id: string
  name: string
  type: string
  height: number
  power_watts: number
}

interface RackState {
  cabinets: RackCabinet[]
  unplacedDevices: UnplacedDevice[]
  selectedCabinetId: number | null
  selectedDevice: RackDevice | null
  addDeviceMode: boolean
  editingDevice: string | null

  initDefault: (serverCount: number, rackType?: number, powerLimit?: number) => void
  initFromTopology: (topologyNodes: { id: string; type: string; group: string; podid: string }[], rackType?: number, powerLimit?: number) => void
  loadRackLayout: (projectName: string) => Promise<void>
  saveRackLayout: (projectName: string) => Promise<void>
  addCabinet: (totalU?: number, type?: CabinetType, powerLimit?: number) => void
  removeCabinet: (id: number) => void
  selectCabinet: (id: number | null) => void
  updateCabinet: (id: number, updates: Partial<Pick<RackCabinet, 'name' | 'totalU' | 'type' | 'power_limit'>>) => void
  placeDevice: (cabinetId: number, device: UnplacedDevice, startU: number) => boolean
  removeDevice: (cabinetId: number, deviceId: string) => void
  moveDevice: (deviceId: string, fromCabinet: number, toCabinet: number, newStartU: number) => boolean
  selectedDeviceInfo: (id: string) => RackDevice | null
  selectDevice: (id: string | null) => void
  exportToExcel: (projectName: string) => Promise<string>
  importCabinetList: (csvData: string) => void
  getPowerUsage: (cabinetId: number) => { used: number; limit: number; percent: number; exceeded: boolean }
  getPowerUsageAll: () => { total: number; limit: number; percent: number }
}

export const useRackStore = create<RackState>()(
  persist(
    (set, get) => ({
  cabinets: [],
  unplacedDevices: [],
  selectedCabinetId: null,
  selectedDevice: null,
  addDeviceMode: false,
  editingDevice: null,

  initDefault: (serverCount, rackType = 42, powerLimit = 6000) => {
    const baseServers = Math.min(serverCount, 134)
    const cabsNeeded = Math.ceil(baseServers / rackType)

    const cabinets: RackCabinet[] = []
    for (let i = 0; i < cabsNeeded; i++) {
      cabinets.push({
        id: i + 1,
        name: `机柜 ${String.fromCharCode(65 + i)}`,
        totalU: rackType,
        type: 'gpu',
        power_limit: powerLimit,
        devices: [],
      })
    }

    // Create default devices
    const unplacedDevices: UnplacedDevice[] = []
    for (let i = 1; i <= baseServers; i++) {
      unplacedDevices.push({
        id: `gpu-${i}`,
        name: `GPU服务器_${i}`,
        type: 'GPU Server',
        height: 4,
        power_watts: 2000,
      })
    }

    set({ cabinets, unplacedDevices, selectedCabinetId: cabinets.length > 0 ? 1 : null })
  },

  initFromTopology: (topologyNodes, rackType = 42, powerLimit = 6000) => {
    // Extract server-type devices from topology data, using real cabinet assignments
    const serverNodes = topologyNodes.filter((n: any) => n.type === 'server')
    if (serverNodes.length === 0) {
      get().initDefault(134, rackType, powerLimit)
      return
    }

    // Group servers by cabinetId to respect topology's cabinet assignments
    const cabinetMap = new Map<number, { id: number; name: string; devices: any[] }>()
    const unplacedDevices: UnplacedDevice[] = []

    for (let i = 0; i < serverNodes.length; i++) {
      const node: any = serverNodes[i]
      const cabinetId: number = node.cabinetId ?? (i % Math.ceil(serverNodes.length / Math.ceil(serverNodes.length / rackType)) + 1)
      const cabinetName: string = node.cabinetName || `机柜 ${String.fromCharCode(64 + cabinetId)}`

      if (!cabinetMap.has(cabinetId)) {
        cabinetMap.set(cabinetId, {
          id: cabinetId,
          name: cabinetName,
          devices: [],
        })
      }

      const cab = cabinetMap.get(cabinetId)!
      const uHeight: number = node.uHeight || 4
      const powerWatts: number = node.powerWatts || 2000
      const startU: number = node.startU ?? (cab.devices.length * uHeight + 1)

      cab.devices.push({
        id: node.id,
        name: node.id,
        type: node.group || 'GPU Server',
        cabinetId,
        startU,
        endU: startU + uHeight - 1,
        power_watts: powerWatts,
      })

      // Also add to unplaced for manual placement flexibility
      unplacedDevices.push({
        id: node.id,
        name: node.id,
        type: node.group || 'GPU Server',
        height: uHeight,
        power_watts: powerWatts,
      })
    }

    const cabinets: RackCabinet[] = Array.from(cabinetMap.values()).map((c) => ({
      id: c.id,
      name: c.name,
      totalU: rackType,
      type: 'gpu' as CabinetType,
      power_limit: powerLimit,
      devices: c.devices,
    }))

    set({
      cabinets,
      unplacedDevices,
      selectedCabinetId: cabinets.length > 0 ? cabinets[0].id : null,
    })
  },

  loadRackLayout: async (projectName) => {
    try {
      if (window.electron?.project?.getFile) {
        const jsonStr = await window.electron.project.getFile(projectName, 'rack_layout.json')
        if (jsonStr) {
          const data = JSON.parse(jsonStr)
          if (data.cabinets && Array.isArray(data.cabinets)) {
            // Ensure new fields have defaults
            const cabinets = (data.cabinets as RackCabinet[]).map((c) => ({
              ...c,
              type: c.type || 'gpu',
              power_limit: c.power_limit || 6000,
              devices: (c.devices || []).map((d) => ({
                ...d,
                power_watts: d.power_watts || 0,
              })),
            }))
            set({
              cabinets,
              unplacedDevices: [],
              selectedCabinetId: cabinets.length > 0 ? cabinets[0].id : null,
              addDeviceMode: false,
            })
            return
          }
        }
      }
      // Fallback: init default layout
      get().initDefault(134)
    } catch (err) {
      console.error('loadRackLayout:', err)
      get().initDefault(134)
    }
  },

  saveRackLayout: async (projectName) => {
    try {
      if (window.electron?.project?.saveConfigFile) {
        const { cabinets } = get()
        const data = { cabinets, updated_at: new Date().toISOString() }
        // Use saveConfigFile to save rack_layout.json via the existing save mechanism
        // Actually, we need a generic file save. Let's use the export:saveFile mechanism
        const jsonStr = JSON.stringify(data, null, 2)
        const base64 = btoa(unescape(encodeURIComponent(jsonStr)))
        if (window.electron?.export?.saveFile) {
          await window.electron.export.saveFile(projectName, 'rack_layout.json', base64)
        }
      }
    } catch (err) {
      console.error('saveRackLayout:', err)
    }
  },

  addCabinet: (totalU = 42, type = 'gpu', powerLimit = 6000) => {
    set((s) => {
      const newId = s.cabinets.length > 0 ? Math.max(...s.cabinets.map((c) => c.id)) + 1 : 1
      const label = String.fromCharCode(64 + newId)
      return {
        cabinets: [...s.cabinets, { id: newId, name: `机柜 ${label}`, totalU, type, power_limit: powerLimit, devices: [] }],
      }
    })
  },

  removeCabinet: (id) => {
    set((s) => {
      return {
        cabinets: s.cabinets.filter((c) => c.id !== id),
        selectedCabinetId: s.selectedCabinetId === id ? null : s.selectedCabinetId,
      }
    })
  },

  selectCabinet: (id) => set({ selectedCabinetId: id, addDeviceMode: false, editingDevice: null }),

  updateCabinet: (id, updates) => {
    set((s) => ({
      cabinets: s.cabinets.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }))
  },

  placeDevice: (cabinetId, device, startU) => {
    const { cabinets } = get()
    const cabinet = cabinets.find((c) => c.id === cabinetId)
    if (!cabinet) return false

    const endU = startU + device.height - 1
    if (endU > cabinet.totalU) return false

    // Check power limit
    const currentPower = cabinet.devices.reduce((sum, d) => sum + d.power_watts, 0)
    if (currentPower + device.power_watts > cabinet.power_limit) return false

    // Check conflict
    const hasConflict = cabinet.devices.some(
      (d) => !(endU < d.startU || startU > d.endU),
    )
    if (hasConflict) return false

    const newDevice: RackDevice = {
      id: device.id,
      name: device.name,
      type: device.type,
      cabinetId,
      startU,
      endU,
      power_watts: device.power_watts,
    }

    set((s) => ({
      cabinets: s.cabinets.map((c) =>
        c.id === cabinetId ? { ...c, devices: [...c.devices, newDevice] } : c,
      ),
      unplacedDevices: s.unplacedDevices.filter((d) => d.id !== device.id),
    }))
    return true
  },

  removeDevice: (cabinetId, deviceId) => {
    set((s) => {
      const cabinet = s.cabinets.find((c) => c.id === cabinetId)
      const device = cabinet?.devices.find((d) => d.id === deviceId)
      if (!device) return s

      const unplaced: UnplacedDevice = {
        id: device.id,
        name: device.name,
        type: device.type,
        height: device.endU - device.startU + 1,
        power_watts: device.power_watts,
      }

      return {
        cabinets: s.cabinets.map((c) =>
          c.id === cabinetId
            ? { ...c, devices: c.devices.filter((d) => d.id !== deviceId) }
            : c,
        ),
        unplacedDevices: [...s.unplacedDevices, unplaced],
        selectedDevice: s.selectedDevice?.id === deviceId ? null : s.selectedDevice,
      }
    })
  },

  moveDevice: (deviceId, fromCabinet, toCabinet, newStartU) => {
    const { cabinets } = get()
    const fromCab = cabinets.find((c) => c.id === fromCabinet)
    const device = fromCab?.devices.find((d) => d.id === deviceId)
    if (!device) return false

    const toCab = cabinets.find((c) => c.id === toCabinet)
    if (!toCab) return false

    const height = device.endU - device.startU + 1
    const newEndU = newStartU + height - 1
    if (newEndU > toCab.totalU) return false

    const hasConflict = toCab.devices.some(
      (d) => d.id !== deviceId && !(newEndU < d.startU || newStartU > d.endU),
    )
    if (hasConflict) return false

    const moved: RackDevice = { ...device, cabinetId: toCabinet, startU: newStartU, endU: newEndU }

    set((s) => ({
      cabinets: s.cabinets.map((c) => {
        if (c.id === fromCabinet) return { ...c, devices: c.devices.filter((d) => d.id !== deviceId) }
        if (c.id === toCabinet) return { ...c, devices: [...c.devices, moved] }
        return c
      }),
      selectedDevice: s.selectedDevice?.id === deviceId ? moved : s.selectedDevice,
    }))
    return true
  },

  selectedDeviceInfo: (id) => {
    const { cabinets } = get()
    for (const c of cabinets) {
      const d = c.devices.find((d) => d.id === id)
      if (d) return d
    }
    return null
  },

  selectDevice: (id) => {
    if (!id) {
      set({ selectedDevice: null, addDeviceMode: false, editingDevice: null })
      return
    }
    const info = get().selectedDeviceInfo(id)
    set({ selectedDevice: info, addDeviceMode: false, editingDevice: null })
  },

  exportToExcel: async (projectName) => {
    const { cabinets } = get()
    const rows: Record<string, string | number>[] = []

    for (const cab of cabinets) {
      for (const device of cab.devices) {
        rows.push({
          '机柜号': cab.name,
          '机柜类型': CABINET_TYPE_LABELS[cab.type] || cab.type,
          '机柜功率上限(W)': cab.power_limit,
          '设备名称': device.name,
          '设备类型': device.type,
          '起始U位': device.startU,
          '结束U位': device.endU,
          '占用U数': device.endU - device.startU + 1,
          '功率(W)': device.power_watts,
        })
      }
    }

    // Add power summary rows
    rows.push({})
    rows.push({ '机柜号': '--- 功率汇总 ---' })
    for (const cab of cabinets) {
      const used = cab.devices.reduce((sum, d) => sum + d.power_watts, 0)
      const pct = Math.round((used / cab.power_limit) * 100)
      rows.push({
        '机柜号': cab.name,
        '机柜功率上限(W)': cab.power_limit,
        '实际功率(W)': used,
        '使用率': `${pct}%`,
        '状态': used > cab.power_limit ? '超限' : '正常',
      })
    }

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)

    ws['!cols'] = [
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      { wch: 20 },
      { wch: 15 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
    ]

    XLSX.utils.book_append_sheet(wb, ws, '上机表')

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fileName = `上机表_${timestamp}.xlsx`

    const filePath = await window.electron?.export?.saveFile(projectName, fileName, wbout)
    return filePath || ''
  },

  importCabinetList: (csvData) => {
    const lines = csvData.trim().split(/\r?\n/)
    const cabinets: RackCabinet[] = []

    for (const line of lines) {
      const cols = line.split(',').map((s) => s.trim())
      if (cols.length < 2) continue
      const name = cols[0]
      const totalU = parseInt(cols[1]) || 42
      const type = (cols[2] || 'gpu') as CabinetType
      const powerLimit = parseInt(cols[3]) || 6000

      if (name && !isNaN(totalU)) {
        cabinets.push({
          id: cabinets.length + 1,
          name,
          totalU,
          type,
          power_limit: powerLimit,
          devices: [],
        })
      }
    }

    if (cabinets.length > 0) {
      set({ cabinets, selectedCabinetId: cabinets[0].id })
    }
  },

  getPowerUsage: (cabinetId) => {
    const { cabinets } = get()
    const cabinet = cabinets.find((c) => c.id === cabinetId)
    if (!cabinet) return { used: 0, limit: 0, percent: 0, exceeded: false }
    const used = cabinet.devices.reduce((sum, d) => sum + d.power_watts, 0)
    const percent = cabinet.power_limit > 0 ? Math.round((used / cabinet.power_limit) * 100) : 0
    return { used, limit: cabinet.power_limit, percent, exceeded: used > cabinet.power_limit }
  },

  getPowerUsageAll: () => {
    const { cabinets } = get()
    const total = cabinets.reduce((sum, c) => sum + c.devices.reduce((s, d) => s + d.power_watts, 0), 0)
    const limit = cabinets.reduce((sum, c) => sum + c.power_limit, 0)
    const percent = limit > 0 ? Math.round((total / limit) * 100) : 0
    return { total, limit, percent }
  },
  }),
  {
    name: 'autolink-rack-state',
    partialize: (state) => ({
      cabinets: state.cabinets,
      unplacedDevices: state.unplacedDevices,
      selectedCabinetId: state.selectedCabinetId,
    }),
  },
),
)
