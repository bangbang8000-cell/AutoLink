import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GitBranch, ZoomIn, ZoomOut, Maximize2,
  Network, Search, X, Filter, Download,
} from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore, type TopologyNode, type TopologyEdge } from '@/stores/design.store'

// ECharts will be loaded on demand to avoid SSR issues
let ReactECharts: any = null

async function loadECharts() {
  if (!ReactECharts) {
    const mod = await import('echarts-for-react')
    ReactECharts = mod.default
  }
  return ReactECharts
}

/* -------------------------------------------------- */
/*  Types                                             */
/* -------------------------------------------------- */
interface NodeCategory {
  name: string
  itemStyle: { color: string }
  symbol: string
}

const categories: Record<string, NodeCategory> = {
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

/* -------------------------------------------------- */
/*  Node Detail                                       */
/* -------------------------------------------------- */
function NodeDetail({ node, edges, onClose }: { node: TopologyNode; edges: TopologyEdge[]; onClose: () => void }) {
  const connectedEdges = edges.filter(
    (e) => e.source === node.id || e.target === node.id,
  )

  return (
    <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{node.id}</span>
        <button onClick={onClose} className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
          <X size={14} className="text-gray-400" />
        </button>
      </div>
      <div className="space-y-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-gray-400">类型</span>
          <span className="text-gray-600 dark:text-gray-400">{node.type}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">分组</span>
          <span className="text-gray-600 dark:text-gray-400 truncate max-w-[120px]">{node.group || '-'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Pod</span>
          <span className="text-gray-600 dark:text-gray-400">{node.podid || '-'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">连接数</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{connectedEdges.length}</span>
        </div>
      </div>
      {connectedEdges.length > 0 && (
        <div className="mt-2 max-h-32 overflow-auto">
          <div className="text-[10px] font-medium text-gray-500 mb-1">连接列表</div>
          {connectedEdges.slice(0, 20).map((e, i) => (
            <div key={i} className="text-[10px] text-gray-400 py-0.5 border-b border-gray-100 dark:border-gray-700/30">
              <span className="text-gray-600 dark:text-gray-400">{e.source === node.id ? e.target : e.source}</span>
              <span className="mx-1 text-gray-400">→</span>
              <span className="text-gray-500">{e.description}</span>
              <span className="ml-1 text-gray-400">[{e.speed}]</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------- */
/*  TopologyPanel                                     */
/* -------------------------------------------------- */
export function TopologyPanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const topology = useDesignStore((s) => s.topology)
  const generating = useDesignStore((s) => s.generating)

  const [ECharts, setECharts] = useState<any>(null)
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const chartRef = useRef<any>(null)
  const isDark = document.documentElement.classList.contains('dark')

  useEffect(() => {
    loadECharts().then(setECharts).catch((err) => {
      console.error('[TopologyPanel] ECharts import failed:', err)
    })
  }, [])

  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!topology) return { filteredNodes: [], filteredEdges: [] }
    let nodes = topology.nodes
    let edges = topology.edges

    if (filter) {
      const allowedTypes = filter === 'param'
        ? ['server', 'param_leaf', 'param_spine', 'param_core']
        : filter === 'storage'
          ? ['server', 'storage_leaf', 'storage_spine']
          : filter === 'oob'
            ? ['server', 'oob_access', 'oob_agg']
            : filter === 'biz'
              ? ['server', 'biz_access', 'biz_agg']
              : null

      if (allowedTypes) {
        const allowedSet = new Set(allowedTypes)
        nodes = nodes.filter((n) => allowedSet.has(n.type))
        const nodeIds = new Set(nodes.map((n) => n.id))
        edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      }
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      const matchedIds = new Set(
        nodes.filter((n) => n.id.toLowerCase().includes(q)).map((n) => n.id),
      )
      nodes = nodes.filter((n) => matchedIds.has(n.id))
      edges = edges.filter((e) => matchedIds.has(e.source) || matchedIds.has(e.target))
    }

    return { filteredNodes: nodes, filteredEdges: edges }
  }, [topology, filter, search])

  const categoryList = useMemo(() => {
    const types = new Set(filteredNodes.map((n) => n.type))
    return Array.from(types).map((t) => categories[t] || { name: t, itemStyle: { color: '#9ca3af' }, symbol: 'circle' })
  }, [filteredNodes])

  const option = useMemo(() => {
    if (!topology || filteredNodes.length === 0) return null

    // Compute layered positions
    const typeOrder: Record<string, number> = {
      server: 0,
      param_leaf: 1, storage_leaf: 1, oob_access: 1, biz_access: 1,
      param_spine: 2, storage_spine: 2, oob_agg: 2, biz_agg: 2,
      param_core: 3, storage_core: 3,
    }

    const nodesByType: Record<string, TopologyNode[]> = {}
    for (const node of filteredNodes) {
      const t = node.type
      if (!nodesByType[t]) nodesByType[t] = []
      nodesByType[t].push(node)
    }

    const graphNodes: any[] = []
    const spacing = 40
    const layerSpacing = 200
    const colWidth = 60

    for (const [type, nodes] of Object.entries(nodesByType)) {
      const layer = typeOrder[type] ?? 0
      const cols = Math.ceil(Math.sqrt(nodes.length * 2))
      nodes.forEach((node, i) => {
        const row = Math.floor(i / cols)
        const col = i % cols
        const x = col * colWidth
        const y = layer * layerSpacing + row * spacing
        const catName = categories[type]?.name || type
        const catIdx = categoryList.findIndex((c) => c.name === catName)

        graphNodes.push({
          id: node.id,
          name: node.id,
          x, y,
          category: catIdx >= 0 ? catIdx : 0,
          symbolSize: type === 'server' ? 8 : 18,
          label: {
            show: type !== 'server',
            fontSize: 9,
            position: 'right',
            formatter: (p: any) => p.name.length > 15 ? p.name.slice(0, 15) + '...' : p.name,
          },
          itemStyle: {
            borderRadius: 4,
          },
          fixed: true,
        })
      })
    }

    const graphEdges = filteredEdges.map((e) => {
      const isServerEdge = e.source.includes('服务器') || e.target.includes('服务器')
      return {
        source: e.source,
        target: e.target,
        lineStyle: {
          width: isServerEdge ? 0.5 : 1,
          opacity: isServerEdge ? 0.15 : 0.4,
          curveness: 0.1,
          color: isDark ? '#4b5563' : '#d1d5db',
        },
      }
    })

    const graphNodeIds = new Set(graphNodes.map((n) => n.id))
    const validEdges = graphEdges.filter((e) => graphNodeIds.has(e.source) && graphNodeIds.has(e.target))

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          const cat = categoryList[p.data?.category]
          return `
            <div style="font-size:12px;line-height:1.5">
              <b>${p.name}</b><br/>
              类型: ${cat?.name ?? 'Unknown'}<br/>
              连接: ${validEdges.filter((e: any) => e.source === p.name || e.target === p.name).length}
            </div>`
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'none',
          categories: categoryList,
          data: graphNodes,
          edges: validEdges,
          roam: true,
          draggable: false,
          scaleLimit: { min: 0.1, max: 4 },
          emphasis: {
            focus: 'adjacency',
            lineStyle: { width: 2 },
          },
        },
      ],
    }
  }, [topology, filteredNodes, filteredEdges, categoryList, isDark])

  const onChartReady = useCallback((echarts: any) => {
    chartRef.current = echarts
  }, [])

  const handleChartClick = useCallback((params: any) => {
    if (params.dataType === 'node') {
      const node = topology?.nodes.find((n) => n.id === params.name)
      if (node) setSelectedNode(node)
    }
  }, [topology])

  const onEvents = useMemo(() => ({
    click: handleChartClick,
  }), [handleChartClick])

  const handleZoomIn = () => {
    if (chartRef.current) {
      const inst = chartRef.current.getEchartsInstance?.() || chartRef.current
      const opt = inst?.getOption()
      const zoom = (opt?.series?.[0]?.zoom || 1) * 1.3
      inst?.setOption({ series: [{ zoom }] })
    }
  }

  const handleZoomOut = () => {
    if (chartRef.current) {
      const inst = chartRef.current.getEchartsInstance?.() || chartRef.current
      const opt = inst?.getOption()
      const zoom = (opt?.series?.[0]?.zoom || 1) / 1.3
      inst?.setOption({ series: [{ zoom }] })
    }
  }

  const handleFitView = () => {
    if (chartRef.current) {
      const inst = chartRef.current.getEchartsInstance?.() || chartRef.current
      inst?.dispatchAction?.({ type: 'restore' })
    }
  }

  const handleExportPng = useCallback(async () => {
    if (!chartRef.current || !selectedProjectName) return
    setExporting(true)
    try {
      const inst = chartRef.current.getEchartsInstance?.() || chartRef.current
      const dataUrl: string = inst?.getDataURL?.({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
      if (dataUrl) {
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const fileName = `组网拓扑图_${timestamp}.png`
        const filePath = await window.electron?.export?.saveFile(selectedProjectName, fileName, base64)
        if (filePath) {
          window.electron?.shell?.showItemInFolder(filePath)
        }
      }
    } catch (err) {
      console.error('Export PNG failed:', err)
    } finally {
      setExporting(false)
    }
  }, [selectedProjectName])

  const filters = [
    { key: null, label: t('topology:networkTopology') },
    { key: 'param', label: '参数网络' },
    { key: 'storage', label: '存储网络' },
    { key: 'oob', label: 'OOB' },
    { key: 'biz', label: '业务网络' },
  ]

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <GitBranch size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">{t('topology:title')}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('topology:noProject')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Title */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('topology:title')}
        </span>
        <div className="flex items-center gap-0.5">
          {topology && (
            <button
              onClick={handleExportPng}
              disabled={exporting}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 disabled:opacity-50"
              title="导出拓扑图"
            >
              <Download size={13} />
            </button>
          )}
          <button onClick={handleZoomIn} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" title={t('topology:zoomIn')}>
            <ZoomIn size={13} />
          </button>
          <button onClick={handleZoomOut} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" title={t('topology:zoomOut')}>
            <ZoomOut size={13} />
          </button>
          <button onClick={handleFitView} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" title={t('topology:fitView')}>
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {topology && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <Filter size={11} className="text-gray-400" />
          {filters.map((f) => (
            <button
              key={f.key ?? 'all'}
              onClick={() => setFilter(f.key)}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                filter === f.key
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto relative">
            <Search size={11} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索设备..."
              className="w-36 pl-5 pr-2 py-0.5 text-[10px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-primary-400"
            />
          </div>
        </div>
      )}

      {/* Chart area */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          {!topology ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <Network size={32} className="text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">
                {t('topology:networkTopology')}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                在「拓扑设计」面板中生成拓扑后查看
              </p>
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
              当前筛选条件下无匹配设备
            </div>
          ) : ECharts && option ? (
            <ReactECharts
              option={option}
              style={{ width: '100%', height: '100%' }}
              onChartReady={onChartReady}
              onEvents={onEvents}
              notMerge
              lazyUpdate
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
              {generating ? '正在生成...' : '加载图表...'}
            </div>
          )}

          {/* Legend */}
          {topology && filteredNodes.length > 0 && (
            <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 bg-white/80 dark:bg-gray-800/80 rounded px-2 py-1">
              {categoryList.map((cat) => (
                <div key={cat.name} className="flex items-center gap-1 text-[10px] text-gray-500">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: cat.itemStyle.color }} />
                  {cat.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="w-52 shrink-0 border-l border-gray-200 dark:border-gray-700 p-2 overflow-auto">
            <NodeDetail
              node={selectedNode}
              edges={topology?.edges || []}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}
      </div>

      {/* Stats bar */}
      {topology && (
        <div className="flex items-center gap-3 px-3 py-1 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
          <span>{t('topology:deviceList')}: <b className="text-gray-600 dark:text-gray-400">{filteredNodes.length}</b></span>
          <span>{t('topology:connectionList')}: <b className="text-gray-600 dark:text-gray-400">{filteredEdges.length}</b></span>
        </div>
      )}
    </div>
  )
}
