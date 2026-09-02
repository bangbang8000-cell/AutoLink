/**
 * 4.6.0（F6-4）：质量仪表盘 渲染测试（Q-4）
 *
 * - 覆盖率（后端/前端）展示：readDocFile 注入统一测试报告 → 覆盖率条/门禁徽章渲染
 * - 最近门禁结果 / 测试通过率：报告 modules/gates 渲染
 * - 校验通过率：从 validation.store 本地聚合（问题数 → 通过率）
 * - 性能基准：perf.ts 达标阈值渲染
 * - 手动刷新按钮存在；报告不可用时优雅降级（未检测到）
 */
import '@/i18n'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QualityDashboard } from '@/components/quality/QualityDashboard'
import { useQualityStore, type QualityReport } from '@/stores/quality.store'
import { useValidationStore } from '@/stores/validation.store'

const REPORT: QualityReport = {
  schemaVersion: 1,
  generatedAt: '2026-09-02T10:00:00+0800',
  mode: 'smoke',
  summary: { totalTests: 1200, passed: 1195, failed: 5, skipped: 0, passRate: 99.6 },
  coverage: {
    backend: {
      lines: { pct: 61.2, covered: 980, total: 1600 },
      branches: { pct: 48.0, covered: 240, total: 500 },
    },
    frontend: {
      lines: { pct: 42.8, covered: 2200, total: 5140 },
      statements: { pct: 42.3, covered: 2190, total: 5177 },
      functions: { pct: 38.2, covered: 480, total: 1256 },
      branches: { pct: 34.7, covered: 810, total: 2334 },
    },
  },
  coverageGate: {
    passed: true,
    thresholds: { backend: { lines: 55 }, frontend: { lines: 40 } },
    checks: [
      { scope: 'backend', metric: 'lines', value: 61.2, threshold: 55, baseline: 60, passed: true },
      { scope: 'frontend', metric: 'lines', value: 42.8, threshold: 40, baseline: 42, passed: true },
    ],
  },
  modules: [
    { id: 'backend', name: '后端 pytest', tests: 1213, failures: 0, errors: 0, skipped: 2, passRate: 100, durationMs: 45000 },
    { id: 'frontend', name: '前端 vitest', tests: 1150, failures: 0, errors: 0, skipped: 1, passRate: 100, durationMs: 356000 },
  ],
  gates: [
    { id: 'golden', name: 'golden 基线', passed: true },
    { id: 'bench', name: '性能基准', passed: true },
    { id: 'templates', name: '模板校验', passed: true },
  ],
  validation: { passed: true, detail: '16/16 模板健康' },
}

function mockReadDocFile(report: QualityReport | null) {
  const electron = {
    app: {
      readDocFile: async () => (report ? JSON.stringify(report) : null),
    },
  } as unknown as Window['electron']
  Object.defineProperty(window, 'electron', { value: electron, configurable: true, writable: true })
}

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron
  useQualityStore.getState().reset()
  useValidationStore.getState().reset()
})

describe('QualityDashboard（F6-4 / Q-4）', () => {
  it('Q-4 覆盖率（后端/前端）与门禁徽章渲染', async () => {
    mockReadDocFile(REPORT)
    render(<QualityDashboard />)
    expect(await screen.findByText('质量仪表盘')).toBeInTheDocument()
    expect(screen.getByText('后端 (pytest)')).toBeInTheDocument()
    expect(screen.getByText('前端 (vitest)')).toBeInTheDocument()
    // 后端 lines 61.2% + 门禁达标
    expect(screen.getByText('61.2%')).toBeInTheDocument()
    expect(screen.getAllByText('达标').length).toBeGreaterThanOrEqual(2)
    // 前端 lines 42.8%
    expect(screen.getByText('42.8%')).toBeInTheDocument()
  })

  it('Q-4 测试模块通过率 / 门禁结果 / 门禁汇总渲染', async () => {
    mockReadDocFile(REPORT)
    render(<QualityDashboard />)
    expect(await screen.findByText('后端 pytest')).toBeInTheDocument()
    expect(screen.getByText('前端 vitest')).toBeInTheDocument()
    expect(screen.getByText('门禁 3/3 通过')).toBeInTheDocument()
    expect(screen.getAllByText('通过').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('golden 基线')).toBeInTheDocument()
    // '性能基准' 既是门禁名又是区块标题，可能存在多处
    expect(screen.getAllByText('性能基准').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('模板校验')).toBeInTheDocument()
    // 测试通过率徽章：用例 1195/1200 通过（99.6%）
    expect(screen.getByText('用例 1195/1200 通过（99.6%）')).toBeInTheDocument()
  })

  it('Q-4 校验通过率从 validation.store 本地聚合', async () => {
    mockReadDocFile(REPORT)
    // 模拟一次校验报告：100 项问题中 2 个 error → 通过率 98%
    useValidationStore.setState({
      report: {
        schemaVersion: 1,
        generatedAt: '2026-09-02T10:00:00+0800',
        scope: { projectName: 'demo' },
        summary: {
          valid: false,
          total: 100,
          bySeverity: { error: 2, warning: 10, info: 88 },
          byCategory: {},
        },
        problems: [],
      },
      lastRunAt: '2026-09-02T10:00:00+0800',
    })
    render(<QualityDashboard />)
    expect(await screen.findByText('98%')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('Q-4 性能基准（bench_perf.py 达标阈值）渲染', async () => {
    mockReadDocFile(REPORT)
    render(<QualityDashboard />)
    expect(await screen.findByText('2048 GPU 设计/渲染')).toBeInTheDocument()
    expect(screen.getByText('225 柜机房落位')).toBeInTheDocument()
    expect(screen.getByText('≤ 30.00s')).toBeInTheDocument()
    expect(screen.getByText('≤ 5.00s')).toBeInTheDocument()
  })

  it('Q-4 手动刷新按钮存在；报告不可用时优雅降级', async () => {
    // 无报告：readDocFile 返回 null
    mockReadDocFile(null)
    render(<QualityDashboard />)
    expect(await screen.findByText('质量仪表盘')).toBeInTheDocument()
    expect(screen.getByText('未检测到测试报告')).toBeInTheDocument()
    // 刷新按钮
    expect(screen.getByTitle('刷新')).toBeInTheDocument()
  })
})
