/**
 * 柜数需求估算（B1-03 / B1-09 · FR-A01 / FR-A07 共用唯一实现）。
 *
 * 这里是「设备清单 → 各柜型需要几个柜」的唯一算法：
 *   - `packCabinetsByType`  精确需求，供全局可行性预检（rackFeasibility）与差额状态条使用；
 *   - `estimateCabinetDemand` 在其上叠加余量系数与排/列建议，供规划页容量建议卡使用。
 * 预检与估算禁止各写一套（PRD FR-A01 边界）。
 *
 * 纯函数：不读 store、不写盘、无缓存。
 */
import { toCabinetType } from '@/utils/rackCabinetTypes'
import { RACK_PACKING_DEFAULTS, resolveRackReserve } from '@/shared/roomTaxonomy'
import { resolveGpuPerCabinet, type GpuShareMode } from '@/shared/gpuShare'

export type DemandCabinetType = 'gpu' | 'network' | 'storage' | 'compute'

export const DEMAND_CABINET_TYPES: readonly DemandCabinetType[] = ['gpu', 'network', 'storage', 'compute']

/** 估算只需要的最小设备画像（RackTopologyNode 是其超集） */
export interface CabinetDemandDevice {
  id?: string
  type?: string
  group?: string
  domain?: string
  uHeight?: number
  powerWatts?: number
}

export interface CabinetPackingOptions {
  /** 单柜总 U，默认 42 */
  rackType?: number
  /** 顶部预留 U，默认 2 */
  topReservedU?: number
  /** 单柜功率上限(W)，默认 12000 */
  powerLimit?: number
  /** GPU 每柜台数，默认 1（`gpuShareMode='manual'` 时为人工值；缺省档位时保持旧口径） */
  gpuPerCabinet?: number
  /** B5-01 / FR-A26：GPU 共柜档位（fixed1 / byPower / manual）；缺省 = 旧口径 */
  gpuShareMode?: GpuShareMode
  /** 网络柜相邻交换机理线间隔 U，默认 1 */
  interSwitchGapU?: number
}

export type CabinetDemandByType = Record<DemandCabinetType, number>

export interface CabinetPackingDetail {
  cabinets: number
  /** 可落位设备台数（不含 unplaceable） */
  deviceCount: number
  requiredU: number
  requiredPowerW: number
  unplaceable: string[]
}

export interface CabinetPacking {
  /** 各柜型精确需求柜数（不含余量） */
  byType: CabinetDemandByType
  /** 各柜型分项需求明细（预检缺口归因用） */
  detail: Record<DemandCabinetType, CabinetPackingDetail>
  /** 求和后的精确需求柜数 */
  totalCabinets: number
  /** 设备总 U（不含永远放不进柜的设备） */
  requiredU: number
  /** 设备总功率(W) */
  requiredPowerW: number
  /** 柜高/功率导致永远无法落位的设备 id */
  unplaceable: string[]
  /** 实际参与计算的可用 U（全局兼容口径；按柜型见 usableUByType） */
  usableU: number
  /** 按柜型可用 U（B4-04 / FR-A23） */
  usableUByType: Record<DemandCabinetType, number>
  powerLimit: number
  /** B5-01 / B5-02（FR-A26）：实际生效的 GPU 每柜台数 */
  gpuPerCabinet: number
  /** B5-02：档位降级/收敛告警（功率缺失回退 12 kW、人工值超物理约束等） */
  warnings: string[]
}

export interface CabinetDemandOptions extends CabinetPackingOptions {
  /** 建议每排柜数（6–24），默认 24 */
  perRowBasis?: number
  /** 余量系数，默认 0.10（0 = 精确需求） */
  marginRatio?: number
  /** 每柜占地（含通道分摊），默认 3 m² */
  areaPerCabinetSqm?: number
}

export interface CabinetDemandSuggestion {
  rows: number
  perRow: number
}

export interface CabinetDemandEstimate {
  byType: CabinetDemandByType
  /** 精确需求柜数（不含余量），与预检/差额条同一口径 */
  totalCabinets: number
  /** 叠加余量系数后的建议柜数 */
  totalWithMargin: number
  suggested: CabinetDemandSuggestion[]
  areaSqm: number
  powerKw: number
  coolingKw: number
}

/** 默认参数来自共享 JSON（B1-05：与后端 rack_feasibility.py 同源，禁止本地另写数值） */
export const DEFAULT_RACK_TYPE_U = RACK_PACKING_DEFAULTS.rackTypeU
export const DEFAULT_TOP_RESERVED_U = RACK_PACKING_DEFAULTS.topReservedU
export const DEFAULT_POWER_LIMIT_W = RACK_PACKING_DEFAULTS.powerLimitW
export const DEFAULT_INTER_SWITCH_GAP_U = RACK_PACKING_DEFAULTS.interSwitchGapU
export const DEFAULT_MARGIN_RATIO = RACK_PACKING_DEFAULTS.marginRatio
export const DEFAULT_AREA_PER_CABINET_SQM = RACK_PACKING_DEFAULTS.areaPerCabinetSqm
export const MIN_CABINETS_PER_ROW = RACK_PACKING_DEFAULTS.minCabinetsPerRow
export const MAX_CABINETS_PER_ROW = RACK_PACKING_DEFAULTS.maxCabinetsPerRow

const emptyByType = (): CabinetDemandByType => ({ gpu: 0, network: 0, storage: 0, compute: 0 })

function resolvePowerLimit(opts: CabinetPackingOptions): number {
  return Math.max(1, opts.powerLimit ?? DEFAULT_POWER_LIMIT_W)
}

function resolveUsableU(opts: CabinetPackingOptions): number {
  const rackType = Math.max(1, opts.rackType ?? DEFAULT_RACK_TYPE_U)
  const topReservedU = Math.max(0, opts.topReservedU ?? DEFAULT_TOP_RESERVED_U)
  return Math.max(1, rackType - topReservedU)
}

/**
 * 按柜型取可用 U（B4-04 / FR-A23）：预留查共享 JSON，`topReservedU` 仅作未知柜型回退。
 * GPU/通算/存储柜底留 4U（42U 柜 → 38U），网络柜顶留 2U（→ 40U）。
 */
export function resolveUsableUFor(
  opts: CabinetPackingOptions,
  cabinetType: DemandCabinetType,
): number {
  const rackType = Math.max(1, opts.rackType ?? DEFAULT_RACK_TYPE_U)
  const reserve = resolveRackReserve(cabinetType, opts.topReservedU ?? DEFAULT_TOP_RESERVED_U)
  return Math.max(1, rackType - reserve.bottomReservedU - reserve.topReservedU)
}

/**
 * 按柜内打包规则估算某柜型需要的柜数（与 rackMatrixLayout 的装箱规则一致）：
 *   - 网络柜：自顶向下，同柜第 2 台起先占 interSwitchGapU 理线间隔；
 *   - 存储/通算柜：自底向上，受可用 U 与单柜功率上限双重约束；
 *   - GPU 柜：每柜 gpuPerCabinet 台。
 * 柜高超过可用 U、或单台功率超过单柜上限的设备永远放不进，计入 unplaceable。
 */
function packCabinets(
  devices: CabinetDemandDevice[],
  opts: CabinetPackingOptions & { powerLimited: boolean; gapPerExtraU: number },
  cabinetType: DemandCabinetType,
): { cabinets: number; deviceCount: number; requiredU: number; requiredPowerW: number; unplaceable: string[] } {
  const usableU = resolveUsableUFor(opts, cabinetType)
  const powerLimit = resolvePowerLimit(opts)
  const unplaceable: string[] = []
  let cabinets = 0
  let usedU = 0
  let usedPower = 0
  let count = 0
  let requiredU = 0
  let requiredPowerW = 0

  for (const d of devices) {
    const height = Math.max(1, d.uHeight ?? 4)
    const power = Math.max(0, d.powerWatts ?? 0)
    if (height > usableU || (opts.powerLimited && power > powerLimit)) {
      unplaceable.push(String(d.id ?? ''))
      continue
    }
    requiredU += height
    requiredPowerW += power

    const gap = count > 0 ? opts.gapPerExtraU : 0
    const uFits = usedU + gap + height <= usableU
    const powerFits = !opts.powerLimited || usedPower + power <= powerLimit
    if (count > 0 && (!uFits || !powerFits)) {
      cabinets += 1
      usedU = 0
      usedPower = 0
      count = 0
    }
    usedU += height + (count > 0 ? opts.gapPerExtraU : 0)
    usedPower += power
    count += 1
  }
  if (count > 0) cabinets += 1
  return { cabinets, deviceCount: devices.length - unplaceable.length, requiredU, requiredPowerW, unplaceable }
}

/** 设备清单 → 各柜型精确需求柜数（单一算法，预检/估算/状态条共用） */
export function packCabinetsByType(
  devices: CabinetDemandDevice[],
  opts: CabinetPackingOptions = {},
): CabinetPacking {
  const usableU = resolveUsableU(opts)
  const usableUByType: Record<DemandCabinetType, number> = {
    gpu: resolveUsableUFor(opts, 'gpu'),
    network: resolveUsableUFor(opts, 'network'),
    storage: resolveUsableUFor(opts, 'storage'),
    compute: resolveUsableUFor(opts, 'compute'),
  }
  const powerLimit = resolvePowerLimit(opts)
  const interSwitchGapU = Math.max(0, opts.interSwitchGapU ?? DEFAULT_INTER_SWITCH_GAP_U)

  const grouped: Record<DemandCabinetType, CabinetDemandDevice[]> = {
    gpu: [], network: [], storage: [], compute: [],
  }
  const unplaceable: string[] = []
  for (const node of devices) {
    const t = toCabinetType(node)
    if (t === 'gpu' || t === 'network' || t === 'storage' || t === 'compute') grouped[t].push(node)
  }

  // B5-01 / B5-02（FR-A26）：按档位解析每柜台数（byPower 需设备功率/机高，故在分组后计算）
  const gpuShare = resolveGpuPerCabinet({
    mode: opts.gpuShareMode,
    manualPerCabinet: opts.gpuPerCabinet ?? RACK_PACKING_DEFAULTS.gpuPerCabinet,
    devicePowers: grouped.gpu.map((d) => Math.max(0, d.powerWatts ?? 0)),
    deviceHeights: grouped.gpu.map((d) => Math.max(1, d.uHeight ?? 4)),
    powerLimitW: powerLimit,
    usableU: usableUByType.gpu,
  })
  const gpuPerCabinet = gpuShare.perCabinet
  // B5-02：降级/收敛告警落到日志（UI 侧由向导档位面板与预检提示呈现）
  for (const warning of gpuShare.warnings) console.warn('[GPU共柜]', warning)

  const byType = emptyByType()
  const detail: Record<DemandCabinetType, CabinetPackingDetail> = {
    gpu: { cabinets: 0, deviceCount: 0, requiredU: 0, requiredPowerW: 0, unplaceable: [] },
    network: { cabinets: 0, deviceCount: 0, requiredU: 0, requiredPowerW: 0, unplaceable: [] },
    storage: { cabinets: 0, deviceCount: 0, requiredU: 0, requiredPowerW: 0, unplaceable: [] },
    compute: { cabinets: 0, deviceCount: 0, requiredU: 0, requiredPowerW: 0, unplaceable: [] },
  }
  let requiredU = 0
  let requiredPowerW = 0

  // GPU：每柜固定台数，柜高不足的设备单独计入不可落位
  const gpuFitting = grouped.gpu.filter((d) => {
    if (Math.max(1, d.uHeight ?? 4) > usableUByType.gpu) {
      unplaceable.push(String(d.id ?? ''))
      return false
    }
    return true
  })
  byType.gpu = Math.ceil(gpuFitting.length / gpuPerCabinet)
  for (const d of gpuFitting) {
    detail.gpu.requiredU += Math.max(1, d.uHeight ?? 4)
    detail.gpu.requiredPowerW += Math.max(0, d.powerWatts ?? 0)
  }
  detail.gpu.cabinets = byType.gpu
  detail.gpu.deviceCount = gpuFitting.length

  for (const t of ['network', 'storage', 'compute'] as const) {
    const res = packCabinets(grouped[t], {
      ...opts,
      powerLimited: true,
      gapPerExtraU: t === 'network' ? interSwitchGapU : 0,
    }, t)
    byType[t] = res.cabinets
    detail[t] = res
    requiredU += res.requiredU
    requiredPowerW += res.requiredPowerW
    unplaceable.push(...res.unplaceable)
  }
  for (const d of gpuFitting) {
    requiredU += Math.max(1, d.uHeight ?? 4)
    requiredPowerW += Math.max(0, d.powerWatts ?? 0)
  }

  return {
    byType,
    detail,
    totalCabinets: DEMAND_CABINET_TYPES.reduce((s, t) => s + byType[t], 0),
    requiredU,
    requiredPowerW,
    unplaceable,
    usableU,
    usableUByType,
    powerLimit,
    gpuPerCabinet,
    warnings: gpuShare.warnings,
  }
}

function clampPerRow(value: number): number {
  const v = Number.isFinite(value) ? Math.round(value) : MAX_CABINETS_PER_ROW
  return Math.min(MAX_CABINETS_PER_ROW, Math.max(MIN_CABINETS_PER_ROW, v))
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** FR-A07：柜数需求估算（只算不写）。建议值叠加余量系数，精确需求与预检同源。 */
export function estimateCabinetDemand(
  devices: CabinetDemandDevice[],
  opts: CabinetDemandOptions = {},
): CabinetDemandEstimate {
  const packing = packCabinetsByType(devices, opts)
  const marginRatio = Math.max(0, opts.marginRatio ?? DEFAULT_MARGIN_RATIO)
  const perRow = clampPerRow(opts.perRowBasis ?? MAX_CABINETS_PER_ROW)
  const byTypeWithMargin = emptyByType()
  for (const t of DEMAND_CABINET_TYPES) {
    byTypeWithMargin[t] = Math.ceil(packing.byType[t] * (1 + marginRatio))
  }
  const totalWithMargin = DEMAND_CABINET_TYPES.reduce((s, t) => s + byTypeWithMargin[t], 0)
  const totalPowerW = devices.reduce((s, d) => s + Math.max(0, d.powerWatts ?? 0), 0)
  const powerKw = round1(totalPowerW / 1000)
  const areaPerCabinetSqm = Math.max(0, opts.areaPerCabinetSqm ?? DEFAULT_AREA_PER_CABINET_SQM)

  return {
    byType: packing.byType,
    totalCabinets: packing.totalCabinets,
    totalWithMargin,
    suggested: [{ rows: Math.ceil(totalWithMargin / perRow), perRow }],
    areaSqm: round1(packing.totalCabinets * areaPerCabinetSqm),
    powerKw,
    // 冷负荷 = IT 热负荷（机房热力学 1:1），供容量建议卡展示
    coolingKw: powerKw,
  }
}
