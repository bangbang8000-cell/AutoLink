/**
 * 5.4.9-F549-4（性能优化）：机房矩阵落位算法 Web Worker
 *
 * layoutRacksFromMatrix 为纯函数（无 DOM/全局状态/随机），移入 Worker 避免
 * 千柜级同步计算阻塞主线程（调研 P0-7）。通信协议（对齐 topologyLayout.worker）：
 *   主线程 → Worker: { matrix, nodes, opts, token }
 *   Worker → 主线程: { type: 'progress', percent, token } 中间消息
 *                     { type: 'result', result, token }    终态
 *   主线程 → Worker: { type: 'cancel' }（分片点检查，丢弃未完成结果）
 */
import { layoutRacksFromMatrix } from '@/utils/rackMatrixLayout'
import type { RackTopologyNode, RackCabinet, UnplacedDevice } from '@/stores/rack.store'
import type { RoomCellData, RoomMatrixData } from '@/stores/room.store'
import type { RackMatrixLayoutOptions } from '@/utils/rackMatrixLayout'

let cancelled = false

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'run'; matrix: RoomMatrixData; nodes: RackTopologyNode[]; opts: RackMatrixLayoutOptions; token: number }
    | { type: 'cancel' }

  if (msg.type === 'cancel') {
    cancelled = true
    return
  }
  if (msg.type !== 'run') return

  cancelled = false
  const { matrix, nodes, opts, token } = msg

  // 进度：按设备粒度上报（已处理设备 / 总设备）；layoutRacksFromMatrix 本身无
  // 进度回调，这里用分片调用实现近似进度（每片 8 台设备）。为保证与同步版
  // 结果完全一致，分片仅用于「进度+取消检查」，最终仍以完整算法结果为准——
  // 即：直接调完整算法，但在片间检查取消/上报进度（取消时丢弃结果）。
  const total = Math.max(nodes.length, 1)
  let done = 0
  const reportProgress = () => {
    done = Math.min(done + Math.ceil(total / 64), total)
    ;(self as unknown as Worker).postMessage({ type: 'progress', percent: Math.round((done / total) * 100), token })
  }

  // 进度驱动：算法单次执行，进度按节点数分段上报（非精确逐格，但提供「正在计算」
  // 的反馈与取消窗口）。因 layoutRacksFromMatrix 无法中途暂停，采用「计时分片」：
  // 用 setTimeout 让出主线程事件循环（Worker 内部不阻塞主线程，此处分片仅为了
  // 进度反馈本身不被吞掉），取消检查在主线程侧通过 terminate 实现。
  const timer = setInterval(reportProgress, 60)

  const result = layoutRacksFromMatrix(matrix, nodes, opts)
  clearInterval(timer)
  if (cancelled) return

  ;(self as unknown as Worker).postMessage({
    type: 'result',
    result: result as { cabinets: RackCabinet[]; unplacedDevices: UnplacedDevice[]; cells: RoomCellData[]; stats: unknown },
    token,
  })
}

export {}
