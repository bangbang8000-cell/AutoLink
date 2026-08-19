/**
 * 打磨轮（v1.4 / AL-R2c）：AIDC 机柜 = 矩阵（矩阵权威）——跨 store 编排（叶子模块，不被任何 store import）
 *
 * 存在矩阵 → room.applyMatrixRackLayout（按矩阵落位 + rack/room 双文件持久化）
 * 无矩阵    → rack.initFromTopology（原"每设备一柜"路径回退）
 *
 * 由 AidcPlannerPanel.applyToDesign 与 DesignTab.handleGenerate 两条生成路径共用，语义一致。
 */
import { useRackStore } from '@/stores/rack.store'
import { useRoomStore } from '@/stores/room.store'
import type { RackTopologyNode } from '@/stores/rack.store'
import type { RackMatrixLayoutOptions, RackMatrixLayoutStats } from '@/utils/rackMatrixLayout'

export interface EnsureMatrixRacksResult {
  usedMatrix: boolean
  stats?: RackMatrixLayoutStats
  error?: string
}

export async function ensureMatrixRacks(
  projectName: string,
  nodes: RackTopologyNode[],
  opts?: RackMatrixLayoutOptions,
): Promise<EnsureMatrixRacksResult> {
  let matrix = useRoomStore.getState().matrix
  if (!matrix) {
    // 用户可能未进过机柜子视图：store 为空但 room_layout.json 已存在
    await useRoomStore.getState().loadMatrix(projectName)
    matrix = useRoomStore.getState().matrix
  }
  if (matrix) {
    const res = await useRoomStore.getState().applyMatrixRackLayout(projectName, nodes, opts)
    return { usedMatrix: true, stats: res.stats, error: res.ok ? undefined : res.errors.join('; ') }
  }
  useRackStore.getState().initFromTopology(nodes, opts?.rackType, opts?.powerLimit)
  return { usedMatrix: false }
}
