/**
 * 打磨轮（v1.4 / AL-R2c）：按机房矩阵格子构建机柜布局（纯函数，可单测）
 *
 * 矩阵权威：机柜类型与格子类型一一对应（GPU 1柜1台默认；网络/存储/通算按 U+功率打包），
 * 替代后端"每设备一柜"。ac/pillar/power/empty/combined 格不建柜；
 * scaleup/security/custom 等不可标记柜类型的设备直接进待上架池。
 */
// 5.4.9-F549-4：toCabinetType 改从叶子模块引用（worker 复用，避免 xlsx/zustand 进 worker）
import { toCabinetType, type CabinetType } from '@/utils/rackCabinetTypes'
import { checkRackFeasibility, type RackFeasibilityResult } from '@/utils/rackFeasibility'
import { packCabinetsByType } from '@/utils/cabinetDemand'
import { PLACEABLE_CABINET_TYPES, resolveRackReserve } from '@/shared/roomTaxonomy'
import { resolveGpuPerCabinet, type GpuShareMode } from '@/shared/gpuShare'
import type { RackCabinet, RackDevice, RackTopologyNode, UnplacedDevice } from '@/stores/rack.store'
import type { RoomCellData, RoomMatrixData } from '@/stores/room.store'

export interface RackMatrixLayoutOptions {
  /** 单柜总 U，默认 42 */
  rackType?: number
  /** 单柜功率上限(W)，默认 12000 */
  powerLimit?: number
  /** GPU 每柜台数，默认 1（GPU 1柜1台；`gpuShareMode='manual'` 时为人工值） */
  gpuPerCabinet?: number
  /** B5-01 / FR-A26：GPU 共柜档位；缺省 = 旧口径（直接用 gpuPerCabinet） */
  gpuShareMode?: GpuShareMode
  /** M5: 顶部预留 U 数（默认 2，网络设备从顶部向下、服务器从底部向上） */
  topReservedU?: number
  /** F6（5.4.4 可用性修复）：网络柜相邻交换机之间的理线间隔 U，默认 1 */
  interSwitchGapU?: number
}

export interface RackMatrixLayoutStats {
  gpu: number
  network: number
  storage: number
  compute: number
  mounted: number
  overflow: number
}

export interface RackMatrixLayoutResult {
  /**
   * 全局可行性预检是否通过（B1-04 / FR-A01）。
   * false 时本结果不含任何落位：cabinets/unplacedDevices 为空、cells 为原矩阵（未被清空或改写）。
   */
  ok: boolean
  /** 预检明细（缺口 + 解法建议），供表格化拒绝弹窗渲染 */
  feasibility: RackFeasibilityResult
  cabinets: RackCabinet[]
  unplacedDevices: UnplacedDevice[]
  /** 更新后的矩阵格（旧 cabinetId 已清空、新柜已落位） */
  cells: RoomCellData[]
  stats: RackMatrixLayoutStats
}

/** 机柜类型 → 设备类型标签（优先用节点 group 更可读） */
const DEVICE_TYPE_LABEL: Partial<Record<CabinetType, string>> = {
  gpu: 'GPU Server',
  storage: 'Storage Server',
  compute: 'Compute Server',
  network: 'Switch',
}

/** 可建柜的矩阵格子类型（B1-01：来自 roomTaxonomy.json，与后端同源；combined/power/empty/占位不建柜） */
const LAYOUT_CELL_TYPES = PLACEABLE_CABINET_TYPES

/** B1-07 / FR-A03：空白格按需改判优先级（GPU → 网络 → 存储 → 通算） */
const AUTO_ASSIGN_PRIORITY = ['gpu', 'network', 'storage', 'compute'] as const

interface _Device {
  id: string
  name: string
  type: string
  height: number
  power_watts: number
}

/**
 * B1-07 / FR-A03：空白格按需改判。
 * - 只改 `placeholder === null && type === 'empty'` 的格；power/ac/pillar/combined 与人工改型格恒定不动；
 * - 各柜型需求取 `packCabinetsByType`（与预检/柜数估算同一算法），已有同类型格先行抵扣；
 * - 改判格标 `typeAuto = true`（UI 显示「自动」角标）；调用前已把上次自动改判格回落为 empty → 幂等。
 */
function autoAssignEmptyCells(
  cells: RoomCellData[],
  nodes: RackTopologyNode[],
  opts: RackMatrixLayoutOptions,
): RoomCellData[] {
  if (cells.length === 0 || nodes.length === 0) return cells
  const packing = packCabinetsByType(nodes, opts)
  const need: Record<string, number> = { gpu: 0, network: 0, storage: 0, compute: 0 }
  for (const t of AUTO_ASSIGN_PRIORITY) need[t] = packing.byType[t]
  for (const c of cells) {
    if (c.placeholder !== null) continue
    const t = AUTO_ASSIGN_PRIORITY.find((k) => k === c.type)
    if (t) need[t] -= 1
  }
  if (AUTO_ASSIGN_PRIORITY.every((t) => need[t] <= 0)) return cells

  const next = [...cells]
  for (let i = 0; i < next.length; i++) {
    const c = next[i]
    if (c.placeholder !== null || c.type !== 'empty') continue
    const t = AUTO_ASSIGN_PRIORITY.find((k) => need[k] > 0)
    if (!t) break
    need[t] -= 1
    next[i] = { ...c, type: t, typeAuto: true }
  }
  return next
}

export function layoutRacksFromMatrix(
  matrix: RoomMatrixData,
  nodes: RackTopologyNode[],
  opts: RackMatrixLayoutOptions = {},
): RackMatrixLayoutResult {
  const rackType = opts.rackType ?? 42
  const powerLimit = opts.powerLimit ?? 12000
  // M5: 顶部预留 U（默认 2）→ 可用 U = rackType - topReservedU；网络从顶部向下、服务器从底部向上
  const topReservedU = Math.max(0, opts.topReservedU ?? 2)
  // B4-04 / FR-A23：预留按柜型查表（服务器类底留 4U、网络柜顶留 2U）；
  // 可用区间 = [bottom+1, rackType-top]，与后端 RackAllocator 完全同口径。
  const reserveByType = {
    gpu: resolveRackReserve('gpu', topReservedU),
    network: resolveRackReserve('network', topReservedU),
    storage: resolveRackReserve('storage', topReservedU),
    compute: resolveRackReserve('compute', topReservedU),
  }
  const usableUByType = {
    gpu: Math.max(1, rackType - reserveByType.gpu.bottomReservedU - reserveByType.gpu.topReservedU),
    network: Math.max(1, rackType - reserveByType.network.bottomReservedU - reserveByType.network.topReservedU),
    storage: Math.max(1, rackType - reserveByType.storage.bottomReservedU - reserveByType.storage.topReservedU),
    compute: Math.max(1, rackType - reserveByType.compute.bottomReservedU - reserveByType.compute.topReservedU),
  }
  // F6（5.4.4 可用性修复）：交换机之间的理线间隔 U（用户反馈#4；默认 1，0=紧密堆叠）
  const interSwitchGapU = Math.max(0, opts.interSwitchGapU ?? 1)

  // B1-07 / FR-A03：空白格按需改判（幂等——上次自动改判的格先回落为 empty，再按需求重判）。
  // 预检与此后落位都用改判后的矩阵，保证「预检可落位格数」与「实际可建柜格数」一致。
  const baseCells: RoomCellData[] = matrix.cells.map((c) =>
    c.typeAuto && c.placeholder === null ? { ...c, type: 'empty', typeAuto: false } : c,
  )
  const effectiveMatrix: RoomMatrixData = { ...matrix, cells: autoAssignEmptyCells(baseCells, nodes ?? [], opts) }

  // B1-04 / FR-A01：入口先做全局可行性预检（与 FR-A07 柜数估算同一算法）。
  // 不足则一次性拒绝——不建柜、不改写任何格子、不产生落位结果。
  const feasibility = checkRackFeasibility(effectiveMatrix, nodes ?? [], opts)
  if (!feasibility.ok) {
    return {
      ok: false,
      feasibility,
      cabinets: [],
      unplacedDevices: [],
      cells: matrix.cells,
      stats: { gpu: 0, network: 0, storage: 0, compute: 0, mounted: 0, overflow: 0 },
    }
  }

  // 整表重建：清空旧 cabinetId（矩阵权威，可重复应用）
  const cells: RoomCellData[] = effectiveMatrix.cells.map((c) => ({ ...c, cabinetId: null }))
  if (!nodes || nodes.length === 0) {
    return {
      ok: true,
      feasibility,
      cabinets: [],
      unplacedDevices: [],
      cells,
      stats: { gpu: 0, network: 0, storage: 0, compute: 0, mounted: 0, overflow: 0 },
    }
  }

  // 节点分类 → 设备池
  const byType: Record<string, _Device[]> = { gpu: [], network: [], storage: [], compute: [] }
  const unplacedDevices: UnplacedDevice[] = []
  for (const node of nodes) {
    const t = toCabinetType(node)
    const label = DEVICE_TYPE_LABEL[t]
    const device: _Device = {
      id: node.id,
      name: node.id,
      type: node.group || label || node.type || 'Device',
      height: node.uHeight || 4,
      power_watts: node.powerWatts || 0,
    }
    if (label && byType[t]) {
      byType[t].push(device)
    } else {
      // scaleup/security/custom 等不可标记类型 → 待上架池
      unplacedDevices.push({
        id: device.id, name: device.name, type: device.type,
        height: device.height, power_watts: device.power_watts,
      })
    }
  }

  // 每类型候选格（跳过占位，保持 matrix.cells 行优先顺序 → 确定性）
  const candidateCells: Record<string, RoomCellData[]> = { gpu: [], network: [], storage: [], compute: [] }
  for (const cell of cells) {
    if (cell.placeholder !== null) continue
    if (LAYOUT_CELL_TYPES.has(cell.type as CabinetType)) candidateCells[cell.type].push(cell)
  }

  const cabinets: RackCabinet[] = []
  let nextId = 1
  const cellPosIndex = new Map<string, number>()
  cells.forEach((c, i) => cellPosIndex.set(`${c.row}${c.col}`, i))
  const mount = (cell: RoomCellData, cabinetId: number) => {
    const i = cellPosIndex.get(`${cell.row}${cell.col}`)
    if (i != null) cells[i] = { ...cells[i], cabinetId }
  }

  // GPU：每 gpu 格建 1 柜，档位决定每柜台数（B5-01/B5-02 / FR-A26）
  // B4-04：GPU 柜底留 4U → 首台 startU=5，顶部可用到 rackType
  const gpuLowU = reserveByType.gpu.bottomReservedU + 1
  const gpuHighU = rackType - reserveByType.gpu.topReservedU
  const gpuDevices = byType.gpu
  const gpuPerCabinet = resolveGpuPerCabinet({
    mode: opts.gpuShareMode,
    manualPerCabinet: opts.gpuPerCabinet ?? 1,
    devicePowers: gpuDevices.map((d) => d.power_watts),
    deviceHeights: gpuDevices.map((d) => d.height),
    powerLimitW: powerLimit,
    usableU: usableUByType.gpu,
  }).perCabinet
  let gi = 0
  for (const cell of candidateCells.gpu) {
    if (gi >= gpuDevices.length) break
    const devices: RackDevice[] = []
    let powerSum = 0
    let nextU = gpuLowU
    while (gi < gpuDevices.length && devices.length < gpuPerCabinet) {
      const d = gpuDevices[gi]
      if (d.height > usableUByType.gpu || nextU + d.height - 1 > gpuHighU) {
        unplacedDevices.push({ id: d.id, name: d.name, type: d.type, height: d.height, power_watts: d.power_watts })
        gi++
        continue
      }
      // 多台共柜仍需守单柜功率上限（与后端 _can_fit 同口径；首台不拦，兼容旧行为）
      if (devices.length > 0 && powerSum + d.power_watts > powerLimit) break
      devices.push({
        id: d.id, name: d.name, type: d.type, cabinetId: nextId,
        startU: nextU, endU: nextU + d.height - 1, power_watts: d.power_watts,
      })
      powerSum += d.power_watts
      nextU += d.height
      gi++
    }
    if (devices.length === 0) continue // 该格设备均超柜高 → 不建空柜
    cabinets.push({
      id: nextId, name: `机柜 ${cell.row}${cell.col}`, totalU: rackType, type: 'gpu',
      power_limit: Math.max(powerLimit, powerSum), devices,
    })
    mount(cell, nextId)
    nextId++
  }
  for (; gi < gpuDevices.length; gi++) {
    const d = gpuDevices[gi]
    unplacedDevices.push({ id: d.id, name: d.name, type: d.type, height: d.height, power_watts: d.power_watts })
  }

  // 网络/存储/通算：按 U + 功率打包（跨格均摊，格子耗尽进池）
  // M5 方向化：网络柜从顶部向下、存储/通算从底部向上，均不越过顶部预留
  // F6（5.4.4）：网络柜相邻交换机之间留 interSwitchGapU（默认 1U）理线间隔
  // B1-06 / FR-A02：同一柜型的设备跨候选格 round-robin 均摊——每轮每格最多落 1 台，
  // 因此同柜型各柜设备数极差 ≤1；总落位数与柜内贪心版一致，落位顺序保持确定性。
  for (const t of ['network', 'storage', 'compute'] as const) {
    const devices = byType[t]
    const fromTop = t === 'network'
    // B4-04：可用区间 [lowU, highU]——网络柜 highU = rackType - topReservedU（默认 40），
    // 服务器类 lowU = bottomReservedU + 1（默认 5）
    const reserve = reserveByType[t]
    const lowU = reserve.bottomReservedU + 1
    const highU = rackType - reserve.topReservedU
    const usableU_t = usableUByType[t]
    const slots = candidateCells[t].map((cell) => ({
      cell,
      cabinetId: null as number | null,
      cabDevices: [] as RackDevice[],
      nextU: fromTop ? highU + 1 : lowU,
      powerSum: 0,
    }))
    let cursor = 0
    for (const d of devices) {
      if (d.height > usableU_t) {
        unplacedDevices.push({ id: d.id, name: d.name, type: d.type, height: d.height, power_watts: d.power_watts })
        continue
      }
      let placed = false
      for (let attempt = 0; attempt < slots.length; attempt++) {
        const idx = (cursor + attempt) % slots.length
        const s = slots[idx]
        // F6：交换机间隔——同柜第 2 台起，先跳过理线间隔 U 再落位
        const gap = fromTop && s.cabDevices.length > 0 ? interSwitchGapU : 0
        let startU: number
        let endU: number
        if (fromTop) {
          startU = s.nextU - d.height - gap
          endU = s.nextU - gap - 1
          if (startU < lowU) continue // 顶部空间不足 → 试下一格
        } else {
          startU = s.nextU
          endU = s.nextU + d.height - 1
          if (endU > highU) continue // 装不下 → 试下一格
        }
        if (s.powerSum + d.power_watts > powerLimit) continue
        if (s.cabinetId === null) {
          s.cabinetId = nextId
          cabinets.push({
            id: nextId, name: `机柜 ${s.cell.row}${s.cell.col}`, totalU: rackType, type: t,
            power_limit: powerLimit, devices: s.cabDevices,
          })
          mount(s.cell, nextId)
          nextId++
        }
        s.cabDevices.push({
          id: d.id, name: d.name, type: d.type, cabinetId: s.cabinetId,
          startU, endU, power_watts: d.power_watts,
        })
        s.powerSum += d.power_watts
        s.nextU = fromTop ? startU : endU + 1
        cursor = (idx + 1) % slots.length
        placed = true
        break
      }
      if (!placed) {
        unplacedDevices.push({ id: d.id, name: d.name, type: d.type, height: d.height, power_watts: d.power_watts })
      }
    }
  }

  return {
    ok: true,
    feasibility,
    cabinets,
    unplacedDevices,
    cells,
    stats: {
      gpu: cabinets.filter((c) => c.type === 'gpu').length,
      network: cabinets.filter((c) => c.type === 'network').length,
      storage: cabinets.filter((c) => c.type === 'storage').length,
      compute: cabinets.filter((c) => c.type === 'compute').length,
      mounted: cabinets.length,
      overflow: unplacedDevices.length,
    },
  }
}
