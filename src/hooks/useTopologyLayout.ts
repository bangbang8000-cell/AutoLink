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
import { useEffect, useRef, useState } from 'react'
import { computeTopologyLayout, type LayoutResult } from '@/components/workspace/tabs/topology/topologyLayout'
import type { TopologyNode, TopologyEdge } from '@/stores/design.store'

// v2.7.3-T6: 超过此阈值自动走 Worker
const WORKER_THRESHOLD = 500

export function useTopologyLayout(nodes: TopologyNode[], edges: TopologyEdge[]) {
  const [layout, setLayout] = useState<LayoutResult | null>(null)
  const [computing, setComputing] = useState(false)
  // AL-M4d: 实例复用——同一次挂载周期内复用同一 Worker,避免每次 effect 变更新建/销毁
  const workerRef = useRef<Worker | null>(null)
  // AL-M4d: 竞态防护——请求 token,丢弃 Worker 回传的过时结果
  const seqRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      seqRef.current++
    }
  }, [])

  useEffect(() => {
    if (nodes.length === 0) {
      setLayout(null)
      return
    }

    // 大规模走 Worker,否则同步
    if (nodes.length > WORKER_THRESHOLD) {
      const seq = ++seqRef.current
      setComputing(true)
      let worker = workerRef.current
      if (!worker) {
        worker = new Worker(
          new URL('../workers/topologyLayout.worker.ts', import.meta.url),
          { type: 'module' },
        )
        worker.onmessage = (e: MessageEvent<{ result: LayoutResult; token: number }>) => {
          // 仅接受最新请求的结果；卸载后也忽略
          if (!mountedRef.current || e.data.token !== seqRef.current) return
          setLayout(e.data.result)
          setComputing(false)
        }
        worker.onerror = (err) => {
          console.error('[topologyLayout.worker]', err)
          if (!mountedRef.current) return
          // 出错回退到同步
          setLayout(computeTopologyLayout(nodes, edges))
          setComputing(false)
        }
        workerRef.current = worker
      }
      worker.postMessage({ nodes, edges, token: seq })
      return
    }

    setLayout(computeTopologyLayout(nodes, edges))
  }, [nodes, edges])

  return { layout, computing }
}
