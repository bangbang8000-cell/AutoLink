/**
 * 打磨轮（v1.4 / AL-R2c）：AIDC 机柜 = 矩阵（矩阵权威）——跨 store 编排（叶子模块，不被任何 store import）
 *
 * 存在矩阵 → room.applyMatrixRackLayout（按矩阵落位 + rack/room 双文件持久化）
 * 无矩阵    → rack.initFromTopology（原"每设备一柜"路径回退）
 *
 * 由 AidcPlannerPanel.applyToDesign 与 DesignTab.handleGenerate 两条生成路径共用，语义一致。
 *
 * F2（5.4.4 可用性修复）：落位参数优先读项目 rack_config（project_config.json）——
 * 旧实现不传 opts ⇒ powerLimit 硬编码 12000，与后端 rack_allocation（按
 * power_limit_per_rack，如 DP3Tier-1024 模板=30000）前后端不一致；现按
 * rack_config.power_limit_per_rack / rack_type / gpu_per_cabinet / top_reserved_u
 * 接线，缺省仍为 12000/42/1/2（向后兼容）。
 * 5.4.6（调研 P0-4）：实测 8192 卡-X400-RoCE 模板 power_limit_per_rack=12000
 *（30000 属 DP3Tier-1024），注释与模板一致化；落位统一读 rack_config。
 */
import { useRackStore } from '@/stores/rack.store'
import { useRoomStore } from '@/stores/room.store'
import { inferGpuShareMode } from '@/shared/gpuShare'
import type { RackTopologyNode } from '@/stores/rack.store'
import type { RackMatrixLayoutOptions, RackMatrixLayoutStats } from '@/utils/rackMatrixLayout'

export interface EnsureMatrixRacksResult {
  usedMatrix: boolean
  stats?: RackMatrixLayoutStats
  error?: string
}

/** F2：读项目 rack_config（project_config.json）；无文件/无段/解析失败返回 null */
async function readProjectRackConfig(
  projectName: string,
): Promise<RackMatrixLayoutOptions | null> {
  try {
    const raw = await window.electron?.project?.getFile(projectName, 'project_config.json')
    if (!raw) return null
    const cfg = JSON.parse(raw)
    const rc = cfg?.rack_config
    if (!rc || typeof rc !== 'object') return null
    const opts: RackMatrixLayoutOptions = {}
    if (typeof rc.power_limit_per_rack === 'number' && rc.power_limit_per_rack > 0) {
      opts.powerLimit = rc.power_limit_per_rack
    }
    if (typeof rc.rack_type === 'number' && rc.rack_type > 0) {
      opts.rackType = rc.rack_type
    }
    if (typeof rc.gpu_per_cabinet === 'number' && rc.gpu_per_cabinet > 0) {
      opts.gpuPerCabinet = rc.gpu_per_cabinet
    }
    // B5-01 / FR-A26：档位（未写 + 存量 >1 → 人工指定）
    opts.gpuShareMode = inferGpuShareMode(rc.gpu_share_mode, opts.gpuPerCabinet)
    if (typeof rc.top_reserved_u === 'number' && rc.top_reserved_u >= 0) {
      opts.topReservedU = rc.top_reserved_u
    }
    return Object.keys(opts).length > 0 ? opts : null
  } catch {
    return null
  }
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
  // F2：调用方显式 opts 优先；缺省读项目 rack_config；再缺省走函数默认值（12000/42/1/2）
  const resolved = opts ?? (await readProjectRackConfig(projectName)) ?? undefined
  // F2：同步项目机柜配置到 rack.store（topReservedU/gpuPerCabinet 上架校验同源生效）
  if (resolved?.topReservedU != null || resolved?.gpuPerCabinet != null || resolved?.gpuShareMode != null) {
    useRackStore.getState().setRackConfig({
      ...(resolved.topReservedU != null ? { topReservedU: resolved.topReservedU } : {}),
      ...(resolved.gpuPerCabinet != null ? { gpuPerCabinet: resolved.gpuPerCabinet } : {}),
      ...(resolved.gpuShareMode != null ? { gpuShareMode: resolved.gpuShareMode } : {}),
    })
  }
  if (matrix) {
    const res = await useRoomStore.getState().applyMatrixRackLayout(projectName, nodes, resolved)
    return { usedMatrix: true, stats: res.stats, error: res.ok ? undefined : res.errors.join('; ') }
  }
  useRackStore.getState().initFromTopology(
    nodes,
    resolved?.rackType,
    resolved?.powerLimit ?? 12000,
  )
  return { usedMatrix: false }
}
