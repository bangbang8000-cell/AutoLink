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
import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
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
  Search, MousePointer2, Box, Undo2, Redo2,
} from 'lucide-react'
import { useDesignStore, type TopologyNode } from '@/stores/design.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { exportTopologyPng } from '@/utils/exportTopology'
import { makeTimestampedFilename } from '@/utils/exportSvg'
import { NODE_TYPE_LABELS } from '@/constants/labels'
import {
  ServerNode, SwitchNode, NODE_COLORS, NODE_LABELS, EDGE_COLORS,
  type TopologyNodeData,
} from './topology/TopologyNodes'
import {
  PodGroupNode,
  getPodColor,
  type PodGroupNodeData,
} from './topology/PodGroupNode'
import {
  computeTopologyLayout,
} from './topology/topologyLayout'

/* ---------- node / edge types ---------- */

const nodeTypes: NodeTypes = {
  server: ServerNode,
  switch: SwitchNode,
  podGroup: PodGroupNode,
}

/* ---------- filter ---------- */

type FilterType = '全部' | '参数网络' | '存储网络' | 'OOB' | '业务网络'
const FILTER_OPTIONS: FilterType[] = ['全部', '参数网络', '存储网络', 'OOB', '业务网络']

/** V2.4.2: 过滤匹配，优先使用 networkType 字段，回退到 description/cableType */
function matchFilter(description: string, cableType: string, networkType: string, filter: FilterType): boolean {
  if (filter === '全部') return true
  // 优先使用 networkType
  if (networkType) {
    if (filter === '参数网络') return networkType === 'param'
    if (filter === '存储网络') return networkType === 'storage'
    if (filter === 'OOB') return networkType === 'oob'
    if (filter === '业务网络') return networkType === 'biz'
  }
  // 回退到旧逻辑
  if (filter === '参数网络') return description.includes('参数') || cableType.includes('参数')
  if (filter === '存储网络') return description.includes('存储') || cableType.includes('存储')
  if (filter === 'OOB') return description.includes('OOB') || cableType.includes('OOB')
  if (filter === '业务网络') return description.includes('业务') || cableType.includes('业务')
  return true
}

/** V2.4.2: 边颜色，优先使用 networkType 字段 */
function getEdgeColor(description: string, cableType: string, networkType: string): string {
  if (networkType) {
    if (networkType === 'param') return EDGE_COLORS.param
    if (networkType === 'storage') return EDGE_COLORS.storage
    if (networkType === 'oob') return EDGE_COLORS.oob
    if (networkType === 'biz') return EDGE_COLORS.biz
  }
  // 回退到旧逻辑
  if (description.includes('参数') || cableType.includes('参数')) return EDGE_COLORS.param
  if (description.includes('存储') || cableType.includes('存储')) return EDGE_COLORS.storage
  if (description.includes('OOB') || cableType.includes('OOB')) return EDGE_COLORS.oob
  if (description.includes('业务') || cableType.includes('业务')) return EDGE_COLORS.biz
  return '#d1d5db'
}

/* ---------- saved layout ---------- */

type SavedLayout = Record<string, { x: number; y: number }>

/** V2.4.5: 布局版本号，版本升级时自动清除旧 localStorage */
const LAYOUT_VERSION = 'v4'

function getStorageKey(projectName: string): string { return `autolink-topology-${LAYOUT_VERSION}-${projectName}` }

/** V2.4.5: 清除旧版本布局数据 */
function clearOldLayoutVersions(projectName: string) {
  try {
    const oldKeys = [
      `autolink-topology-v3-${projectName}`,  // V2.4.4 旧版
      `autolink-topology-v2-${projectName}`,  // V2.4.2/3 旧版
      `autolink-topology-rf-${projectName}`,  // V2.4 旧版
      `autolink-topology-${projectName}`,     // 更早版本
    ]
    for (const key of oldKeys) {
      if (localStorage.getItem(key)) localStorage.removeItem(key)
    }
  } catch { /* ignore */ }
}

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
  const { t } = useTranslation()
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
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)

  /* ---------- V2.4.7: 撤销/重做 ---------- */
  // 历史栈存储节点位置快照（只记录设备节点，不含 POD 背景框）
  const pastRef = useRef<Map<string, { x: number; y: number }>[]>([])
  const futureRef = useRef<Map<string, { x: number; y: number }>[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const HISTORY_LIMIT = 50

  /** 记录当前节点位置快照到历史栈 */
  const pushHistory = useCallback(() => {
    const snapshot = new Map<string, { x: number; y: number }>()
    for (const n of rfNodes) {
      if (n.id.startsWith('pod-group-')) continue
      snapshot.set(n.id, { x: n.position.x, y: n.position.y })
    }
    pastRef.current.push(snapshot)
    if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift()
    futureRef.current = []  // 新操作清空 future
    setCanUndo(pastRef.current.length > 0)
    setCanRedo(false)
  }, [rfNodes])

  /** 从当前 rfNodes 生成快照 */
  const currentSnapshot = useCallback(() => {
    const snapshot = new Map<string, { x: number; y: number }>()
    for (const n of rfNodes) {
      if (n.id.startsWith('pod-group-')) continue
      snapshot.set(n.id, { x: n.position.x, y: n.position.y })
    }
    return snapshot
  }, [rfNodes])

  /** 应用快照到 rfNodes */
  const applySnapshot = useCallback((snapshot: Map<string, { x: number; y: number }>) => {
    setRfNodes((prev) => prev.map((n) => {
      if (n.id.startsWith('pod-group-')) return n
      const pos = snapshot.get(n.id)
      return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
    }))
  }, [])

  const handleUndo = useCallback(() => {
    if (pastRef.current.length === 0) return
    const current = currentSnapshot()
    const prev = pastRef.current.pop()!
    futureRef.current.push(current)
    applySnapshot(prev)
    setCanUndo(pastRef.current.length > 0)
    setCanRedo(futureRef.current.length > 0)
  }, [currentSnapshot, applySnapshot])

  const handleRedo = useCallback(() => {
    if (futureRef.current.length === 0) return
    const current = currentSnapshot()
    const next = futureRef.current.pop()!
    pastRef.current.push(current)
    applySnapshot(next)
    setCanUndo(pastRef.current.length > 0)
    setCanRedo(futureRef.current.length > 0)
  }, [currentSnapshot, applySnapshot])

  /** Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 快捷键 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleUndo, handleRedo])

  /* ---------- V2.4.7: POD 折叠/展开 ---------- */
  const [collapsedPods, setCollapsedPods] = useState<Set<string>>(new Set())

  const togglePodCollapse = useCallback((podid: string) => {
    setCollapsedPods((prev) => {
      const next = new Set(prev)
      if (next.has(podid)) next.delete(podid)
      else next.add(podid)
      return next
    })
  }, [])

  /* ---------- check saved layout ---------- */
  useEffect(() => {
    if (selectedProjectName) {
      // V2.4.2: 清除旧版本布局数据
      clearOldLayoutVersions(selectedProjectName)
      setHasSavedLayout(loadLayout(selectedProjectName) !== null)
    }
  }, [selectedProjectName])

  /* ---------- filtered data ---------- */
  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!topology) return { filteredNodes: [], filteredEdges: [] }
    if (filter === '全部') return { filteredNodes: topology.nodes, filteredEdges: topology.edges }
    const matchingEdgeSet = new Set<string>()
    for (const edge of topology.edges) {
      if (matchFilter(edge.description, edge.cableType, edge.networkType || '', filter)) {
        matchingEdgeSet.add(edge.source)
        matchingEdgeSet.add(edge.target)
      }
    }
    const nodes = topology.nodes.filter((n) => matchingEdgeSet.has(n.id))
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = topology.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target) && matchFilter(e.description, e.cableType, e.networkType || '', filter),
    )
    return { filteredNodes: nodes, filteredEdges: edges }
  }, [topology, filter])

  /* ---------- compute layout + build react-flow nodes/edges (pure, no setState) ---------- */
  const { nodeCount, edgeCount, computedNodes, computedEdges } = useMemo(() => {
    if (filteredNodes.length === 0) return { nodeCount: 0, edgeCount: 0, computedNodes: [] as Node[], computedEdges: [] as Edge[] }

    const saved = selectedProjectName ? loadLayout(selectedProjectName) : null
    // V2.4.2: 新布局 API 返回 LayoutResult (含 pods 背景框信息)
    const { layoutNodes, pods } = computeTopologyLayout(filteredNodes, filteredEdges)

    // 计算连接数
    const connCount = new Map<string, number>()
    for (const e of filteredEdges) {
      connCount.set(e.source, (connCount.get(e.source) || 0) + 1)
      connCount.set(e.target, (connCount.get(e.target) || 0) + 1)
    }

    // V2.4.2: 生成 POD 背景框节点 (zIndex 较低，置于设备节点之后)
    const podGroupNodes: Node[] = pods.map((pod, idx) => {
      const podData: PodGroupNodeData = {
        podid: pod.podid,
        podIndex: idx,
        serverCount: pod.serverCount,
        accessCount: pod.accessCount,
        leafCount: pod.leafCount,
        width: pod.width,
        height: pod.height,
        fillColor: getPodColor(idx),
      }
      return {
        id: `pod-group-${pod.podid}`,
        type: 'podGroup',
        position: { x: pod.x, y: pod.y },
        data: podData as unknown as Record<string, unknown>,
        draggable: false,
        selectable: false,
        zIndex: 0,
      }
    })

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
        zIndex: 10,
      }
    })

    // POD 背景框 + 设备节点合并（背景框在前，确保渲染在底层）
    const allNodes = [...podGroupNodes, ...nodes]

    // V2.4.3: 根据布局位置动态指定 sourceHandle/targetHandle
    // 规则：source 在 target 上方 → source 用 "down" handle, target 用 "up" handle
    //       source 在 target 下方 → source 用 "up" handle, target 用 "down" handle
    const edges: Edge[] = filteredEdges.map((e, idx) => {
      const sourcePos = posMap.get(e.source)
      const targetPos = posMap.get(e.target)
      let sourceHandle: string | undefined
      let targetHandle: string | undefined
      if (sourcePos && targetPos) {
        if (sourcePos.y <= targetPos.y) {
          // source 在上方（或同行）：source 底部 → target 顶部
          sourceHandle = 'down'
          targetHandle = 'up'
        } else {
          // source 在下方：source 顶部 → target 底部
          sourceHandle = 'up'
          targetHandle = 'down'
        }
      }
      return {
        id: `e-${idx}-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        sourceHandle,
        targetHandle,
        style: {
          stroke: getEdgeColor(e.description, e.cableType, e.networkType || ''),
          strokeWidth: 1.2,
          opacity: 0.5,
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 8, height: 8 },
      }
    })

    return { nodeCount: nodes.length, edgeCount: edges.length, computedNodes: allNodes, computedEdges: edges }
  }, [filteredNodes, filteredEdges, selectedProjectName])

  /* ---------- sync computed nodes/edges to state (for drag-to-move) ---------- */
  useEffect(() => {
    setRfNodes(computedNodes)
    setRfEdges(computedEdges)
  }, [computedNodes, computedEdges])

  /* ---------- V2.4.7: 显示层 = 折叠隐藏 + 搜索高亮 ---------- */
  const displayNodes = useMemo(() => {
    // 构建折叠 POD 内设备节点 ID 集合
    const collapsedNodeIds = new Set<string>()
    if (collapsedPods.size > 0) {
      for (const n of rfNodes) {
        if (n.id.startsWith('pod-group-')) continue
        const data = n.data as unknown as TopologyNodeData
        if (data?.podid && collapsedPods.has(data.podid)) {
          collapsedNodeIds.add(n.id)
        }
      }
    }

    const q = searchQuery.toLowerCase().trim()
    const hasSearch = !!q

    return rfNodes.map((n) => {
      // POD 背景框节点：传递 collapsed 状态和切换回调
      if (n.id.startsWith('pod-group-')) {
        const podid = n.id.replace('pod-group-', '')
        const isCollapsed = collapsedPods.has(podid)
        return {
          ...n,
          data: {
            ...n.data,
            collapsed: isCollapsed,
            onToggleCollapse: togglePodCollapse,
          } as unknown as Record<string, unknown>,
        }
      }

      // 折叠 POD 内的设备节点：隐藏
      if (collapsedNodeIds.has(n.id)) {
        return { ...n, hidden: true }
      }

      // 搜索高亮
      if (hasSearch) {
        const matches = n.id.toLowerCase().includes(q) ||
          (n.data?.label as string)?.toLowerCase().includes(q) ||
          (n.data?.nodeType as string)?.toLowerCase().includes(q)
        if (matches) {
          return {
            ...n,
            hidden: false,
            style: { ...n.style, opacity: 1, boxShadow: '0 0 0 2px #3b82f6' },
          }
        }
        return {
          ...n,
          hidden: false,
          style: { ...n.style, opacity: 0.12 },
        }
      }

      return { ...n, hidden: false }
    })
  }, [rfNodes, searchQuery, collapsedPods, togglePodCollapse])

  const displayEdges = useMemo(() => {
    // 构建折叠 POD 内设备节点 ID 集合
    const collapsedNodeIds = new Set<string>()
    if (collapsedPods.size > 0) {
      for (const n of rfNodes) {
        if (n.id.startsWith('pod-group-')) continue
        const data = n.data as unknown as TopologyNodeData
        if (data?.podid && collapsedPods.has(data.podid)) {
          collapsedNodeIds.add(n.id)
        }
      }
    }

    const hasSearch = !!searchQuery.trim()

    return rfEdges.map((e) => {
      // 折叠 POD 内的边：隐藏
      if (collapsedNodeIds.has(e.source) || collapsedNodeIds.has(e.target)) {
        return { ...e, hidden: true }
      }
      // 搜索时降低所有边的透明度
      if (hasSearch) {
        return { ...e, hidden: false, style: { ...e.style, opacity: 0.05 } }
      }
      return { ...e, hidden: false }
    })
  }, [rfNodes, rfEdges, searchQuery, collapsedPods])

  /* ---------- search & focus: center on first matching node ---------- */
  const handleSearchFocus = useCallback(() => {
    if (!searchQuery.trim() || !reactFlow) return
    const q = searchQuery.toLowerCase().trim()
    const match = rfNodes.find((n) => {
      if (n.id.startsWith('pod-group-')) return false
      return n.id.toLowerCase().includes(q) ||
        (n.data?.label as string)?.toLowerCase().includes(q) ||
        (n.data?.nodeType as string)?.toLowerCase().includes(q)
    })
    if (match) {
      reactFlow.setCenter(match.position.x, match.position.y, { zoom: 1.2, duration: 500 })
    } else {
      addToast('info', t('common:toast.nodeNotFound'))
    }
  }, [searchQuery, rfNodes, reactFlow, addToast])

  /* ---------- actions ---------- */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  /** V2.4.7: 拖拽结束时记录历史快照 */
  const onNodeDragStop = useCallback(() => {
    pushHistory()
  }, [pushHistory])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const raw = topology?.nodes.find((n) => n.id === node.id)
    if (raw) setSelectedNode(raw)
  }, [topology])

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  const handleSaveLayout = useCallback(() => {
    if (!selectedProjectName) return
    const layout: SavedLayout = {}
    // V2.4.2: 排除 POD 背景框节点（id 以 pod-group- 开头），只保存设备节点
    for (const n of rfNodes) {
      if (n.id.startsWith('pod-group-')) continue
      layout[n.id] = { x: n.position.x, y: n.position.y }
    }
    saveLayout(selectedProjectName, layout)
    setHasSavedLayout(true)
    addToast('success', t('common:toast.topologyLayoutSaved'))
  }, [selectedProjectName, rfNodes, addToast])

  const handleResetLayout = useCallback(() => {
    if (!selectedProjectName) return
    clearLayout(selectedProjectName)
    setHasSavedLayout(false)
    // 触发重新计算布局 (V2.4.2: 新布局 API 返回 LayoutResult)
    const { layoutNodes } = computeTopologyLayout(filteredNodes, filteredEdges)
    const posMap = new Map(layoutNodes.map((p) => [p.id, p]))
    setRfNodes((prev) => prev.map((n) => {
      const pos = posMap.get(n.id)
      return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
    }))
    addToast('success', t('common:toast.layoutReset'))
  }, [selectedProjectName, filteredNodes, filteredEdges, addToast])

  /* ---------- V2.4.4: 根据节点规模动态调整画布缩放范围 ---------- */
  const { minZoom, fitViewPadding } = useMemo(() => {
    const n = nodeCount
    if (n > 500) return { minZoom: 0.05, fitViewPadding: 0.15 }  // 超大规模：允许缩得更小
    if (n > 200) return { minZoom: 0.08, fitViewPadding: 0.18 }
    if (n > 100) return { minZoom: 0.12, fitViewPadding: 0.2 }
    return { minZoom: 0.15, fitViewPadding: 0.25 }               // 默认
  }, [nodeCount])

  const handleFitView = useCallback(() => {
    reactFlow.fitView({ padding: fitViewPadding, duration: 300 })
  }, [reactFlow, fitViewPadding])

  const handleExportPng = useCallback(async () => {
    if (!topology || !selectedProjectName) {
      addToast('error', t('common:toast.noTopologyToExport'))
      return
    }
    addToast('info', t('common:toast.generatingTopologyPng'))
    try {
      const base64 = await exportTopologyPng(topology.nodes, topology.edges)
      const filename = makeTimestampedFilename('组网拓扑图', 'png')
      if (window.electron?.export?.saveFile) {
        await window.electron.export.saveFile(selectedProjectName, filename, base64)
        addToast('success', t('common:toast.topologyExported', { filename }))
      } else {
        addToast('error', t('common:toast.ipcNotReady'))
      }
    } catch (err) {
      console.error('Export topology PNG failed:', err)
      addToast('error', t('common:toast.exportFailed', { error: err instanceof Error ? err.message : t('common:toast.unknownError') }))
    }
  }, [topology, selectedProjectName, addToast])

  const nodeConnectionCount = useMemo(() => {
    if (!selectedNode || !topology) return 0
    return topology.edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id).length
  }, [selectedNode, topology])

  /* ---------- empty states ---------- */
  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-app-elevated">
        <Network size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500">拓扑可视化</p>
        <p className="text-xs text-gray-400">请先选择一个项目</p>
      </div>
    )
  }

  if (!topology) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-app-elevated">
        <Network size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500">尚未生成拓扑</p>
        <p className="text-xs text-gray-400">在「设计」面板中生成拓扑数据后查看</p>
      </div>
    )
  }

  /* ---------- render ---------- */
  return (
    <div className="h-full flex flex-col bg-white dark:bg-app-elevated">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-edge-subtle shrink-0 bg-gray-50 dark:bg-app/50 z-10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">拓扑视图</span>
          <span className="text-2xs text-gray-400"><span className="font-mono tabular-nums">{nodeCount}</span> 节点 · <span className="font-mono tabular-nums">{edgeCount}</span> 连接</span>
        </div>
        <div className="flex items-center gap-1">
          {/* 搜索框 */}
          <div className="flex items-center gap-1">
            {showSearch ? (
              <div className="flex items-center gap-1 bg-white dark:bg-app border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5">
                <Search size={11} className="text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearchFocus(); if (e.key === 'Escape') { setSearchQuery(''); setShowSearch(false) } }}
                  placeholder="搜索节点..."
                  className="w-28 bg-transparent text-2xs outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
                  autoFocus
                />
                <button
                  onClick={handleSearchFocus}
                  className="text-2xs text-primary-500 hover:text-primary-600"
                  title="定位到匹配节点"
                >
                  定位
                </button>
                <button
                  onClick={() => { setSearchQuery(''); setShowSearch(false) }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={10} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSearch(true)}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500"
                title="搜索节点"
              >
                <Search size={14} />
              </button>
            )}
          </div>

          {/* 框选模式切换 */}
          <button
            onClick={() => setSelectionMode(!selectionMode)}
            className={`p-1 rounded transition-colors ${
              selectionMode
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                : 'hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500'
            }`}
            title={selectionMode ? '框选模式（点击切换为平移）' : '平移模式（点击切换为框选）'}
          >
            {selectionMode ? <Box size={14} /> : <MousePointer2 size={14} />}
          </button>

          {/* V2.4.7: 撤销/重做 */}
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className={`p-1 rounded transition-colors ${
              canUndo
                ? 'hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            }`}
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className={`p-1 rounded transition-colors ${
              canRedo
                ? 'hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            }`}
            title="重做 (Ctrl+Y)"
          >
            <Redo2 size={14} />
          </button>

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-0.5" />

          {/* Filter */}
          <div className="relative">
            <button onClick={() => setShowFilter(!showFilter)}
              className={`flex items-center gap-1 px-2 py-1 text-2xs rounded border transition-colors ${
                filter !== '全部'
                  ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                  : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover'
              }`}>
              <Filter size={11} />{filter}
            </button>
            {showFilter && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowFilter(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded shadow-lg py-1 min-w-[120px]">
                  {FILTER_OPTIONS.map((opt) => (
                    <button key={opt} onClick={() => { setFilter(opt); setShowFilter(false) }}
                      className={`block w-full text-left px-3 py-1.5 text-2xs hover:bg-gray-50 dark:hover:bg-app-hover ${
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
          <button onClick={handleFitView} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500" title="适应视图">
            <Maximize2 size={14} />
          </button>
          <button onClick={handleSaveLayout}
            className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
            title="保存当前布局">
            <Save size={12} />保存布局
          </button>
          {hasSavedLayout && (
            <button onClick={handleResetLayout}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
              title="重置为自动布局">
              <RotateCcw size={12} />重置
            </button>
          )}
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-0.5" />
          <button onClick={handleExportPng} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500" title="导出PNG">
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* react-flow canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: fitViewPadding }}
          minZoom={minZoom}
          maxZoom={4}
          nodesDraggable
          nodesConnectable={false}
          selectionOnDrag={selectionMode}
          panOnDrag={!selectionMode}
          selectionKeyCode={selectionMode ? undefined : 'Shift'}
          proOptions={{ hideAttribution: true }}
          className="bg-white dark:bg-app-surface"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={isDark ? '#374151' : '#e5e7eb'} />
          <Controls className="!bg-white dark:!bg-surface !border-gray-200 dark:!border-gray-600" showInteractive={false} />
          <MiniMap
            className="!bg-white dark:!bg-surface !border-gray-200 dark:!border-gray-600"
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
          <div className="absolute top-3 right-3 z-20 bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded-lg shadow-lg p-4 min-w-[240px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">节点详情</span>
              <button onClick={() => setSelectedNode(null)}
                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-400">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: NODE_COLORS[selectedNode.type] || '#9ca3af' }} />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{selectedNode.id}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-2xs">
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
          <div className="absolute bottom-3 left-3 z-20 bg-white/90 dark:bg-app/90 backdrop-blur-sm border border-gray-200 dark:border-edge-subtle rounded-lg px-3 py-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(NODE_COLORS).filter(([type]) =>
                rfNodes.some((n) => (n.data as unknown as TopologyNodeData)?.nodeType === type)
              ).slice(0, 12).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5 text-2xs text-gray-600 dark:text-gray-400">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  {NODE_LABELS[type] || type}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 pt-1.5 border-t border-gray-100 dark:border-edge-subtle">
              {Object.entries(EDGE_COLORS).map(([label, color]) => (
                <div key={label} className="flex items-center gap-1.5 text-2xs text-gray-600 dark:text-gray-400">
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
