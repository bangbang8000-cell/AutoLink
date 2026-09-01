/**
 * F2-3（42-c）：项目备份加固——自动备份轮转 + 恢复校验 + 一键恢复（渲染层纯逻辑，最小侵入）
 * - 与既有 snapshot/undo 协同不冲突：复用 designSnapshot 的 serialize/validate/apply 原语，
 *   备份内嵌 state 与快照同为 DesignSnapshot 结构，可互转；恢复走 applyDesignState（可撤销回退）。
 * - 自动备份轮转：addBackup 追加并按 maxCount 淘汰最旧，返回被淘汰数与最新列表。
 * - 恢复校验：verifyBackup 元数据 + 结构/版本 + checksum 一致性三重校验（防篡改/防漂移）。
 * - 一键恢复：restoreBackup 校验 → 自动生成当前状态安全备份（pre-restore）→ 应用（可撤销）。
 * - 数据一致：computeBackupConsistency 全量体检，检出校验和不一致的损坏备份。
 */
import {
  serializeDesignState,
  validateSnapshot,
  applyDesignState,
  SNAPSHOT_MAX_BYTES,
  type DesignSnapshot,
  type SnapshotRoomSource,
  type SnapshotRackSource,
  type SnapshotRoomHandle,
  type SnapshotRackHandle,
} from '@/utils/designSnapshot'

export const BACKUP_FORMAT = 'autolink-project-backup'
export const BACKUP_VERSION = 1
/** 自动备份轮转上限（超出淘汰最旧） */
export const BACKUP_MAX_COUNT = 20

export type BackupKind = 'auto' | 'manual' | 'pre-restore'

export interface BackupEntry {
  id: string
  kind: BackupKind
  name: string
  createdAt: string
  /** 序列化状态 JSON 的 FNV-1a 校验和（恢复/体检时重算比对，保证数据一致） */
  checksum: string
  state: DesignSnapshot
}

/** 备份操作入参：room / rack store state 句柄（getState() 即满足） */
export type BackupRoomHandle = SnapshotRoomSource & SnapshotRoomHandle
export type BackupRackHandle = SnapshotRackSource & SnapshotRackHandle

/* ---------------- 校验和（FNV-1a 32bit，确定性、快速、非加密用途） ---------------- */

export function checksum(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/* ---------------- 命名 ---------------- */

/** 默认备份名：备份 YYYYMMDD-HHmmss（date 可注入便于测试） */
export function defaultBackupName(date?: Date): string {
  const d = date ?? new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `备份 ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/* ---------------- 创建备份 ---------------- */

export type CreateBackupResult = { ok: true; entry: BackupEntry } | { ok: false; reason: string }

export interface CreateBackupOptions {
  kind?: BackupKind
  name?: string
  savedAt?: Date
  /** 序列化后字节上限（超出拒绝，默认对齐快照 2MB） */
  maxBytes?: number
}

function utf8Bytes(str: string): number {
  try {
    return new TextEncoder().encode(str).length
  } catch {
    return str.length
  }
}

let backupSeq = 0
function nextId(): string {
  return `bk-${Date.now()}-${++backupSeq}`
}

export function createBackup(
  room: SnapshotRoomSource,
  rack: SnapshotRackSource,
  opts?: CreateBackupOptions,
): CreateBackupResult {
  if (!room.matrix && rack.cabinets.length === 0) {
    return { ok: false, reason: 'no_data' }
  }
  const savedAtDate = opts?.savedAt ?? new Date()
  const savedAt = savedAtDate.toISOString()
  const finalName = opts?.name ?? defaultBackupName(savedAtDate)
  const state = serializeDesignState(room, rack, { name: finalName, savedAt: savedAtDate })
  const bytes = utf8Bytes(JSON.stringify(state))
  const maxBytes = opts?.maxBytes ?? SNAPSHOT_MAX_BYTES
  if (bytes > maxBytes) {
    return { ok: false, reason: 'too_large' }
  }
  const entry: BackupEntry = {
    id: nextId(),
    kind: opts?.kind ?? 'manual',
    name: finalName,
    createdAt: savedAt,
    checksum: checksum(JSON.stringify(state)),
    state,
  }
  return { ok: true, entry }
}

/* ---------------- 自动备份轮转 ---------------- */

export interface AddBackupResult {
  list: BackupEntry[]
  /** 被淘汰的备份数（轮转触发） */
  evicted: number
  total: number
}

export function addBackup(
  backups: BackupEntry[],
  entry: BackupEntry,
  maxCount: number = BACKUP_MAX_COUNT,
): AddBackupResult {
  const list = [...backups, entry]
  const cap = Math.max(1, Math.floor(maxCount))
  const overflow = list.length - cap
  if (overflow > 0) {
    return { list: list.slice(overflow), evicted: overflow, total: cap }
  }
  return { list, evicted: 0, total: list.length }
}

/* ---------------- 恢复校验 ---------------- */

export type VerifyBackupResult = { ok: true; entry: BackupEntry } | { ok: false; reason: string }

export function verifyBackup(entry: unknown): VerifyBackupResult {
  if (!entry || typeof entry !== 'object') return { ok: false, reason: '备份不是有效对象' }
  const e = entry as Partial<BackupEntry>
  if (e.id == null || e.kind == null || e.createdAt == null || e.checksum == null || e.state == null) {
    return { ok: false, reason: '备份元数据缺失（id/kind/createdAt/checksum/state）' }
  }
  if (typeof e.checksum !== 'string' || !/^[0-9a-f]{8}$/.test(e.checksum)) {
    return { ok: false, reason: '备份校验和不合法' }
  }
  const snapCheck = validateSnapshot(e.state)
  if (!snapCheck.ok) return { ok: false, reason: `备份状态校验失败：${snapCheck.reason}` }
  const recomputed = checksum(JSON.stringify(e.state))
  if (recomputed !== e.checksum) {
    return { ok: false, reason: '备份校验和不一致（数据可能已损坏或被篡改）' }
  }
  return { ok: true, entry: entry as BackupEntry }
}

/* ---------------- 一键恢复 ---------------- */

export type RestoreBackupResult =
  | ({ ok: true; safetyBackup?: BackupEntry })
  | { ok: false; reason: string }

export interface RestoreBackupOptions {
  safetyName?: string
  /** 无设计数据时是否仍生成空安全备份（默认 false，对齐快照「无数据不备份」） */
  keepEmptySafety?: boolean
}

export function restoreBackup(
  entry: BackupEntry,
  room: BackupRoomHandle,
  rack: BackupRackHandle,
  opts?: RestoreBackupOptions,
): RestoreBackupResult {
  const check = verifyBackup(entry)
  if (!check.ok) return check
  // 恢复前自动生成当前状态安全备份（数据安全兜底）
  let safety: BackupEntry | undefined
  if (opts?.keepEmptySafety || room.matrix || rack.cabinets.length > 0) {
    const s = createBackup(room, rack, { kind: 'pre-restore', name: opts?.safetyName })
    if (s.ok) safety = s.entry
  }
  const r = applyDesignState(room, rack, entry.state)
  if (!r.ok) return r
  return { ok: true, ...(safety ? { safetyBackup: safety } : {}) }
}

/* ---------------- 统计 / 一致性体检 ---------------- */

export interface BackupStats {
  total: number
  byKind: Record<BackupKind, number>
  oldest: string | null
  newest: string | null
}

export function backupStats(backups: BackupEntry[]): BackupStats {
  const byKind: Record<BackupKind, number> = { auto: 0, manual: 0, 'pre-restore': 0 }
  let oldest: string | null = null
  let newest: string | null = null
  for (const b of backups) {
    byKind[b.kind] = (byKind[b.kind] ?? 0) + 1
    if (oldest == null || b.createdAt < oldest) oldest = b.createdAt
    if (newest == null || b.createdAt > newest) newest = b.createdAt
  }
  return { total: backups.length, byKind, oldest, newest }
}

export interface BackupConsistencyIssue {
  id: string
  reason: string
}

export interface BackupConsistencyResult {
  checked: number
  healthy: number
  issues: BackupConsistencyIssue[]
}

export function computeBackupConsistency(backups: BackupEntry[]): BackupConsistencyResult {
  const issues: BackupConsistencyIssue[] = []
  let healthy = 0
  for (const b of backups) {
    const v = verifyBackup(b)
    if (v.ok) {
      healthy++
    } else {
      issues.push({ id: b.id, reason: v.reason })
    }
  }
  return { checked: backups.length, healthy, issues }
}
