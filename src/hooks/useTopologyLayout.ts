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
 *   - progress: F4（5.4.4 可用性修复）布局阶段进度 0-100（Worker 进度消息驱动）
 */
import { useEffect, useRef, useState } from 'react'
import { computeTopologyLayout, type LayoutResult } from '@/components/workspace/tabs/topology/topologyLayout'
import type { TopologyNode, TopologyEdge } from '@/stores/design.store'

// v2.7.3-T6: 超过此阈值自动走 Worker
const WORKER_THRESHOLD = 500

type WorkerMessage =
  | { type: 'progress'; percent: number; token: number }
  | { type: 'result'; result: LayoutResult; token: number }

export function useTopologyLayout(nodes: TopologyNode[], edges: TopologyEdge[]) {
  const [layout, setLayout] = useState<LayoutResult | null>(null)
  const [computing, setComputing] = useState(false)
  // F4（5.4.4 可用性修复）：布局阶段进度（0-100）
  const [progress, setProgress] = useState(0)
  // AL-M4d: 实例复用——同一次挂载周期内复用同一 Worker,避免每次 effect 变更新建/销毁
  const workerRef = useRef<Worker | null>(null)
  // AL-M4d: 竞态防护——请求 token,丢弃 Worker 回传的过时结果
  const seqRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const seq = seqRef.current
    return () => {
      mountedRef.current = false
      seqRef.current = seq + 1
    }
  }, [])

  useEffect(() => {
    if (nodes.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 节点清空时重置布局结果
      setLayout(null)
      setProgress(0)
      return
    }

    // 大规模走 Worker,否则同步
    if (nodes.length > WORKER_THRESHOLD) {
      const seq = ++seqRef.current
      setComputing(true)
      setProgress(0)
      let worker = workerRef.current
      if (!worker) {
        worker = new Worker(
          new URL('../workers/topologyLayout.worker.ts', import.meta.url),
          { type: 'module' },
        )
        worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
          // 仅接受最新请求的结果；卸载后也忽略
          if (!mountedRef.current || e.data.token !== seqRef.current) return
          if (e.data.type === 'progress') {
            setProgress(e.data.percent)
            return
          }
          setLayout(e.data.result)
          setProgress(100)
          setComputing(false)
        }
        worker.onerror = (err) => {
          console.error('[topologyLayout.worker]', err)
          if (!mountedRef.current) return
          // 出错回退到同步
          setLayout(computeTopologyLayout(nodes, edges))
          setProgress(100)
          setComputing(false)
        }
        workerRef.current = worker
      }
      worker.postMessage({ nodes, edges, token: seq })
      return
    }

    setLayout(computeTopologyLayout(nodes, edges))
    setProgress(100)
  }, [nodes, edges])

  return { layout, computing, progress }
}
