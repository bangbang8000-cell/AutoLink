/**
 * 4.6.0（F6-4）：质量仪表盘面板（覆盖率 / 门禁 / 测试通过率 / 校验通过率 / 性能基准 一处可查）
 *
 * 本地聚合（quality.store）：统一测试报告（scripts/test_report.py）+ 本地校验 + 性能基准，
 * 手动刷新，不遥测。
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, CheckCircle2, Gauge, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import clsx from 'clsx'
import { useQualityStore, type CoverageMetric } from '@/stores/quality.store'
import { useValidationStore } from '@/stores/validation.store'
import { formatMs } from '@/utils/perf'

const METRIC_LABEL_KEYS: Record<string, string> = {
  lines: 'common:qualityPanel.metrics.lines',
  statements: 'common:qualityPanel.metrics.statements',
  functions: 'common:qualityPanel.metrics.functions',
  branches: 'common:qualityPanel.metrics.branches',
}

function CoverageBar({ label, metric }: { label: string; metric: CoverageMetric | undefined }) {
  if (!metric) return null
  const pct = metric.pct
  const color = pct >= 70 ? 'bg-success-500' : pct >= 50 ? 'bg-warning-500' : 'bg-error-500'
  return (
    <div className="grid grid-cols-[64px_1fr_44px] items-center gap-2 text-2xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <div className="h-1.5 bg-gray-100 dark:bg-app-hover rounded overflow-hidden">
        <div className={clsx('h-full rounded', color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="text-right font-mono tabular-nums text-gray-700 dark:text-gray-200">{pct}%</span>
    </div>
  )
}

function CoverageCard({
  title,
  metrics,
  gatePassed,
}: {
  title: string
  metrics: Record<string, CoverageMetric> | undefined
  gatePassed: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded border border-gray-200 dark:border-edge-subtle p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold text-gray-600 dark:text-gray-300">{title}</span>
        <span
          className={clsx(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium',
            gatePassed
              ? 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300'
              : 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
          )}
        >
          {gatePassed ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
          {gatePassed ? t('common:qualityPanel.coveragePassed') : t('common:qualityPanel.coverageFailed')}
        </span>
      </div>
      {metrics ? (
        <div className="space-y-1">
          {Object.entries(metrics).map(([key, val]) => (
            <CoverageBar key={key} label={t(METRIC_LABEL_KEYS[key] ?? key)} metric={val} />
          ))}
        </div>
      ) : (
        <p className="text-2xs text-gray-400">{t('common:qualityPanel.noCoverageData')}</p>
      )}
    </div>
  )
}

function SectionTitle({
  icon,
  children,
  right,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <span className="flex items-center gap-1.5 text-2xs font-semibold text-gray-600 dark:text-gray-300">
        {icon}
        {children}
      </span>
      {right}
    </div>
  )
}

export function QualityDashboard() {
  const { t } = useTranslation()
  const q = useQualityStore()
  const validationStore = useValidationStore()

  useEffect(() => {
    // 挂载时聚合一次（本地校验 + 性能基准 + 尽力读取报告）
    q.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const gateChecks = q.report?.coverageGate?.checks ?? []
  const backendGate = gateChecks.some((c) => c.scope === 'backend' && !c.passed)
    ? false
    : gateChecks.some((c) => c.scope === 'backend')
  const frontendGate = gateChecks.some((c) => c.scope === 'frontend' && !c.passed)
    ? false
    : gateChecks.some((c) => c.scope === 'frontend')

  const runValidation = () => {
    validationStore.runValidation()
  }

  const reportSummary = q.report?.summary
  const gates = q.report?.gates ?? []
  const passedGates = gates.filter((g) => g.passed).length
  const allGatesPassed = gates.length > 0 && passedGates === gates.length

  return (
    <div className="h-full overflow-auto bg-white dark:bg-app-surface p-2.5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
          <Gauge size={13} className="text-primary-500" />
          {t('common:qualityPanel.title')}
        </span>
        <button
          onClick={() => q.refresh()}
          disabled={q.loading}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover disabled:opacity-50"
          title={t('common:qualityPanel.refresh')}
        >
          <RefreshCw size={10} className={clsx(q.loading && 'animate-spin')} />
          {q.loading ? t('common:qualityPanel.refreshing') : t('common:qualityPanel.refresh')}
        </button>
      </div>

      {q.error && (
        <p className="text-2xs text-error-500 bg-error-50 dark:bg-error-900/10 border border-error-200 dark:border-error-900 rounded px-2 py-1">
          {t('common:qualityPanel.error', { error: q.error })}
        </p>
      )}

      {/* 总览徽章 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {q.report ? (
          <span
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-medium',
              (reportSummary?.failed ?? 0) === 0
                ? 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300'
                : 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
            )}
          >
            {t('common:qualityPanel.testPassRate', {
              passed: reportSummary?.passed ?? 0,
              total: reportSummary?.totalTests ?? 0,
              rate: reportSummary?.passRate ?? 0,
            })}
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded text-2xs bg-gray-100 dark:bg-app-hover text-gray-500">
            {t('common:qualityPanel.noReport')}
          </span>
        )}
        <span
          className={clsx(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-medium',
            allGatesPassed
              ? 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300'
              : 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
          )}
        >
          {allGatesPassed ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
          {t('common:qualityPanel.gateSummary', { passed: passedGates, total: gates.length })}
        </span>
        {q.lastRefreshedAt && (
          <span className="text-[10px] text-gray-400">
            {t('common:qualityPanel.updatedAt', { time: new Date(q.lastRefreshedAt).toLocaleTimeString('zh-CN', { hour12: false }) })}
          </span>
        )}
      </div>

      {!q.report && (
        <p className="text-2xs text-gray-400 border border-dashed border-gray-200 dark:border-edge-subtle rounded px-2 py-1.5">
          {t('common:qualityPanel.noReportHint')}
        </p>
      )}

      {/* 覆盖率 */}
      <section>
        <SectionTitle icon={<Activity size={12} className="text-gray-400" />}>
          {t('common:qualityPanel.coverage')}
        </SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <CoverageCard
            title={t('common:qualityPanel.backend')}
            metrics={q.report?.coverage.backend}
            gatePassed={backendGate}
          />
          <CoverageCard
            title={t('common:qualityPanel.frontend')}
            metrics={q.report?.coverage.frontend}
            gatePassed={frontendGate}
          />
        </div>
        {gateChecks.length > 0 && (
          <div className="mt-1 text-[10px] text-gray-400 space-y-0.5">
            {gateChecks.map((c) => (
              <div key={`${c.scope}-${c.metric}`} className="flex items-center gap-1">
                <span className={c.passed ? 'text-success-500' : 'text-error-500'}>
                  {c.passed ? '✓' : '✗'}
                </span>
                <span>
                  {c.scope}.{c.metric} = {c.value}%（阈值 {c.threshold}）
                  {c.baseline != null ? ` / 基线 ${c.baseline}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 测试模块 */}
      <section>
        <SectionTitle icon={<Gauge size={12} className="text-gray-400" />}>
          {t('common:qualityPanel.modules')}
        </SectionTitle>
        {(q.report?.modules?.length ?? 0) > 0 ? (
          <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
            <table className="w-full text-2xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-app-hover text-gray-500 dark:text-gray-400">
                  <th className="text-left font-medium px-1.5 py-1">{t('common:qualityPanel.module')}</th>
                  <th className="text-right font-medium px-1.5 py-1">{t('common:qualityPanel.tests')}</th>
                  <th className="text-right font-medium px-1.5 py-1">{t('common:qualityPanel.failures')}</th>
                  <th className="text-right font-medium px-1.5 py-1">{t('common:qualityPanel.passRate')}</th>
                  <th className="text-right font-medium px-1.5 py-1">{t('common:qualityPanel.duration')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-edge-subtle">
                {(q.report?.modules ?? []).map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-app-hover">
                    <td className="px-1.5 py-0.5 text-gray-600 dark:text-gray-300">{m.name}</td>
                    <td className="px-1.5 py-0.5 text-right font-mono tabular-nums text-gray-700 dark:text-gray-200">{m.tests}</td>
                    <td className="px-1.5 py-0.5 text-right font-mono tabular-nums text-gray-700 dark:text-gray-200">{m.failures + m.errors}</td>
                    <td
                      className={clsx(
                        'px-1.5 py-0.5 text-right font-mono tabular-nums',
                        m.passRate >= 100 ? 'text-success-600 dark:text-success-400' : 'text-error-500',
                      )}
                    >
                      {m.passRate}%
                    </td>
                    <td className="px-1.5 py-0.5 text-right font-mono tabular-nums text-gray-700 dark:text-gray-200">
                      {formatMs(m.durationMs ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-2xs text-gray-400">{t('common:qualityPanel.noData')}</p>
        )}
      </section>

      {/* 门禁 */}
      <section>
        <SectionTitle icon={<ShieldCheck size={12} className="text-gray-400" />}>
          {t('common:qualityPanel.gates')}
        </SectionTitle>
        {(q.report?.gates?.length ?? 0) > 0 ? (
          <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
            <table className="w-full text-2xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-app-hover text-gray-500 dark:text-gray-400">
                  <th className="text-left font-medium px-1.5 py-1">{t('common:qualityPanel.gate')}</th>
                  <th className="text-right font-medium px-1.5 py-1">{t('common:qualityPanel.result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-edge-subtle">
                {(q.report?.gates ?? []).map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50 dark:hover:bg-app-hover">
                    <td className="px-1.5 py-0.5 text-gray-600 dark:text-gray-300">{g.name}</td>
                    <td
                      className={clsx(
                        'px-1.5 py-0.5 text-right font-medium',
                        g.passed ? 'text-success-600 dark:text-success-400' : 'text-error-500',
                      )}
                    >
                      {g.passed ? t('common:qualityPanel.gatePassed') : t('common:qualityPanel.gateFailed')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-2xs text-gray-400">{t('common:qualityPanel.noData')}</p>
        )}
      </section>

      {/* 数据校验 */}
      <section>
        <SectionTitle
          icon={<ShieldCheck size={12} className="text-gray-400" />}
          right={
            <button
              onClick={runValidation}
              disabled={validationStore.running}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover disabled:opacity-50"
            >
              {validationStore.running ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              {t('common:qualityPanel.runValidation')}
            </button>
          }
        >
          {t('common:qualityPanel.validation')}
        </SectionTitle>
        {q.validationPassRate != null ? (
          <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-gray-200 dark:divide-edge-subtle text-center">
              <div className="px-1.5 py-1">
                <div
                  className={clsx(
                    'text-xs font-mono tabular-nums',
                    q.validationPassRate >= 100 ? 'text-success-600 dark:text-success-400' : 'text-error-500',
                  )}
                >
                  {q.validationPassRate}%
                </div>
                <div className="text-[10px] text-gray-400">{t('common:qualityPanel.validationPassRate')}</div>
              </div>
              <div className="px-1.5 py-1">
                <div className="text-xs font-mono tabular-nums text-gray-700 dark:text-gray-200">
                  {q.validationIssueCount ?? '—'}
                </div>
                <div className="text-[10px] text-gray-400">{t('common:qualityPanel.validationIssues')}</div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-2xs text-gray-400">{t('common:qualityPanel.validationNeverRun')}</p>
        )}
      </section>

      {/* 性能基准 */}
      <section>
        <SectionTitle icon={<Activity size={12} className="text-gray-400" />}>
          {t('common:qualityPanel.benchmark')}
        </SectionTitle>
        <p className="text-[10px] text-gray-400 mb-1">{t('common:qualityPanel.benchmarkSource')}</p>
        <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
          <table className="w-full text-2xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-app-hover text-gray-500 dark:text-gray-400">
                <th className="text-left font-medium px-1.5 py-1">{t('common:qualityPanel.module')}</th>
                <th className="text-right font-medium px-1.5 py-1">{t('common:qualityPanel.benchmarkThreshold')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-edge-subtle">
              {q.benchmark.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-app-hover">
                  <td className="px-1.5 py-0.5 text-gray-600 dark:text-gray-300">{b.label}</td>
                  <td className="px-1.5 py-0.5 text-right font-mono tabular-nums text-gray-700 dark:text-gray-200">
                    ≤ {formatMs(b.thresholdMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
