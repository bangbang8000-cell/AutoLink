/**
 * 打磨轮（v1.4 / AL-R2c）：按机房矩阵格子构建机柜布局（纯函数，可单测）
 *
 * 矩阵权威：机柜类型与格子类型一一对应（GPU 1柜1台默认；网络/存储/通算按 U+功率打包），
 * 替代后端"每设备一柜"。ac/pillar/power/empty/combined 格不建柜；
 * scaleup/security/custom 等不可标记柜类型的设备直接进待上架池。
 */
import { toCabinetType } from '@/stores/rack.store'
import type { CabinetType, RackCabinet, RackDevice, RackTopologyNode, UnplacedDevice } from '@/stores/rack.store'
import type { RoomCellData, RoomMatrixData } from '@/stores/room.store'

export interface RackMatrixLayoutOptions {
  /** 单柜总 U，默认 42 */
  rackType?: number
  /** 单柜功率上限(W)，默认 6000 */
  powerLimit?: number
  /** GPU 每柜台数，默认 1（GPU 1柜1台） */
  gpuPerCabinet?: number
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

/** 可建柜的矩阵格子类型（gpu/network/storage/compute；combined/power/empty/占位不建柜） */
const LAYOUT_CELL_TYPES = new Set<CabinetType>(['gpu', 'network', 'storage', 'compute'])

interface _Device {
  id: string
  name: string
  type: string
  height: number
  power_watts: number
}

export function layoutRacksFromMatrix(
  matrix: RoomMatrixData,
  nodes: RackTopologyNode[],
  opts: RackMatrixLayoutOptions = {},
): RackMatrixLayoutResult {
  const rackType = opts.rackType ?? 42
  const powerLimit = opts.powerLimit ?? 6000
  const gpuPerCabinet = Math.max(1, opts.gpuPerCabinet ?? 1)

  // 整表重建：清空旧 cabinetId（矩阵权威，可重复应用）
  const cells: RoomCellData[] = matrix.cells.map((c) => ({ ...c, cabinetId: null }))
  if (!nodes || nodes.length === 0) {
    return {
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

  // GPU：每 gpu 格建 1 柜，1柜1台（gpuPerCabinet 可配置；uHeight 超柜直接进池）
  const gpuDevices = byType.gpu
  let gi = 0
  for (const cell of candidateCells.gpu) {
    if (gi >= gpuDevices.length) break
    const devices: RackDevice[] = []
    let powerSum = 0
    while (gi < gpuDevices.length && devices.length < gpuPerCabinet) {
      const d = gpuDevices[gi]
      if (d.height > rackType) {
        unplacedDevices.push({ id: d.id, name: d.name, type: d.type, height: d.height, power_watts: d.power_watts })
        gi++
        continue
      }
      devices.push({
        id: d.id, name: d.name, type: d.type, cabinetId: nextId,
        startU: 1, endU: d.height, power_watts: d.power_watts,
      })
      powerSum += d.power_watts
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

  // 网络/存储/通算：按 U + 功率打包（跨格填充，格子耗尽进池）
  for (const t of ['network', 'storage', 'compute'] as const) {
    const devices = byType[t]
    let di = 0
    for (const cell of candidateCells[t]) {
      if (di >= devices.length) break
      const cabDevices: RackDevice[] = []
      let nextU = 1
      let powerSum = 0
      while (di < devices.length) {
        const d = devices[di]
        if (d.height > rackType) {
          unplacedDevices.push({ id: d.id, name: d.name, type: d.type, height: d.height, power_watts: d.power_watts })
          di++
          continue
        }
        const endU = nextU + d.height - 1
        if (endU > rackType) break // 装不下 → 换下一格
        if (powerSum + d.power_watts > powerLimit) break
        cabDevices.push({ id: d.id, name: d.name, type: d.type, cabinetId: nextId, startU: nextU, endU, power_watts: d.power_watts })
        powerSum += d.power_watts
        nextU = endU + 1
        di++
      }
      if (cabDevices.length > 0) {
        cabinets.push({ id: nextId, name: `机柜 ${cell.row}${cell.col}`, totalU: rackType, type: t, power_limit: powerLimit, devices: cabDevices })
        mount(cell, nextId)
        nextId++
      }
    }
    for (; di < devices.length; di++) {
      const d = devices[di]
      unplacedDevices.push({ id: d.id, name: d.name, type: d.type, height: d.height, power_watts: d.power_watts })
    }
  }

  return {
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
