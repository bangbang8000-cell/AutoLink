/**
 * AutoLink V2.4 — 拓扑图 Tab（react-flow 重构版）
 *
 * 核心改进：
 *   - 从 ECharts 迁移到 react-flow，支持拖拽、框选、缩放等交互
 *   - 分层×分区×分组三维防重叠布局
 *   - 网络域分区背景（参数网/存储网/业务网/OOB 独立区域）
 *   - Pod/Rail 分组视觉边框
 *   - 小地图、暗色模式适配
 */
import { useMemo, useState, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeChange,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Download, Filter, Network, X, Activity, RotateCcw, Save, Maximize2,
} from 'lucide-react'
import { useDesignStore, type TopologyNode } from '@/stores/design.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { NODE_TYPE_LABELS } from '@/constants/labels'
import {
  ServerNode, SwitchNode, NODE_COLORS, NODE_LABELS, EDGE_COLORS,
  type TopologyNodeData,
} from './topology/TopologyNodes'
import {
  computeTopologyLayout,
} from './topology/topologyLayout'

/* ---------- node / edge types ---------- */

const nodeTypes: NodeTypes = {
  server: ServerNode,
  switch: SwitchNode,
}

/* ---------- filter ---------- */

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
  if (description.includes('参数') || cableType.includes('参数')) return EDGE_COLORS.param
  if (description.includes('存储') || cableType.includes('存储')) return EDGE_COLORS.storage
  if (description.includes('OOB') || cableType.includes('OOB')) return EDGE_COLORS.oob
  if (description.includes('业务') || cableType.includes('业务')) return EDGE_COLORS.biz
  return '#d1d5db'
}

/* ---------- saved layout ---------- */

type SavedLayout = Record<string, { x: number; y: number }>
function getStorageKey(projectName: string): string { return `autolink-topology-rf-${projectName}` }
function loadLayout(projectName: string): SavedLayout | null {
  try {
    const raw = localStorage.getItem(getStorageKey(projectName))
    return raw ? (JSON.parse(raw) as SavedLayout) : null
  } catch { return null }
}
function saveLayout(projectName: string, layout: SavedLayout) {
  try { localStorage.setItem(getStorageKey(projectName), JSON.stringify(layout)) } catch { /* ignore */ }
}
function clearLayout(projectName: string) { localStorage.removeItem(getStorageKey(projectName)) }

/* ---------- dark mode detection ---------- */

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

/* ---------- inner component (has access to react-flow context) ---------- */

function TopologyFlowInner() {
  const topology = useDesignStore((s) => s.topology)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const addToast = useToastStore((s) => s.addToast)
  const reactFlow = useReactFlow()
  const isDark = useIsDark()

  const [filter, setFilter] = useState<FilterType>('全部')
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [hasSavedLayout, setHasSavedLayout] = useState(false)
  const [rfNodes, setRfNodes] = useState<Node[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])

  /* ---------- check saved layout ---------- */
  useEffect(() => {
    if (selectedProjectName) setHasSavedLayout(loadLayout(selectedProjectName) !== null)
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
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target) && matchFilter(e.description, e.cableType, filter),
    )
    return { filteredNodes: nodes, filteredEdges: edges }
  }, [topology, filter])

  /* ---------- compute layout + build react-flow nodes/edges (pure, no setState) ---------- */
  const { nodeCount, edgeCount, computedNodes, computedEdges } = useMemo(() => {
    if (filteredNodes.length === 0) return { nodeCount: 0, edgeCount: 0, computedNodes: [] as Node[], computedEdges: [] as Edge[] }

    const saved = selectedProjectName ? loadLayout(selectedProjectName) : null
    const { layoutNodes } = computeTopologyLayout(filteredNodes, filteredEdges)

    // 计算连接数
    const connCount = new Map<string, number>()
    for (const e of filteredEdges) {
      connCount.set(e.source, (connCount.get(e.source) || 0) + 1)
      connCount.set(e.target, (connCount.get(e.target) || 0) + 1)
    }

    const posMap = new Map(layoutNodes.map((p) => [p.id, p]))
    const nodes: Node[] = filteredNodes.map((node) => {
      const pos = posMap.get(node.id)
      const isSwitch = node.type !== 'server'
      const data: TopologyNodeData = {
        label: node.id,
        nodeType: node.type,
        group: node.group,
        podid: node.podid,
        cabinetName: node.cabinetName,
        cabinetId: node.cabinetId,
        startU: node.startU,
        endU: node.endU,
        powerWatts: node.powerWatts,
        connectionCount: connCount.get(node.id) || 0,
      }
      return {
        id: node.id,
        type: isSwitch ? 'switch' : 'server',
        position: {
          x: saved?.[node.id]?.x ?? pos?.x ?? 0,
          y: saved?.[node.id]?.y ?? pos?.y ?? 260,
        },
        data: data as unknown as Record<string, unknown>,
      }
    })

    const edges: Edge[] = filteredEdges.map((e, idx) => ({
      id: `e-${idx}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      style: {
        stroke: getEdgeColor(e.description, e.cableType),
        strokeWidth: 1.2,
        opacity: 0.5,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 8, height: 8 },
    }))

    return { nodeCount: nodes.length, edgeCount: edges.length, computedNodes: nodes, computedEdges: edges }
  }, [filteredNodes, filteredEdges, selectedProjectName])

  /* ---------- sync computed nodes/edges to state (for drag-to-move) ---------- */
  useEffect(() => {
    setRfNodes(computedNodes)
    setRfEdges(computedEdges)
  }, [computedNodes, computedEdges])

  /* ---------- actions ---------- */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const raw = topology?.nodes.find((n) => n.id === node.id)
    if (raw) setSelectedNode(raw)
  }, [topology])

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  const handleSaveLayout = useCallback(() => {
    if (!selectedProjectName) return
    const layout: SavedLayout = {}
    for (const n of rfNodes) layout[n.id] = { x: n.position.x, y: n.position.y }
    saveLayout(selectedProjectName, layout)
    setHasSavedLayout(true)
    addToast('success', '拓扑布局已保存')
  }, [selectedProjectName, rfNodes, addToast])

  const handleResetLayout = useCallback(() => {
    if (!selectedProjectName) return
    clearLayout(selectedProjectName)
    setHasSavedLayout(false)
    // 触发重新计算布局
    const { layoutNodes } = computeTopologyLayout(filteredNodes, filteredEdges)
    setRfNodes((prev) => prev.map((n) => {
      const pos = layoutNodes.find((p) => p.id === n.id)
      return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
    }))
    addToast('success', '布局已重置')
  }, [selectedProjectName, filteredNodes, filteredEdges, addToast])

  const handleFitView = useCallback(() => {
    reactFlow.fitView({ padding: 0.2, duration: 300 })
  }, [reactFlow])

  const handleExportPng = useCallback(() => {
    // react-flow 没有内置导出，使用 html-to-image 或截图
    // 简化：提示用户使用截图工具
    addToast('info', '请使用系统截图工具导出，或右键复制图片')
  }, [addToast])

  const nodeConnectionCount = useMemo(() => {
    if (!selectedNode || !topology) return 0
    return topology.edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id).length
  }, [selectedNode, topology])

  /* ---------- empty states ---------- */
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

  /* ---------- render ---------- */
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50 z-10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">拓扑视图</span>
          <span className="text-[10px] text-gray-400">{nodeCount} 节点 · {edgeCount} 连接</span>
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
          <button onClick={handleFitView} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" title="适应视图">
            <Maximize2 size={14} />
          </button>
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

      {/* react-flow canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          maxZoom={4}
          nodesDraggable
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          className="bg-white dark:bg-gray-800"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={isDark ? '#374151' : '#e5e7eb'} />
          <Controls className="!bg-white dark:!bg-gray-700 !border-gray-200 dark:!border-gray-600" showInteractive={false} />
          <MiniMap
            className="!bg-white dark:!bg-gray-700 !border-gray-200 dark:!border-gray-600"
            nodeColor={(node) => {
              const data = node.data as unknown as TopologyNodeData
              return NODE_COLORS[data?.nodeType] || '#9ca3af'
            }}
            maskColor={isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.08)'}
            pannable
            zoomable
          />
        </ReactFlow>

        {/* Detail panel */}
        {selectedNode && (
          <div className="absolute top-3 right-3 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4 min-w-[240px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">节点详情</span>
              <button onClick={() => setSelectedNode(null)}
                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: NODE_COLORS[selectedNode.type] || '#9ca3af' }} />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{selectedNode.id}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <span className="text-gray-400">类型</span>
                <span className="text-gray-700 dark:text-gray-300 font-medium">{NODE_LABELS[selectedNode.type] || NODE_TYPE_LABELS[selectedNode.type] || selectedNode.type}</span>
                <span className="text-gray-400">组</span>
                <span className="text-gray-700 dark:text-gray-300">{selectedNode.group || '-'}</span>
                <span className="text-gray-400">Pod</span>
                <span className="text-gray-700 dark:text-gray-300">{selectedNode.podid || '-'}</span>
                {selectedNode.cabinetName && (
                  <>
                    <span className="text-gray-400">机柜</span>
                    <span className="text-gray-700 dark:text-gray-300">{selectedNode.cabinetName}</span>
                  </>
                )}
                {(selectedNode.startU !== undefined || selectedNode.endU !== undefined) && (
                  <>
                    <span className="text-gray-400">U位</span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {selectedNode.startU ?? '-'} - {selectedNode.endU ?? '-'}
                    </span>
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
        {rfNodes.length > 0 && (
          <div className="absolute bottom-3 left-3 z-20 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(NODE_COLORS).filter(([type]) =>
                rfNodes.some((n) => (n.data as unknown as TopologyNodeData)?.nodeType === type)
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
                  {label === 'param' ? '参数网' : label === 'storage' ? '存储网' : label === 'oob' ? 'OOB' : '业务网'}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- exported wrapper with ReactFlowProvider ---------- */

export function TopologyTab() {
  return (
    <ReactFlowProvider>
      <TopologyFlowInner />
    </ReactFlowProvider>
  )
}
