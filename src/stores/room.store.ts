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

// ================================================================
// V3.1.4-T8-2: 机房智能落位（对齐 backend room:optimize 输出/入参）
// ================================================================

/** 落位方案中的单个机柜放置（backend placements[]） */
export interface RoomOptimizePlacement {
  position: string
  type: string
  cabinetId: number | null   // counts 模式为 null（用类型标记可视化）
  powerWatts: number
}

/** room:optimize 返回结果 */
export interface RoomOptimizeResult {
  success: boolean
  error?: string
  placements: RoomOptimizePlacement[]
  scores: Record<string, number>   // power_balance/thermal_zones/network_locality/shortest_cable/total
  issues: string[]
  stats: { total_items: number; placed: number; unplaced: number; elapsed_ms: number | null }
}

/** 智能落位入参（cabinets / counts 二选一；matrix 缺省取 store 当前矩阵） */
export interface RoomOptimizeParams {
  matrix?: RoomMatrixData
  counts?: Record<string, number>
  cabinets?: Array<{ id: number; type: string; power_watts: number }>
  objectives?: Record<string, number>
  constraints?: { powerLimitPerRack?: number }
  timeBudgetS?: number
  resetExisting?: boolean
}

/** 可写入格子的机柜类型（对齐 RoomCellData.type 有效值；v1.4 加 power 电源柜） */
const ROOM_MARK_TYPES = new Set(['gpu', 'network', 'storage', 'compute', 'combined', 'power'])

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
  | 'power'
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
  power: 'room.typePower',
  clear: 'room.clear',
}

const TYPE_TOOLS = new Set<RoomMarkTool>(['gpu', 'network', 'storage', 'compute', 'combined', 'power'])
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
  /** 打磨轮（v1.4）：默认列配比自动布点——每列 1 电源 + 空调占位 + GPU(1柜1台) + 网络 */
  composeDefaults: (opts?: { gpuCount?: number; networkCount?: number }) => void
  mountCabinet: (position: string, cabinetId: number) => MountCheck
  unmountCabinet: (position: string) => MountCheck
  // V3.1.4-T8-2: 机房智能落位
  runOptimize: (params: RoomOptimizeParams) => Promise<RoomOptimizeResult | null>
  optimizeCabinets: (opts?: { resetExisting?: boolean }) => Promise<RoomOptimizeResult | null>
  optimizeCounts: (counts: Record<string, number>) => Promise<RoomOptimizeResult | null>
  applyOptimize: (result: RoomOptimizeResult) => { ok: boolean; errors: string[] }
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

  // 打磨轮（v1.4）：默认列配比——每列 1 电源 + 1 空调占位，GPU 1柜1台、网络柜按规模均摊
  composeDefaults: (opts) => {
    const { matrix } = get()
    if (!matrix) return
    const { gpuCount = 0, networkCount = 0 } = opts || {}
    const cols = [...matrix.cols].sort((a, b) => a - b)
    const rows = [...matrix.rows].sort()
    const perCol = Math.max(1, cols.length)
    const gpuPerCol = Math.ceil(gpuCount / perCol)
    const netPerCol = Math.ceil(networkCount / perCol)

    const cells = matrix.cells.map((cell) => {
      // 每列底部 1 电源柜
      if (cell.row === rows[rows.length - 1]) return { ...cell, type: 'power', placeholder: null }
      // 每列顶部 1 空调占位
      if (cell.row === rows[0]) return { ...cell, type: 'empty', placeholder: 'ac' }
      return cell
    })

    const emptyByCol = new Map<number, RoomCellData[]>()
    for (const c of cells) {
      if (c.type === 'empty' && c.placeholder === null) {
        const arr = emptyByCol.get(c.col) || []
        arr.push(c)
        emptyByCol.set(c.col, arr)
      }
    }
    // 每列按 网络→GPU 顺序填充空位（GPU 1柜1台）
    const mark = (cell: RoomCellData, type: string) => {
      const i = cells.findIndex((c) => c.row === cell.row && c.col === cell.col)
      if (i >= 0) cells[i] = { ...cells[i], type, placeholder: null }
    }
    for (const col of cols) {
      const pool = emptyByCol.get(col) || []
      let idx = 0
      for (let n = 0; n < netPerCol && idx < pool.length; n++, idx++) mark(pool[idx], 'network')
      for (let n = 0; n < gpuPerCol && idx < pool.length; n++, idx++) mark(pool[idx], 'gpu')
    }

    set({ matrix: { ...matrix, cells } })
  },

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

  // ===== V3.1.4-T8-2: 机房智能落位 =====

  runOptimize: async (params) => {
    const { matrix } = get()
    if (!matrix) {
      useToastStore.getState().addToast('error', '机房矩阵未加载', 5000)
      return null
    }
    if (!params.counts && !params.cabinets) {
      useToastStore.getState().addToast('error', '请提供落位机柜或数量', 5000)
      return null
    }
    if (!window.electron?.room?.optimize) {
      useToastStore.getState().addToast('error', '智能落位能力不可用（Electron 桥接未就绪）', 5000)
      return null
    }
    try {
      const res = await window.electron.room.optimize({ matrix, ...params })
      if (!res.success) {
        useToastStore.getState().addToast('error', res.error || res.issues?.[0] || '落位计算失败', 5000)
        return null
      }
      return res
    } catch (err) {
      console.error('runOptimize:', err)
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : '落位计算失败', 5000)
      return null
    }
  },

  optimizeCabinets: async (opts) => {
    const { matrix } = get()
    const resetExisting = opts?.resetExisting ?? false
    const allCabs = useRackStore.getState().cabinets
    // 保留手动放置（resetExisting=false）：仅将未上架机柜交给后端（已上架格被排除在候选外，避免重复落位）；
    // 清空重排（true）：全部机柜重新落位
    const mountedIds = resetExisting
      ? new Set<number>()
      : new Set((matrix?.cells ?? []).filter((c) => c.cabinetId != null).map((c) => c.cabinetId))
    const items = allCabs
      .filter((c) => !mountedIds.has(c.id))
      .map((c) => ({
        id: c.id,
        type: c.type,
        power_watts: c.devices.reduce((s, d) => s + d.power_watts, 0),
      }))
    if (items.length === 0) {
      useToastStore.getState().addToast('warning', '暂无可落位机柜（未上架机柜为空）', 4000)
      return null
    }
    return get().runOptimize({ cabinets: items, resetExisting })
  },

  optimizeCounts: async (counts) => {
    // 过滤零值数量，仅提交非空类型
    const clean = Object.fromEntries(
      Object.entries(counts).filter(([, n]) => (Number(n) || 0) > 0),
    )
    if (Object.keys(clean).length === 0) {
      useToastStore.getState().addToast('error', '请填写至少一种机柜数量', 5000)
      return null
    }
    return get().runOptimize({ counts: clean })
  },

  applyOptimize: (result) => {
    const { matrix } = get()
    if (!matrix) return { ok: false, errors: ['机房矩阵未加载'] }
    if (!result?.placements?.length) return { ok: false, errors: ['无可用落位方案'] }
    const errors: string[] = []
    const byPos = new Map<string, RoomOptimizePlacement>()
    for (const p of result.placements) byPos.set(p.position, p)
    // 方案中出现的机柜 id（用于清除被重新落位机柜的旧位置）
    const placedIds = new Set(
      result.placements.filter((p) => p.cabinetId != null).map((p) => p.cabinetId as number),
    )
    const cells = matrix.cells.map((cell) => {
      const pos = `${cell.row}${cell.col}`
      const pl = byPos.get(pos)
      // 机柜被方案移到别处 → 清除旧位置（保留未参与方案的机柜，即手动放置）
      if (cell.cabinetId != null && placedIds.has(cell.cabinetId) && pl?.cabinetId !== cell.cabinetId) {
        return { ...cell, cabinetId: null }
      }
      if (!pl) return cell
      if (cell.placeholder) {
        errors.push(`位置 ${pos} 是占位（${cell.placeholder}），跳过落位`)
        return cell
      }
      const next: RoomCellData = { ...cell }
      if (pl.cabinetId != null) {
        next.cabinetId = pl.cabinetId
      } else if (cell.cabinetId != null) {
        // counts 模式落在原有机柜格（清空重排场景）→ 移除旧机柜
        next.cabinetId = null
      }
      // 类型标记：仅填充空/组合格（counts 模式无 cabinetId，用类型可视化落位结果）
      if ((cell.type === 'empty' || cell.type === 'combined') && ROOM_MARK_TYPES.has(pl.type)) {
        next.type = pl.type
      }
      return next
    })
    set({ matrix: { ...matrix, cells }, selectedPosition: null })
    return { ok: errors.length === 0, errors }
  },

  reset: () => set({ matrix: null, selectedPosition: null }),
}))
