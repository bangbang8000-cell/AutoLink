/**
 * 48-b（F8-2）：设计快照文件格式——快照（designSnapshot JSON）导出为可移植文件并回导
 * - buildSnapshotFile：把 DesignSnapshot 包装为文件（format/schemaVersion/exportedAt/project/snapshot）
 * - parseSnapshotFile：解析文件 → 校验外壳 + 内层快照（复用 validateSnapshot），失败返回友好 reason
 * - 兼容旧格式：直接传入 DesignSnapshot（无外壳）也可解析回导
 */
import { validateSnapshot, type DesignSnapshot, type ValidateResult } from '@/utils/designSnapshot'

export const SNAPSHOT_FILE_FORMAT = 'autolink-snapshot-file'
export const SNAPSHOT_FILE_VERSION = 1

export interface SnapshotFilePayload {
  format: string
  schemaVersion: number
  exportedAt: string
  project?: { projectName?: string; projectId?: string }
  snapshot: DesignSnapshot
}

export interface BuildSnapshotFileOptions {
  projectName?: string
  projectId?: string
  exportedAt?: Date
}

/** 把快照包装为可移植文件 JSON（外壳校验失败则抛错，避免导出损坏文件） */
export function buildSnapshotFile(snapshot: DesignSnapshot, opts?: BuildSnapshotFileOptions): string {
  const check = validateSnapshot(snapshot)
  if (!check.ok) throw new Error(check.reason)
  const payload: SnapshotFilePayload = {
    format: SNAPSHOT_FILE_FORMAT,
    schemaVersion: SNAPSHOT_FILE_VERSION,
    exportedAt: (opts?.exportedAt ?? new Date()).toISOString(),
    ...(opts?.projectName || opts?.projectId
      ? {
          project: {
            ...(opts.projectName ? { projectName: opts.projectName } : {}),
            ...(opts.projectId ? { projectId: opts.projectId } : {}),
          },
        }
      : {}),
    snapshot,
  }
  return JSON.stringify(payload, null, 2)
}

export type ParseSnapshotFileResult = ValidateResult & { snapshot?: DesignSnapshot; projectName?: string }

/** 解析快照文件 → 校验外壳 + 内层快照；兼容直接传入 DesignSnapshot（旧格式） */
export function parseSnapshotFile(jsonText: string): ParseSnapshotFileResult {
  let data: unknown
  try {
    data = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: '快照文件不是合法 JSON' }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: '快照文件不是有效对象' }
  }
  const d = data as Record<string, unknown>
  if (d.format !== SNAPSHOT_FILE_FORMAT) {
    // 兼容旧格式：直接传入 DesignSnapshot
    const inner = validateSnapshot(data)
    if (inner.ok) return { ...inner, snapshot: data as DesignSnapshot }
    return { ok: false, reason: `快照文件格式标识缺失/不符（${inner.reason}）` }
  }
  if (d.schemaVersion !== SNAPSHOT_FILE_VERSION) {
    return {
      ok: false,
      reason: `快照文件版本不兼容（当前 v${SNAPSHOT_FILE_VERSION}，文件 v${String(d.schemaVersion)}）`,
    }
  }
  const snap = d.snapshot
  const check = validateSnapshot(snap)
  if (!check.ok) return { ok: false, reason: `快照校验失败：${check.reason}` }
  const project = d.project as { projectName?: string; projectId?: string } | undefined
  return {
    ok: true,
    snapshot: snap as DesignSnapshot,
    ...(project?.projectName ? { projectName: project.projectName } : {}),
  }
}
