import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import {
  ZoomIn, ZoomOut, Maximize2, Download, Filter, Network, X, Activity,
  RotateCcw, Save,
} from 'lucide-react'
import { useDesignStore, type TopologyNode } from '@/stores/design.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { NODE_TYPE_LABELS } from '@/constants/labels'

/* ---------- constants ---------- */
const NODE_COLORS: Record<string, string> = {
  server: '#3B82F6',
  param_leaf: '#F59E0B',
  param_spine: '#8B5CF6',
  param_core: '#EF4444',
  storage_leaf: '#10B981',
  storage_spine: '#14B8A6',
  storage_core: '#06B6D4',
  oob_access: '#6B7280',
  oob_agg: '#4B5563',
  biz_access: '#0EA5E9',
  biz_agg: '#0284C7',
}

const NODE_SIZES: Record<string, [number, number]> = {
  server: [100, 26],
  param_leaf: [80, 36], storage_leaf: [80, 36],
  param_spine: [88, 40], storage_spine: [88, 40],
  param_core: [96, 44], storage_core: [96, 44],
  oob_access: [72, 32], biz_access: [72, 32],
  oob_agg: [80, 36], biz_agg: [80, 36],
}

function getNodeWidth(type: string): number { return NODE_SIZES[type]?.[0] || 72 }
function getNodeHeight(type: string): number { return NODE_SIZES[type]?.[1] || 32 }

const NODE_LABELS = NODE_TYPE_LABELS

const EDGE_COLORS: Record<string, string> = {
  '参数网': '#3B82F6', '存储网': '#10B981', 'OOB': '#6B7280', '业务网': '#8B5CF6',
}

// Layer assignment — from top to bottom:
//   0 : biz_agg / oob_agg           (业务汇聚 / 带外汇聚)
//   1 : biz_access / oob_access     (业务接入 / 带外接入)
//   2 : server                      (服务器 — 中间层)
//   3 : param_leaf / storage_leaf   (参数Leaf / 存储Leaf)
//   4 : param_spine / storage_spine
//   5 : param_core / storage_core
function getNodeLayer(type: string): number {
  if (type === 'biz_agg' || type === 'oob_agg') return 0
  if (type === 'biz_access' || type === 'oob_access') return 1
  if (type === 'server') return 2
  if (type.includes('leaf')) return 3
  if (type.includes('spine')) return 4
  if (type.includes('core')) return 5
  return 2
}

// Layer Y positions in pixels — vertical spacing large enough to avoid overlap
// Node heights ~26–44px, layer gaps 60–80px between layer centers
const LAYER_Y: Record<number, number> = { 0: 40, 1: 150, 2: 290, 3: 430, 4: 550, 5: 650 }
const H_SPACING = 120   // horizontal pitch between node centers
const GROUP_GAP = 80    // extra gap between server groups

type FilterType = '全部' | '参数网络' | '存储网络' | 'OOB' | '业务网络'
const FILTER_OPTIONS: FilterType[] = ['全部', '参数网络', '存储网络', 'OOB', '业务网络']

function matchFilter(description: string, cableType: string, filter: FilterType): boolean {
  if (filter === '全部') return true
  if (filter === '参数网络') return description.includes('参数') || cableType.includes('参数')
  if (filter === '存储网络') return description.includes('存储') || cableType.includes('存储')
  if (filter === 'OOB') return description.includes('OOB') || cableType.includes('OOB')
  if (filter === '业务网络') return description.includes('业务') || cableType.includes('业务')
  return true
}

function getEdgeColor(description: string, cableType: string): string {
  if (description.includes('参数') || cableType.includes('参数')) return EDGE_COLORS['参数网']
  if (description.includes('存储') || cableType.includes('存储')) return EDGE_COLORS['存储网']
  if (description.includes('OOB') || cableType.includes('OOB')) return EDGE_COLORS['OOB']
  if (description.includes('业务') || cableType.includes('业务')) return EDGE_COLORS['业务网']
  return '#d1d5db'
}

function getNodeColor(type: string): string { return NODE_COLORS[type] || '#9ca3af' }

/* ---------- saved layout helpers ---------- */
type SavedLayout = Record<string, { x: number; y: number }>

function getStorageKey(projectName: string): string {
  return `autolink-topology-${projectName}`
}

function loadLayout(projectName: string): SavedLayout | null {
  try {
    const raw = localStorage.getItem(getStorageKey(projectName))
    if (!raw) return null
    return JSON.parse(raw) as SavedLayout
  } catch { return null }
}

function saveLayout(projectName: string, layout: SavedLayout) {
  try {
    localStorage.setItem(getStorageKey(projectName), JSON.stringify(layout))
  } catch { /* storage full, ignore */ }
}

function clearLayout(projectName: string) {
  localStorage.removeItem(getStorageKey(projectName))
}

/* ---------- compute positions ---------- */
interface NodePosition { id: string; x: number; y: number; type: string; podid: string }

function computeLayout(
  nodes: TopologyNode[],
  edges: { source: string; target: string; cableType: string }[],
  savedLayout: SavedLayout | null,
): NodePosition[] {
  // Build server → param_leaf mapping from edges
  // Each server may connect to one primary param_leaf
  const serverLeafMap = new Map<string, string>()
  for (const e of edges) {
    if (!e.cableType.includes('参数')) continue
    const srcNode = nodes.find((n) => n.id === e.source)
    const tgtNode = nodes.find((n) => n.id === e.target)
    if (srcNode?.type === 'server' && tgtNode?.type === 'param_leaf') {
      serverLeafMap.set(srcNode.id, tgtNode.id)
    }
    if (tgtNode?.type === 'server' && srcNode?.type === 'param_leaf') {
      serverLeafMap.set(tgtNode.id, srcNode.id)
    }
  }

  // Group by layer
  const layerMap = new Map<number, TopologyNode[]>()
  for (const n of nodes) {
    const l = getNodeLayer(n.type)
    if (!layerMap.has(l)) layerMap.set(l, [])
    layerMap.get(l)!.push(n)
  }

  const positions: NodePosition[] = []

  for (const [layer, layerNodes] of layerMap) {
    const y = LAYER_Y[layer] ?? 300

    if (layer === 2) {
      // ---- Server layer: group by connected param_leaf, with clear group gaps ----
      const leafGroups = new Map<string, TopologyNode[]>()
      const ungrouped: TopologyNode[] = []

      for (const n of layerNodes) {
        const leaf = serverLeafMap.get(n.id)
        if (leaf) {
          if (!leafGroups.has(leaf)) leafGroups.set(leaf, [])
          leafGroups.get(leaf)!.push(n)
        } else {
          ungrouped.push(n)
        }
      }

      // Calculate total width: each group's servers + group gaps
      const groupEntries = Array.from(leafGroups.entries())
      let totalGroupsWidth = 0
      const groupWidths: number[] = []

      for (const [, groupNodes] of groupEntries) {
        const gw = (groupNodes.length - 1) * H_SPACING
        groupWidths.push(gw)
        totalGroupsWidth += gw
      }
      // Ungrouped servers
      if (ungrouped.length > 0) {
        const uw = (ungrouped.length - 1) * H_SPACING
        groupWidths.push(uw)
        totalGroupsWidth += uw
      }

      const totalGapWidth = Math.max(0, groupEntries.length + (ungrouped.length > 0 ? 0 : 0) - 1) * GROUP_GAP
      const totalWidth = totalGroupsWidth + totalGapWidth

      // Center everything horizontally
      let cursorX = -totalWidth / 2
      let groupIdx = 0

      // Render leaf groups
      for (const [, groupNodes] of groupEntries) {
        const gw = groupWidths[groupIdx]
        const groupStartX = cursorX + gw / 2 - (groupNodes.length - 1) * H_SPACING / 2
        groupNodes.forEach((n, ni) => {
          const x = groupStartX + ni * H_SPACING
          const saved = savedLayout?.[n.id]
          positions.push({
            id: n.id,
            x: saved?.x ?? x,
            y: saved?.y ?? y,
            type: n.type,
            podid: n.podid || '',
          })
        })
        cursorX += gw + GROUP_GAP
        groupIdx++
      }

      // Render ungrouped servers (fallback: original pod-based grouping)
      if (ungrouped.length > 0) {
        const uw = groupWidths[groupIdx] || 0
        const ungroupedStartX = cursorX + uw / 2
        ungrouped.forEach((n, ni) => {
          const x = ungroupedStartX + (ni - (ungrouped.length - 1) / 2) * H_SPACING
          const saved = savedLayout?.[n.id]
          positions.push({
            id: n.id,
            x: saved?.x ?? x,
            y: saved?.y ?? y,
            type: n.type,
            podid: n.podid || '',
          })
        })
      }
    } else {
      // ---- Non-server layers: evenly spread horizontally ----
      const totalWidth = (layerNodes.length - 1) * H_SPACING
      const startX = -totalWidth / 2

      layerNodes.forEach((n, i) => {
        const saved = savedLayout?.[n.id]
        positions.push({
          id: n.id,
          x: saved?.x ?? startX + i * H_SPACING,
          y: saved?.y ?? y,
          type: n.type,
          podid: n.podid || '',
        })
      })
    }
  }

  return positions
}

/* ---------- component ---------- */

export function TopologyTab() {
  const topology = useDesignStore((s) => s.topology)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const addToast = useToastStore((s) => s.addToast)

  const chartRef = useRef<ReactECharts | null>(null)
  const [filter, setFilter] = useState<FilterType>('全部')
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [hasSavedLayout, setHasSavedLayout] = useState(false)
  const [layoutVersion, setLayoutVersion] = useState(0) // increment to force re-render

  // Check for saved layout
  useEffect(() => {
    if (selectedProjectName) {
      const saved = loadLayout(selectedProjectName)
      setHasSavedLayout(saved !== null)
    }
  }, [selectedProjectName])

  /* ---------- filtered data ---------- */
  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!topology) return { filteredNodes: [], filteredEdges: [] }
    if (filter === '全部') return { filteredNodes: topology.nodes, filteredEdges: topology.edges }

    const matchingEdgeSet = new Set<string>()
    for (const edge of topology.edges) {
      if (matchFilter(edge.description, edge.cableType, filter)) {
        matchingEdgeSet.add(edge.source)
        matchingEdgeSet.add(edge.target)
      }
    }
    const nodes = topology.nodes.filter((n) => matchingEdgeSet.has(n.id))
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = topology.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target) &&
        matchFilter(e.description, e.cableType, filter),
    )
    return { filteredNodes: nodes, filteredEdges: edges }
  }, [topology, filter])

  /* ---------- compute positions ---------- */
  const nodePositions = useMemo(() => {
    if (filteredNodes.length === 0) return []
    const saved = selectedProjectName ? loadLayout(selectedProjectName) : null
    return computeLayout(filteredNodes as TopologyNode[], filteredEdges, saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredNodes, filteredEdges, selectedProjectName, layoutVersion])

  /* ---------- ECharts option ---------- */
  const option = useMemo((): EChartsOption | null => {
    if (!topology || filteredNodes.length === 0) return null

    const types = new Set(filteredNodes.map((n) => n.type))
    const categories = Array.from(types).map((type) => ({
      name: NODE_LABELS[type] || type,
      itemStyle: { color: getNodeColor(type) },
    }))

    const posMap = new Map(nodePositions.map((p) => [p.id, p]))

    const graphNodes = filteredNodes.map((node) => {
      const pos = posMap.get(node.id)
      const catIdx = categories.findIndex((c) => c.name === (NODE_LABELS[node.type] || node.type))
      const w = getNodeWidth(node.type)
      const h = getNodeHeight(node.type)
      return {
        id: node.id,
        name: node.id,
        x: pos?.x ?? 0,
        y: pos?.y ?? 300,
        category: catIdx >= 0 ? catIdx : 0,
        symbol: 'rect',
        symbolSize: [w, h],
        itemStyle: {
          borderRadius: 4,
          shadowBlur: 2,
          shadowColor: 'rgba(0,0,0,0.15)',
        },
        label: {
          show: true,
          fontSize: 9,
          position: 'inside' as const,
          distance: 0,
          color: '#fff',
          formatter: (p: { name: string }) =>
            p.name.length > 14 ? p.name.slice(0, 14) + '..' : p.name,
        },
        _rawNode: node,
      }
    })

    const graphNodeIds = new Set(graphNodes.map((n) => n.id))
    const graphEdges = filteredEdges
      .filter((e) => graphNodeIds.has(e.source) && graphNodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        lineStyle: {
          color: getEdgeColor(e.description, e.cableType),
          width: 1.2,
          opacity: 0.35,
          curveness: 0.15,
        },
      }))

    return {
      backgroundColor: 'transparent',
      animationDuration: 400,
      animationEasing: 'cubicOut' as const,
      tooltip: {
        trigger: 'item' as const,
        formatter: (params: any) => {
          if (params.dataType === 'node') {
            const raw: TopologyNode = params.data._rawNode
            const parts = [`<b>${raw.id}</b>`, `类型: ${NODE_LABELS[raw.type] || raw.type}`]
            if (raw.group) parts.push(`组: ${raw.group}`)
            if (raw.podid) parts.push(`Pod: ${raw.podid}`)
            const ext = raw as any
            if (ext.cabinetName) parts.push(`机柜: ${ext.cabinetName}`)
            return parts.join('<br/>')
          }
          return `${params.data.source} → ${params.data.target}`
        },
      },
      series: [{
        type: 'graph',
        layout: 'none',
        categories,
        data: graphNodes,
        edges: graphEdges,
        roam: true,
        draggable: true,
        scaleLimit: { min: 0.2, max: 5 },
        emphasis: {
          focus: 'adjacency' as const,
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          lineStyle: { width: 2.5, opacity: 0.7 },
        },
      }],
    }
  }, [topology, filteredNodes, filteredEdges, nodePositions])

  /* ---------- actions ---------- */
  const handleChartClick = useCallback((params: any) => {
    if (params.dataType === 'node') {
      setSelectedNode(params.data._rawNode as TopologyNode)
    } else {
      setSelectedNode(null)
    }
  }, [])

  const handleSaveLayout = useCallback(() => {
    if (!selectedProjectName) return
    const chart = chartRef.current?.getEchartsInstance()
    if (!chart) return
    const model = (chart as any).getModel()
    const series = model.getSeriesByIndex(0) as any
    if (!series) return
    const graph = series.getGraph()
    const layout: SavedLayout = {}
    graph.eachNode((node: any) => {
      const pos = node.getLayout()
      if (pos) layout[node.id] = { x: pos.x, y: pos.y }
    })
    saveLayout(selectedProjectName, layout)
    setHasSavedLayout(true)
    addToast('success', '拓扑布局已保存')
  }, [selectedProjectName, addToast])

  const handleResetLayout = useCallback(() => {
    if (!selectedProjectName) return
    clearLayout(selectedProjectName)
    setHasSavedLayout(false)
    setLayoutVersion((v) => v + 1)
    addToast('success', '布局已重置')
  }, [selectedProjectName, addToast])

  const handleZoomIn = () => {
    const chart = chartRef.current?.getEchartsInstance()
    if (chart) {
      const opt = chart.getOption() as any
      const zoom = opt?.series?.[0]?.zoom || 1
      chart.setOption({ series: [{ zoom: Math.min(zoom * 1.3, 5) }] })
    }
  }

  const handleZoomOut = () => {
    const chart = chartRef.current?.getEchartsInstance()
    if (chart) {
      const opt = chart.getOption() as any
      const zoom = opt?.series?.[0]?.zoom || 1
      chart.setOption({ series: [{ zoom: Math.max(zoom * 0.7, 0.2) }] })
    }
  }

  const handleFitView = () => {
    chartRef.current?.getEchartsInstance()?.dispatchAction({ type: 'restore' })
  }

  const handleExportPng = () => {
    const chart = chartRef.current?.getEchartsInstance()
    if (!chart) return
    try {
      const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
      const link = document.createElement('a')
      link.href = dataUrl
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      link.download = `拓扑图_${ts}.png`
      link.click()
    } catch { /* fallback */ }
  }

  const nodeConnectionCount = useMemo(() => {
    if (!selectedNode || !topology) return 0
    return topology.edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id,
    ).length
  }, [selectedNode, topology])

  /* ---------- render ---------- */
  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-gray-800">
        <Network size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500">拓扑可视化</p>
        <p className="text-xs text-gray-400">请先选择一个项目</p>
      </div>
    )
  }

  if (!topology) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-gray-800">
        <Network size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500">尚未生成拓扑</p>
        <p className="text-xs text-gray-400">在「设计」面板中生成拓扑数据后查看</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">拓扑视图</span>
          <span className="text-[10px] text-gray-400">{filteredNodes.length} 节点 · {filteredEdges.length} 连接</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Filter */}
          <div className="relative">
            <button onClick={() => setShowFilter(!showFilter)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors ${
                filter !== '全部'
                  ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                  : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}>
              <Filter size={11} />{filter}
            </button>
            {showFilter && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowFilter(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg py-1 min-w-[120px]">
                  {FILTER_OPTIONS.map((opt) => (
                    <button key={opt} onClick={() => { setFilter(opt); setShowFilter(false) }}
                      className={`block w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        filter === opt ? 'text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-600 dark:text-gray-400'
                      }`}>
                      {opt}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-0.5" />

          <button onClick={handleZoomIn} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" title="放大">
            <ZoomIn size={14} />
          </button>
          <button onClick={handleZoomOut} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" title="缩小">
            <ZoomOut size={14} />
          </button>
          <button onClick={handleFitView} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" title="适应视图">
            <Maximize2 size={14} />
          </button>

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-0.5" />

          <button onClick={handleSaveLayout}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="保存当前布局">
            <Save size={12} />保存布局
          </button>
          {hasSavedLayout && (
            <button onClick={handleResetLayout}
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="重置为自动布局">
              <RotateCcw size={12} />重置
            </button>
          )}

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-0.5" />

          <button onClick={handleExportPng} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" title="导出PNG">
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 relative overflow-hidden">
        {option && (
          <ReactECharts
            ref={(e) => { chartRef.current = e }}
            option={option}
            style={{ height: '100%', width: '100%' }}
            onEvents={{ click: handleChartClick }}
            opts={{ renderer: 'canvas' }}
          />
        )}

        {/* Detail panel */}
        {selectedNode && (
          <div className="absolute top-3 right-3 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4 min-w-[240px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">节点详情</span>
              <button onClick={() => setSelectedNode(null)}
                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: getNodeColor(selectedNode.type) }} />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{selectedNode.id}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <span className="text-gray-400">类型</span>
                <span className="text-gray-700 dark:text-gray-300 font-medium">{NODE_LABELS[selectedNode.type] || selectedNode.type}</span>
                <span className="text-gray-400">组</span>
                <span className="text-gray-700 dark:text-gray-300">{selectedNode.group || '-'}</span>
                <span className="text-gray-400">Pod</span>
                <span className="text-gray-700 dark:text-gray-300">{selectedNode.podid || '-'}</span>
                {((selectedNode as any).cabinetName || (selectedNode as any).cabinetId) && (
                  <>
                    {(selectedNode as any).cabinetId && (
                      <>
                        <span className="text-gray-400">机柜ID</span>
                        <span className="text-gray-700 dark:text-gray-300">{(selectedNode as any).cabinetId}</span>
                      </>
                    )}
                    {(selectedNode as any).cabinetName && (
                      <>
                        <span className="text-gray-400">机柜名称</span>
                        <span className="text-gray-700 dark:text-gray-300">{(selectedNode as any).cabinetName}</span>
                      </>
                    )}
                    {((selectedNode as any).startU !== undefined || (selectedNode as any).endU !== undefined) && (
                      <>
                        <span className="text-gray-400">U位</span>
                        <span className="text-gray-700 dark:text-gray-300">
                          {(selectedNode as any).startU ?? '-'} - {(selectedNode as any).endU ?? '-'}
                        </span>
                      </>
                    )}
                  </>
                )}
                <span className="text-gray-400">连接数</span>
                <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
                  <Activity size={11} />{nodeConnectionCount}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        {option && (
          <div className="absolute bottom-3 left-3 z-10 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(NODE_COLORS).filter(([type]) =>
                filteredNodes.some((n) => n.type === type)
              ).slice(0, 12).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5 text-[10px] text-gray-600 dark:text-gray-400">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  {NODE_LABELS[type] || type}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700">
              {Object.entries(EDGE_COLORS).map(([label, color]) => (
                <div key={label} className="flex items-center gap-1.5 text-[10px] text-gray-600 dark:text-gray-400">
                  <span className="inline-block w-4 h-px" style={{ backgroundColor: color }} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
