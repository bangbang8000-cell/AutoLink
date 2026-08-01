/**
 * v2.7.3-T6: 拓扑布局算法 Web Worker
 *
 * 将 computeTopologyLayout 移入 Worker,避免大规模拓扑(>500 节点)阻塞主线程。
 * 通信协议:
 *   主线程 → Worker: { nodes: TopologyNode[], edges: TopologyEdge[] }
 *   Worker → 主线程: LayoutResult
 */
import { computeTopologyLayout } from '@/components/workspace/tabs/topology/topologyLayout'
import type { TopologyNode, TopologyEdge } from '@/stores/design.store'

self.onmessage = (e: MessageEvent<{ nodes: TopologyNode[]; edges: TopologyEdge[] }>) => {
  const { nodes, edges } = e.data
  const result = computeTopologyLayout(nodes, edges)
  ;(self as unknown as Worker).postMessage(result)
}
