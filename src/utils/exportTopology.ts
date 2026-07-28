/**
 * Utility: Export topology graph to PNG using ECharts
 * Used by WorkbenchPanel to generate topology PNG during rendering
 */
import type { TopologyNode, TopologyEdge } from '@/stores/design.store'

const categories: Record<string, { name: string; itemStyle: { color: string }; symbol: string }> = {
  server: { name: 'Server', itemStyle: { color: '#6366f1' }, symbol: 'circle' },
  param_leaf: { name: 'Param Leaf', itemStyle: { color: '#3b82f6' }, symbol: 'roundRect' },
  param_spine: { name: 'Param Spine', itemStyle: { color: '#f59e0b' }, symbol: 'roundRect' },
  param_core: { name: 'Param Core', itemStyle: { color: '#ef4444' }, symbol: 'roundRect' },
  storage_leaf: { name: 'Storage Leaf', itemStyle: { color: '#10b981' }, symbol: 'roundRect' },
  storage_spine: { name: 'Storage Spine', itemStyle: { color: '#8b5cf6' }, symbol: 'roundRect' },
  oob_access: { name: 'OOB Access', itemStyle: { color: '#6b7280' }, symbol: 'roundRect' },
  oob_agg: { name: 'OOB Agg', itemStyle: { color: '#4b5563' }, symbol: 'roundRect' },
  biz_access: { name: 'Biz Access', itemStyle: { color: '#14b8a6' }, symbol: 'roundRect' },
  biz_agg: { name: 'Biz Agg', itemStyle: { color: '#0d9488' }, symbol: 'roundRect' },
}

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
  // ECharts 6 exports named functions directly
  const ecInit = (echarts as any).init || (echarts as any).default?.init

  // Build category list
  const types = new Set(nodes.map((n) => n.type))
  const catList = Array.from(types).map(
    (t) => categories[t] || { name: t, itemStyle: { color: '#9ca3af' }, symbol: 'circle' },
  )

  // Compute layered positions
  const nodesByType: Record<string, TopologyNode[]> = {}
  for (const node of nodes) {
    const t = node.type
    if (!nodesByType[t]) nodesByType[t] = []
    nodesByType[t].push(node)
  }

  const graphNodes: any[] = []
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
          formatter: (p: any) => (p.name.length > 15 ? p.name.slice(0, 15) + '...' : p.name),
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
