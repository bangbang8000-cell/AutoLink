/**
 * 48-d（F8-4）：评审包——聚合版本历史 diff + 设计报告数据 + 校验结果 + 交付清单
 * - buildReviewPackage：归一化评审包 JSON（format/schemaVersion/exportedAt/project/四段数据）
 * - validateReviewPackage：结构校验（评审包回读/展示守卫），失败返回友好 reason
 * - reviewPackageFileName：评审包 zip 文件名（含项目名 + 时间戳）
 */
export const REVIEW_PACKAGE_FORMAT = 'autolink-review-package'
export const REVIEW_PACKAGE_VERSION = 1

export interface ReviewVersionEntry {
  version: number
  planHash?: string
  generatedAt?: string
}

export interface ReviewPackageInput {
  projectName?: string
  projectId?: string
  /** 当前 planVersion（AIDC 规划版本） */
  currentVersion?: number
  /** 版本历史（版本号 + planHash + generatedAt） */
  versions?: ReviewVersionEntry[]
  /** 设计报告数据（design:report / share:snapshot 归一结果） */
  designReport?: unknown
  /** 校验结果（design:validate） */
  validation?: unknown
  /** 交付清单（最新批次 manifest） */
  delivery?: unknown
  /** 交付批次名 */
  deliveryBatch?: string
  exportedAt?: Date
}

export interface ReviewPackagePayload {
  format: string
  schemaVersion: number
  exportedAt: string
  project: { projectName?: string; projectId?: string }
  versionHistory: { currentVersion?: number; versions: ReviewVersionEntry[] }
  designReport: unknown
  validation: unknown
  delivery: unknown
}

/** 聚合各段输入 → 评审包 JSON（版本历史按版本号去重排序） */
export function buildReviewPackage(input: ReviewPackageInput): ReviewPackagePayload {
  const byVersion = new Map<number, ReviewVersionEntry>()
  for (const v of input.versions ?? []) {
    if (v && v.version > 0 && !byVersion.has(v.version)) byVersion.set(v.version, v)
  }
  const versions = [...byVersion.values()].sort((a, b) => a.version - b.version)
  return {
    format: REVIEW_PACKAGE_FORMAT,
    schemaVersion: REVIEW_PACKAGE_VERSION,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    project: {
      ...(input.projectName ? { projectName: input.projectName } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
    },
    versionHistory: {
      ...(input.currentVersion != null ? { currentVersion: input.currentVersion } : {}),
      versions,
    },
    designReport: input.designReport ?? null,
    validation: input.validation ?? null,
    delivery: input.delivery ?? null,
  }
}

export type ValidateReviewPackageResult = { ok: true } | { ok: false; reason: string }

/** 评审包结构校验（评审包文件回读/展示守卫） */
export function validateReviewPackage(data: unknown): ValidateReviewPackageResult {
  if (!data || typeof data !== 'object') return { ok: false, reason: '评审包不是有效对象' }
  const d = data as Partial<ReviewPackagePayload>
  if (d.format !== REVIEW_PACKAGE_FORMAT) return { ok: false, reason: '评审包格式标识缺失/不符' }
  if (d.schemaVersion !== REVIEW_PACKAGE_VERSION) {
    return { ok: false, reason: `评审包版本不兼容（当前 v${REVIEW_PACKAGE_VERSION}，文件 v${String(d.schemaVersion)}）` }
  }
  if (!d.exportedAt) return { ok: false, reason: '评审包缺少 exportedAt' }
  if (!d.project || typeof d.project !== 'object') return { ok: false, reason: '评审包缺少 project 段' }
  if (!d.versionHistory || typeof d.versionHistory !== 'object') return { ok: false, reason: '评审包缺少 versionHistory 段' }
  if (!Array.isArray(d.versionHistory.versions)) return { ok: false, reason: '评审包 versionHistory.versions 缺失' }
  return { ok: true }
}

/** 评审包 zip 文件名：<项目名>_评审包_<YYYYMMDD-HHmmss>.zip（date 可注入便于测试） */
export function reviewPackageFileName(projectName: string, date?: Date): string {
  const d = date ?? new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const safeName = String(projectName ?? '').replace(/[\\/:*?"<>|]/g, '_')
  return `${safeName || '项目'}_评审包_${ts}.zip`
}
