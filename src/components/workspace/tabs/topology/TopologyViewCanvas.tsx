/**
 * 2026-08-24（新增）：拓扑视图「真实渲染」画布组件与元素构建
 *
 * 目标：导出的拓扑图与交互式拓扑视图（react-flow）**逐像素一致**（1:1 还原）。
 *  - 复用与 TopologyTab 相同的布局算法（computeTopologyLayout + saved layout）、
 *    节点组件（topologyNodeTypes / PodGroupNode）、边样式（edgeColor）与 POD 框。
 *  - TopologyViewCanvas 只渲染纯画布（无工具栏/交互），供 html-to-image 截图导出。
 *  - 导出器见 @/utils/exportTopologyView（临时挂载 → fit → toPng → 卸载）。
 */
import { memo, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import { topologyNodeTypes, EDGE_COLORS } from './TopologyNodes'
import { PodGroupNode } from './PodGroupNode'
import { computeTopologyLayout, getPodColor } from './topologyLayout'
import type { TopologyNode, TopologyEdge, TopologyLayout } from '@/stores/design.store'

export const topologyViewNodeTypes = { ...topologyNodeTypes, podGroup: PodGroupNode }

/** 与 TopologyTab 相同的边颜色（优先 networkType，回退 description/cableType） */
function edgeColor(description: string, cableType: string, networkType: string): string {
  if (networkType) {
    if (networkType === 'param') return EDGE_COLORS.param
    if (networkType === 'storage') return EDGE_COLORS.storage
    if (networkType === 'oob') return EDGE_COLORS.oob
    if (networkType === 'biz') return EDGE_COLORS.biz
    if (networkType === 'scale_up') return EDGE_COLORS.scale_up
  }
  if (description.includes('参数') || cableType.includes('参数')) return EDGE_COLORS.param
  if (description.includes('存储') || cableType.includes('存储')) return EDGE_COLORS.storage
  if (description.includes('OOB') || cableType.includes('OOB')) return EDGE_COLORS.oob
  if (description.includes('业务') || cableType.includes('业务')) return EDGE_COLORS.biz
  if (
    description.includes('Scale-Up') || description.includes('UALink') ||
    description.includes('NVLink') || description.includes('UB') ||
    cableType.includes('Scale-Up') || cableType.includes('UALink') ||
    cableType.includes('NVLink') || cableType.includes('UB')
  ) return EDGE_COLORS.scale_up
  return '#d1d5db'
}

/** 布局节点位置（saved layout 优先，与 TopologyTab 一致） */
function resolvePosition(
  id: string,
  layout: ReturnType<typeof computeTopologyLayout>,
  savedPos: Record<string, { x: number; y: number }>,
): { x: number; y: number } {
  const computed = layout.layoutNodes.find((n) => n.id === id)
  return savedPos[id] ?? (computed ? { x: computed.x, y: computed.y } : { x: 0, y: 260 })
}

export interface TopologyViewElements {
  rfNodes: Node[]
  rfEdges: Edge[]
  /** 布局结果（供比例评估） */
  layout: ReturnType<typeof computeTopologyLayout>
}

/** 从 topology 数据构建 react-flow 元素（与 TopologyTab 同源算法，保证所见即所得） */
export function buildTopologyView(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  savedLayout?: TopologyLayout | null,
): TopologyViewElements {
  const layout = computeTopologyLayout(nodes, [])
  const savedPos = savedLayout?.nodePositions ?? {}

  // POD 背景框（复用 PodGroupNode 组件）
  const podNodes: Node[] = layout.pods.map((pod, idx) => {
    const color = getPodColor(idx)
    return {
      id: `pod-group-${pod.podid}`,
      type: 'podGroup',
      position: { x: pod.x, y: pod.y },
      data: {
        podid: pod.podid,
        podIndex: idx,
        serverCount: pod.serverCount,
        accessCount: pod.accessCount,
        leafCount: pod.leafCount,
        width: pod.width,
        height: pod.height,
        fillColor: color,
      } as unknown as Record<string, unknown>,
      draggable: false,
      selectable: false,
      zIndex: 0,
    }
  })

  // 设备节点
  const connCount = new Map<string, number>()
  for (const e of edges) {
    connCount.set(e.source, (connCount.get(e.source) || 0) + 1)
    connCount.set(e.target, (connCount.get(e.target) || 0) + 1)
  }
  const deviceNodes: Node[] = nodes.map((node) => {
    const pos = resolvePosition(node.id, layout, savedPos)
    const isGpu = node.type === 'scaleup_gpu'
    const isSwitch = !isGpu && node.type !== 'server'
    return {
      id: node.id,
      type: isGpu ? 'gpu' : (isSwitch ? 'switch' : 'server'),
      position: { x: pos.x, y: pos.y },
      data: {
        label: node.id,
        nodeType: node.type,
        group: node.group,
        podid: node.podid,
        cabinetName: node.cabinetName,
        connectionCount: connCount.get(node.id) || 0,
      } as unknown as Record<string, unknown>,
      zIndex: 10,
    }
  })

  // 边（handle 上下判定 + 网络类型颜色 + 标签，与 TopologyTab 一致）
  const posMap = new Map(deviceNodes.map((n) => [n.id, n.position]))
  const rfEdges: Edge[] = edges.map((e, idx) => {
    const sp = posMap.get(e.source)
    const tp = posMap.get(e.target)
    let sourceHandle: string | undefined
    let targetHandle: string | undefined
    if (sp && tp) {
      if (sp.y <= tp.y) { sourceHandle = 'down'; targetHandle = 'up' }
      else { sourceHandle = 'up'; targetHandle = 'down' }
    }
    const label = `${e.speed}${e.networkType ? ` ${e.networkType}` : ''}`.trim()
    return {
      id: `e-${idx}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      style: {
        stroke: edgeColor(e.description, e.cableType, e.networkType || ''),
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

  return { rfNodes: [...podNodes, ...deviceNodes], rfEdges, layout }
}

/**
 * 纯拓扑画布：挂载到任意容器（off-screen 导出容器），fit 后回调 onReady。
 * width/height 为导出容器逻辑尺寸（内容按比例、等比 fit，不拉伸 → 1:1）。
 */
export const TopologyViewCanvas = memo(function TopologyViewCanvas({
  nodes,
  edges,
  savedLayout,
  width,
  height,
  onReady,
}: {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  savedLayout?: TopologyLayout | null
  width: number
  height: number
  onReady?: () => void
}) {
  const reactFlow = useReactFlow()
  const [elements, setElements] = useState<TopologyViewElements>(() =>
    buildTopologyView(nodes, edges, savedLayout),
  )
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }

  // 数据变化 → 重建元素
  useEffect(() => {
    setElements(buildTopologyView(nodes, edges, savedLayout))
  }, [nodes, edges, savedLayout])

  // 等待节点测量完成后手动 fit（setViewport），然后 onReady（导出器在此截图）
  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    const deadline = Date.now() + 2500
    const tryFit = async () => {
      for (;;) {
        if (cancelled) return
        const list = reactFlow.getNodes()
        const visible = list.filter((n) => !n.hidden)
        const allMeasured =
          visible.length > 0 && visible.every((n) => (n.measured?.width ?? 0) > 0)
        if (allMeasured || Date.now() >= deadline) {
          const { width: w, height: h } = sizeRef.current
          const vp = fitViewport(reactFlow, w, h)
          if (vp) reactFlow.setViewport(vp, { duration: 0 })
          onReadyRef.current?.()
          return
        }
        await new Promise((r) => { timer = window.setTimeout(r, 60) })
      }
    }
    void tryFit()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [reactFlow, elements.layout])

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={elements.rfNodes}
        edges={elements.rfEdges}
        nodeTypes={topologyViewNodeTypes}
        minZoom={0.01}
        maxZoom={4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        className="bg-white"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
      </ReactFlow>
    </div>
  )
})

/** 手动计算自适应视口：内容包围盒（positionAbsolute + measured）等比居中 */
function fitViewport(
  reactFlow: ReturnType<typeof useReactFlow>,
  cw: number,
  ch: number,
): { x: number; y: number; zoom: number } | null {
  const nodes = reactFlow.getNodes()
  const visible = nodes.filter((n) => !n.hidden)
  if (visible.length === 0) return null
  const useMeasured = visible.some((n) => (n.measured?.width ?? 0) > 0)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of visible) {
    const w = useMeasured ? (n.measured?.width ?? 0) : 0
    const h = useMeasured ? (n.measured?.height ?? 0) : 0
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }
  if (!isFinite(minX) || maxX <= minX || maxY <= minY) return null
  const bw = maxX - minX
  const bh = maxY - minY
  const pad = Math.round(Math.min(40, Math.min(cw, ch) * 0.05))
  const zoom = Math.max(0.01, Math.min(4, Math.min((cw - 2 * pad) / bw, (ch - 2 * pad) / bh)))
  return {
    x: (cw - bw * zoom) / 2 - minX * zoom,
    y: (ch - bh * zoom) / 2 - minY * zoom,
    zoom,
  }
}
