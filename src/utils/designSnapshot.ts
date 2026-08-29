/**
 * M2（AL-SNAP1/2）：设计快照——序列化 / 校验 / 应用（纯逻辑层）
 * - serializeDesignState：room.store.matrix + rack.store（cabinets/unplacedDevices/config）→ DesignSnapshot
 * - validateSnapshot：结构 + 版本兼容校验（导入前/恢复前守卫，失败返回友好 reason）
 * - applyDesignState：整状态替换（rack.setRacks + setRackConfig + room.applySnapshot），
 *   随后触发 syncCabinetToCell 联动重算（已上架机柜类型回写矩阵格，矩阵↔柜内一致）
 */
import type { RoomMatrixData } from '@/stores/room.store'
import type { RackCabinet, UnplacedDevice } from '@/stores/rack.store'

/** 快照格式标识（导出/导入文件首级 meta.format 校验） */
export const SNAPSHOT_FORMAT = 'autolink-design-snapshot'
/** 当前快照结构版本（不兼容旧版本导入时友好提示） */
export const SNAPSHOT_VERSION = 1
/** 单快照序列化字节上限（超出跳过保存并提示） */
export const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024

/** 快照内附带的机柜配置（顶部预留 U / 每柜 GPU 数），恢复时随快照还原 */
export interface SnapshotRackConfig {
  topReservedU: number
  gpuPerCabinet: number
}

/** 设计快照结构：{version, meta, matrix, cabinets, config}（PRD AL-SNAP1/2） */
export interface DesignSnapshot {
  version: number
  meta: {
    format: string
    version: number
    savedAt: string
    name?: string
  }
  matrix: RoomMatrixData | null
  cabinets: RackCabinet[]
  unplacedDevices: UnplacedDevice[]
  config: SnapshotRackConfig
}

/** 序列化入参（room / rack store state 句柄的子集） */
export interface SnapshotRoomSource {
  matrix: RoomMatrixData | null
}

export interface SnapshotRackSource {
  cabinets: RackCabinet[]
  unplacedDevices: UnplacedDevice[]
  topReservedU: number
  gpuPerCabinet: number
}

/** 校验/应用结果：ok 或 友好失败原因（reason 面向 UI 直接展示） */
export type ValidateResult = { ok: true } | { ok: false; reason: string }

/**
 * 序列化当前设计状态为快照（深拷贝，避免快照与活动编辑共享引用）
 * @param room room.store 状态（matrix）
 * @param rack rack.store 状态（cabinets / unplacedDevices / topReservedU / gpuPerCabinet）
 * @param opts 快照命名（默认不写 meta.name）与 savedAt 注入（便于测试）
 */
export function serializeDesignState(
  room: SnapshotRoomSource,
  rack: SnapshotRackSource,
  opts?: { name?: string; savedAt?: Date },
): DesignSnapshot {
  const savedAt = (opts?.savedAt ?? new Date()).toISOString()
  return {
    version: SNAPSHOT_VERSION,
    meta: {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      savedAt,
      ...(opts?.name ? { name: opts.name } : {}),
    },
    matrix: room.matrix ? structuredClone(room.matrix) : null,
    cabinets: structuredClone(rack.cabinets),
    unplacedDevices: structuredClone(rack.unplacedDevices ?? []),
    config: {
      topReservedU: rack.topReservedU,
      gpuPerCabinet: rack.gpuPerCabinet,
    },
  }
}

/** 结构 + 版本兼容校验（失败返回友好 reason） */
export function validateSnapshot(data: unknown): ValidateResult {
  if (!data || typeof data !== 'object') return { ok: false, reason: '快照不是有效对象' }
  const s = data as Partial<DesignSnapshot>
  if (s.version !== SNAPSHOT_VERSION) {
    return {
      ok: false,
      reason: `快照版本不兼容（当前 v${SNAPSHOT_VERSION}，文件 v${s.version ?? '未知'}）`,
    }
  }
  const meta = s.meta
  if (!meta || meta.format !== SNAPSHOT_FORMAT) {
    return { ok: false, reason: '快照格式标识缺失/不符' }
  }
  if (s.matrix != null) {
    if (!Array.isArray(s.matrix.rows) || !Array.isArray(s.matrix.cols) || !Array.isArray(s.matrix.cells)) {
      return { ok: false, reason: '快照矩阵结构不完整（缺少 rows/cols/cells）' }
    }
  }
  if (!Array.isArray(s.cabinets)) {
    return { ok: false, reason: '快照机柜列表缺失' }
  }
  return { ok: true }
}

/** 应用句柄（room / rack store state 的子集；测试可直接传 getState()） */
export interface SnapshotRoomHandle {
  applySnapshot: (matrix: RoomMatrixData | null) => void
  syncCabinetToCell: (cabinetId: number, recordHistory?: boolean) => void
}

export interface SnapshotRackHandle {
  setRacks: (
    cabinets: RackCabinet[],
    unplacedDevices?: UnplacedDevice[],
    selectedCabinetId?: number | null,
  ) => void
  setRackConfig: (cfg: { topReservedU?: number; gpuPerCabinet?: number }) => void
}

/**
 * 应用快照：整状态替换（稳妥策略，避免差异合并遗漏字段）+ 联动重算
 * - rack：setRacks 整表替换（含未上架设备）+ setRackConfig 还原配置
 * - room：applySnapshot 整矩阵替换（清空选中/多选残留）
 * - 联动重算：syncCabinetToCell（recordHistory=false，等值守卫收敛不重复压栈）
 * 失败（校验不过）时不改写任何 store。
 */
export function applyDesignState(
  room: SnapshotRoomHandle,
  rack: SnapshotRackHandle,
  snapshot: DesignSnapshot,
): ValidateResult {
  const check = validateSnapshot(snapshot)
  if (!check.ok) return check
  rack.setRacks(
    snapshot.cabinets,
    snapshot.unplacedDevices,
    snapshot.cabinets.length > 0 ? snapshot.cabinets[0].id : null,
  )
  rack.setRackConfig({
    topReservedU: snapshot.config.topReservedU,
    gpuPerCabinet: snapshot.config.gpuPerCabinet,
  })
  room.applySnapshot(snapshot.matrix)
  for (const cab of snapshot.cabinets) room.syncCabinetToCell(cab.id, false)
  return { ok: true }
}
