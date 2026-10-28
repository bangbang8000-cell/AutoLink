/**
 * 机房柜型分类单一真源（B1-01 / FR-A05）。
 *
 * 本模块只是 roomTaxonomy.json 的类型化包装：前端各处只允许引用这里的集合，
 * 后端 backend/room_taxonomy.py 加载同一份 JSON（打包时由 package.json
 * extraResources 复制到 resources/backend/roomTaxonomy.json）。
 *
 * 三组口径：
 *   - placeableCabinetTypes 可落位（可建柜）柜型：gpu/network/storage/compute
 *   - freeDomainTypes       自由域柜型：不约束设备域（combined/empty/scaleup/security/custom）
 *   - placeholderTypes      占位类型：不可放置设备（ac/pillar）
 */
import taxonomy from './roomTaxonomy.json'

/** 设备域（与 backend/rack_allocation.py DEVICE_TYPE_* 对齐） */
export type DeviceDomain = 'gpu' | 'compute' | 'storage' | 'network'

/** 全部可标记柜型（含自由域与电源柜） */
export const CABINET_TYPES: readonly string[] = taxonomy.cabinetTypes

/** 可落位（可建柜）柜型；自由域/电源柜不建柜 */
export const PLACEABLE_CABINET_TYPES: ReadonlySet<string> = new Set(taxonomy.placeableCabinetTypes)

/** 自由域柜型：不约束设备域 */
export const FREE_DOMAIN_TYPES: ReadonlySet<string> = new Set(taxonomy.freeDomainTypes)

/** 占位类型：不可放置设备 */
export const PLACEHOLDER_TYPES: ReadonlySet<string> = new Set(taxonomy.placeholderTypes)

/** 设备域遍历顺序（GPU → 通算 → 存储 → 网络） */
export const DEVICE_DOMAINS = taxonomy.deviceDomains as readonly DeviceDomain[]

/**
 * 柜内装箱默认参数（B1-05 / FR-A01）。
 *
 * 与 `backend/room_taxonomy.py` 的 `RACK_PACKING_DEFAULTS` 同读一份 JSON：
 * 前端 `cabinetDemand.ts` 与后端 `rack_feasibility.py` 必须由同一组常量推导，
 * 否则「同输入同输出」契约失效。
 */
export interface RackPackingDefaults {
  /** 单柜总 U */
  rackTypeU: number
  /** 顶部预留 U */
  topReservedU: number
  /** 单柜功率上限(W) */
  powerLimitW: number
  /** GPU 默认每柜台数 */
  gpuPerCabinet: number
  /** 网络柜相邻交换机理线间隔 U */
  interSwitchGapU: number
  /** 柜数估算默认余量系数 */
  marginRatio: number
  /** 每柜占地（含通道分摊）m² */
  areaPerCabinetSqm: number
  /** 每排柜数下限 */
  minCabinetsPerRow: number
  /** 每排柜数上限 */
  maxCabinetsPerRow: number
}

export const RACK_PACKING_DEFAULTS: Readonly<RackPackingDefaults> = taxonomy.rackPackingDefaults

/**
 * 柜型预留（B4-04 / FR-A23）。
 *
 * `bottomReservedU` 从底部起留空，`topReservedU` 从顶部起留空；
 * 可用 U 区间为 `[bottomReservedU + 1, rackTypeU - topReservedU]`。
 */
export interface RackReserve {
  /** 底部预留 U */
  bottomReservedU: number
  /** 顶部预留 U */
  topReservedU: number
}

const _RAW_RACK_RESERVE_BY_TYPE: Record<string, RackReserve> = taxonomy.rackReserveByType as unknown as Record<
  string,
  RackReserve
>

/** 按柜型的预留表（已剔除 `_` 开头的注释键） */
export const RACK_RESERVE_BY_TYPE: Readonly<Record<string, RackReserve>> = Object.freeze(
  Object.fromEntries(
    Object.entries(_RAW_RACK_RESERVE_BY_TYPE).filter(([key]) => !key.startsWith('_')),
  ),
)

/**
 * 取柜型的预留：表中有的柜型以表为准；未列出的柜型回退
 * 「底部不预留 + 全局 topReservedU」。
 */
export function resolveRackReserve(
  cabinetType: string | null | undefined,
  fallbackTopReservedU: number = RACK_PACKING_DEFAULTS.topReservedU,
): RackReserve {
  const hit = cabinetType ? RACK_RESERVE_BY_TYPE[cabinetType] : undefined
  if (hit) return { ...hit }
  return { bottomReservedU: 0, topReservedU: Math.max(0, fallbackTopReservedU) }
}
