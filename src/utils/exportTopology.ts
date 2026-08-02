/**
 * Utility: Export topology graph to PNG using ECharts
 * Used by WorkbenchPanel to generate topology PNG during rendering
 */
import type { TopologyNode, TopologyEdge } from '@/stores/design.store'
import {
  TOPOLOGY_NODE_STYLES,
  TOPOLOGY_NODE_DEFAULT_COLOR,
} from '@/constants/topology-colors'

// U5: 节点颜色统一引用 @/constants/topology-colors,保留局部名 categories
const categories: Record<string, { name: string; itemStyle: { color: string }; symbol: string }> =
  Object.fromEntries(
    Object.entries(TOPOLOGY_NODE_STYLES).map(([type, style]) => [
      type,
      {
        name: style.echartsName,
        itemStyle: { color: style.color },
        symbol: style.echartsSymbol,
      },
    ]),
  )

const typeOrder: Record<string, number> = {
  server: 0,
  param_leaf: 1, storage_leaf: 1, oob_access: 1, biz_access: 1,
  param_spine: 2, storage_spine: 2, oob_agg: 2, biz_agg: 2,
  param_core: 3, storage_core: 3,
}

export async function exportTopologyPng(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): Promise<string> {
  // Dynamically import echarts
  const echarts = await import('echarts')
  // ECharts 6 exports named functions directly (兼容 default 导出形态)
  const ecInit =
    echarts.init ??
    (echarts as unknown as { default?: { init: typeof echarts.init } }).default?.init ??
    echarts.init

  // Build category list
  const types = new Set(nodes.map((n) => n.type))
  const catList = Array.from(types).map(
    (t) => categories[t] || { name: t, itemStyle: { color: TOPOLOGY_NODE_DEFAULT_COLOR }, symbol: 'circle' },
  )

  // Compute layered positions
  const nodesByType: Record<string, TopologyNode[]> = {}
  for (const node of nodes) {
    const t = node.type
    if (!nodesByType[t]) nodesByType[t] = []
    nodesByType[t].push(node)
  }

  // V2.9.1-T4: 图节点结构类型化（ECharts graph series data）
  interface GraphNodeData {
    id: string
    name: string
    x: number
    y: number
    category: number
    symbolSize: number
    label?: {
      show: boolean
      fontSize: number
      position: string
      formatter?: (p: { name: string }) => string
    }
    itemStyle?: { borderRadius: number }
    fixed: boolean
  }
  const graphNodes: GraphNodeData[] = []
  const spacing = 40
  const layerSpacing = 200
  const colWidth = 60

  for (const [type, typeNodes] of Object.entries(nodesByType)) {
    const layer = typeOrder[type] ?? 0
    const cols = Math.ceil(Math.sqrt(typeNodes.length * 2))
    typeNodes.forEach((node, i) => {
      const row = Math.floor(i / cols)
      const col = i % cols
      const x = col * colWidth
      const y = layer * layerSpacing + row * spacing
      const catName = categories[type]?.name || type
      const catIdx = catList.findIndex((c) => c.name === catName)

      graphNodes.push({
        id: node.id,
        name: node.id,
        x,
        y,
        category: catIdx >= 0 ? catIdx : 0,
        symbolSize: type === 'server' ? 8 : 18,
        label: {
          show: type !== 'server',
          fontSize: 9,
          position: 'right',
          formatter: (p: { name: string }) => (p.name.length > 15 ? p.name.slice(0, 15) + '...' : p.name),
        },
        itemStyle: { borderRadius: 4 },
        fixed: true,
      })
    })
  }

  const graphNodeIds = new Set(graphNodes.map((n) => n.id))
  const graphEdges = edges
    .filter((e) => graphNodeIds.has(e.source) && graphNodeIds.has(e.target))
    .map((e) => {
      const isServerEdge = e.source.includes('服务器') || e.target.includes('服务器')
      return {
        source: e.source,
        target: e.target,
        lineStyle: {
          width: isServerEdge ? 0.3 : 0.5,
          opacity: isServerEdge ? 0.08 : 0.2,
          curveness: 0.1,
          color: '#d1d5db',
        },
      }
    })

  // Create a hidden container
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:1200px;height:800px;z-index:-1'
  document.body.appendChild(container)

  try {
    const chart = ecInit(container, undefined, {
      width: 1200,
      height: 800,
      renderer: 'canvas',
      devicePixelRatio: 2,
    })

    chart.setOption({
      backgroundColor: '#fff',
      animation: false,
      series: [
        {
          type: 'graph',
          layout: 'none',
          categories: catList,
          data: graphNodes,
          edges: graphEdges,
          roam: false,
          draggable: false,
        },
      ],
    })

    // Wait a tick for render to complete
    await new Promise((resolve) => setTimeout(resolve, 200))

    const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
    chart.dispose()

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    return base64
  } finally {
    document.body.removeChild(container)
  }
}
