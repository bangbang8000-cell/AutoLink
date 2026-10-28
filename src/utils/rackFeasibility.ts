/**
 * 全局可行性预检（B1-03 / FR-A01）。
 *
 * 落位前先算三项总量：总 U 需求 = Σ 设备 U、总功率 = Σ 设备功率、总柜位 = rowCount × cabinetsPerRow；
 * 再按柜型分项估算所需柜数（与 FR-A07 估算共用 `packCabinetsByType`，禁止各算一套），
 * 不足则一次性拒绝落位并给出缺口与解法建议。
 *
 * 边界：纯函数、不缓存（设备清单或柜位任一变化即重算）。
 */
import {
  packCabinetsByType,
  MAX_CABINETS_PER_ROW,
  DEMAND_CABINET_TYPES,
  type CabinetDemandDevice,
  type CabinetPackingOptions,
  type DemandCabinetType,
} from '@/utils/cabinetDemand'
import { PLACEABLE_CABINET_TYPES } from '@/shared/roomTaxonomy'
import type { RoomMatrixData } from '@/stores/room.store'

export interface FeasibilityCapacity {
  /** 各柜型现有可落位格数 */
  byType: Record<DemandCabinetType, number>
  /** 可落位格总数（= 实际被标记为 gpu/network/storage/compute 且非占位的格子数） */
  total: number
  /** 矩阵名义柜位 = rowCount × cabinetsPerRow */
  slots: number
}

export interface FeasibilityTypeShortage {
  required: number
  available: number
  missing: number
}

export interface FeasibilityShortage {
  /** 各柜型柜数缺口之和（0 表示柜位够用） */
  cabinets: number
  /** 可用 U 缺口（0 表示 U 够用） */
  u: number
  /** 可承载功率缺口(W)（GPU 柜功率上限会按柜内设备抬高，不计入） */
  power: number
  /** 分柜型明细，供 O1 表格「需求/现有/缺口/建议」直接渲染 */
  byType: Record<DemandCabinetType, FeasibilityTypeShortage>
}

export interface RackFeasibilityResult {
  ok: boolean
  /** 各柜型精确需求柜数（不含余量） */
  required: Record<DemandCabinetType, number>
  requiredCabinets: number
  capacity: FeasibilityCapacity
  shortage: FeasibilityShortage
  /** 缺口解法（不足时至少两条） */
  suggestions: string[]
  /** GPU 柜位不足时的建议共柜档位（台/柜）；无需调整时为 null（O1 弹窗【改共柜档位】用） */
  gpuPerCabinetSuggest: number | null
  /** 永远放不进柜的设备 id（柜高超过可用 U，或单台功率超单柜上限） */
  unplaceable: string[]
  totalRequiredU: number
  totalRequiredPowerW: number
}

const TYPE_LABELS: Record<DemandCabinetType, string> = {
  gpu: 'GPU柜',
  network: '网络柜',
  storage: '存储柜',
  compute: '通算柜',
}

/**
 * 预检：把「设备清单 + 矩阵柜位」一次性判定是否可行。
 * 拒绝（ok=false）时调用方不得写入任何落位结果。
 */
export function checkRackFeasibility(
  matrix: RoomMatrixData,
  nodes: CabinetDemandDevice[],
  opts: CabinetPackingOptions = {},
): RackFeasibilityResult {
  const packing = packCabinetsByType(nodes, opts)

  const capacityByType: Record<DemandCabinetType, number> = { gpu: 0, network: 0, storage: 0, compute: 0 }
  for (const cell of matrix.cells) {
    if (cell.placeholder !== null) continue
    if (!PLACEABLE_CABINET_TYPES.has(cell.type)) continue
    if (cell.type in capacityByType) capacityByType[cell.type as DemandCabinetType] += 1
  }
  const capacityTotal = DEMAND_CABINET_TYPES.reduce((s, t) => s + capacityByType[t], 0)

  const byType = {} as Record<DemandCabinetType, FeasibilityTypeShortage>
  let missingCabinets = 0
  let missingU = 0
  let missingPower = 0
  let missingCabinetsOtherThanGpu = 0

  for (const t of DEMAND_CABINET_TYPES) {
    const required = packing.byType[t]
    const available = capacityByType[t]
    const missing = Math.max(0, required - available)
    byType[t] = { required, available, missing }
    missingCabinets += missing
    if (t !== 'gpu') missingCabinetsOtherThanGpu += missing

    // U 缺口：该柜型设备总 U vs 现有格可提供的 U（按柜型可用 U，B4-04）
    const availableU = available * packing.usableUByType[t]
    missingU += Math.max(0, packing.detail[t].requiredU - availableU)

    // 功率缺口：GPU 柜按柜内设备抬高上限，不做功率拒绝
    if (t !== 'gpu') {
      const availablePower = available * packing.powerLimit
      missingPower += Math.max(0, packing.detail[t].requiredPowerW - availablePower)
    }
  }

  const ok = missingCabinets === 0 && missingU === 0 && missingPower === 0 && packing.unplaceable.length === 0

  const suggestions: string[] = []
  let gpuPerCabinetSuggest: number | null = null
  if (!ok) {
    if (missingCabinets > 0) {
      const rowsNeeded = Math.ceil(packing.totalCabinets / MAX_CABINETS_PER_ROW)
      suggestions.push(
        `扩容至 ${rowsNeeded} 排 × ${MAX_CABINETS_PER_ROW} 列（共 ${rowsNeeded * MAX_CABINETS_PER_ROW} 柜位，` +
        `当前可落位 ${capacityTotal} 柜位，缺 ${missingCabinets} 柜）`,
      )
    }

    // GPU 共柜档位解法：仅当 GPU 柜位不足时给出明确档位
    if (byType.gpu.missing > 0 && capacityByType.gpu > 0) {
      const gpuDeviceCount = packing.detail.gpu.deviceCount
      const targetPerCabinet = Math.ceil(gpuDeviceCount / capacityByType.gpu)
      gpuPerCabinetSuggest = targetPerCabinet
      suggestions.push(
        `调整 GPU 共柜档位至 ${targetPerCabinet} 台/柜（${gpuDeviceCount} 台 GPU 仅需 ${capacityByType.gpu} 个 GPU 柜位）`,
      )
    } else if (missingCabinetsOtherThanGpu > 0) {
      const bottleneck = DEMAND_CABINET_TYPES
        .filter((t) => t !== 'gpu' && byType[t].missing > 0)
        .sort((a, b) => byType[b].missing - byType[a].missing)[0]
      suggestions.push(
        `或提高 ${TYPE_LABELS[bottleneck]} 单柜密度（单柜功率上限 / 每柜台数），补足 ${byType[bottleneck].missing} 柜`,
      )
    }

    if (missingU > 0) {
      suggestions.push(
        `单柜可用 U 不足：需 ${packing.requiredU} U，现有格位仅可提供 ${packing.requiredU - missingU} U，` +
        `建议提高机柜 U 数或减少高 U 设备`,
      )
    }
    if (missingPower > 0) {
      suggestions.push(
        `单柜功率不足：需 ${Math.round(packing.requiredPowerW / 1000)} kW，` +
        `现有格位仅可承载 ${Math.round((packing.requiredPowerW - missingPower) / 1000)} kW，建议提高单柜功率上限`,
      )
    }
    if (packing.unplaceable.length > 0) {
      const usableDesc = DEMAND_CABINET_TYPES
        .map((t) => `${TYPE_LABELS[t]} ${packing.usableUByType[t]}U`)
        .join('、')
      suggestions.push(
        `有 ${packing.unplaceable.length} 台设备超出单柜可用 U（${usableDesc}）或超单柜功率上限，无法落位：` +
        packing.unplaceable.slice(0, 5).join('、'),
      )
    }
  }

  return {
    ok,
    required: packing.byType,
    requiredCabinets: packing.totalCabinets,
    capacity: {
      byType: capacityByType,
      total: capacityTotal,
      slots: matrix.rows.length * matrix.cols.length,
    },
    shortage: { cabinets: missingCabinets, u: missingU, power: missingPower, byType },
    suggestions,
    gpuPerCabinetSuggest,
    unplaceable: packing.unplaceable,
    totalRequiredU: packing.requiredU,
    totalRequiredPowerW: packing.requiredPowerW,
  }
}
