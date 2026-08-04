/* ================================================================
 *  AutoLink — 拓扑节点统一颜色常量(U5 颜色体系统一)
 *  --------------------------------------------------------------
 *  合并原 TopologyNodes.tsx 的 NODE_COLORS 与 exportTopology.ts 的
 *  categories 颜色定义为单一来源。两处消费者各自派生所需形状,
 *  但内部引用本常量,确保 react-flow 渲染与 ECharts 导出颜色一致。
 * ================================================================ */

/** 单个拓扑节点类型的统一样式定义 */
export interface TopologyNodeStyleDef {
  /** 节点颜色 (hex,用于 react-flow 边框 / Handle / 图标着色) */
  color: string
  /** ECharts 分类显示名 */
  echartsName: string
  /** ECharts 节点形状 */
  echartsSymbol: string
}

/**
 * 拓扑节点统一样式表(单一来源)
 * 颜色取自原 TopologyNodes.NODE_COLORS(与主色调 primary-500 对齐,
 *  且包含完整的 storage_core 类型),ECharts 元数据取自原 exportTopology.categories。
 */
export const TOPOLOGY_NODE_STYLES: Record<string, TopologyNodeStyleDef> = {
  server: { color: '#3B82F6', echartsName: 'Server', echartsSymbol: 'circle' },
  param_leaf: { color: '#F59E0B', echartsName: 'Param Leaf', echartsSymbol: 'roundRect' },
  param_spine: { color: '#8B5CF6', echartsName: 'Param Spine', echartsSymbol: 'roundRect' },
  param_core: { color: '#EF4444', echartsName: 'Param Core', echartsSymbol: 'roundRect' },
  storage_leaf: { color: '#10B981', echartsName: 'Storage Leaf', echartsSymbol: 'roundRect' },
  storage_spine: { color: '#14B8A6', echartsName: 'Storage Spine', echartsSymbol: 'roundRect' },
  storage_core: { color: '#06B6D4', echartsName: 'Storage Core', echartsSymbol: 'roundRect' },
  oob_access: { color: '#6B7280', echartsName: 'OOB Access', echartsSymbol: 'roundRect' },
  oob_agg: { color: '#4B5563', echartsName: 'OOB Agg', echartsSymbol: 'roundRect' },
  biz_access: { color: '#0EA5E9', echartsName: 'Biz Access', echartsSymbol: 'roundRect' },
  biz_agg: { color: '#0284C7', echartsName: 'Biz Agg', echartsSymbol: 'roundRect' },
}

/** 默认节点颜色(未知节点类型回退) */
export const TOPOLOGY_NODE_DEFAULT_COLOR = '#9ca3af'

/* ================================================================
 *  V3.0.1-T1-7: 双平面节点着色（基础可辨识版）
 *  服务器 8×双口网卡分属两平面：平面 A（参数A_* / plane-A）琥珀色、
 *  平面 B（参数B_* / plane-B）青色，拓扑图中按平面一眼可辨。
 * ================================================================ */

/** 双平面专属配色（平面 A / 平面 B） */
export const DUAL_PLANE_COLORS = {
  A: '#F59E0B', // 琥珀（与参数网默认一致）
  B: '#06B6D4', // 青色
} as const

/**
 * 根据节点 group / 名称识别所属平面，返回平面专属色；非双平面节点返回 null
 * 后端命名约定：group "参数A_Leaf组" / "参数B_Leaf组"，podid "plane-A" / "plane-B"
 */
export function getDualPlaneColor(group?: string, name?: string): string | null {
  const haystack = `${group ?? ''} ${name ?? ''}`
  if (/参数A|参数A_|plane-A/i.test(haystack)) return DUAL_PLANE_COLORS.A
  if (/参数B|参数B_|plane-B/i.test(haystack)) return DUAL_PLANE_COLORS.B
  return null
}
