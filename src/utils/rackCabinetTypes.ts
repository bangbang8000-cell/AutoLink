/**
 * 机柜类型与类型推断——叶子模块（5.4.9-F549-4）。
 *
 * 从 rack.store 抽出，供矩阵落位 Worker 无副作用引用（避免把 zustand + xlsx
 * 拉进 worker 包）。rack.store 与本模块共同引用，保持单源。
 */

/** 设备域（与后端 NetworkObject.domain / roomTaxonomy.json 的 deviceDomains 对齐） */
export type DeviceDomain = 'gpu' | 'compute' | 'storage' | 'network'

export type CabinetType =
  | 'gpu'
  | 'storage'
  | 'network'
  | 'compute'
  | 'security'
  | 'custom'
  | 'scaleup'
  | 'power'

/** 中文 group 兜底次数（B1-02 / FR-A04 判据：正常设备库下应为 0） */
let groupFallbackCount = 0

export function getCabinetTypeGroupFallbackCount(): number {
  return groupFallbackCount
}

export function resetCabinetTypeGroupFallbackCount(): void {
  groupFallbackCount = 0
}

const DOMAIN_TO_CABINET: Record<DeviceDomain, CabinetType> = {
  gpu: 'gpu',
  compute: 'compute',
  storage: 'storage',
  network: 'network',
}

/**
 * 从拓扑节点推断机柜类型（B1-02 / FR-A04）。
 *
 * 优先读后端产出的结构化字段 `domain`（gpu/compute/storage/network）；
 * 缺失时退回中文 group 串匹配并累计一次兜底告警，避免 group 改名/i18n 后整批误判。
 */
export function toCabinetType(node: {
  type?: string
  group?: string
  domain?: string
}): CabinetType {
  // Scale-Up GPU 节点 → Scale-Up 柜（type 优先于 domain）
  if (node.type === 'scaleup_gpu') return 'scaleup'
  if (node.type !== 'server') return 'network'

  const domain = node.domain
  if (domain && domain in DOMAIN_TO_CABINET) {
    return DOMAIN_TO_CABINET[domain as DeviceDomain]
  }

  // 兜底：中文 group 串（历史数据/旧拓扑），仅用于向后兼容
  groupFallbackCount += 1
  const g = node.group || ''
  if (g.includes('存储')) return 'storage'
  if (g.includes('通算')) return 'compute'
  return 'gpu'
}
