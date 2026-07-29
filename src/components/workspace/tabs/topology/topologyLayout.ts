/**
 * AutoLink V2.4 — 拓扑图分层×分区×分组防重叠布局算法
 *
 * 三维布局策略：
 *   1. 分层（Y轴）：按节点类型分配 Y 坐标（Core → Spine → Leaf → Server → Access → Agg）
 *   2. 分区（X轴区域）：按网络域分配独立 X 区域（参数网 / 存储网 / 业务网 / OOB）
 *   3. 分组（组内排列）：在分区内按 Pod / Rail 分组，组间留间距
 *
 * 自适应间距：节点数多时自动增加水平间距，避免重叠
 */

import type { TopologyNode, TopologyEdge } from '@/stores/design.store'

/* ---------- 层级定义 ---------- */
// Layer 0 (Y=40):  Core / Spine（核心层/汇聚层 — 最上方）
// Layer 1 (Y=140): Leaf（接入层交换机 — 第二层）
// Layer 2 (Y=260): Server（服务器 — 中间层）
// Layer 3 (Y=380): Access（业务/带外接入 — 第四层）
// Layer 4 (Y=480): Agg（业务/带外汇聚 — 最下方）

export const LAYER_Y: Record<string, number> = {
  param_core: 40,
  storage_core: 40,
  param_spine: 40,
  storage_spine: 40,
  param_leaf: 140,
  storage_leaf: 140,
  server: 260,
  biz_access: 380,
  oob_access: 380,
  biz_agg: 480,
  oob_agg: 480,
}

/* ---------- 网络域分区 ---------- */

export type NetworkDomain = 'param' | 'storage' | 'server' | 'biz' | 'oob'

export function getNetworkDomain(nodeType: string): NetworkDomain {
  if (nodeType === 'server') return 'server'
  if (nodeType.startsWith('param_')) return 'param'
  if (nodeType.startsWith('storage_')) return 'storage'
  if (nodeType.startsWith('biz_')) return 'biz'
  if (nodeType.startsWith('oob_')) return 'oob'
  return 'server'
}

/* ---------- 分区宽度配置 ---------- */

const DOMAIN_ORDER: NetworkDomain[] = ['biz', 'oob', 'server', 'storage', 'param']

// 每个分区的基准宽度（会根据节点数自适应扩展）
const DOMAIN_BASE_WIDTH: Record<NetworkDomain, number> = {
  biz: 200,
  oob: 200,
  server: 500,
  storage: 300,
  param: 400,
}

// 分区间距
const DOMAIN_GAP = 60

/* ---------- 自适应间距计算 ---------- */

const NODE_MIN_SPACING = 100  // 节点间最小水平间距
const NODE_MAX_SPACING = 160  // 节点间最大水平间距
const GROUP_GAP = 50          // 组间间距

function adaptiveSpacing(nodeCount: number, baseWidth: number): number {
  const needed = (nodeCount - 1) * NODE_MIN_SPACING
  if (needed <= baseWidth) return NODE_MIN_SPACING
  // 节点数过多时，在 min-max 之间自适应
  const spacing = Math.min(NODE_MAX_SPACING, Math.ceil(needed / Math.max(1, nodeCount - 1)))
  return spacing
}

/* ---------- 布局结果接口 ---------- */

export interface LayoutNode {
  id: string
  x: number
  y: number
  type: string
  domain: NetworkDomain
  group?: string
  podid?: string
}

export interface LayoutDomain {
  domain: NetworkDomain
  x: number
  width: number
}

/* ---------- 主布局算法 ---------- */

export function computeTopologyLayout(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): { layoutNodes: LayoutNode[]; domains: LayoutDomain[] } {
  if (nodes.length === 0) return { layoutNodes: [], domains: [] }

  /* === Step 1: 按网络域分组 === */
  const domainNodes = new Map<NetworkDomain, TopologyNode[]>()
  for (const domain of DOMAIN_ORDER) domainNodes.set(domain, [])
  for (const n of nodes) {
    const domain = getNetworkDomain(n.type)
    domainNodes.get(domain)!.push(n)
  }

  /* === Step 2: 计算每个分区宽度（自适应）=== */
  const domainWidths = new Map<NetworkDomain, number>()
  for (const domain of DOMAIN_ORDER) {
    const dns = domainNodes.get(domain) || []
    // 按层分组，取最大层节点数计算宽度
    const layerCounts = new Map<number, number>()
    for (const n of dns) {
      const layer = LAYER_Y[n.type] || 260
      layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1)
    }
    let maxLayerCount = 1
    for (const count of layerCounts.values()) {
      if (count > maxLayerCount) maxLayerCount = count
    }
    const spacing = adaptiveSpacing(maxLayerCount, DOMAIN_BASE_WIDTH[domain])
    const width = Math.max(DOMAIN_BASE_WIDTH[domain], (maxLayerCount - 1) * spacing + GROUP_GAP * 2)
    domainWidths.set(domain, width)
  }

  /* === Step 3: 计算分区 X 起点 === */
  const domains: LayoutDomain[] = []
  let cursorX = 0
  for (const domain of DOMAIN_ORDER) {
    const width = domainWidths.get(domain) || DOMAIN_BASE_WIDTH[domain]
    domains.push({ domain, x: cursorX, width })
    cursorX += width + DOMAIN_GAP
  }

  /* === Step 4: 在每个分区内按层+组排列节点 === */
  const layoutNodes: LayoutNode[] = []

  for (const { domain, x: domainX, width: domainWidth } of domains) {
    const dns = domainNodes.get(domain) || []
    if (dns.length === 0) continue

    // 按层分组
    const layerMap = new Map<number, TopologyNode[]>()
    for (const n of dns) {
      const layer = LAYER_Y[n.type] || 260
      if (!layerMap.has(layer)) layerMap.set(layer, [])
      layerMap.get(layer)!.push(n)
    }

    for (const [layerY, layerNodes] of layerMap) {
      // 服务器层：按 Pod/Rail 分组
      if (domain === 'server') {
        layoutServerLayer(layerNodes, edges, domainX, domainWidth, layerY, layoutNodes)
      } else {
        // 其他层：按 podid 分组，组内均匀排列
        layoutGroupedLayer(layerNodes, domainX, domainWidth, layerY, layoutNodes, domain)
      }
    }
  }

  return { layoutNodes, domains }
}

/* ---------- 服务器层布局（按 Pod 分组）---------- */

function layoutServerLayer(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  domainX: number,
  domainWidth: number,
  layerY: number,
  out: LayoutNode[],
) {
  // 通过参数网边建立 server → param_leaf 映射
  const serverLeafMap = new Map<string, string>()
  for (const e of edges) {
    if (!e.cableType.includes('参数') && !e.description.includes('参数')) continue
    const isServerSrc = nodes.some((n) => n.id === e.source && n.type === 'server')
    const isLeafTgt = nodes.some((n) => n.id === e.target && n.type === 'param_leaf')
    const isServerTgt = nodes.some((n) => n.id === e.target && n.type === 'server')
    const isLeafSrc = nodes.some((n) => n.id === e.source && n.type === 'param_leaf')
    if (isServerSrc && isLeafTgt) serverLeafMap.set(e.source, e.target)
    if (isServerTgt && isLeafSrc) serverLeafMap.set(e.target, e.source)
  }

  // 按 Pod 分组
  const podGroups = new Map<string, TopologyNode[]>()
  const ungrouped: TopologyNode[] = []
  for (const n of nodes) {
    const podKey = n.podid || serverLeafMap.get(n.id) || ''
    if (podKey) {
      if (!podGroups.has(podKey)) podGroups.set(podKey, [])
      podGroups.get(podKey)!.push(n)
    } else {
      ungrouped.push(n)
    }
  }

  const groupEntries = Array.from(podGroups.entries())
  const totalGroups = groupEntries.length + (ungrouped.length > 0 ? 1 : 0)
  const groupSlotWidth = domainWidth / Math.max(totalGroups, 1)

  let groupIdx = 0
  for (const [podKey, groupNodes] of groupEntries) {
    const groupCenterX = domainX + groupIdx * groupSlotWidth + groupSlotWidth / 2
    const spacing = Math.min(NODE_MAX_SPACING, Math.max(NODE_MIN_SPACING, Math.floor(groupSlotWidth / Math.max(groupNodes.length, 1))))
    const totalW = (groupNodes.length - 1) * spacing
    const startX = groupCenterX - totalW / 2

    groupNodes.forEach((n, ni) => {
      out.push({
        id: n.id,
        x: startX + ni * spacing,
        y: layerY,
        type: n.type,
        domain: 'server',
        group: podKey,
        podid: n.podid || '',
      })
    })
    groupIdx++
  }

  // 未分组服务器
  if (ungrouped.length > 0) {
    const groupCenterX = domainX + groupIdx * groupSlotWidth + groupSlotWidth / 2
    const spacing = Math.min(NODE_MAX_SPACING, Math.max(NODE_MIN_SPACING, Math.floor(groupSlotWidth / Math.max(ungrouped.length, 1))))
    const totalW = (ungrouped.length - 1) * spacing
    const startX = groupCenterX - totalW / 2
    ungrouped.forEach((n, ni) => {
      out.push({
        id: n.id,
        x: startX + ni * spacing,
        y: layerY,
        type: n.type,
        domain: 'server',
        podid: n.podid || '',
      })
    })
  }
}

/* ---------- 分组层布局（按 podid 分组）---------- */

function layoutGroupedLayer(
  nodes: TopologyNode[],
  domainX: number,
  domainWidth: number,
  layerY: number,
  out: LayoutNode[],
  domain: NetworkDomain,
) {
  // 按 podid 或 group 分组
  const groups = new Map<string, TopologyNode[]>()
  for (const n of nodes) {
    const key = n.podid || n.group || '_default'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(n)
  }

  const groupEntries = Array.from(groups.entries())
  const totalGroups = groupEntries.length
  const groupSlotWidth = domainWidth / Math.max(totalGroups, 1)

  groupEntries.forEach(([key, groupNodes], gi) => {
    const groupCenterX = domainX + gi * groupSlotWidth + groupSlotWidth / 2
    const spacing = Math.min(NODE_MAX_SPACING, Math.max(NODE_MIN_SPACING, Math.floor(groupSlotWidth / Math.max(groupNodes.length, 1))))
    const totalW = (groupNodes.length - 1) * spacing
    const startX = groupCenterX - totalW / 2

    groupNodes.forEach((n, ni) => {
      out.push({
        id: n.id,
        x: startX + ni * spacing,
        y: layerY,
        type: n.type,
        domain,
        group: key !== '_default' ? key : undefined,
        podid: n.podid || '',
      })
    })
  })
}

/* ---------- 域分区背景样式 ---------- */

export const DOMAIN_BG_COLORS: Record<NetworkDomain, { fill: string; fillDark: string; border: string; label: string }> = {
  param: { fill: 'rgba(59,130,246,0.06)', fillDark: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.25)', label: '参数网络' },
  storage: { fill: 'rgba(16,185,129,0.06)', fillDark: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.25)', label: '存储网络' },
  server: { fill: 'rgba(156,163,175,0.04)', fillDark: 'rgba(156,163,175,0.08)', border: 'rgba(156,163,175,0.15)', label: '服务器' },
  biz: { fill: 'rgba(139,92,246,0.06)', fillDark: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.25)', label: '业务网络' },
  oob: { fill: 'rgba(107,114,128,0.06)', fillDark: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.25)', label: '带外管理' },
}
