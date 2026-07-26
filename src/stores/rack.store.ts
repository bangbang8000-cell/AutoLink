import { create } from 'zustand'

export interface RackDevice {
  id: string
  name: string
  type: string
  cabinetId: number
  startU: number
  endU: number
}

export interface RackCabinet {
  id: number
  name: string
  totalU: number
  devices: RackDevice[]
}

export interface UnplacedDevice {
  id: string
  name: string
  type: string
  height: number
}

interface RackState {
  cabinets: RackCabinet[]
  unplacedDevices: UnplacedDevice[]
  selectedCabinetId: number | null
  selectedDevice: RackDevice | null
  addDeviceMode: boolean
  editingDevice: string | null

  initDefault: (serverCount: number) => void
  loadRackLayout: (projectName: string) => Promise<void>
  addCabinet: () => void
  removeCabinet: (id: number) => void
  selectCabinet: (id: number | null) => void
  placeDevice: (cabinetId: number, device: UnplacedDevice, startU: number) => boolean
  removeDevice: (cabinetId: number, deviceId: string) => void
  moveDevice: (deviceId: string, fromCabinet: number, toCabinet: number, newStartU: number) => boolean
  selectedDeviceInfo: (id: string) => RackDevice | null
  selectDevice: (id: string | null) => void
}

export const useRackStore = create<RackState>()((set, get) => ({
  cabinets: [],
  unplacedDevices: [],
  selectedCabinetId: null,
  selectedDevice: null,
  addDeviceMode: false,
  editingDevice: null,

  initDefault: (serverCount) => {
    const baseServers = Math.min(serverCount, 134)
    const cabsNeeded = Math.ceil(baseServers / 42)

    const cabinets: RackCabinet[] = []
    for (let i = 0; i < cabsNeeded; i++) {
      cabinets.push({
        id: i + 1,
        name: `机柜 ${String.fromCharCode(65 + i)}`,
        totalU: 42,
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
      })
    }

    set({ cabinets, unplacedDevices, selectedCabinetId: cabinets.length > 0 ? 1 : null })
  },

  loadRackLayout: async (projectName) => {
    try {
      if (window.electron?.project?.getFile) {
        const jsonStr = await window.electron.project.getFile(projectName, 'rack_layout.json')
        if (jsonStr) {
          const data = JSON.parse(jsonStr)
          if (data.cabinets && Array.isArray(data.cabinets)) {
            set({
              cabinets: data.cabinets as RackCabinet[],
              unplacedDevices: [],
              selectedCabinetId: data.cabinets.length > 0 ? data.cabinets[0].id : null,
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

  addCabinet: () => {
    set((s) => {
      const newId = s.cabinets.length > 0 ? Math.max(...s.cabinets.map((c) => c.id)) + 1 : 1
      const label = String.fromCharCode(64 + newId)
      return {
        cabinets: [...s.cabinets, { id: newId, name: `机柜 ${label}`, totalU: 42, devices: [] }],
      }
    })
  },

  removeCabinet: (id) => {
    set((s) => {
      const cabinet = s.cabinets.find((c) => c.id === id)
      const movedDevices = cabinet
        ? cabinet.devices.map((d) => ({ ...d, cabinetId: -1, startU: 0, endU: 0 }) as RackDevice)
        : []
      return {
        cabinets: s.cabinets.filter((c) => c.id !== id),
        selectedCabinetId: s.selectedCabinetId === id ? null : s.selectedCabinetId,
      }
    })
  },

  selectCabinet: (id) => set({ selectedCabinetId: id, addDeviceMode: false, editingDevice: null }),

  placeDevice: (cabinetId, device, startU) => {
    const { cabinets } = get()
    const cabinet = cabinets.find((c) => c.id === cabinetId)
    if (!cabinet) return false

    const endU = startU + device.height - 1
    if (endU > cabinet.totalU) return false

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
}))
