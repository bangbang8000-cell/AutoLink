/**
 * 48-d（F8-4）：评审包——聚合版本历史 + 设计报告 + 校验 + 交付清单（纯逻辑层）
 * - buildReviewPackage：归一化评审包 JSON（四段数据 + 版本历史去重排序）
 * - validateReviewPackage：结构校验（回读/展示守卫）
 * - reviewPackageFileName：评审包 zip 文件名
 */
import { describe, it, expect } from 'vitest'
import {
  REVIEW_PACKAGE_FORMAT,
  REVIEW_PACKAGE_VERSION,
  buildReviewPackage,
  validateReviewPackage,
  reviewPackageFileName,
} from '@/utils/reviewPackage'

const input = {
  projectName: 'H100-100台',
  projectId: 'P1',
  currentVersion: 3,
  versions: [
    { version: 1, planHash: 'h1', generatedAt: '2026-01-01T00:00:00Z' },
    { version: 3, planHash: 'h3', generatedAt: '2026-01-03T00:00:00Z' },
    { version: 2, planHash: 'h2', generatedAt: '2026-01-02T00:00:00Z' },
  ],
  designReport: { summary: 'ok' },
  validation: { valid: true, issues: [] },
  delivery: { batch: 'v3_20260101', manifest: { config_hash: 'x' } },
}

describe('buildReviewPackage（评审包聚合）', () => {
  it('聚合四段数据并按版本号去重排序', () => {
    const pkg = buildReviewPackage(input)
    expect(pkg.format).toBe(REVIEW_PACKAGE_FORMAT)
    expect(pkg.schemaVersion).toBe(REVIEW_PACKAGE_VERSION)
    expect(pkg.exportedAt).toBeTruthy()
    expect(pkg.project).toEqual({ projectName: 'H100-100台', projectId: 'P1' })
    expect(pkg.versionHistory.currentVersion).toBe(3)
    expect(pkg.versionHistory.versions.map((v) => v.version)).toEqual([1, 2, 3])
    expect(pkg.designReport).toEqual({ summary: 'ok' })
    expect(pkg.validation).toEqual({ valid: true, issues: [] })
    expect(pkg.delivery).toEqual({ batch: 'v3_20260101', manifest: { config_hash: 'x' } })
  })

  it('缺省输入回退空段（不抛错）', () => {
    const pkg = buildReviewPackage({})
    expect(pkg.format).toBe(REVIEW_PACKAGE_FORMAT)
    expect(pkg.versionHistory.versions).toEqual([])
    expect(pkg.project).toEqual({})
    expect(pkg.designReport).toBeNull()
  })
})

describe('validateReviewPackage（评审包结构校验）', () => {
  it('合法评审包通过', () => {
    expect(validateReviewPackage(buildReviewPackage(input)).ok).toBe(true)
  })

  it('格式/版本/段缺失 → 失败', () => {
    const pkg = buildReviewPackage(input) as unknown as Record<string, unknown>
    expect(validateReviewPackage(null).ok).toBe(false)
    expect(validateReviewPackage({ ...pkg, format: 'other' }).ok).toBe(false)
    expect(validateReviewPackage({ ...pkg, schemaVersion: 9 }).ok).toBe(false)
    expect(validateReviewPackage({ ...pkg, versionHistory: { versions: 'bad' } }).ok).toBe(false)
    const noHistory = { ...pkg }
    delete noHistory.versionHistory
    expect(validateReviewPackage(noHistory).ok).toBe(false)
  })
})

describe('reviewPackageFileName', () => {
  const d = new Date(2026, 0, 2, 3, 4, 5)
  it('含项目名 + 时间戳', () => {
    expect(reviewPackageFileName('H100-100台', d)).toBe('H100-100台_评审包_20260102-030405.zip')
  })
  it('非法文件名字符替换为下划线', () => {
    expect(reviewPackageFileName('a/b:c', d)).toBe('a_b_c_评审包_20260102-030405.zip')
  })
})
