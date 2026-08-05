/**
 * AutoLink V3.0.4-T3-1 — 机房矩阵 Store（RoomMatrix）
 *
 * 与 backend/room.py 数据层对齐：
 *   - 矩阵定义（行×列命名规则自定义，如 A15~O15=225 柜）
 *   - 占位标记（空调/柱子，不可放置设备）
 *   - 机柜类型标记（gpu/network/storage/compute/combined/empty）
 *   - room_layout.json 按项目持久化（project.getFile / project.saveFile + room:validate 校验）
 */
import { create } from 'zustand'
import { useToastStore } from './toast.store'
import { useRackStore, type RackCabinet } from './rack.store'

/** 落位校验结果：errors 阻塞落位；warnings 非阻塞提示（散热等） */
export interface MountCheck {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** 矩阵单元（对齐 backend/room.py RoomCell.to_dict） */
export interface RoomCellData {
  row: string
  col: number
  type: string                   // gpu/network/storage/compute/combined/empty
  placeholder: string | null     // ac/pillar/null
  cabinetId: number | null
}

/** 机房矩阵（对齐 backend/room.py RoomMatrix.to_dict） */
export interface RoomMatrixData {
  schemaVersion: number
  name: string
  rows: string[]
  cols: number[]
  cells: RoomCellData[]
}

/** 标记工具：select 选择；ac/pillar 占位；类型标记；clear 清除标记 */
export type RoomMarkTool =
  | 'select'
  | 'ac'
  | 'pillar'
  | 'gpu'
  | 'network'
  | 'storage'
  | 'compute'
  | 'combined'
  | 'clear'

/** 占位/类型标记对应的 i18n key 后缀（rack.json room.typeLabels.*） */
export const ROOM_TOOL_LABEL_KEYS: Record<RoomMarkTool, string> = {
  select: 'room.select',
  ac: 'room.placeholderAc',
  pillar: 'room.placeholderPillar',
  gpu: 'room.typeGpu',
  network: 'room.typeNetwork',
  storage: 'room.typeStorage',
  compute: 'room.typeCompute',
  combined: 'room.typeCombined',
  clear: 'room.clear',
}

const TYPE_TOOLS = new Set<RoomMarkTool>(['gpu', 'network', 'storage', 'compute', 'combined'])
const PLACEHOLDER_TOOLS = new Set<RoomMarkTool>(['ac', 'pillar'])

/** 机柜类型 → 设备域（对齐 backend RoomConstraints.type_device_map；域外类型如 security/custom/scaleup 视为无限制） */
const CABINET_DEVICE_TYPE: Record<string, string> = {
  gpu: 'gpu',
  network: 'network',
  storage: 'storage',
  compute: 'compute',
}

/** 功率密度散热警告阈值（W/U，超过提示高密度散热风险，不阻塞落位） */
const POWER_DENSITY_WARN = 350

interface RoomState {
  matrix: RoomMatrixData | null
  markTool: RoomMarkTool
  selectedPosition: string | null

  loadMatrix: (projectName: string) => Promise<void>
  createMatrix: (projectName: string, rows: string[], cols: number[], name?: string) => Promise<boolean>
  saveMatrix: (projectName: string) => Promise<boolean>
  setMarkTool: (tool: RoomMarkTool) => void
  markCell: (position: string) => void
  selectPosition: (position: string | null) => void
  mountCabinet: (position: string, cabinetId: number) => MountCheck
  unmountCabinet: (position: string) => MountCheck
  reset: () => void
}

/** T3-3 落位即时校验：占位阻止 / 机柜类型域 / U 位溢出 / 功率超限 / 功率密度散热警告 */
export function checkMount(cabinet: RackCabinet, cell: RoomCellData): MountCheck {
  const errors: string[] = []
  const warnings: string[] = []
  if (cell.placeholder) {
    errors.push(`位置 ${cell.row}${cell.col} 是占位（${cell.placeholder}），不可放置机柜`)
    return { ok: false, errors, warnings }
  }
  const deviceType = CABINET_DEVICE_TYPE[cabinet.type]
  if (deviceType && cell.type !== 'combined' && cell.type !== 'empty' && cell.type !== deviceType) {
    errors.push(`位置 ${cell.row}${cell.col} 类型为 ${cell.type}，不允许放置 ${cabinet.type} 机柜`)
    return { ok: false, errors, warnings }
  }
  const usedU = cabinet.devices.reduce((s, d) => s + (d.endU - d.startU + 1), 0)
  if (usedU > cabinet.totalU) {
    errors.push(`机柜 ${cabinet.name} U 位溢出（${usedU}/${cabinet.totalU}）`)
    return { ok: false, errors, warnings }
  }
  const power = cabinet.devices.reduce((s, d) => s + d.power_watts, 0)
  if (power > cabinet.power_limit) {
    errors.push(`机柜 ${cabinet.name} 功率超限（${power}W > ${cabinet.power_limit}W）`)
    return { ok: false, errors, warnings }
  }
  if (cabinet.totalU > 0 && power / cabinet.totalU > POWER_DENSITY_WARN) {
    warnings.push(`机柜 ${cabinet.name} 功率密度 ${Math.round(power / cabinet.totalU)}W/U 偏高，注意散热`)
  }
  return { ok: errors.length === 0, errors, warnings }
}

/** 工具对应单元目标值（toggle 用） */
function targetFor(tool: RoomMarkTool, cell: RoomCellData): Partial<RoomCellData> {
  if (PLACEHOLDER_TOOLS.has(tool)) {
    // 同位置再次点击同占位 → 清除；点击其他占位 → 切换
    const placeholder = cell.placeholder === tool ? null : tool
    return { placeholder, cabinetId: null }
  }
  if (TYPE_TOOLS.has(tool)) {
    const type = cell.type === tool ? 'empty' : tool
    return { type }
  }
  if (tool === 'clear') {
    return { type: 'empty', placeholder: null, cabinetId: null }
  }
  return {}
}

export const useRoomStore = create<RoomState>()((set, get) => ({
  matrix: null,
  markTool: 'select',
  selectedPosition: null,

  loadMatrix: async (projectName) => {
    try {
      if (window.electron?.project?.getFile) {
        const jsonStr = await window.electron.project.getFile(projectName, 'room_layout.json')
        if (jsonStr) {
          const data = JSON.parse(jsonStr) as RoomMatrixData
          if (data && Array.isArray(data.rows) && Array.isArray(data.cols) && Array.isArray(data.cells)) {
            set({ matrix: data, selectedPosition: null })
            return
          }
        }
      }
    } catch (err) {
      console.error('loadMatrix:', err)
      useToastStore.getState().addToast('error', '机房矩阵加载失败，已重置', 5000)
    }
    set({ matrix: null, selectedPosition: null })
  },

  createMatrix: async (projectName, rows, cols, name) => {
    if (!rows.length || !cols.length) {
      useToastStore.getState().addToast('error', '矩阵必须定义行与列', 5000)
      return false
    }
    try {
      if (!window.electron?.room?.createMatrix) {
        useToastStore.getState().addToast('error', '机房矩阵能力不可用（Electron 桥接未就绪）', 5000)
        return false
      }
      const result = await window.electron.room.createMatrix(rows, cols, name)
      if (result?.error) {
        useToastStore.getState().addToast('error', result.error, 5000)
        return false
      }
      set({ matrix: result as RoomMatrixData, selectedPosition: null })
      return await get().saveMatrix(projectName)
    } catch (err) {
      console.error('createMatrix:', err)
      useToastStore.getState().addToast('error', '机房矩阵创建失败', 5000)
      return false
    }
  },

  saveMatrix: async (projectName) => {
    const { matrix } = get()
    if (!matrix) return false
    try {
      // 保存前经后端校验，防写入损坏布局
      if (window.electron?.room?.validateLayout) {
        const check = await window.electron.room.validateLayout(matrix)
        if (!check.valid) {
          useToastStore.getState().addToast('error', `机房矩阵校验失败: ${check.errors.join('; ')}`, 5000)
          return false
        }
      }
      if (window.electron?.project?.saveFile) {
        await window.electron.project.saveFile(projectName, 'room_layout.json', JSON.stringify(matrix, null, 2))
        useToastStore.getState().addToast('success', '机房矩阵已保存', 3000)
        return true
      }
      return false
    } catch (err) {
      console.error('saveMatrix:', err)
      useToastStore.getState().addToast('error', '机房矩阵保存失败', 5000)
      return false
    }
  },

  setMarkTool: (tool) => set({ markTool: tool }),

  markCell: (position) => {
    const { matrix, markTool } = get()
    if (!matrix) return
    const cell = matrix.cells.find((c) => `${c.row}${c.col}` === position)
    if (!cell) return
    const updates = targetFor(markTool, cell)
    set({
      matrix: {
        ...matrix,
        cells: matrix.cells.map((c) =>
          `${c.row}${c.col}` === position ? { ...c, ...updates } : c,
        ),
      },
      selectedPosition: position,
    })
  },

  selectPosition: (position) => set({ selectedPosition: position }),

  mountCabinet: (position, cabinetId) => {
    const { matrix } = get()
    if (!matrix) return { ok: false, errors: ['机房矩阵未加载'], warnings: [] }
    const cell = matrix.cells.find((c) => `${c.row}${c.col}` === position)
    if (!cell) return { ok: false, errors: [`矩阵位置不存在: ${position}`], warnings: [] }
    const cabinet = useRackStore.getState().cabinets.find((c) => c.id === cabinetId)
    if (!cabinet) return { ok: false, errors: [`机柜不存在: ${cabinetId}`], warnings: [] }
    const check = checkMount(cabinet, cell)
    if (!check.ok) {
      check.errors.forEach((m) => useToastStore.getState().addToast('error', m, 5000))
      return check
    }
    // 目标格子已被其他机柜占用
    if (cell.cabinetId != null && cell.cabinetId !== cabinetId) {
      const msg = `位置 ${position} 已被机柜 ${cell.cabinetId} 占用，请先移除`
      useToastStore.getState().addToast('error', msg, 5000)
      return { ok: false, errors: [msg], warnings: [] }
    }
    set({
      matrix: {
        ...matrix,
        cells: matrix.cells.map((c) => {
          if (c.cabinetId === cabinetId && `${c.row}${c.col}` !== position) {
            return { ...c, cabinetId: null } // 机柜原位置 → 移动
          }
          if (`${c.row}${c.col}` === position) return { ...c, cabinetId }
          return c
        }),
      },
      selectedPosition: position,
    })
    if (check.warnings.length > 0) {
      check.warnings.forEach((m) => useToastStore.getState().addToast('warning', m, 5000))
    }
    return check
  },

  unmountCabinet: (position) => {
    const { matrix } = get()
    if (!matrix) return { ok: false, errors: ['机房矩阵未加载'], warnings: [] }
    const cell = matrix.cells.find((c) => `${c.row}${c.col}` === position)
    if (!cell) return { ok: false, errors: [`矩阵位置不存在: ${position}`], warnings: [] }
    if (cell.cabinetId == null) return { ok: true, errors: [], warnings: [] }
    set({
      matrix: {
        ...matrix,
        cells: matrix.cells.map((c) =>
          `${c.row}${c.col}` === position ? { ...c, cabinetId: null } : c,
        ),
      },
      selectedPosition: position,
    })
    return { ok: true, errors: [], warnings: [] }
  },

  reset: () => set({ matrix: null, selectedPosition: null }),
}))
