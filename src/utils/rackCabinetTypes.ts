/**
 * 机柜类型与类型推断——叶子模块（5.4.9-F549-4）。
 *
 * 从 rack.store 抽出，供矩阵落位 Worker 无副作用引用（避免把 zustand + xlsx
 * 拉进 worker 包）。rack.store 与本模块共同引用，保持单源。
 */

export type CabinetType =
  | 'gpu'
  | 'storage'
  | 'network'
  | 'compute'
  | 'security'
  | 'custom'
  | 'scaleup'
  | 'power'

/** 从拓扑节点推断机柜类型（服务器按 group 分类，交换机归为网络柜） */
export function toCabinetType(node: { type?: string; group?: string }): CabinetType {
  // Scale-Up GPU 节点 → Scale-Up 柜
  if (node.type === 'scaleup_gpu') return 'scaleup'
  if (node.type !== 'server') return 'network'
  const g = node.group || ''
  if (g.includes('存储')) return 'storage'
  if (g.includes('通算')) return 'compute'
  return 'gpu'
}
