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

// M5: 机柜顶部预留 U 数（业界通用：顶部预留空间，网络设备从顶部向下、服务器从底部向上）
export const DEFAULT_TOP_RESERVED_U = 2

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

// M-F2（F2-1）：跨项目粘贴兼容校验新增原因（type=机柜类型不匹配 / totalU=柜高不匹配 / device_type=设备类型域不匹配）
export type TemplateConflictReason =
  | 'occupied'
  | 'overflow'
  | 'top_reserved'
  | 'power'
  | 'type_mismatch'
  | 'totalU_mismatch'
  | 'device_type_mismatch'

export interface TemplateConflict {
  cabinetId: number
  deviceName: string
  startU: number
  reason: TemplateConflictReason
}

export interface ApplyCabinetTemplateResult {
  applied: number
  skipped: number
  conflicts: TemplateConflict[]
}

// ===== M3（AL-CP1/CP2）+ M-F2（F2-1）：应用内剪贴板（机柜/设备复制粘贴；非 OS 剪贴板） =====

/** M3：剪贴板态——机柜或设备深拷贝 + 源柜 id（粘贴目标柜/新柜用） */
export type RackClipboard =
  | { type: 'cabinet'; cabinet: RackCabinet; sourceCabinetId: number; sourceProjectName?: string | null }
  | { type: 'device'; device: RackDevice; sourceCabinetId: number; sourceProjectName?: string | null }

/**
 * M-F2（F2-1）：应用级剪贴板信封——复制时序列化到 localStorage（key `autolink-clipboard`），
 * 切换项目后仍可粘贴；sourceProjectName 记录来源项目，供跨项目兼容校验与 UI 提示。
 */
export interface RackClipboardEnvelope {
  schemaVersion: number
  type: 'cabinet' | 'device'
  /** 机柜或设备深拷贝（按 type 二选一） */
  data: RackCabinet | RackDevice
  sourceCabinetId: number
  /** 来源项目名（currentProjectName 为空时为 null，视为未知来源 → 不做跨项目严格校验） */
  sourceProjectName: string | null
  serializedAt: string
}

/** M-F2（F2-1）：应用级剪贴板 localStorage key（跨项目共享，不随项目切换清空） */
export const CLIPBOARD_STORAGE_KEY = 'autolink-clipboard'
/** M-F2（F2-1）：剪贴板信封结构版本（不兼容旧格式时忽略并提示） */
export const CLIPBOARD_SCHEMA_VERSION = 1
/** M-F2（F2-1）：剪贴板序列化字节上限（防止超大连通柜撑爆 localStorage） */
export const CLIPBOARD_MAX_BYTES = 256 * 1024

/** M3：设备粘贴失败原因（U 位/顶部预留/占用/功率/无空位/无剪贴板内容） */
export type DevicePasteReason =
  | 'no_clipboard'
  | 'overflow'
  | 'top_reserved'
  | 'occupied'
  | 'power'
  | 'no_space'
  // M-F2（F2-1）：跨项目设备类型与目标柜类型域不兼容
  | 'type_mismatch'

export interface DevicePasteResult {
  ok: boolean
  reason?: DevicePasteReason
  startU?: number
  endU?: number
  deviceName?: string
  // M-F2（F2-1）：跨项目粘贴标记（成功时置 true，供 UI 提示来源项目）
  crossProject?: boolean
  sourceProjectName?: string | null
}

// M4/M5（AL-ED2/ED7/ED6）：机柜/设备批量更新冲突原因（overflow=改矮/越界、power=功率改小/超限、top_reserved=柜顶预留区、occupied=U位被占）
export type BulkUpdateIssueReason = 'overflow' | 'power' | 'top_reserved' | 'occupied'

export interface BulkUpdateIssue {
  cabinetId: number
  reason: BulkUpdateIssueReason
  message: string
}

export interface BulkUpdateResult {
  applied: number
  skipped: number
  issues: BulkUpdateIssue[]
}

/** 机柜属性补丁（批量/单柜编辑共用；顶部预留为全局 topReservedU，不在此补丁内） */
export type CabinetPatch = Partial<Pick<RackCabinet, 'name' | 'totalU' | 'type' | 'power_limit'>>

/**
 * M4（AL-ED7）：机柜属性补丁冲突校验纯函数（M6 统一校验可在此扩展）
 * - totalU 改矮：设备最高占用 U 位 > 新高度 → overflow
 * - power_limit 改小：设备总功率 > 新上限 → power
 */
export function validateCabinetPatch(cabinet: RackCabinet, patch: CabinetPatch): BulkUpdateIssue[] {
  const issues: BulkUpdateIssue[] = []
  const nextTotalU = patch.totalU ?? cabinet.totalU
  const maxEndU = cabinet.devices.reduce((m, d) => Math.max(m, d.endU), 0)
  if (patch.totalU != null && maxEndU > nextTotalU) {
    issues.push({
      cabinetId: cabinet.id,
      reason: 'overflow',
      message: `机柜 ${cabinet.name} 设备最高占用到 ${maxEndU}U，超过新高度 ${nextTotalU}U`,
    })
  }
  const usedPower = cabinet.devices.reduce((s, d) => s + d.power_watts, 0)
  if (patch.power_limit != null && usedPower > patch.power_limit) {
    issues.push({
      cabinetId: cabinet.id,
      reason: 'power',
      message: `机柜 ${cabinet.name} 功率 ${usedPower}W 超过新上限 ${patch.power_limit}W`,
    })
  }
  return issues
}

/** M5（AL-ED6）：设备属性补丁（同柜批量改属性用） */
export type DevicePatch = Partial<Pick<RackDevice, 'name' | 'type' | 'power_watts'>>

export type DeviceMoveReason = 'overflow' | 'top_reserved' | 'occupied' | 'power'
export interface DeviceMoveCheck {
  ok: boolean
  reason: DeviceMoveReason | null
}

/**
 * M5（AL-ED5）：设备拖拽落点预判纯函数——与 moveDevice 落库校验同源（M6 统一校验可在此收敛）
 * - overflow：越界（startU<1 或 endU>totalU）
 * - top_reserved：进入柜顶预留区
 * - occupied：与其他设备 U 位重叠（排除自身）
 * - power：目标柜其余设备功率 + 自身功率超上限
 */
export function checkDeviceMove(
  cabinet: RackCabinet,
  device: RackDevice,
  newStartU: number,
  topReservedU: number,
): DeviceMoveCheck {
  const height = device.endU - device.startU + 1
  const newEndU = newStartU + height - 1
  if (newStartU < 1 || newEndU > cabinet.totalU) return { ok: false, reason: 'overflow' }
  if (newEndU > cabinet.totalU - topReservedU) return { ok: false, reason: 'top_reserved' }
  const occupied = cabinet.devices.some(
    (d) => d.id !== device.id && !(newEndU < d.startU || newStartU > d.endU),
  )
  if (occupied) return { ok: false, reason: 'occupied' }
  const power = cabinet.devices
    .filter((d) => d.id !== device.id)
    .reduce((s, d) => s + d.power_watts, 0)
  if (power + device.power_watts > cabinet.power_limit) return { ok: false, reason: 'power' }
  return { ok: true, reason: null }
}

/**
 * M5（AL-ED5）：在目标柜寻找设备第一个可用落点（bottom-up，含顶部预留/占用/功率校验）
 * @param opts.topReservedU 柜顶预留（默认 DEFAULT_TOP_RESERVED_U）
 * @param opts.power_watts 设备功率（提供时做功率预判）
 * @param opts.excludeDeviceId 排除设备（同柜重排时排除自身）
 */
export function findFirstAvailableU(
  cabinet: RackCabinet,
  height: number,
  opts: { topReservedU?: number; power_watts?: number; excludeDeviceId?: string } = {},
): number | null {
  const topReservedU = opts.topReservedU ?? DEFAULT_TOP_RESERVED_U
  const maxEndU = cabinet.totalU - topReservedU
  for (let startU = 1; startU + height - 1 <= maxEndU; startU++) {
    const endU = startU + height - 1
    const occupied = cabinet.devices.some(
      (d) => d.id !== opts.excludeDeviceId && !(endU < d.startU || startU > d.endU),
    )
    if (occupied) continue
    if (opts.power_watts != null) {
      const power = cabinet.devices
        .filter((d) => d.id !== opts.excludeDeviceId)
        .reduce((s, d) => s + d.power_watts, 0)
      if (power + opts.power_watts > cabinet.power_limit) return null
    }
    return startU
  }
  return null
}

/**
 * M5（AL-ED6）：批量 U 位偏移整批校验——任一选中设备越界/入预留区/与其他设备冲突即整批拒绝
 * （偏移为整体语义，部分应用会造成柜内间隙错乱）
 */
export function validateShiftDevices(
  cabinet: RackCabinet,
  deviceIds: string[],
  offset: number,
  topReservedU: number,
): BulkUpdateIssue[] {
  const issues: BulkUpdateIssue[] = []
  const idSet = new Set(deviceIds)
  const selected = cabinet.devices.filter((d) => idSet.has(d.id))
  if (selected.length === 0) return issues
  const others = cabinet.devices.filter((d) => !idSet.has(d.id))
  for (const d of selected) {
    const ns = d.startU + offset
    const ne = d.endU + offset
    if (ns < 1 || ne > cabinet.totalU) {
      issues.push({ cabinetId: cabinet.id, reason: 'overflow', message: `设备 ${d.name} 偏移后 U 位越界（U${ns}-U${ne}）` })
      return issues
    }
    if (ne > cabinet.totalU - topReservedU) {
      issues.push({ cabinetId: cabinet.id, reason: 'top_reserved', message: `设备 ${d.name} 偏移后进入柜顶预留区（U${ne}U）` })
      return issues
    }
    const occupied = others.some((o) => !(ne < o.startU || ns > o.endU))
    if (occupied) {
      issues.push({ cabinetId: cabinet.id, reason: 'occupied', message: `设备 ${d.name} 偏移后与其他设备 U 位冲突` })
      return issues
    }
  }
  return issues
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
  /** 打磨轮（v1.4 / AL-R2c）：整表替换机柜布局（矩阵落位用，避免逐条 addCabinet 污染 id） */
  setRacks: (cabinets: RackCabinet[], unplacedDevices?: UnplacedDevice[], selectedCabinetId?: number | null) => void
  /** 打磨轮（v1.5 / AL-R1b）：柜内智能落位（后端 rack:optimize → 应用 U 位方案） */
  optimizeRacks: (gpuPerCabinet?: number) => Promise<{ stats?: { placed: number; unplaced: number } } | null>
  /** 打磨轮（v1.5 / AL-R1d / PRD AL-R6）：把源柜（模板柜）的设备对象整体复制到所有同类柜并返回冲突明细 */
  applyCabinetTemplate: (sourceId: number) => ApplyCabinetTemplateResult
  loadRackLayout: (projectName: string) => Promise<void>
  saveRackLayout: (projectName: string) => Promise<void>
  addCabinet: (totalU?: number, type?: CabinetType, powerLimit?: number) => void
  /** M2（AL-UR1）：recordHistory=false 时不压撤销栈（跨 store 批量操作由调用方统一压一次快照） */
  removeCabinet: (id: number, recordHistory?: boolean) => void
  selectCabinet: (id: number | null) => void
  /** M2（AL-UR1）：recordHistory=false 时不压撤销栈（跨 store 批量操作由调用方统一压一次快照） */
  updateCabinet: (id: number, updates: Partial<Pick<RackCabinet, 'name' | 'totalU' | 'type' | 'power_limit'>>, recordHistory?: boolean) => void
  /** M5（AL-ED4）：单柜信息调整——带冲突校验（改矮/功率改小冲突阻塞不落库，复用 validateCabinetPatch） */
  updateCabinetSafe: (id: number, patch: CabinetPatch) => BulkUpdateResult
  /** M4（AL-ED2/ED7）：批量更新机柜属性（冲突柜跳过并返回 issues） */
  updateCabinetsBulk: (ids: number[], patch: CabinetPatch) => BulkUpdateResult
  /** M4（AL-ED2）：按机柜类型批量更新属性（同类型柜全量） */
  updateCabinetsByType: (type: CabinetType, patch: CabinetPatch) => BulkUpdateResult
  /** M4/M5: 项目机柜配置（顶部预留 U / 每柜 GPU 数量），上架校验与优化按此生效 */
  topReservedU: number
  gpuPerCabinet: number
  setRackConfig: (cfg: { topReservedU?: number; gpuPerCabinet?: number }) => void
  /** M4: 清空柜内设计（设备回待上架池），用于改布局后重新规划 */
  clearCabinets: () => void
  placeDevice: (cabinetId: number, device: UnplacedDevice, startU: number) => boolean
  removeDevice: (cabinetId: number, deviceId: string) => void
  moveDevice: (deviceId: string, fromCabinet: number, toCabinet: number, newStartU: number) => boolean
  /** M5（AL-ED6）：同柜设备批量改属性（名称/类型/功率；功率改小超限设备跳过并返回 issues） */
  updateDevicesBulk: (cabinetId: number, deviceIds: string[], patch: DevicePatch) => BulkUpdateResult
  /** M5（AL-ED6）：同柜设备批量 U 位偏移（整批原子：任一越界/入预留区/冲突即整批拒绝） */
  shiftDevicesU: (cabinetId: number, deviceIds: string[], offset: number) => BulkUpdateResult
  // ===== M3（AL-CP1/CP2）：应用内剪贴板复制/粘贴（机柜与设备） =====
  /** 应用内剪贴板态（机柜深拷贝 / 设备深拷贝；复制操作不压撤销栈） */
  clipboard: RackClipboard | null
  /** 复制机柜（名称/类型/功率/设备深拷贝）到剪贴板；柜不存在返回 false */
  copyCabinet: (cabinetId: number) => boolean
  /** 把剪贴板机柜的设备/类型/功率应用到目标柜：设备 U 位映射，冲突跳过并返回明细 */
  pasteCabinet: (targetCabinetId: number) => ApplyCabinetTemplateResult
  /** 把剪贴板机柜粘贴为新柜（名称后缀「-副本」）；无机柜剪贴板返回 null；返回新柜 id */
  pasteCabinetToNew: () => number | null
  /** 复制设备（深拷贝）到剪贴板；设备不存在返回 false */
  copyDevice: (cabinetId: number, deviceId: string) => boolean
  /** 粘贴剪贴板设备到目标柜指定 U 位（U 位/顶部预留/功率校验），失败返回 reason */
  pasteDevice: (targetCabinetId: number, startU: number) => DevicePasteResult
  /** 粘贴剪贴板设备到目标柜首个可用 U 位（bottom-up 自动找位） */
  pasteDeviceAuto: (targetCabinetId: number) => DevicePasteResult
  /** 清空剪贴板 */
  clearClipboard: () => void
  /** 是否有剪贴板内容（可传 type 限定机柜/设备） */
  hasClipboard: (type?: RackClipboard['type']) => boolean
  // ===== M-F2（F2-1）：跨项目剪贴板 =====
  /** 读取剪贴板来源信息（type + sourceProjectName），供 UI 跨项目提示；空返回 null */
  getClipboardSource: () => { type: RackClipboard['type']; sourceProjectName: string | null } | null
  /** 记录当前项目上下文（项目切换/加载时由 loadRackLayout 自动维护；测试可显式调用模拟切换） */
  setCurrentProjectName: (projectName: string | null) => void
  selectedDeviceInfo: (id: string) => RackDevice | null
  selectDevice: (id: string | null) => void
  /** 打磨轮（v1.5 / AL-O1b）：batchName 提供时写入版本批次目录 output/<batch>/ */
  exportToExcel: (projectName: string, batchName?: string) => Promise<string>
  importCabinetList: (csvData: string) => void
  getPowerUsage: (cabinetId: number) => { used: number; limit: number; percent: number; exceeded: boolean }
  getPowerUsageAll: () => { total: number; limit: number; percent: number }

  // ===== M2（AL-UR1/UR2）：编辑撤销/重做命令栈 =====
  /** 编辑快照栈（编辑前的状态，undo 时弹出恢复；栈深上限 RACK_UNDO_LIMIT） */
  undoStack: RackHistorySnapshot[]
  /** 重做快照栈（undo 时压入当前态，redo 时弹出恢复；新编辑清空） */
  redoStack: RackHistorySnapshot[]
  canUndo: boolean
  canRedo: boolean
  /** 显式压入一次编辑快照（跨 store 批量操作前调用，使一次操作仅产生一条历史） */
  pushHistory: () => void
  undo: () => void
  redo: () => void
}

/** M2（AL-UR1）：编辑撤销/重做栈深度上限 */
export const RACK_UNDO_LIMIT = 50

/** M2（AL-UR1）：rack.store 编辑快照（编辑前状态，用于撤销/重做恢复） */
export interface RackHistorySnapshot {
  cabinets: RackCabinet[]
  unplacedDevices: UnplacedDevice[]
  selectedCabinetId: number | null
  selectedDevice: RackDevice | null
  addDeviceMode: boolean
  editingDevice: string | null
}

/** M2（AL-UR1）：深拷贝当前 rack 状态为编辑快照 */
function cloneRackHistory(state: RackState): RackHistorySnapshot {
  return {
    cabinets: structuredClone(state.cabinets),
    unplacedDevices: structuredClone(state.unplacedDevices),
    selectedCabinetId: state.selectedCabinetId,
    selectedDevice: state.selectedDevice ? structuredClone(state.selectedDevice) : null,
    addDeviceMode: state.addDeviceMode,
    editingDevice: state.editingDevice,
  }
}

/** M2（AL-UR1）：编辑前压入快照 → 返回命令栈更新（新编辑清空 redo，栈深封顶） */
function pushRackHistory(state: RackState): Pick<RackState, 'undoStack' | 'redoStack' | 'canUndo' | 'canRedo'> {
  const undoStack = [...state.undoStack, cloneRackHistory(state)].slice(-RACK_UNDO_LIMIT)
  return { undoStack, redoStack: [], canUndo: true, canRedo: false }
}

// ===== M3（AL-CP1/CP2）：复制/粘贴辅助 =====

/** M3：粘贴到新柜的名称后缀（已有「-副本」则递增「-副本2」「-副本3」） */
function nextCopyName(existingNames: string[], base: string): string {
  const names = new Set(existingNames)
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base}${i}`)) i++
  return `${base}${i}`
}

/** M3：粘贴设备生成新 id（避免跨柜/同柜 id 冲突破坏选中/移动/批量），带柜内唯一兜底 */
let copyDeviceSeq = 0
function freshDeviceId(existingIds: Set<string>, base: string): string {
  let id = `${base}_copy_${++copyDeviceSeq}`
  while (existingIds.has(id)) id = `${base}_copy_${++copyDeviceSeq}`
  return id
}

// ===== M-F2（F2-1）：跨项目剪贴板——应用级 localStorage + 兼容校验 =====

/** M-F2（F2-1）：当前项目上下文（loadRackLayout/setCurrentProjectName 维护；null=无项目/未加载，不做跨项目严格校验） */
let currentProjectName: string | null = null

/** M-F2（F2-1）：设置当前项目上下文（项目切换/加载时调用；测试可显式调用模拟跨项目） */
export function setRackCurrentProject(projectName: string | null): void {
  currentProjectName = projectName
}

/** M-F2（F2-1）：当前项目名只读（供外部判断项目上下文） */
export function getRackCurrentProject(): string | null {
  return currentProjectName
}

/** M-F2（F2-1）：把信封序列化到应用级 localStorage（容量守卫，超限丢弃并 console 提示） */
export function saveClipboardEnvelope(envelope: RackClipboardEnvelope): void {
  try {
    const json = JSON.stringify(envelope)
    if (json.length > CLIPBOARD_MAX_BYTES) {
      console.warn('[clipboard] 剪贴板内容超限，未写入 localStorage:', json.length)
      return
    }
    localStorage.setItem(CLIPBOARD_STORAGE_KEY, json)
  } catch (err) {
    console.error('[clipboard] localStorage 写入失败:', err)
  }
}

/** M-F2（F2-1）：从应用级 localStorage 读取信封（结构/版本校验；损坏返回 null） */
export function loadClipboardEnvelope(): RackClipboardEnvelope | null {
  try {
    const raw = localStorage.getItem(CLIPBOARD_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RackClipboardEnvelope>
    if (parsed?.schemaVersion !== CLIPBOARD_SCHEMA_VERSION) return null
    if (parsed.type !== 'cabinet' && parsed.type !== 'device') return null
    if (!parsed.data || typeof parsed.data !== 'object') return null
    return parsed as RackClipboardEnvelope
  } catch {
    return null
  }
}

/** M-F2（F2-1）：清除应用级剪贴板 */
export function clearClipboardEnvelope(): void {
  try {
    localStorage.removeItem(CLIPBOARD_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * M-F2（F2-1）：是否跨项目粘贴——来源项目存在且与当前项目不同
 * （sourceProjectName 为 null/空 / 当前无项目上下文 → 视为项目内，保持既有行为）
 */
export function isCrossProjectClipboard(sourceProjectName: string | null | undefined): boolean {
  if (!sourceProjectName) return false
  if (!currentProjectName) return false
  return sourceProjectName !== currentProjectName
}

/**
 * M-F2（F2-1）：从应用级 localStorage 恢复剪贴板到内存（粘贴/检查用；内存已有则直接返回）。
 * 切换项目后内存剪贴板被清空/重建，localStorage 仍是唯一来源。
 */
function resolveClipboardFromStorage(): RackClipboard | null {
  const s = useRackStore.getState()
  if (s.clipboard) return s.clipboard
  const env = loadClipboardEnvelope()
  if (!env) return null
  const clip: RackClipboard =
    env.type === 'cabinet'
      ? {
          type: 'cabinet',
          cabinet: env.data as RackCabinet,
          sourceCabinetId: env.sourceCabinetId,
          sourceProjectName: env.sourceProjectName,
        }
      : {
          type: 'device',
          device: env.data as RackDevice,
          sourceCabinetId: env.sourceCabinetId,
          sourceProjectName: env.sourceProjectName,
        }
  useRackStore.setState({ clipboard: clip })
  return clip
}

/** M-F2（F2-1）：设备类型 → 设备域（gpu/storage/network/compute；无法识别返回 null 表示不限制） */
export function deviceDomainOf(type: string | undefined): string | null {
  const t = (type ?? '').toLowerCase()
  if (t.includes('gpu')) return 'gpu'
  if (t.includes('存储') || t.includes('storage')) return 'storage'
  if (t.includes('switch') || t.includes('交换机') || t.includes('leaf') || t.includes('spine') || t.includes('core')) return 'network'
  if (t.includes('通算') || t.includes('compute')) return 'compute'
  return null
}

/** M-F2（F2-1）：机柜类型 → 设备域（security/custom/scaleup/power 等域外类型不限制） */
export function cabinetDomainOf(type: CabinetType): string | null {
  if (type === 'gpu' || type === 'network' || type === 'storage' || type === 'compute') return type
  return null
}

/**
 * M-F2（F2-1）：跨项目机柜 → 目标柜兼容预检（整柜级）
 * - type 不一致 → 'type_mismatch'；totalU 不一致 → 'totalU_mismatch'；兼容返回 null
 */
export function checkCrossProjectCabinetCompatibility(
  source: RackCabinet,
  target: RackCabinet,
): TemplateConflictReason | null {
  if (source.type !== target.type) return 'type_mismatch'
  if (source.totalU !== target.totalU) return 'totalU_mismatch'
  return null
}

/** M-F2（F2-1）：跨项目设备 → 目标柜类型域兼容校验；兼容返回 null，否则 'type_mismatch' */
export function checkCrossProjectDeviceCompatibility(
  device: RackDevice,
  target: RackCabinet,
): TemplateConflictReason | null {
  const dom = deviceDomainOf(device.type)
  if (!dom) return null
  const cdom = cabinetDomainOf(target.type)
  if (!cdom) return null
  return dom === cdom ? null : 'type_mismatch'
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
  // M3（AL-CP1/CP2）：应用内剪贴板（初始为空；不持久化）
  clipboard: null,
  // M2（AL-UR1）：编辑撤销/重做命令栈（仅内存会话，不持久化）
  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,
  // M4/M5: 项目机柜配置默认值（由 setRackConfig 覆盖）
  topReservedU: DEFAULT_TOP_RESERVED_U,
  gpuPerCabinet: 1,
  setRackConfig: (cfg) =>
    set((s) => ({
      topReservedU: cfg.topReservedU ?? s.topReservedU,
      gpuPerCabinet: cfg.gpuPerCabinet ?? s.gpuPerCabinet,
    })),

  // ===== M2（AL-UR1/UR2）：编辑撤销/重做命令栈 =====
  pushHistory: () => set((s) => pushRackHistory(s)),

  undo: () => {
    const s = get()
    if (s.undoStack.length === 0) return
    const prev = s.undoStack[s.undoStack.length - 1]
    const undoStack = s.undoStack.slice(0, -1)
    const redoStack = [...s.redoStack, cloneRackHistory(s)].slice(-RACK_UNDO_LIMIT)
    set({
      ...prev,
      undoStack,
      redoStack,
      canUndo: undoStack.length > 0,
      canRedo: true,
    })
  },

  redo: () => {
    const s = get()
    if (s.redoStack.length === 0) return
    const next = s.redoStack[s.redoStack.length - 1]
    const redoStack = s.redoStack.slice(0, -1)
    const undoStack = [...s.undoStack, cloneRackHistory(s)].slice(-RACK_UNDO_LIMIT)
    set({
      ...next,
      undoStack,
      redoStack,
      canUndo: true,
      canRedo: redoStack.length > 0,
    })
  },

  clearCabinets: () => {
    const { cabinets } = get()
    // M2（AL-UR1）：空柜清空为 no-op，不压栈
    if (cabinets.length === 0) return
    const reflow: UnplacedDevice[] = []
    for (const c of cabinets) {
      for (const d of c.devices) {
        reflow.push({
          id: d.id,
          name: d.name,
          type: d.type,
          height: d.endU - d.startU + 1,
          power_watts: d.power_watts,
        })
      }
    }
    set((s) => ({
      ...pushRackHistory(s),
      cabinets: [],
      unplacedDevices: [...s.unplacedDevices, ...reflow],
      selectedCabinetId: null,
      selectedDevice: null,
    }))
  },

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
    set((s) => ({
      ...pushRackHistory(s),
      cabinets,
      unplacedDevices,
      selectedCabinetId: cabinets.length > 0 ? 1 : null,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
    }))
  },

  initFromTopology: (topologyNodes, rackType = 42, powerLimit = 6000) => {
    // V2.9.2: 优先采用后端分配(cabinetId/type/startU/endU/power/uHeight)，
    // 服务器按 group 分类(gpu/storage/compute)，交换机归为网络柜
    const nodes = topologyNodes.filter(
      (n) => n.cabinetId != null || n.type === 'server',
    )
    if (nodes.length === 0) {
      // 无有效节点 → 空状态（不虚构机柜，等待渲染拓扑）
      set((s) => ({
        ...pushRackHistory(s),
        cabinets: [],
        unplacedDevices: [],
        selectedCabinetId: null,
        addDeviceMode: false,
        selectedDevice: null,
        editingDevice: null,
      }))
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

    set((s) => ({
      ...pushRackHistory(s),
      cabinets,
      unplacedDevices,
      selectedCabinetId: cabinets.length > 0 ? cabinets[0].id : null,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
    }))
  },

  setRacks: (cabinets, unplacedDevices = [], selectedCabinetId = null) =>
    set((s) => ({
      ...pushRackHistory(s),
      cabinets,
      unplacedDevices,
      selectedCabinetId,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
    })),

  // 打磨轮（v1.5 / AL-R1b）：柜内智能落位——待上架池 → 现有柜 U 位
  optimizeRacks: async (gpuPerCabinet = 1) => {
    const { cabinets, unplacedDevices } = get()
    if (unplacedDevices.length === 0) {
      useToastStore.getState().addToast('warning', '待上架设备池为空，暂无可落位设备', 4000)
      return null
    }
    if (cabinets.length === 0) {
      useToastStore.getState().addToast('warning', '无机柜可放置，请先创建/上架机柜', 4000)
      return null
    }
    if (!window.electron?.rack?.optimize) {
      useToastStore.getState().addToast('error', '柜内智能落位能力不可用（Electron 桥接未就绪）', 5000)
      return null
    }
    try {
      const res = await window.electron.rack.optimize({
        cabinets: cabinets.map((c) => ({
          id: c.id, type: c.type, totalU: c.totalU, power_limit: c.power_limit,
          devices: c.devices.map((d) => ({ id: d.id, startU: d.startU, endU: d.endU, power_watts: d.power_watts })),
        })),
        unplaced_devices: unplacedDevices.map((d) => ({ id: d.id, name: d.name, type: d.type, height: d.height, power_watts: d.power_watts })),
        gpu_per_cabinet: gpuPerCabinet,
      })
      if (!res?.success) {
        useToastStore.getState().addToast('error', '落位计算失败', 5000)
        return null
      }
      const stats = res.stats ?? { placed: 0, unplaced: 0 }
      // 应用方案：把放置结果写入柜内（信任后端约束校验）
      const poolById = new Map(unplacedDevices.map((d) => [d.id, d]))
      const placedIds = new Set((res.placements ?? []).map((p) => p.deviceId))
      set((s) => ({
        cabinets: s.cabinets.map((c) => {
          const added = (res.placements ?? [])
            .filter((p) => p.cabinetId === c.id)
            .map((p) => {
              const d = poolById.get(p.deviceId)!
              return { id: d.id, name: d.name, type: d.type, cabinetId: c.id, startU: p.startU, endU: p.endU, power_watts: d.power_watts }
            })
          return added.length > 0 ? { ...c, devices: [...c.devices, ...added] } : c
        }),
        unplacedDevices: s.unplacedDevices.filter((d) => !placedIds.has(d.id)),
      }))
      useToastStore.getState().addToast(
        'success',
        `柜内智能落位完成：放置 ${stats.placed} 台${stats.unplaced > 0 ? `，${stats.unplaced} 台无位置留在待上架池` : ''}`,
        5000,
      )
      return { stats }
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : '落位失败', 5000)
      return null
    }
  },

  // 打磨轮（v1.5 / AL-R1d / PRD AL-R6）：批量应用整柜设计模板（设备/名称/功率复制 + 冲突明细）
  applyCabinetTemplate: (sourceId) => {
    const { cabinets, topReservedU } = get()
    const source = cabinets.find((c) => c.id === sourceId)
    if (!source) return { applied: 0, skipped: 0, conflicts: [] }
    let applied = 0
    const conflicts: TemplateConflict[] = []
    const newCabinets = cabinets.map((c) => {
      if (c.id === sourceId || c.type !== source.type) return c
      const devices = [...c.devices]
      for (const sd of source.devices) {
        // 冲突判定①：U 位溢出柜高
        if (sd.startU < 1 || sd.endU > c.totalU) {
          conflicts.push({ cabinetId: c.id, deviceName: sd.name, startU: sd.startU, reason: 'overflow' })
          continue
        }
        // 冲突判定②：柜顶预留区（顶部预留 U 保护）
        if (sd.endU > c.totalU - topReservedU) {
          conflicts.push({ cabinetId: c.id, deviceName: sd.name, startU: sd.startU, reason: 'top_reserved' })
          continue
        }
        // 冲突判定③：U 位被占
        if (devices.some((d) => !(sd.endU < d.startU || sd.startU > d.endU))) {
          conflicts.push({ cabinetId: c.id, deviceName: sd.name, startU: sd.startU, reason: 'occupied' })
          continue
        }
        // 冲突判定④：功率超限
        const currentPower = devices.reduce((sum, d) => sum + d.power_watts, 0)
        if (currentPower + sd.power_watts > c.power_limit) {
          conflicts.push({ cabinetId: c.id, deviceName: sd.name, startU: sd.startU, reason: 'power' })
          continue
        }
        // 整柜模板复制：设备对象整体复制（含名称/功率/类型），U 位按源柜布局放置
        devices.push({ ...sd, cabinetId: c.id })
        applied++
      }
      return { ...c, totalU: source.totalU, power_limit: source.power_limit, devices }
    })
    // M2（AL-UR1）：整柜模板应用为可撤销编辑（复制设备/同步属性 → 撤销整体回退）
    set((s) => ({ ...pushRackHistory(s), cabinets: newCabinets }))
    return { applied, skipped: conflicts.length, conflicts }
  },

  loadRackLayout: async (projectName) => {
    // M-F2（F2-1/2）：记录当前项目上下文（跨项目粘贴判断 + 撤销持久化按项目落盘）
    setRackCurrentProject(projectName)
    try {
      if (window.electron?.project?.getFile) {
        const jsonStr = await window.electron.project.getFile(projectName, 'rack_layout.json')
        if (jsonStr) {
          const data = JSON.parse(jsonStr)
          if (data.cabinets && Array.isArray(data.cabinets)) {
            // Ensure new fields have defaults (AL-N4: 补 totalU/device.type 默认，防 GPU 柜缺字段渲染崩溃)
            const cabinets = (data.cabinets as RackCabinet[]).map((c) => ({
              ...c,
              type: c.type || 'gpu',
              totalU: c.totalU || 42,
              power_limit: c.power_limit || 6000,
              devices: (c.devices || []).map((d) => ({
                ...d,
                type: d.type || 'gpu',
                power_watts: d.power_watts || 0,
              })),
            }))
            set((s) => ({
              ...pushRackHistory(s),
              cabinets,
              unplacedDevices: [],
              selectedCabinetId: cabinets.length > 0 ? cabinets[0].id : null,
              addDeviceMode: false,
              selectedDevice: null,
              editingDevice: null,
            }))
            // M-F2（F2-2）：加载完成后恢复上次会话持久化的撤销/重做栈（覆盖加载产生的快照）
            await restoreRackUndoHistory(projectName).catch(() => {})
            return
          }
        }
      }
    } catch (err) {
      console.error('loadRackLayout:', err)
      useToastStore.getState().addToast('error', '机柜布局加载失败，已重置为空状态', 5000)
    }
    // V2.9.2: 无布局文件 → 空状态（不虚构机柜），渲染拓扑后由 initFromTopology 填充
    set((s) => ({
      ...pushRackHistory(s),
      cabinets: [],
      unplacedDevices: [],
      selectedCabinetId: null,
      addDeviceMode: false,
      selectedDevice: null,
      editingDevice: null,
    }))
    // M-F2（F2-2）：空状态也恢复持久化撤销栈（可回退到重启前）
    await restoreRackUndoHistory(projectName).catch(() => {})
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
        ...pushRackHistory(s),
        cabinets: [...s.cabinets, { id: newId, name: `机柜 ${label}`, totalU, type, power_limit: powerLimit, devices: [] }],
      }
    })
  },

  removeCabinet: (id, recordHistory = true) => {
    set((s) => {
      return {
        ...(recordHistory ? pushRackHistory(s) : {}),
        cabinets: s.cabinets.filter((c) => c.id !== id),
        selectedCabinetId: s.selectedCabinetId === id ? null : s.selectedCabinetId,
      }
    })
  },

  selectCabinet: (id) => set({ selectedCabinetId: id, addDeviceMode: false, editingDevice: null }),

  updateCabinet: (id, updates, recordHistory = true) => {
    set((s) => ({
      ...(recordHistory ? pushRackHistory(s) : {}),
      cabinets: s.cabinets.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }))
  },

  // M5（AL-ED4）：单柜信息调整——冲突（改矮/功率改小）校验阻塞不落库（复用 validateCabinetPatch）
  updateCabinetSafe: (id, patch) => {
    const cabinet = get().cabinets.find((c) => c.id === id)
    if (!cabinet) return { applied: 0, skipped: 0, issues: [] }
    const problems = validateCabinetPatch(cabinet, patch)
    if (problems.length > 0) return { applied: 0, skipped: problems.length, issues: problems }
    get().updateCabinet(id, patch)
    return { applied: 1, skipped: 0, issues: [] }
  },

  // M4（AL-ED2/ED7）：批量更新机柜属性——逐柜冲突校验，冲突柜跳过不落库
  updateCabinetsBulk: (ids, patch) => {
    const idSet = new Set(ids)
    let applied = 0
    const issues: BulkUpdateIssue[] = []
    const cabinets = get().cabinets.map((c) => {
      if (!idSet.has(c.id)) return c
      const problems = validateCabinetPatch(c, patch)
      if (problems.length > 0) {
        issues.push(...problems)
        return c
      }
      applied++
      return { ...c, ...patch }
    })
    // M2（AL-UR1）：全部冲突跳过 → 不压栈（无实际修改）
    set((s) => ({
      ...(applied > 0 ? pushRackHistory(s) : {}),
      cabinets,
    }))
    return { applied, skipped: issues.length, issues }
  },

  // M4（AL-ED2）：按类型批量更新（机房同类机柜批量入口）
  updateCabinetsByType: (type, patch) => {
    const ids = get().cabinets.filter((c) => c.type === type).map((c) => c.id)
    return get().updateCabinetsBulk(ids, patch)
  },

  placeDevice: (cabinetId, device, startU) => {
    const { cabinets } = get()
    const cabinet = cabinets.find((c) => c.id === cabinetId)
    if (!cabinet) return false

    const endU = startU + device.height - 1
    // M5: 顶部预留保护（读取项目配置 topReservedU，不占用预留 U 位）
    if (startU < 1 || endU > cabinet.totalU - get().topReservedU) return false

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
      ...pushRackHistory(s),
      cabinets: s.cabinets.map((c) =>
        c.id === cabinetId ? { ...c, devices: [...c.devices, newDevice] } : c,
      ),
      unplacedDevices: s.unplacedDevices.filter((d) => d.id !== device.id),
    }))
    return true
  },

  removeDevice: (cabinetId, deviceId) => {
    const { cabinets } = get()
    const cabinet = cabinets.find((c) => c.id === cabinetId)
    const device = cabinet?.devices.find((d) => d.id === deviceId)
    // M2（AL-UR1）：设备不存在 → no-op，不压栈
    if (!device) return

    const unplaced: UnplacedDevice = {
      id: device.id,
      name: device.name,
      type: device.type,
      height: device.endU - device.startU + 1,
      power_watts: device.power_watts,
    }

    set((s) => ({
      ...pushRackHistory(s),
      cabinets: s.cabinets.map((c) =>
        c.id === cabinetId
          ? { ...c, devices: c.devices.filter((d) => d.id !== deviceId) }
          : c,
      ),
      unplacedDevices: [...s.unplacedDevices, unplaced],
      selectedDevice: s.selectedDevice?.id === deviceId ? null : s.selectedDevice,
    }))
  },

  moveDevice: (deviceId, fromCabinet, toCabinet, newStartU) => {
    const { cabinets } = get()
    const fromCab = cabinets.find((c) => c.id === fromCabinet)
    const device = fromCab?.devices.find((d) => d.id === deviceId)
    if (!device) return false

    const toCab = cabinets.find((c) => c.id === toCabinet)
    if (!toCab) return false

    // M5（AL-ED5）：复用 checkDeviceMove 统一落点校验（顶部预留/越界/占用/功率，与 UI 预判同源）
    if (!checkDeviceMove(toCab, device, newStartU, get().topReservedU).ok) return false

    const newEndU = newStartU + (device.endU - device.startU)
    const moved: RackDevice = { ...device, cabinetId: toCabinet, startU: newStartU, endU: newEndU }

    set((s) => ({
      ...pushRackHistory(s),
      cabinets: s.cabinets.map((c) => {
        if (c.id === fromCabinet) return { ...c, devices: c.devices.filter((d) => d.id !== deviceId) }
        if (c.id === toCabinet) return { ...c, devices: [...c.devices, moved] }
        return c
      }),
      selectedDevice: s.selectedDevice?.id === deviceId ? moved : s.selectedDevice,
    }))
    return true
  },

  // M5（AL-ED6）：同柜设备批量改属性——功率整批原子校验（应用后柜总功率超限即整批拒绝，与 shiftDevicesU 一致）
  updateDevicesBulk: (cabinetId, deviceIds, patch) => {
    const cabinet = get().cabinets.find((c) => c.id === cabinetId)
    if (!cabinet) return { applied: 0, skipped: 0, issues: [] }
    const idSet = new Set(deviceIds)
    const target = cabinet.devices.filter((d) => idSet.has(d.id))
    if (target.length === 0) return { applied: 0, skipped: 0, issues: [] }
    if (patch.power_watts != null) {
      const othersPower = cabinet.devices
        .filter((d) => !idSet.has(d.id))
        .reduce((s, d) => s + d.power_watts, 0)
      const newTotal = othersPower + target.length * patch.power_watts
      if (newTotal > cabinet.power_limit) {
        return {
          applied: 0,
          skipped: 1,
          issues: [{ cabinetId, reason: 'power', message: `批量功率 ${newTotal}W 超过机柜上限 ${cabinet.power_limit}W` }],
        }
      }
    }
    const devices = cabinet.devices.map((d) => (idSet.has(d.id) ? { ...d, ...patch } : d))
    set((s) => ({
      ...pushRackHistory(s),
      cabinets: s.cabinets.map((c) => (c.id === cabinetId ? { ...c, devices } : c)),
    }))
    return { applied: target.length, skipped: 0, issues: [] }
  },

  // M5（AL-ED6）：同柜设备批量 U 位偏移——整批原子，任一冲突整批拒绝
  shiftDevicesU: (cabinetId, deviceIds, offset) => {
    const cabinet = get().cabinets.find((c) => c.id === cabinetId)
    if (!cabinet) return { applied: 0, skipped: 0, issues: [] }
    const problems = validateShiftDevices(cabinet, deviceIds, offset, get().topReservedU)
    if (problems.length > 0) return { applied: 0, skipped: problems.length, issues: problems }
    const idSet = new Set(deviceIds)
    const devices = cabinet.devices.map((d) =>
      idSet.has(d.id) ? { ...d, startU: d.startU + offset, endU: d.endU + offset } : d,
    )
    set((s) => ({
      ...pushRackHistory(s),
      cabinets: s.cabinets.map((c) => (c.id === cabinetId ? { ...c, devices } : c)),
    }))
    return { applied: idSet.size, skipped: 0, issues: [] }
  },

  // ===== M3（AL-CP1/CP2）+ M-F2（F2-1）：应用内剪贴板复制/粘贴（机柜与设备；跨项目持久化到 localStorage） =====

  copyCabinet: (cabinetId) => {
    const cab = get().cabinets.find((c) => c.id === cabinetId)
    if (!cab) return false
    const clip: RackClipboard = {
      type: 'cabinet',
      cabinet: structuredClone(cab),
      sourceCabinetId: cabinetId,
      sourceProjectName: currentProjectName,
    }
    set({ clipboard: clip })
    // M-F2（F2-1）：应用级 localStorage 双写——切换项目后仍可粘贴
    saveClipboardEnvelope({
      schemaVersion: CLIPBOARD_SCHEMA_VERSION,
      type: 'cabinet',
      data: structuredClone(cab),
      sourceCabinetId: cabinetId,
      sourceProjectName: currentProjectName,
      serializedAt: new Date().toISOString(),
    })
    return true
  },

  pasteCabinet: (targetCabinetId) => {
    const s = get()
    // M-F2（F2-1）：内存优先，空则从 localStorage 恢复（跨项目切回后剪贴板仍可用）
    const clip = s.clipboard ?? resolveClipboardFromStorage()
    if (!clip || clip.type !== 'cabinet') return { applied: 0, skipped: 0, conflicts: [] }
    const target = s.cabinets.find((c) => c.id === targetCabinetId)
    if (!target) return { applied: 0, skipped: 0, conflicts: [] }
    const source = clip.cabinet
    // M-F2（F2-1）：跨项目整柜兼容预检——type/totalU 与源一致才允许（不兼容整柜拒绝并返回 reason）
    const cross = isCrossProjectClipboard(clip.sourceProjectName)
    if (cross) {
      const compat = checkCrossProjectCabinetCompatibility(source, target)
      if (compat) {
        return {
          applied: 0,
          skipped: 0,
          conflicts: [{ cabinetId: target.id, deviceName: source.name, startU: 1, reason: compat }],
        }
      }
    }
    const added: RackDevice[] = []
    const conflicts: TemplateConflict[] = []
    const existingIds = new Set(target.devices.map((d) => d.id))
    // 设备 U 位映射 + 冲突校验（与 applyCabinetTemplate 同源：overflow/top_reserved/occupied/power）
    for (const sd of source.devices) {
      // M-F2（F2-1）：跨项目设备类型域校验（设备类型与目标柜类型域不兼容 → 跳过并返回原因）
      if (cross && checkCrossProjectDeviceCompatibility(sd, target)) {
        conflicts.push({ cabinetId: target.id, deviceName: sd.name, startU: sd.startU, reason: 'device_type_mismatch' })
        continue
      }
      const endU = sd.endU
      if (sd.startU < 1 || endU > target.totalU) {
        conflicts.push({ cabinetId: target.id, deviceName: sd.name, startU: sd.startU, reason: 'overflow' })
        continue
      }
      if (endU > target.totalU - s.topReservedU) {
        conflicts.push({ cabinetId: target.id, deviceName: sd.name, startU: sd.startU, reason: 'top_reserved' })
        continue
      }
      const occupied =
        target.devices.some((d) => !(endU < d.startU || sd.startU > d.endU)) ||
        added.some((d) => !(endU < d.startU || sd.startU > d.endU))
      if (occupied) {
        conflicts.push({ cabinetId: target.id, deviceName: sd.name, startU: sd.startU, reason: 'occupied' })
        continue
      }
      const currentPower =
        target.devices.reduce((sum, d) => sum + d.power_watts, 0) +
        added.reduce((sum, d) => sum + d.power_watts, 0)
      if (currentPower + sd.power_watts > target.power_limit) {
        conflicts.push({ cabinetId: target.id, deviceName: sd.name, startU: sd.startU, reason: 'power' })
        continue
      }
      const copyId = freshDeviceId(existingIds, sd.id)
      existingIds.add(copyId)
      added.push({ ...sd, id: copyId, cabinetId: target.id })
    }
    // 类型/功率/总U 同步到目标柜（对齐 applyCabinetTemplate：设备校验用原目标值，再应用源柜属性）
    const nextCabinet: RackCabinet = {
      ...target,
      type: source.type,
      totalU: source.totalU,
      power_limit: source.power_limit,
      devices: [...target.devices, ...added],
    }
    const changed =
      added.length > 0 ||
      nextCabinet.type !== target.type ||
      nextCabinet.totalU !== target.totalU ||
      nextCabinet.power_limit !== target.power_limit
    // 无实际变更（无新增设备且属性未变）→ 不压撤销栈，但冲突明细仍需返回
    if (!changed) return { applied: 0, skipped: conflicts.length, conflicts }
    set((st) => ({
      ...pushRackHistory(st),
      cabinets: st.cabinets.map((c) => (c.id === targetCabinetId ? nextCabinet : c)),
    }))
    return { applied: added.length, skipped: conflicts.length, conflicts }
  },

  pasteCabinetToNew: () => {
    // M-F2（F2-1）：粘贴为新柜无目标约束（新建柜 type/totalU 取源值），跨项目始终允许
    const s = get()
    const clip = s.clipboard ?? resolveClipboardFromStorage()
    if (!clip || clip.type !== 'cabinet') return null
    const newId = s.cabinets.length > 0 ? Math.max(...s.cabinets.map((c) => c.id)) + 1 : 1
    const name = nextCopyName(s.cabinets.map((c) => c.name), `${clip.cabinet.name}-副本`)
    const devices: RackDevice[] = clip.cabinet.devices.map((d, i) => ({
      ...d,
      id: `${d.id}_copy_${newId}_${i}`,
      cabinetId: newId,
    }))
    set((st) => ({
      ...pushRackHistory(st),
      cabinets: [
        ...st.cabinets,
        {
          id: newId,
          name,
          totalU: clip.cabinet.totalU,
          type: clip.cabinet.type,
          power_limit: clip.cabinet.power_limit,
          devices,
        },
      ],
      selectedCabinetId: newId,
    }))
    return newId
  },

  copyDevice: (cabinetId, deviceId) => {
    const cab = get().cabinets.find((c) => c.id === cabinetId)
    const device = cab?.devices.find((d) => d.id === deviceId)
    if (!device) return false
    const clip: RackClipboard = {
      type: 'device',
      device: structuredClone(device),
      sourceCabinetId: cabinetId,
      sourceProjectName: currentProjectName,
    }
    set({ clipboard: clip })
    // M-F2（F2-1）：应用级 localStorage 双写
    saveClipboardEnvelope({
      schemaVersion: CLIPBOARD_SCHEMA_VERSION,
      type: 'device',
      data: structuredClone(device),
      sourceCabinetId: cabinetId,
      sourceProjectName: currentProjectName,
      serializedAt: new Date().toISOString(),
    })
    return true
  },

  pasteDevice: (targetCabinetId, startU) => {
    const s = get()
    const clip = s.clipboard ?? resolveClipboardFromStorage()
    if (!clip || clip.type !== 'device') return { ok: false, reason: 'no_clipboard' }
    const target = s.cabinets.find((c) => c.id === targetCabinetId)
    if (!target) return { ok: false, reason: 'no_clipboard' }
    const device = clip.device
    // M-F2（F2-1）：跨项目设备类型域校验（设备类型与目标柜类型域不兼容 → 拒绝并返回 reason）
    const cross = isCrossProjectClipboard(clip.sourceProjectName)
    if (cross && checkCrossProjectDeviceCompatibility(device, target)) {
      return { ok: false, reason: 'type_mismatch' }
    }
    // 复用 checkDeviceMove 统一落点校验（唯一临时 id，避免排除自身误判）
    const check = checkDeviceMove(target, { ...device, id: `${device.id}__paste_check__` }, startU, s.topReservedU)
    if (!check.ok) return { ok: false, reason: check.reason ?? 'occupied' }
    const height = device.endU - device.startU + 1
    const endU = startU + height - 1
    const copyId = freshDeviceId(new Set(target.devices.map((d) => d.id)), device.id)
    const pasted: RackDevice = { ...device, id: copyId, cabinetId: targetCabinetId, startU, endU }
    set((st) => ({
      ...pushRackHistory(st),
      cabinets: st.cabinets.map((c) =>
        c.id === targetCabinetId ? { ...c, devices: [...c.devices, pasted] } : c,
      ),
    }))
    return {
      ok: true,
      startU,
      endU,
      deviceName: device.name,
      // M-F2（F2-1）：跨项目粘贴标记（供 UI 提示来源项目）
      ...(cross ? { crossProject: true, sourceProjectName: clip.sourceProjectName } : {}),
    }
  },

  pasteDeviceAuto: (targetCabinetId) => {
    const s = get()
    const clip = s.clipboard ?? resolveClipboardFromStorage()
    if (!clip || clip.type !== 'device') return { ok: false, reason: 'no_clipboard' }
    const target = s.cabinets.find((c) => c.id === targetCabinetId)
    if (!target) return { ok: false, reason: 'no_clipboard' }
    const device = clip.device
    // M-F2（F2-1）：跨项目设备类型域校验
    if (isCrossProjectClipboard(clip.sourceProjectName) && checkCrossProjectDeviceCompatibility(device, target)) {
      return { ok: false, reason: 'type_mismatch' }
    }
    const height = device.endU - device.startU + 1
    const startU = findFirstAvailableU(target, height, {
      topReservedU: s.topReservedU,
      power_watts: device.power_watts,
    })
    if (startU == null) return { ok: false, reason: 'no_space' }
    return get().pasteDevice(targetCabinetId, startU)
  },

  clearClipboard: () => {
    // M-F2（F2-1）：内存 + 应用级 localStorage 同时清空
    set({ clipboard: null })
    clearClipboardEnvelope()
  },

  hasClipboard: (type) => {
    // M-F2（F2-1）：内存优先，空则从 localStorage 恢复判断（跨项目切回后仍可识别）
    const clip = get().clipboard ?? resolveClipboardFromStorage()
    return clip != null && (type == null || clip.type === type)
  },

  // M-F2（F2-1）：剪贴板来源信息（跨项目 UI 提示用）
  getClipboardSource: () => {
    const clip = get().clipboard ?? resolveClipboardFromStorage()
    if (!clip) return null
    return { type: clip.type, sourceProjectName: clip.sourceProjectName ?? null }
  },

  setCurrentProjectName: (projectName) => {
    setRackCurrentProject(projectName)
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

  exportToExcel: async (projectName, batchName) => {
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

    // 打磨轮（v1.5 / AL-O1b）：批次渲染 → 写入版本批次目录 output/<batch>/<file>
    const filePath = batchName
      ? await window.electron?.render?.saveOutputFile(projectName, `output/${batchName}/${fileName}`, wbout)
      : await window.electron?.export?.saveFile(projectName, fileName, wbout)
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
      // M2（AL-UR1）：导入机柜列表为整表替换 → 可撤销
      set((s) => ({ ...pushRackHistory(s), cabinets, selectedCabinetId: cabinets[0].id }))
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

// ===== M-F2（F2-2）：撤销/重做栈跨会话持久化（节流写盘到项目目录 + 容量受控 + 重启恢复） =====

/** M-F2（F2-2）：持久化栈深上限（仅持久化最近 N 条，防存储膨胀） */
export const RACK_UNDO_PERSIST_LIMIT = 20
/** M-F2（F2-2）：持久化字节阈值（超限丢弃最旧 undo 快照；单条仍超限则放弃本次） */
export const RACK_UNDO_PERSIST_MAX_BYTES = 1024 * 1024
/** M-F2（F2-2）：关键编辑后节流写盘防抖时长 */
export const RACK_UNDO_PERSIST_DEBOUNCE_MS = 800
/** M-F2（F2-2）：项目目录内持久化文件名（<project>/output/<file>） */
export const RACK_UNDO_PERSIST_FILE = 'undo_history.json'

/** M-F2（F2-2）：落盘文件结构（store 标识区分 rack/room 两个栈文件） */
export interface RackUndoPersistFile {
  schema_version: number
  saved_at: string
  store: 'rack'
  undoStack: RackHistorySnapshot[]
  redoStack: RackHistorySnapshot[]
}

let rackUndoPersistTimer: ReturnType<typeof setTimeout> | null = null

function undoLocalStorageKey(projectName: string): string {
  return `autolink-rack-undo:${projectName}`
}

/** M-F2（F2-2）：UTF-8 文本 → base64（Electron 渲染层 / Node 测试环境兼容；btoa 对中文抛错，故先 UTF-8 编码） */
function utf8ToBase64(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf-8').toString('base64')
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** M-F2（F2-2）：构建持久化文件（栈深截断到最近 N 条） */
export function buildRackUndoPersistFile(
  undoStack: RackHistorySnapshot[],
  redoStack: RackHistorySnapshot[],
): RackUndoPersistFile {
  return {
    schema_version: 1,
    saved_at: new Date().toISOString(),
    store: 'rack',
    undoStack: undoStack.slice(-RACK_UNDO_PERSIST_LIMIT),
    redoStack: redoStack.slice(-RACK_UNDO_PERSIST_LIMIT),
  }
}

/**
 * M-F2（F2-2）：容量受控截断纯函数——栈深上限 + 字节阈值，超限丢弃最旧 undo（redo 保留）。
 * 返回 null 表示即使只剩一条仍超限（放弃本次持久化）。
 */
export function truncateRackUndoByBytes(
  undoStack: RackHistorySnapshot[],
  redoStack: RackHistorySnapshot[],
  maxBytes: number,
): { undoStack: RackHistorySnapshot[]; redoStack: RackHistorySnapshot[] } | null {
  let u = undoStack.slice(-RACK_UNDO_PERSIST_LIMIT)
  const r = redoStack.slice(-RACK_UNDO_PERSIST_LIMIT)
  let file = buildRackUndoPersistFile(u, r)
  let json = JSON.stringify(file)
  while (json.length > maxBytes && u.length > 0) {
    u = u.slice(1)
    file = buildRackUndoPersistFile(u, r)
    json = JSON.stringify(file)
  }
  if (json.length > maxBytes) return null
  return { undoStack: u, redoStack: r }
}

/**
 * M-F2（F2-2）：序列化并落盘（容量受控：栈深上限 + 字节阈值，超限丢弃最旧 undo）。
 * 首选 `render.saveOutputFile` 写 <project>/output/undo_history.json；受阻退化为 localStorage（方案B）。
 */
export async function persistRackUndoHistory(projectName: string): Promise<void> {
  const s = useRackStore.getState()
  const capped = truncateRackUndoByBytes(s.undoStack, s.redoStack, RACK_UNDO_PERSIST_MAX_BYTES)
  if (!capped) return
  const json = JSON.stringify(buildRackUndoPersistFile(capped.undoStack, capped.redoStack))
  try {
    if (window.electron?.render?.saveOutputFile) {
      await window.electron.render.saveOutputFile(projectName, RACK_UNDO_PERSIST_FILE, utf8ToBase64(json))
      return
    }
  } catch (err) {
    console.error('[undo-persist] render.saveOutputFile 失败，退化 localStorage:', err)
  }
  try {
    localStorage.setItem(undoLocalStorageKey(projectName), json)
  } catch {
    // quota 超限忽略
  }
}

/** M-F2（F2-2）：编辑后节流调度写盘（防抖 800ms；无项目上下文不写） */
export function scheduleRackUndoPersist(projectName: string | null): void {
  if (!projectName) return
  if (rackUndoPersistTimer) clearTimeout(rackUndoPersistTimer)
  rackUndoPersistTimer = setTimeout(() => {
    rackUndoPersistTimer = null
    persistRackUndoHistory(projectName).catch(() => {})
  }, RACK_UNDO_PERSIST_DEBOUNCE_MS)
}

/** M-F2（F2-2）：落盘结构校验（避免旧/损坏数据污染撤销栈） */
function isRackUndoPersistFile(data: unknown): data is RackUndoPersistFile {
  const d = data as Partial<RackUndoPersistFile> | null
  return !!d && d.store === 'rack' && Array.isArray(d.undoStack) && Array.isArray(d.redoStack)
}

/**
 * M-F2（F2-2）：恢复上次会话持久化的撤销/重做栈（覆盖当前栈；可回退到重启前）。
 * 优先级：项目目录 output/undo_history.json（project.getFile）→ localStorage（方案B）。
 */
export async function restoreRackUndoHistory(projectName: string): Promise<void> {
  let file: RackUndoPersistFile | null = null
  try {
    if (window.electron?.project?.getFile) {
      const raw = await window.electron.project.getFile(projectName, `output/${RACK_UNDO_PERSIST_FILE}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (isRackUndoPersistFile(parsed)) file = parsed
      }
    }
  } catch (err) {
    console.error('[undo-persist] 读取 undo_history.json 失败:', err)
  }
  if (!file) {
    try {
      const raw = localStorage.getItem(undoLocalStorageKey(projectName))
      if (raw) {
        const parsed = JSON.parse(raw)
        if (isRackUndoPersistFile(parsed)) file = parsed
      }
    } catch {
      // ignore
    }
  }
  if (!file) return
  const undoStack = file.undoStack.slice(-RACK_UNDO_PERSIST_LIMIT)
  const redoStack = file.redoStack.slice(-RACK_UNDO_PERSIST_LIMIT)
  useRackStore.setState({
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  })
}

// M-F2（F2-2）：撤销/重做栈变化 → 节流写盘（编辑后自动持久化；无项目上下文不写）
useRackStore.subscribe((state, prev) => {
  if (state.undoStack !== prev.undoStack || state.redoStack !== prev.redoStack) {
    scheduleRackUndoPersist(currentProjectName)
  }
})
