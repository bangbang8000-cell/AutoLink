import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as XLSX from 'xlsx'
import { useToastStore } from './toast.store'

export interface RackDevice {
  id: string
  name: string
  type: string
  cabinetId: number
  startU: number
  endU: number
  power_watts: number
}

export type CabinetType = 'gpu' | 'storage' | 'network' | 'compute' | 'security' | 'custom' | 'scaleup' | 'power'

// V2.9.1-T4: 拓扑节点机柜字段（与后端 NetworkObject 分配结果对齐）
export interface RackTopologyNode {
  id: string
  type: string
  group: string
  podid: string
  cabinetId?: number
  cabinetName?: string
  startU?: number
  endU?: number
  powerWatts?: number
  uHeight?: number
}

export const CABINET_TYPE_LABELS: Record<CabinetType, string> = {
  gpu: 'GPU柜',
  storage: '存储柜',
  network: '网络柜',
  compute: '通算柜',
  security: '安全柜',
  custom: '自定义',
  // V2.9.3-T4: Scale-Up GPU 节点柜
  scaleup: 'Scale-Up柜',
  // v1.4: 电源柜
  power: '电源柜',
}

// V2.9.2: 从拓扑节点推断机柜类型（服务器按 group 分类，交换机归为网络柜）
export function toCabinetType(node: { type?: string; group?: string }): CabinetType {
  // V2.9.3-T4: Scale-Up GPU 节点 → Scale-Up 柜
  if (node.type === 'scaleup_gpu') return 'scaleup'
  if (node.type !== 'server') return 'network'
  const g = node.group || ''
  if (g.includes('存储')) return 'storage'
  if (g.includes('通算')) return 'compute'
  return 'gpu'
}

// V2.9.2: 机柜类型配色（机架视图/机房平面图按类型区分）
export const RACK_TYPE_COLORS: Record<CabinetType, { bg: string; text: string; border: string }> = {
  gpu: { bg: '#fee2e2', text: '#b91c1c', border: '#f87171' },        // 红
  network: { bg: '#dbeafe', text: '#1d4ed8', border: '#60a5fa' },    // 蓝
  storage: { bg: '#dcfce7', text: '#15803d', border: '#4ade80' },    // 绿
  compute: { bg: '#fef9c3', text: '#a16207', border: '#facc15' },    // 黄
  security: { bg: '#f3e8ff', text: '#7e22ce', border: '#c084fc' },   // 紫
  custom: { bg: '#f1f5f9', text: '#475569', border: '#94a3b8' },     // 灰
  // V2.9.3-T4: Scale-Up 柜 (琥珀色, 与 scale_up 网络色一致)
  scaleup: { bg: '#fef3c7', text: '#b45309', border: '#f59e0b' },    // 琥珀
  // v1.4: 电源柜 (橙色/深红, 与空调/柱子区分)
  power: { bg: '#ffedd5', text: '#c2410c', border: '#fb923c' },      // 橙
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
  initFromTopology: (topologyNodes: RackTopologyNode[], rackType?: number, powerLimit?: number) => void
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
    // V2.9.2: 按真实 GPU 服务器参数生成 (8U 高, 功率≈上限85%), GPU 独占机柜 1 台/柜
    const gpuPower = Math.max(1, Math.round((powerLimit * 0.85) / 100) * 100)
    const gpuU = 8
    const cabinets: RackCabinet[] = []
    const unplacedDevices: UnplacedDevice[] = []
    for (let i = 1; i <= serverCount; i++) {
      const cabId = i
      const col = String.fromCharCode(65 + ((i - 1) % 26))
      const row = Math.floor((i - 1) / 26) + 1
      cabinets.push({
        id: cabId,
        name: `机柜 ${col}${row}`,
        totalU: rackType,
        type: 'gpu',
        power_limit: powerLimit,
        devices: [],
      })
      unplacedDevices.push({
        id: `gpu-${i}`,
        name: `GPU服务器_${i}`,
        type: 'GPU Server',
        height: gpuU,
        power_watts: gpuPower,
      })
    }
    set({ cabinets, unplacedDevices, selectedCabinetId: cabinets.length > 0 ? 1 : null })
  },

  initFromTopology: (topologyNodes, rackType = 42, powerLimit = 6000) => {
    // V2.9.2: 优先采用后端分配(cabinetId/type/startU/endU/power/uHeight)，
    // 服务器按 group 分类(gpu/storage/compute)，交换机归为网络柜
    const nodes = topologyNodes.filter(
      (n) => n.cabinetId != null || n.type === 'server',
    )
    if (nodes.length === 0) {
      // 无有效节点 → 空状态（不虚构机柜，等待渲染拓扑）
      set({ cabinets: [], unplacedDevices: [], selectedCabinetId: null, addDeviceMode: false })
      return
    }

    const cabinetMap = new Map<number, { id: number; name: string; type: CabinetType; devices: RackDevice[] }>()
    const unplacedDevices: UnplacedDevice[] = []

    for (const node of nodes) {
      const uHeight: number = node.uHeight || 4
      const powerWatts: number = node.powerWatts || 0
      const cabinetId: number | undefined = node.cabinetId
      if (cabinetId == null) {
        // 无分配信息（旧数据）→ 待分配池
        unplacedDevices.push({
          id: node.id,
          name: node.id,
          type: node.group || (node.type === 'server' ? 'GPU Server' : 'Switch'),
          height: uHeight,
          power_watts: powerWatts,
        })
        continue
      }
      const cabinetName: string = node.cabinetName || `机柜 ${cabinetId}`
      const cabType = toCabinetType(node)
      if (!cabinetMap.has(cabinetId)) {
        cabinetMap.set(cabinetId, { id: cabinetId, name: cabinetName, type: cabType, devices: [] })
      }
      const cab = cabinetMap.get(cabinetId)!
      const startU: number = node.startU ?? (cab.devices.length * uHeight + 1)
      cab.devices.push({
        id: node.id,
        name: node.id,
        type: node.group || (node.type === 'server' ? 'GPU Server' : 'Switch'),
        cabinetId,
        startU,
        endU: node.endU ?? (startU + uHeight - 1),
        power_watts: powerWatts,
      })
      // 同时进入待分配池，便于手动调整
      unplacedDevices.push({
        id: node.id,
        name: node.id,
        type: node.group || (node.type === 'server' ? 'GPU Server' : 'Switch'),
        height: uHeight,
        power_watts: powerWatts,
      })
    }

    const cabinets: RackCabinet[] = Array.from(cabinetMap.values()).map((c) => ({
      id: c.id,
      name: c.name,
      totalU: rackType,
      type: c.type,
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
    } catch (err) {
      console.error('loadRackLayout:', err)
      useToastStore.getState().addToast('error', '机柜布局加载失败，已重置为空状态', 5000)
    }
    // V2.9.2: 无布局文件 → 空状态（不虚构机柜），渲染拓扑后由 initFromTopology 填充
    set({ cabinets: [], unplacedDevices: [], selectedCabinetId: null, addDeviceMode: false })
  },

  saveRackLayout: async (projectName) => {
    try {
      // T6.3: 改用 project.saveFile 保存到项目根目录 rack_layout.json(白名单内)
      // 之前用 export.saveFile 会写到 output/ 子目录,且 base64 编码,导致读取路径不一致
      if (window.electron?.project?.saveFile) {
        const { cabinets } = get()
        const data = {
          schema_version: 1,
          project_name: projectName,
          updated_at: new Date().toISOString(),
          cabinets,
        }
        await window.electron.project.saveFile(projectName, 'rack_layout.json', JSON.stringify(data, null, 2))
      }
    } catch (err) {
      console.error('saveRackLayout:', err)
      useToastStore.getState().addToast('error', '机柜布局保存失败', 5000)
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
    // T6.3: 移除 cabinets/unplacedDevices/selectedCabinetId 的 localStorage 持久化
    // 改由项目文件 rack_layout.json 按项目持久化,避免跨项目数据污染
    partialize: () => ({}),
  },
),
)
