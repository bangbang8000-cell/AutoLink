/**
 * B5-01 / FR-A26：GPU 共柜三档开关的唯一真源（前端）。
 *
 * 三档：
 *   - `fixed1`  固定 1 台/柜（默认，最保守，等价旧行为）
 *   - `byPower` 按功率计算：min(⌊单柜功率上限 ÷ 单机功率⌋, ⌊可用 U ÷ 机高⌋)，下限 1
 *   - `manual`  人工指定正整数（0/负数/超 U 位容量一律拒绝）
 *
 * 口径（O2 已闭合）：单柜功率上限取项目 `power_limit_per_rack`（缺省 12000 W）；
 * 单机功率取设备 `powerWatts`，缺失或 ≤0 时按单柜上限计（退化为 1 台/柜）并告警。
 *
 * 后端 `backend/rack_feasibility.py` / `backend/rack_allocation.py` 镜像同一规则，
 * 保证「同输入同输出」。
 */
import { RACK_PACKING_DEFAULTS, resolveRackReserve } from './roomTaxonomy'

export type GpuShareMode = 'fixed1' | 'byPower' | 'manual'

export const GPU_SHARE_MODES: readonly GpuShareMode[] = ['fixed1', 'byPower', 'manual'] as const

export const GPU_SHARE_MODE_LABELS: Record<GpuShareMode, string> = {
  fixed1: '固定 1 台/柜',
  byPower: '按功率计算',
  manual: '人工指定',
}

export const GPU_SHARE_MODE_HINTS: Record<GpuShareMode, string> = {
  fixed1: '默认，柜数最保守（1 柜 1 台）',
  byPower: '每柜台数 = ⌊单柜功率上限 ÷ 单机功率⌋，再与 U 位容量取小',
  manual: '手动填写每柜台数（正整数，不得超 U 位容量）',
}

/** 非法/缺省的档位一律回退 `fixed1` */
export function normalizeGpuShareMode(raw: unknown): GpuShareMode {
  return raw === 'byPower' || raw === 'manual' ? raw : 'fixed1'
}

/**
 * 旧项目兼容：未写 `gpu_share_mode` 但 `gpu_per_cabinet > 1` 时视为「人工指定」，
 * 保证存量项目「一柜多台」不因新档位默认值失效。
 */
export function inferGpuShareMode(rawMode: unknown, gpuPerCabinet?: number): GpuShareMode {
  if (rawMode === 'byPower' || rawMode === 'manual' || rawMode === 'fixed1') return rawMode
  return gpuPerCabinet != null && gpuPerCabinet > 1 ? 'manual' : 'fixed1'
}

export interface GpuShareInput {
  /** 档位；undefined = 旧行为（直接用 manualPerCabinet） */
  mode?: GpuShareMode
  /** 人工指定/旧口径的每柜台数 */
  manualPerCabinet?: number
  /** 参与计算的 GPU 设备单机功率(W) */
  devicePowers: number[]
  /** 参与计算的 GPU 设备机高(U) */
  deviceHeights: number[]
  /** 单柜功率上限(W)，缺省 12000 */
  powerLimitW?: number
  /** 单柜总 U，缺省 42 */
  rackTypeU?: number
  /** 未知柜型回退的顶部预留 U */
  topReservedU?: number
  /** 直接指定 GPU 柜可用 U（优先于 rackTypeU/预留推导） */
  usableU?: number
}

export interface GpuShareResult {
  perCabinet: number
  warnings: string[]
}

const DEFAULT_POWER_LIMIT_W = RACK_PACKING_DEFAULTS.powerLimitW

/** GPU 柜可用 U（底留/顶留按 FR-A23 查表） */
export function gpuUsableU(rackTypeU?: number, topReservedU?: number): number {
  const rackType = Math.max(1, rackTypeU ?? RACK_PACKING_DEFAULTS.rackTypeU)
  const reserve = resolveRackReserve('gpu', topReservedU ?? RACK_PACKING_DEFAULTS.topReservedU)
  return Math.max(1, rackType - reserve.bottomReservedU - reserve.topReservedU)
}

/** 按功率档的每柜台数（不含告警） */
export function gpuPerCabinetByPower(input: Omit<GpuShareInput, 'mode' | 'manualPerCabinet'>): number {
  const limit = input.powerLimitW != null && input.powerLimitW > 0 ? input.powerLimitW : DEFAULT_POWER_LIMIT_W
  const usableU = input.usableU ?? gpuUsableU(input.rackTypeU, input.topReservedU)
  if (input.devicePowers.length === 0) return 1
  let cap = Number.POSITIVE_INFINITY
  for (let i = 0; i < input.devicePowers.length; i++) {
    const power = input.devicePowers[i]
    // O2：缺失/非法功率按单柜上限计 → 该设备功率容量退化为 1 台
    const powerCap = power > 0 ? Math.floor(limit / power) : 1
    const height = Math.max(1, input.deviceHeights[i] ?? 4)
    const uCap = Math.floor(usableU / height)
    cap = Math.min(cap, powerCap, uCap)
  }
  return Math.max(1, Number.isFinite(cap) ? cap : 1)
}

/**
 * 人工指定的物理上限（功率 + U 位）：与 `gpuPerCabinetByPower` 同口径，
 * 但**功率缺失（≤0）的设备不参与功率收敛**——人工档下无功率数据不推翻用户选择。
 * 无设备时返回 Infinity（不收敛）。
 */
export function physicalGpuCap(input: Omit<GpuShareInput, 'mode' | 'manualPerCabinet'>): number {
  const limit = input.powerLimitW != null && input.powerLimitW > 0 ? input.powerLimitW : DEFAULT_POWER_LIMIT_W
  const usableU = input.usableU ?? gpuUsableU(input.rackTypeU, input.topReservedU)
  let cap = Number.POSITIVE_INFINITY
  for (let i = 0; i < input.devicePowers.length; i++) {
    const power = input.devicePowers[i]
    if (power > 0) cap = Math.min(cap, Math.floor(limit / power))
    const height = Math.max(1, input.deviceHeights[i] ?? 4)
    cap = Math.min(cap, Math.floor(usableU / height))
  }
  return Number.isFinite(cap) ? Math.max(1, cap) : Number.POSITIVE_INFINITY
}

/**
 * 三档统一解析 → 每柜台数 + 告警。
 * mode 为 undefined / `fixed1` 且未给 manualPerCabinet 时返回 1（旧行为）。
 */
export function resolveGpuPerCabinet(input: GpuShareInput): GpuShareResult {
  const warnings: string[] = []
  const limit = input.powerLimitW != null && input.powerLimitW > 0 ? input.powerLimitW : DEFAULT_POWER_LIMIT_W
  // 只有依赖功率上限的档位才提示回退（fixed1 / 旧口径不读该字段）
  const limitMissing = input.powerLimitW == null || input.powerLimitW <= 0
  const hasKnownPower = input.devicePowers.some((p) => p > 0)

  if (input.mode === 'byPower') {
    if (limitMissing) warnings.push(`单柜功率上限缺失或非法，已回退 ${limit} W`)
    if (input.devicePowers.some((p) => !(p > 0))) {
      warnings.push(`存在单机功率缺失/≤0 的 GPU，按 ${limit} W 计（等价 1 台/柜）`)
    }
    return { perCabinet: gpuPerCabinetByPower(input), warnings }
  }
  if (input.mode === 'manual') {
    if (limitMissing && hasKnownPower) warnings.push(`单柜功率上限缺失或非法，已回退 ${limit} W`)
    const requested = Math.max(1, Math.floor(input.manualPerCabinet ?? 1))
    // 人工值仍受物理约束（功率 / U 位）收敛，避免预检柜数少于实际可落位柜数
    const cap = physicalGpuCap(input)
    if (requested > cap) {
      warnings.push(`人工指定 ${requested} 台/柜超出功率/U 约束，落位按 ${cap} 台/柜计算`)
      return { perCabinet: cap, warnings }
    }
    return { perCabinet: requested, warnings }
  }
  if (input.mode === 'fixed1') {
    return { perCabinet: 1, warnings }
  }
  // mode 缺省：保持旧口径（显式 gpuPerCabinet 生效）
  return { perCabinet: Math.max(1, Math.floor(input.manualPerCabinet ?? 1)), warnings }
}

/** 人工指定值校验：正整数且不超 U 位容量 */
export function validateManualGpuPerCabinet(
  value: number,
  opts: { usableU?: number; maxDeviceHeightU?: number } = {},
): { ok: true; value: number } | { ok: false; message: string } {
  const usableU = opts.usableU ?? gpuUsableU()
  const height = Math.max(1, opts.maxDeviceHeightU ?? 4)
  const uCap = Math.max(1, Math.floor(usableU / height))
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    return { ok: false, message: '每柜台数必须为正整数（≥1）' }
  }
  if (value > uCap) {
    return { ok: false, message: `超出 U 位容量：当前机柜最多 ${uCap} 台/柜` }
  }
  return { ok: true, value }
}

/** 按档位估算 GPU 柜数（用于档位切换提示「柜数由 X 变 Y」） */
export function estimateGpuCabinets(
  deviceCount: number,
  perCabinet: number,
): number {
  const n = Math.max(0, Math.floor(deviceCount))
  const per = Math.max(1, Math.floor(perCabinet))
  return Math.ceil(n / per)
}
