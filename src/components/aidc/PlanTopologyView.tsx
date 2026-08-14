/**
 * D-9（H3）：AIDC 规划整网拓扑视图（react-flow，准确性参照）。
 *
 * 用 plan→Topology 适配器生成逐设备节点 + 真实接线，复用 SwitchNode 渲染；
 * 替换轻量 AidcTopologyPreview。支持网络域过滤 / 小地图 / 缩放。
 */
import { useMemo, useState } from 'react'
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Node, Edge } from '@xyflow/react'
import type { PlanSummary } from './aidcTypes'
import { planToTopology } from '@/utils/planToTopology'
import { topologyNodeTypes } from '@/components/workspace/tabs/topology/TopologyNodes'

const FILTERS = ['全部', '参数网', '存储网', '业务网', '带外网']

export function PlanTopologyView({ plan }: { plan: PlanSummary }) {
  const { nodes: allNodes, edges: allEdges } = useMemo(() => planToTopology(plan), [plan])
  const [filter, setFilter] = useState('全部')

  const nodes = useMemo(() => {
    if (filter === '全部') return allNodes
    const keep = new Set(allNodes.filter((n) => (n.data?.group as string) === filter).map((n) => n.id))
    return allNodes.filter((n) => keep.has(n.id)) as Node[]
  }, [allNodes, filter])

  const edges = useMemo(() => {
    if (filter === '全部') return allEdges
    const keep = new Set(nodes.map((n) => n.id))
    return allEdges.filter((e) => keep.has(e.source) && keep.has(e.target)) as Edge[]
  }, [allEdges, nodes, filter])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500">网络域：</span>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={filter === f
              ? 'px-2 py-0.5 rounded bg-primary-500 text-white'
              : 'px-2 py-0.5 rounded bg-gray-100 dark:bg-app-surface hover:bg-gray-200'}
          >
            {f}
          </button>
        ))}
        <span className="text-gray-400 ml-auto">设备 {nodes.length} · 接线 {edges.length}（与 plan 一致，准确性参照）</span>
      </div>
      <div className="h-[480px] border rounded">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={topologyNodeTypes}
          fitView
          minZoom={0.1}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} />
          <Controls />
          <MiniMap pannable zoomable nodeStrokeWidth={3} />
        </ReactFlow>
      </div>
    </div>
  )
}
