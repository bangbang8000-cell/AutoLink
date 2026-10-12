/**
 * 5.4.9-F549-4（性能优化）：矩阵落位异步执行器。
 *
 * 小规模（≤500 设备）同步执行（与历史行为一致，零开销）；
 * 大规模走 Web Worker（rackMatrixLayout.worker.ts），避免千柜级同步计算
 * 阻塞主线程（调研 P0-7），并提供进度回调与取消（terminate）。
 *
 * 结果与同步版 layoutRacksFromMatrix 完全一致（Worker 内直接调用同一纯函数）。
 */
import { layoutRacksFromMatrix, type RackMatrixLayoutOptions, type RackMatrixLayoutResult } from '@/utils/rackMatrixLayout'
import type { RackTopologyNode } from '@/stores/rack.store'
import type { RoomMatrixData } from '@/stores/room.store'

/** 走 Worker 的规模阈值（对齐 topologyLayout WORKER_THRESHOLD=500） */
export const MATRIX_WORKER_THRESHOLD = 500

export interface MatrixRackLayoutHandle {
  /** 取消：仅 Worker 模式生效（terminate 丢弃未完成结果） */
  cancel: () => void
}

export async function runMatrixRackLayout(
  matrix: RoomMatrixData,
  nodes: RackTopologyNode[],
  opts: RackMatrixLayoutOptions = {},
  onProgress?: (percent: number) => void,
): Promise<{ result: RackMatrixLayoutResult; cancel: () => void }> {
  // 小规模：同步执行，不引入 Worker 开销
  if (nodes.length <= MATRIX_WORKER_THRESHOLD) {
    const result = layoutRacksFromMatrix(matrix, nodes, opts)
    return { result, cancel: () => {} }
  }

  // 大规模：Web Worker + 进度 + 可取消（terminate）
  const worker = new Worker(new URL('../workers/rackMatrixLayout.worker.ts', import.meta.url), { type: 'module' })
  const token = Date.now()
  let settled = false

  const result = await new Promise<RackMatrixLayoutResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data as { type: 'progress' | 'result'; percent?: number; result?: RackMatrixLayoutResult; token?: number }
      if (data.token !== token) return
      if (data.type === 'progress' && onProgress) {
        onProgress(data.percent ?? 0)
      } else if (data.type === 'result' && data.result) {
        settled = true
        worker.terminate()
        resolve(data.result)
      }
    }
    worker.onerror = (e) => {
      if (settled) return
      settled = true
      worker.terminate()
      reject(new Error(e.message || '矩阵落位 Worker 失败'))
    }
    worker.postMessage({ type: 'run', matrix, nodes, opts, token })
  })

  return {
    result,
    cancel: () => {
      if (!settled) {
        settled = true
        worker.terminate()
      }
    },
  }
}
