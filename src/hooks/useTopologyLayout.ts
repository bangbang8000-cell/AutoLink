/**
 * v2.7.3-T6: 拓扑布局 Hook
 *
 * 自动根据节点数选择同步调用或 Web Worker:
 *   - 节点数 ≤ WORKER_THRESHOLD: 同步调用,零通信开销
 *   - 节点数 > WORKER_THRESHOLD: Web Worker 计算,主线程不阻塞
 *
 * 返回:
 *   - layout: 当前布局结果(首次为 null)
 *   - computing: 是否正在计算(仅 Worker 模式下为 true)
 */
import { useEffect, useState } from 'react'
import { computeTopologyLayout, type LayoutResult } from '@/components/workspace/tabs/topology/topologyLayout'
import type { TopologyNode, TopologyEdge } from '@/stores/design.store'

// v2.7.3-T6: 超过此阈值自动走 Worker
const WORKER_THRESHOLD = 500

export function useTopologyLayout(nodes: TopologyNode[], edges: TopologyEdge[]) {
  const [layout, setLayout] = useState<LayoutResult | null>(null)
  const [computing, setComputing] = useState(false)

  useEffect(() => {
    if (nodes.length === 0) {
      setLayout(null)
      return
    }

    // 大规模走 Worker,否则同步
    if (nodes.length > WORKER_THRESHOLD) {
      setComputing(true)
      const worker = new Worker(
        new URL('../workers/topologyLayout.worker.ts', import.meta.url),
        { type: 'module' },
      )
      worker.postMessage({ nodes, edges })
      worker.onmessage = (e: MessageEvent<LayoutResult>) => {
        setLayout(e.data)
        setComputing(false)
        worker.terminate()
      }
      worker.onerror = (err) => {
        console.error('[topologyLayout.worker]', err)
        // 出错回退到同步
        setLayout(computeTopologyLayout(nodes, edges))
        setComputing(false)
        worker.terminate()
      }
      return () => {
        worker.terminate()
        setComputing(false)
      }
    }

    setLayout(computeTopologyLayout(nodes, edges))
  }, [nodes, edges])

  return { layout, computing }
}
