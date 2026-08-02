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
  type Viewport,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Download, Filter, Network, X, Activity, RotateCcw, Save, Maximize2,
  Search, MousePointer2, Box, Undo2, Redo2, AlignStartHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignEndVertical, Trash2, Tags,
} from 'lucide-react'
import { useDesignStore, type TopologyNode, type TopologyEdge } from '@/stores/design.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { exportTopologyPng } from '@/utils/exportTopology'
import { makeTimestampedFilename } from '@/utils/exportSvg'
import { NODE_TYPE_LABELS } from '@/constants/labels'
import {
  ServerNode, SwitchNode, GpuNode, NODE_COLORS, NODE_LABELS, EDGE_COLORS,
  type TopologyNodeData,
} from './topology/TopologyNodes'
import {
  PodGroupNode,
  getPodColor,
  type PodGroupNodeData,
} from './topology/PodGroupNode'
import { useTopologyLayout } from '@/hooks/useTopologyLayout'

/* ---------- node / edge types ---------- */

const nodeTypes: NodeTypes = {
  server: ServerNode,
  switch: SwitchNode,
  gpu: GpuNode,
  podGroup: PodGroupNode,
}

/* ---------- filter ---------- */

// V2.7.6-T5: 新增 'Scale-Up' 过滤器支持双栈联合视图
type FilterType = '全部' | '参数网络' | '存储网络' | 'OOB' | '业务网络' | 'Scale-Up'
const FILTER_OPTIONS: FilterType[] = ['全部', '参数网络', '存储网络', 'OOB', '业务网络', 'Scale-Up']

/** V2.4.2: 过滤匹配，优先使用 networkType 字段，回退到 description/cableType */
function matchFilter(description: string, cableType: string, networkType: string, filter: FilterType): boolean {
  if (filter === '全部') return true
  // 优先使用 networkType
  if (networkType) {
    if (filter === '参数网络') return networkType === 'param'
    if (filter === '存储网络') return networkType === 'storage'
    if (filter === 'OOB') return networkType === 'oob'
    if (filter === '业务网络') return networkType === 'biz'
    // V2.7.6-T5: Scale-Up 双栈联合视图
    if (filter === 'Scale-Up') return networkType === 'scale_up'
  }
  // 回退到旧逻辑
  if (filter === '参数网络') return description.includes('参数') || cableType.includes('参数')
  if (filter === '存储网络') return description.includes('存储') || cableType.includes('存储')
  if (filter === 'OOB') return description.includes('OOB') || cableType.includes('OOB')
  if (filter === '业务网络') return description.includes('业务') || cableType.includes('业务')
  // V2.7.6-T5: Scale-Up 回退匹配
  if (filter === 'Scale-Up') {
    return description.includes('Scale-Up') || description.includes('UALink') ||
           description.includes('NVLink') || description.includes('UB') ||
           cableType.includes('Scale-Up') || cableType.includes('UALink') ||
           cableType.includes('NVLink') || cableType.includes('UB')
  }
  return true
}

/** V2.4.2: 边颜色，优先使用 networkType 字段 */
function getEdgeColor(description: string, cableType: string, networkType: string): string {
  if (networkType) {
    if (networkType === 'param') return EDGE_COLORS.param
    if (networkType === 'storage') return EDGE_COLORS.storage
    if (networkType === 'oob') return EDGE_COLORS.oob
    if (networkType === 'biz') return EDGE_COLORS.biz
    // V2.7.6-T5: Scale-Up 双栈联合视图
    if (networkType === 'scale_up') return EDGE_COLORS.scale_up
  }
  // 回退到旧逻辑
  if (description.includes('参数') || cableType.includes('参数')) return EDGE_COLORS.param
  if (description.includes('存储') || cableType.includes('存储')) return EDGE_COLORS.storage
  if (description.includes('OOB') || cableType.includes('OOB')) return EDGE_COLORS.oob
  if (description.includes('业务') || cableType.includes('业务')) return EDGE_COLORS.biz
  // V2.7.6-T5: Scale-Up 回退匹配
  if (description.includes('Scale-Up') || description.includes('UALink') ||
      description.includes('NVLink') || description.includes('UB') ||
      cableType.includes('Scale-Up') || cableType.includes('UALink') ||
      cableType.includes('NVLink') || cableType.includes('UB')) {
    return EDGE_COLORS.scale_up
  }
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
  // v2.8.1-T3: 项目文件中的布局(来自 topology.json 的 layout 字段)
  const savedLayout = useDesignStore((s) => s.layout)
  // v2.8.1-T2: 布局落盘动作
  const saveLayoutToProject = useDesignStore((s) => s.saveLayout)
  const clearLayoutFromProject = useDesignStore((s) => s.clearLayout)
  // v2.8.2-T5/T6: 节点增删与恢复
  const removeTopologyNodes = useDesignStore((s) => s.removeTopologyNodes)
  const restoreTopology = useDesignStore((s) => s.restoreTopology)

  const [filter, setFilter] = useState<FilterType>('全部')
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [hasSavedLayout, setHasSavedLayout] = useState(false)
  const [rfNodes, setRfNodes] = useState<Node[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  // v2.8.1-T8: 布局是否有未保存的调整
  const [layoutDirty, setLayoutDirty] = useState(false)
  // v2.8.2-T1: 节点 hover
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  // v2.8.2-T2/T7: 链路 hover / 选中
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  // v2.8.2-T3: 链路标签开关 + 缩放自适应
  const [showEdgeLabels, setShowEdgeLabels] = useState(true)
  const [labelHidden, setLabelHidden] = useState(false)
  const labelHiddenRef = useRef(false)
  // v2.8.2-T4: 空格临时平移
  const [spacePressed, setSpacePressed] = useState(false)

  /* ---------- V2.4.7: 撤销/重做 ---------- */
  // 历史栈存储完整拓扑快照（位置 + 节点/链路数据，v2.8.2-T6 扩展）
  const pastRef = useRef<TopologySnapshot[]>([])
  const futureRef = useRef<TopologySnapshot[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const HISTORY_LIMIT = 50

  /** v2.8.2-T6: 完整拓扑快照(位置 + 节点/链路数据),覆盖删除等拓扑变更 */
  interface TopologySnapshot {
    positions: Map<string, { x: number; y: number }>
    nodes: TopologyNode[] | null
    edges: TopologyEdge[] | null
  }

  /** 记录当前节点位置 + 拓扑数据快照到历史栈 */
  const pushHistory = useCallback(() => {
    const positions = new Map<string, { x: number; y: number }>()
    for (const n of rfNodes) {
      if (n.id.startsWith('pod-group-')) continue
      positions.set(n.id, { x: n.position.x, y: n.position.y })
    }
    pastRef.current.push({
      positions,
      nodes: topology?.nodes ? [...topology.nodes] : null,
      edges: topology?.edges ? [...topology.edges] : null,
    })
    if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift()
    futureRef.current = []  // 新操作清空 future
    setCanUndo(pastRef.current.length > 0)
    setCanRedo(false)
  }, [rfNodes, topology])

  /** 从当前 rfNodes + store 生成快照 */
  const currentSnapshot = useCallback((): TopologySnapshot => {
    const positions = new Map<string, { x: number; y: number }>()
    for (const n of rfNodes) {
      if (n.id.startsWith('pod-group-')) continue
      positions.set(n.id, { x: n.position.x, y: n.position.y })
    }
    return {
      positions,
      nodes: topology?.nodes ? [...topology.nodes] : null,
      edges: topology?.edges ? [...topology.edges] : null,
    }
  }, [rfNodes, topology])

  /** 应用快照(恢复拓扑数据 + 位置) */
  const applySnapshot = useCallback((snapshot: TopologySnapshot) => {
    // 拓扑恢复:撤销删除时经 computedNodes 重建,节点位置取文件布局/快照
    if (snapshot.nodes && snapshot.edges) {
      restoreTopology(snapshot.nodes, snapshot.edges)
    }
    // 纯位置操作时 computedNodes 未变,此处直接生效
    setRfNodes((prev) => prev.map((n) => {
      if (n.id.startsWith('pod-group-')) return n
      const pos = snapshot.positions.get(n.id)
      return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
    }))
  }, [restoreTopology])

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

  /* ---------- v2.8.2-T4/T5: Delete / Esc / 空格 快捷键 ---------- */
  const handleDeleteSelected = useCallback(() => {
    const selectedIds = rfNodes
      .filter((n) => n.selected && !n.id.startsWith('pod-group-'))
      .map((n) => n.id)
    if (selectedIds.length === 0) return
    pushHistory()
    removeTopologyNodes(selectedIds)
    setLayoutDirty(true)
    setSelectedNode(null)
    setSelectedEdgeId(null)
    addToast('info', t('common:toast.topologyNodesDeleted', { count: selectedIds.length }))
  }, [rfNodes, pushHistory, removeTopologyNodes, addToast, t])

  useEffect(() => {
    const isTyping = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
    }
    const keydown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // 防止浏览器后退
        e.preventDefault()
        handleDeleteSelected()
      } else if (e.key === 'Escape') {
        // v2.8.2-T4: Esc 取消选区 + 退出框选模式
        setSelectionMode(false)
        reactFlow.setNodes((nodes) => nodes.map((n) => ({ ...n, selected: false })))
        setHoverNodeId(null)
        setHoverEdgeId(null)
        setSelectedEdgeId(null)
      } else if (e.code === 'Space') {
        // v2.8.2-T4: 空格临时切换为平移
        e.preventDefault()
        setSpacePressed(true)
      }
    }
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false)
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
    }
  }, [handleDeleteSelected, reactFlow])

  /* ---------- v2.8.2-T3: 缩放自适应隐藏链路标签(仅在阈值跨越时更新状态) ---------- */
  const handleMove = useCallback((_: unknown, viewport: Viewport) => {
    const hidden = viewport.zoom < 0.5
    if (hidden !== labelHiddenRef.current) {
      labelHiddenRef.current = hidden
      setLabelHidden(hidden)
    }
  }, [])

  /* ---------- v2.8.2-T8: 框选后对齐 ---------- */
  const alignNodes = useCallback((dir: 'left' | 'right' | 'top' | 'bottom') => {
    const sel = rfNodes.filter((n) => n.selected && !n.id.startsWith('pod-group-'))
    if (sel.length < 2) return
    pushHistory()
    const bounds = sel.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      w: (n.measured?.width ?? 90) as number,
      h: (n.measured?.height ?? 30) as number,
    }))
    const minX = Math.min(...bounds.map((b) => b.x))
    const maxX = Math.max(...bounds.map((b) => b.x + b.w))
    const minY = Math.min(...bounds.map((b) => b.y))
    const maxY = Math.max(...bounds.map((b) => b.y + b.h))
    setRfNodes((prev) => prev.map((n) => {
      if (!n.selected || n.id.startsWith('pod-group-')) return n
      const b = bounds.find((bb) => bb.id === n.id)
      if (!b) return n
      let nx = n.position.x
      let ny = n.position.y
      if (dir === 'left') nx = minX
      if (dir === 'right') nx = maxX - b.w
      if (dir === 'top') ny = minY
      if (dir === 'bottom') ny = maxY - b.h
      return { ...n, position: { x: nx, y: ny } }
    }))
    setLayoutDirty(true)
  }, [rfNodes, pushHistory])

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

  /* ---------- v2.7.3-T6: 通过 Web Worker 计算布局(大规模拓扑不阻塞主线程) ---------- */
  const { layout: layoutResult, computing: layoutComputing } = useTopologyLayout(filteredNodes, filteredEdges)

  /* ---------- compute layout + build react-flow nodes/edges (pure, no setState) ---------- */
  const { nodeCount, edgeCount, computedNodes, computedEdges } = useMemo(() => {
    if (filteredNodes.length === 0 || !layoutResult) return { nodeCount: 0, edgeCount: 0, computedNodes: [] as Node[], computedEdges: [] as Edge[] }

    const saved = savedLayout?.nodePositions ?? (selectedProjectName ? loadLayout(selectedProjectName) : null)
    // v2.7.3-T6: 布局结果由 useTopologyLayout 异步提供(大规模走 Worker)
    const { layoutNodes, pods } = layoutResult

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
      // v2.8.2-T2/T3: 边携带原始数据供 hover 卡片/详情面板/标签使用
      const label = `${e.speed}${e.networkType ? ` ${e.networkType}` : ''}`.trim()
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
        data: {
          label,
          speed: e.speed,
          cableType: e.cableType,
          description: e.description,
          networkType: e.networkType || '',
        },
      }
    })

    return { nodeCount: nodes.length, edgeCount: edges.length, computedNodes: allNodes, computedEdges: edges }
  }, [filteredNodes, filteredEdges, selectedProjectName, layoutResult, savedLayout])

  /* ---------- sync computed nodes/edges to state (for drag-to-move) ---------- */
  useEffect(() => {
    setRfNodes(computedNodes)
    setRfEdges(computedEdges)
    // v2.8.1-T8: 数据源变化后位置回到计算态,清除未保存标记
    setLayoutDirty(false)
  }, [computedNodes, computedEdges])

  /* ---------- V2.4.7: 显示层 = 折叠隐藏 + 搜索高亮 ---------- */
  /* v2.7.3-T7: 引用稳定化 — 仅在节点状态实际变化时创建新对象,拖拽时未变节点复用原引用,避免全量重渲染 */
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
        const prevData = n.data as unknown as { collapsed?: boolean; onToggleCollapse?: unknown }
        // 状态未变则复用原对象
        if (prevData?.collapsed === isCollapsed && prevData?.onToggleCollapse === togglePodCollapse) {
          return n
        }
        return {
          ...n,
          data: {
            ...n.data,
            collapsed: isCollapsed,
            onToggleCollapse: togglePodCollapse,
          } as unknown as Record<string, unknown>,
        }
      }

      // v2.8.2-T1: hover 标记(仅目标节点新建对象,其余复用引用,避免全量重渲染)
      const prevData = n.data as unknown as { hovered?: boolean }
      const isHovered = n.id === hoverNodeId
      const baseNode = prevData?.hovered === isHovered ? n : { ...n, data: { ...n.data, hovered: isHovered } }

      // 折叠 POD 内的设备节点：隐藏
      if (collapsedNodeIds.has(baseNode.id)) {
        if (baseNode.hidden === true) return baseNode
        return { ...baseNode, hidden: true }
      }

      // 搜索高亮
      if (hasSearch) {
        const matches = baseNode.id.toLowerCase().includes(q) ||
          (baseNode.data?.label as string)?.toLowerCase().includes(q) ||
          (baseNode.data?.nodeType as string)?.toLowerCase().includes(q)
        const targetOpacity = matches ? 1 : 0.12
        const targetBoxShadow = matches ? '0 0 0 2px #3b82f6' : undefined
        const prevStyle = baseNode.style as { opacity?: number; boxShadow?: string } | undefined
        if (baseNode.hidden === false && prevStyle?.opacity === targetOpacity && prevStyle?.boxShadow === targetBoxShadow) {
          return baseNode
        }
        const newStyle: Record<string, unknown> = { ...baseNode.style, opacity: targetOpacity }
        if (targetBoxShadow) newStyle.boxShadow = targetBoxShadow
        return { ...baseNode, hidden: false, style: newStyle }
      }

      // 普通节点:清除可能的搜索/折叠残留样式
      const prevStyle = baseNode.style as { opacity?: number; boxShadow?: string } | undefined
      if (baseNode.hidden === false && prevStyle?.opacity === undefined && prevStyle?.boxShadow === undefined) {
        return baseNode
      }
      return { ...baseNode, hidden: false }
    })
  }, [rfNodes, searchQuery, collapsedPods, togglePodCollapse, hoverNodeId])

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
    // v2.8.2-T3: 链路标签可见性(开关 + 缩放自适应)
    const showLabel = showEdgeLabels && !labelHidden

    return rfEdges.map((e) => {
      // 折叠 POD 内的边：隐藏
      if (collapsedNodeIds.has(e.source) || collapsedNodeIds.has(e.target)) {
        if (e.hidden === true) return e
        return { ...e, hidden: true }
      }
      // v2.8.2-T2/T7: hover/选中高亮
      const emphasized = e.id === hoverEdgeId || e.id === selectedEdgeId
      const targetStyle = emphasized
        ? { ...e.style, strokeWidth: 2.5, opacity: 1 }
        : hasSearch
          ? { ...e.style, opacity: 0.05 }
          : e.style
      const label = showLabel ? (e.data as { label?: string } | undefined)?.label : undefined
      const prevStyle = e.style as { opacity?: number } | undefined
      if (e.hidden === false && !emphasized && !hasSearch && e.label === label && prevStyle === targetStyle) return e
      return { ...e, hidden: false, style: targetStyle, label }
    })
  }, [rfNodes, rfEdges, searchQuery, collapsedPods, hoverEdgeId, selectedEdgeId, showEdgeLabels, labelHidden])

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
    // v2.8.1-T8: 拖拽后标记布局未保存
    setLayoutDirty(true)
  }, [pushHistory])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const raw = topology?.nodes.find((n) => n.id === node.id)
    if (raw) setSelectedNode(raw)
    setSelectedEdgeId(null)
  }, [topology])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
    setSelectedEdgeId(null)
  }, [])

  // v2.8.2-T1: 节点 hover
  const onNodeMouseEnter = useCallback((_: unknown, node: Node) => {
    if (node.id.startsWith('pod-group-')) return
    setHoverNodeId(node.id)
  }, [])
  const onNodeMouseLeave = useCallback(() => setHoverNodeId(null), [])

  // v2.8.2-T2/T7: 链路 hover / 点击
  const onEdgeMouseEnter = useCallback((_: unknown, edge: Edge) => setHoverEdgeId(edge.id), [])
  const onEdgeMouseLeave = useCallback(() => setHoverEdgeId(null), [])
  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setSelectedEdgeId(edge.id)
    setSelectedNode(null)
  }, [])

  const handleSaveLayout = useCallback(() => {
    if (!selectedProjectName) return
    const nodePositions: Record<string, { x: number; y: number }> = {}
    // V2.4.2: 排除 POD 背景框节点（id 以 pod-group- 开头），只保存设备节点
    for (const n of rfNodes) {
      if (n.id.startsWith('pod-group-')) continue
      nodePositions[n.id] = { x: n.position.x, y: n.position.y }
    }
    // localStorage 保留为快速恢复缓存
    saveLayout(selectedProjectName, nodePositions)
    setHasSavedLayout(true)
    setLayoutDirty(false)
    // v2.8.1-T2: 布局落盘到项目 topology.json
    saveLayoutToProject(selectedProjectName, nodePositions)
      .then(() => {
        addToast('success', t('common:toast.topologyLayoutSaved'))
      })
      .catch((err) => {
        console.error('save layout to project failed:', err)
        addToast('error', t('common:toast.layoutSaveFailed'))
      })
  }, [selectedProjectName, rfNodes, saveLayoutToProject, addToast])

  const handleResetLayout = useCallback(() => {
    if (!selectedProjectName) return
    clearLayout(selectedProjectName)
    setHasSavedLayout(false)
    setLayoutDirty(false)
    // v2.8.1-T6: 移除项目文件中的 layout
    clearLayoutFromProject(selectedProjectName).catch((err) => {
      console.error('clear layout from project failed:', err)
    })
    // v2.7.3-T6: 复用已计算的 layoutResult,避免重复计算(大规模拓扑走 Worker 时尤为重要)
    if (layoutResult) {
      const posMap = new Map(layoutResult.layoutNodes.map((p) => [p.id, p]))
      setRfNodes((prev) => prev.map((n) => {
        const pos = posMap.get(n.id)
        return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
      }))
    }
    addToast('success', t('common:toast.layoutReset'))
  }, [selectedProjectName, layoutResult, clearLayoutFromProject, addToast])

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

  // v2.8.2-T5/T8: 当前选中的设备节点数(排除 POD 背景框)
  const selectedDeviceCount = useMemo(
    () => rfNodes.filter((n) => n.selected && !n.id.startsWith('pod-group-')).length,
    [rfNodes],
  )

  // v2.8.2-T7: 选中链路的详情数据(来自边携带的原始数据)
  const selectedEdgeData = useMemo(() => {
    if (!selectedEdgeId) return null
    const edge = rfEdges.find((e) => e.id === selectedEdgeId)
    if (!edge) return null
    const d = edge.data as { label?: string; speed?: string; cableType?: string; description?: string; networkType?: string } | undefined
    return d ?? null
  }, [selectedEdgeId, rfEdges])

  /* ---------- empty states ---------- */
  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-app-elevated">
        <Network size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500">{t('topology:title')}</p>
        <p className="text-xs text-gray-400">{t('topology:noProject')}</p>
      </div>
    )
  }

  if (!topology) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-app-elevated">
        <Network size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500">{t('topology:noTopology')}</p>
        <p className="text-xs text-gray-400">{t('topology:noTopologyHint')}</p>
      </div>
    )
  }

  /* ---------- render ---------- */
  return (
    <div className="h-full flex flex-col bg-white dark:bg-app-elevated">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-edge-subtle shrink-0 bg-gray-50 dark:bg-app/50 z-10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('topology:viewTitle')}</span>
          <span className="text-2xs text-gray-400"><span className="font-mono tabular-nums">{nodeCount}</span> {t('topology:nodes')} · <span className="font-mono tabular-nums">{edgeCount}</span> {t('topology:connections')}</span>
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
                  placeholder={t('topology:searchPlaceholder')}
                  className="w-28 bg-transparent text-2xs outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
                  autoFocus
                />
                <button
                  onClick={handleSearchFocus}
                  className="text-2xs text-primary-500 hover:text-primary-600"
                  title={t('topology:locateHint')}
                >
                  {t('topology:locate')}
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
                title={t('topology:searchNode')}
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
            title={selectionMode ? t('topology:boxSelectMode') : t('topology:panMode')}
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
            title={t('topology:undoHint')}
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
            title={t('topology:redoHint')}
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
          <button onClick={handleFitView} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500" title={t('topology:fitViewHint')}>
            <Maximize2 size={14} />
          </button>
          <button onClick={handleSaveLayout}
            className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
            title={t('topology:saveLayoutHint')}>
            <Save size={12} />{t('topology:saveLayout')}
          </button>
          {/* v2.8.1-T8: 布局保存状态 */}
          {(layoutDirty || savedLayout) && (
            <span
              className={`flex items-center gap-1 px-1 text-2xs ${
                layoutDirty ? 'text-warning-500' : 'text-gray-400 dark:text-gray-500'
              }`}
              title={layoutDirty ? t('topology:unsavedHint') : t('topology:savedHint')}
            >
              {layoutDirty ? t('topology:unsaved') : t('topology:saved')}
            </span>
          )}
          {hasSavedLayout && (
            <button onClick={handleResetLayout}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
              title={t('topology:resetHint')}>
              <RotateCcw size={12} />{t('topology:reset')}
            </button>
          )}
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-0.5" />
          {/* v2.8.2-T3: 链路标签开关 */}
          <button
            onClick={() => setShowEdgeLabels((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 text-2xs rounded border transition-colors ${
              showEdgeLabels
                ? 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover'
                : 'border-gray-200 dark:border-gray-600 text-gray-300 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover'
            }`}
            title={t('topology:edgeLabelsHint')}
          >
            <Tags size={12} />{t('topology:edgeLabels')}
          </button>
          {/* v2.8.2-T8: 框选 ≥2 节点后显示对齐操作 */}
          {selectedDeviceCount >= 2 && (
            <>
              <button onClick={() => alignNodes('left')} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500" title={t('topology:alignLeft')}>
                <AlignStartHorizontal size={14} />
              </button>
              <button onClick={() => alignNodes('right')} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500" title={t('topology:alignRight')}>
                <AlignEndHorizontal size={14} />
              </button>
              <button onClick={() => alignNodes('top')} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500" title={t('topology:alignTop')}>
                <AlignStartVertical size={14} />
              </button>
              <button onClick={() => alignNodes('bottom')} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500" title={t('topology:alignBottom')}>
                <AlignEndVertical size={14} />
              </button>
            </>
          )}
          {/* v2.8.2-T5: 删除选中节点 */}
          <button
            onClick={handleDeleteSelected}
            disabled={selectedDeviceCount === 0}
            className={`p-1 rounded transition-colors ${
              selectedDeviceCount > 0
                ? 'hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            }`}
            title={t('topology:deleteSelected')}
          >
            <Trash2 size={14} />
          </button>
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-0.5" />
          <button onClick={handleExportPng} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500" title={t('topology:exportPng')}>
            <Download size={14} />
          </button>
          {layoutComputing && (
            <span className="flex items-center gap-1 px-2 py-1 text-2xs text-primary-500">
              <Activity size={12} className="animate-pulse" />{t('topology:computingLayout')}
            </span>
          )}
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
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onEdgeClick={onEdgeClick}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          onPaneClick={onPaneClick}
          onPaneMouseLeave={() => { setHoverNodeId(null); setHoverEdgeId(null) }}
          onMove={handleMove}
          fitView
          fitViewOptions={{ padding: fitViewPadding }}
          minZoom={minZoom}
          maxZoom={4}
          nodesDraggable
          nodesConnectable={false}
          // v2.8.2-T4: 空格临时平移;框选模式下 Shift 追加选区
          selectionOnDrag={selectionMode && !spacePressed}
          panOnDrag={!selectionMode || spacePressed}
          selectionKeyCode={selectionMode ? undefined : 'Shift'}
          multiSelectionKeyCode={selectionMode ? 'Shift' : undefined}
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
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('topology:nodeDetail')}</span>
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
                <span className="text-gray-400">{t('topology:type')}</span>
                <span className="text-gray-700 dark:text-gray-300 font-medium">{NODE_LABELS[selectedNode.type] || NODE_TYPE_LABELS[selectedNode.type] || selectedNode.type}</span>
                <span className="text-gray-400">{t('topology:group')}</span>
                <span className="text-gray-700 dark:text-gray-300">{selectedNode.group || '-'}</span>
                <span className="text-gray-400">{t('topology:pod')}</span>
                <span className="text-gray-700 dark:text-gray-300">{selectedNode.podid || '-'}</span>
                {selectedNode.cabinetName && (
                  <>
                    <span className="text-gray-400">{t('topology:cabinet')}</span>
                    <span className="text-gray-700 dark:text-gray-300">{selectedNode.cabinetName}</span>
                  </>
                )}
                {(selectedNode.startU !== undefined || selectedNode.endU !== undefined) && (
                  <>
                    <span className="text-gray-400">{t('topology:uPosition')}</span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {selectedNode.startU ?? '-'} - {selectedNode.endU ?? '-'}
                    </span>
                  </>
                )}
                <span className="text-gray-400">{t('topology:connectionsCount')}</span>
                <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
                  <Activity size={11} />{nodeConnectionCount}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* v2.8.2-T7: 链路详情面板 */}
        {selectedEdgeData && (() => {
          const edge = rfEdges.find((e) => e.id === selectedEdgeId)
          return (
            <div className="absolute top-3 right-3 z-20 bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded-lg shadow-lg p-4 min-w-[240px]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('topology:edgeDetail')}</span>
                <button onClick={() => setSelectedEdgeId(null)}
                  className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-400">
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-2xs">
                <span className="text-gray-400">{t('topology:source')}</span>
                <span className="text-gray-700 dark:text-gray-300 font-medium truncate">{edge?.source || '-'}</span>
                <span className="text-gray-400">{t('topology:target')}</span>
                <span className="text-gray-700 dark:text-gray-300 font-medium truncate">{edge?.target || '-'}</span>
                <span className="text-gray-400">{t('topology:speed')}</span>
                <span className="text-gray-700 dark:text-gray-300">{selectedEdgeData.speed || '-'}</span>
                <span className="text-gray-400">{t('topology:networkType')}</span>
                <span className="text-gray-700 dark:text-gray-300">{selectedEdgeData.networkType || '-'}</span>
                <span className="text-gray-400">{t('topology:cableType')}</span>
                <span className="text-gray-700 dark:text-gray-300">{selectedEdgeData.cableType || '-'}</span>
                {selectedEdgeData.description && (
                  <>
                    <span className="text-gray-400">{t('topology:description')}</span>
                    <span className="text-gray-700 dark:text-gray-300">{selectedEdgeData.description}</span>
                  </>
                )}
              </div>
            </div>
          )
        })()}

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
                  {label === 'param' ? t('topology:paramNetwork') : label === 'storage' ? t('topology:storageNetwork') : label === 'oob' ? 'OOB' : t('topology:bizNetwork')}
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
