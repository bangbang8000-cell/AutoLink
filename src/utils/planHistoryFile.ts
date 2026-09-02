/**
 * 48-b（F8-2）：版本历史快照文件——聚合 current plan + 全部历史快照 → 可移植文件并回导
 * - buildPlanHistoryFile：聚合版本历史为文件（format/schemaVersion/exportedAt/project/current/history）
 * - parsePlanHistoryFile：解析校验 → 返回历史条目（版本号归一），失败返回友好 reason
 * - mergePlanHistory：回导合并（默认补齐缺失版本；overwrite 时覆盖同版本）
 */
export const PLAN_HISTORY_FILE_FORMAT = 'autolink-plan-history'
export const PLAN_HISTORY_FILE_VERSION = 1

export interface PlanHistoryEntry {
  version: number
  plan: unknown
}

export interface PlanHistoryFilePayload {
  format: string
  schemaVersion: number
  exportedAt: string
  project?: { projectName?: string; projectId?: string }
  current?: unknown
  history: PlanHistoryEntry[]
}

/** 版本历史来源（feature:version-history:list 的 current + files 归一入口） */
export interface PlanHistorySource {
  projectName?: string
  projectId?: string
  current?: unknown
  history?: Array<{ name?: string; version?: number; plan?: unknown }>
}

/** 从文件名 v<N>.plan.json 解析版本号（解析失败回退 0） */
export function parseVersionFromHistoryName(name: string): number {
  const m = /^v(\d+)\.plan\.json$/.exec(name || '')
  return m ? Number(m[1]) : 0
}

export interface BuildPlanHistoryFileOptions {
  exportedAt?: Date
}

/** 聚合版本历史为可移植文件 JSON（history 按版本号排序去重） */
export function buildPlanHistoryFile(src: PlanHistorySource, opts?: BuildPlanHistoryFileOptions): string {
  const byVersion = new Map<number, unknown>()
  for (const h of src.history ?? []) {
    const version = typeof h.version === 'number' && h.version > 0 ? h.version : parseVersionFromHistoryName(h.name ?? '')
    if (version > 0 && h.plan != null && !byVersion.has(version)) {
      byVersion.set(version, h.plan)
    }
  }
  const history: PlanHistoryEntry[] = [...byVersion.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([version, plan]) => ({ version, plan }))
  const payload: PlanHistoryFilePayload = {
    format: PLAN_HISTORY_FILE_FORMAT,
    schemaVersion: PLAN_HISTORY_FILE_VERSION,
    exportedAt: (opts?.exportedAt ?? new Date()).toISOString(),
    ...(src.projectName || src.projectId
      ? {
          project: {
            ...(src.projectName ? { projectName: src.projectName } : {}),
            ...(src.projectId ? { projectId: src.projectId } : {}),
          },
        }
      : {}),
    ...(src.current != null ? { current: src.current } : {}),
    history,
  }
  return JSON.stringify(payload, null, 2)
}

export type ParsePlanHistoryFileResult =
  | { ok: true; payload: PlanHistoryFilePayload }
  | { ok: false; reason: string }

/** 解析版本历史文件 → 校验外壳 + history 结构 */
export function parsePlanHistoryFile(jsonText: string): ParsePlanHistoryFileResult {
  let data: unknown
  try {
    data = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: '版本历史文件不是合法 JSON' }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: '版本历史文件不是有效对象' }
  }
  const d = data as Partial<PlanHistoryFilePayload>
  if (d.format !== PLAN_HISTORY_FILE_FORMAT) {
    return { ok: false, reason: '版本历史文件格式标识缺失/不符' }
  }
  if (d.schemaVersion !== PLAN_HISTORY_FILE_VERSION) {
    return {
      ok: false,
      reason: `版本历史文件版本不兼容（当前 v${PLAN_HISTORY_FILE_VERSION}，文件 v${String(d.schemaVersion)}）`,
    }
  }
  if (!Array.isArray(d.history)) {
    return { ok: false, reason: '版本历史文件缺少 history 段' }
  }
  for (const h of d.history) {
    if (!h || typeof h !== 'object') return { ok: false, reason: '版本历史条目结构非法' }
    const entry = h as PlanHistoryEntry
    if (!Number.isInteger(entry.version) || entry.version < 1 || entry.plan == null) {
      return { ok: false, reason: `版本历史条目非法（version=${String(entry.version)}）` }
    }
  }
  return { ok: true, payload: data as PlanHistoryFilePayload }
}

export interface MergePlanHistoryOptions {
  /** true=覆盖目标端同版本；false（默认）=合并仅补齐缺失版本 */
  overwrite?: boolean
}

export interface MergePlanHistoryResult {
  merged: PlanHistoryEntry[]
  added: number
  skipped: number
}

/** 回导合并：目标端历史 + 外来历史（默认补齐缺失，保留目标端既有版本） */
export function mergePlanHistory(
  target: PlanHistoryEntry[],
  incoming: PlanHistoryEntry[],
  opts?: MergePlanHistoryOptions,
): MergePlanHistoryResult {
  const map = new Map<number, unknown>()
  for (const e of target) {
    if (e.version > 0) map.set(e.version, e.plan)
  }
  let added = 0
  let skipped = 0
  for (const e of incoming) {
    if (e.version < 1 || e.plan == null) continue
    if (map.has(e.version) && !opts?.overwrite) {
      skipped++
      continue
    }
    map.set(e.version, e.plan)
    added++
  }
  const merged = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([version, plan]) => ({ version, plan }))
  return { merged, added, skipped }
}
