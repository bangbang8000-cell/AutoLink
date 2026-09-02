/**
 * 4.6.0（F6-4）：质量仪表盘 store —— 本地聚合质量信号（不遥测）
 *
 * - 覆盖率 / 门禁 / 测试通过率：来自统一测试报告
 *   （scripts/test_report.py 聚合 pytest/vitest/golden/bench/模板校验 → 报告镜像 quality_report.json，
 *    渲染层经受限 IPC app.readDocFile 尽力读取，不可用时优雅降级）
 * - 校验通过率：来自 validation.store（本地一键校验结果，始终可用）
 * - 性能基准：来自 utils/perf（bench_perf.py 达标阈值参考，始终可用）
 *
 * 手动刷新：refresh() 重新聚合 + 重新读取报告。
 */
import { create } from 'zustand'
import { useValidationStore } from '@/stores/validation.store'
import { getBenchmarkReference, type BenchReference } from '@/utils/perf'

export interface CoverageMetric {
  pct: number
  covered: number
  total: number
}

export interface QualityGate {
  id: string
  name: string
  passed: boolean
  durationMs?: number
  output?: string
}

export interface QualityModule {
  id: string
  name: string
  tests: number
  failures: number
  errors: number
  skipped: number
  passRate: number
  durationMs?: number
  source?: string
  missing?: boolean
}

export interface QualityReport {
  schemaVersion: number
  generatedAt: string
  mode: string
  summary: {
    totalTests: number
    passed: number
    failed: number
    skipped: number
    passRate: number
  }
  coverage: {
    backend?: Record<string, CoverageMetric>
    frontend?: Record<string, CoverageMetric>
  }
  coverageGate?: {
    passed: boolean
    thresholds?: Record<string, Record<string, number>>
    checks?: Array<{
      scope: string
      metric: string
      value: number | null
      threshold: number
      baseline: number | null
      passed: boolean
      reason?: string
    }>
  }
  modules?: QualityModule[]
  gates?: QualityGate[]
  validation?: { passed?: boolean; detail?: string }
}

interface QualityState {
  report: QualityReport | null
  reportAvailable: boolean
  validationPassRate: number | null
  validationIssueCount: number | null
  validationLastRunAt: string | null
  benchmark: BenchReference[]
  loading: boolean
  error: string | null
  lastRefreshedAt: string | null
  refresh: () => Promise<void>
  /** 注入统一测试报告（测试/调试用） */
  setReport: (report: QualityReport | null) => void
  reset: () => void
}

/** 渲染层受限读文件：统一测试报告镜像（dev：docs/user_guide/；prod：resourcesPath/docs/） */
async function loadReport(): Promise<QualityReport | null> {
  try {
    const raw = await window.electron?.app?.readDocFile?.('quality_report.json')
    if (raw) return JSON.parse(raw) as QualityReport
  } catch {
    // 报告缺失/损坏 → 返回 null（仪表盘显示未检测到）
  }
  return null
}

function computeValidation(now?: string): {
  passRate: number | null
  issueCount: number | null
  lastRunAt: string | null
} {
  const report = useValidationStore.getState().report
  if (!report) return { passRate: null, issueCount: null, lastRunAt: now ?? null }
  const total = report.summary.total
  if (total === 0) return { passRate: 100, issueCount: 0, lastRunAt: now ?? report.generatedAt }
  const errors = report.summary.bySeverity.error ?? 0
  const passRate = Math.max(0, Math.round(((total - errors) / total) * 100))
  return { passRate, issueCount: total, lastRunAt: now ?? report.generatedAt }
}

export const useQualityStore = create<QualityState>()((set) => ({
  report: null,
  reportAvailable: false,
  validationPassRate: null,
  validationIssueCount: null,
  validationLastRunAt: null,
  benchmark: [],
  loading: false,
  error: null,
  lastRefreshedAt: null,

  refresh: async () => {
    set({ loading: true, error: null })
    const now = new Date().toISOString()
    const v = computeValidation(now)
    const benchmark = getBenchmarkReference()
    try {
      const report = await loadReport()
      set({
        report,
        reportAvailable: report !== null,
        validationPassRate: v.passRate,
        validationIssueCount: v.issueCount,
        validationLastRunAt: v.lastRunAt,
        benchmark,
        loading: false,
        lastRefreshedAt: now,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      set({
        loading: false,
        error: message,
        validationPassRate: v.passRate,
        validationIssueCount: v.issueCount,
        validationLastRunAt: v.lastRunAt,
        benchmark,
        lastRefreshedAt: now,
      })
    }
  },

  setReport: (report) =>
    set({ report, reportAvailable: report !== null, lastRefreshedAt: new Date().toISOString() }),

  reset: () =>
    set({
      report: null,
      reportAvailable: false,
      validationPassRate: null,
      validationIssueCount: null,
      validationLastRunAt: null,
      benchmark: [],
      loading: false,
      error: null,
      lastRefreshedAt: null,
    }),
}))
