/**
 * 4.5 数据准确性与校验体系（AL 4.5.0，F5-5 校验面板）
 *
 * 一键校验当前项目（T1 一致性 / T2 导出核对 / T3 IP 规划）：
 *  - 汇总（通过/问题数/按严重度与类别分组）
 *  - 问题列表（按严重度/类别分组，含字段定位与建议）
 *  - 导出校验报告 JSON（落盘到项目 output/）
 */
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, CheckCircle2, FileDown, Info, Loader2, Play, RefreshCw, ShieldCheck, XCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { useValidationStore } from '@/stores/validation.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import {
  SEVERITY_ORDER,
  reportToJson,
  type ValidationProblem,
  type ValidationReport,
} from '@/utils/validationReport'

const SEVERITY_META: Record<string, { icon: typeof XCircle; label: string; row: string; badge: string }> = {
  error: {
    icon: XCircle,
    label: '错误',
    row: 'border-l-error-500 bg-error-50/60 dark:bg-error-900/10',
    badge: 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
  },
  warning: {
    icon: AlertTriangle,
    label: '警告',
    row: 'border-l-amber-500 bg-amber-50/60 dark:bg-amber-900/10',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  info: {
    icon: Info,
    label: '提示',
    row: 'border-l-sky-500 bg-sky-50/60 dark:bg-sky-900/10',
    badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  },
}

function SummaryBadge({ report }: { report: ValidationReport }) {
  const { t } = useTranslation()
  const s = report.summary
  return (
    <div className="flex items-center gap-2">
      <span
        className={clsx(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium',
          s.valid
            ? 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300'
            : 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
        )}
      >
        {s.valid ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
        {s.valid ? t('common:logPanel.tabs.validation', '校验通过') : t('common:logPanel.tabs.validationFailed', '校验未通过')}
      </span>
      <span className="text-2xs text-gray-500 dark:text-gray-400">
        {t('common:logPanel.tabs.total', '问题')} {s.total} · error {s.bySeverity.error} · warning{' '}
        {s.bySeverity.warning} · info {s.bySeverity.info}
      </span>
    </div>
  )
}

function ProblemRow({ p }: { p: ValidationProblem }) {
  const meta = SEVERITY_META[p.severity] ?? SEVERITY_META.info
  const Icon = meta.icon
  return (
    <div className={clsx('px-2 py-1 border-l-2', meta.row)}>
      <div className="flex items-start gap-1.5">
        <Icon size={12} className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={clsx('px-1 rounded text-[10px] font-medium', meta.badge)}>{meta.label}</span>
            <span className="text-2xs font-mono text-gray-500 dark:text-gray-400">{p.ruleId}</span>
            <span className="text-2xs text-gray-500 dark:text-gray-400">{p.category}</span>
            <span className="text-2xs text-gray-400 dark:text-gray-500 truncate">{p.location}</span>
          </div>
          <div className="text-2xs text-gray-700 dark:text-gray-200 mt-0.5">{p.message}</div>
          <div className="text-2xs text-gray-500 dark:text-gray-400 mt-0.5">建议：{p.suggestion}</div>
        </div>
      </div>
    </div>
  )
}

export function ValidationReportPanel() {
  const { t } = useTranslation()
  const report = useValidationStore((s) => s.report)
  const running = useValidationStore((s) => s.running)
  const error = useValidationStore((s) => s.error)
  const lastRunAt = useValidationStore((s) => s.lastRunAt)

  const handleRun = () => {
    void useValidationStore.getState().runValidation()
  }

  const handleExport = async () => {
    const r = useValidationStore.getState().report
    const projectName = useProjectStore.getState().selectedProjectName
    if (!r || !projectName) return
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      await window.electron.project.saveFile(projectName, `output/validation_report_${ts}.json`, reportToJson(r))
      useToastStore.getState().addToast('success', t('common:logPanel.tabs.exported', '校验报告已导出'), 3000)
    } catch (e) {
      useToastStore.getState().addToast('error', e instanceof Error ? e.message : String(e), 4000)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        <span className="inline-flex items-center gap-1 text-2xs font-medium text-gray-600 dark:text-gray-300">
          <ShieldCheck size={12} className="text-primary-600 dark:text-primary-400" />
          {t('common:logPanel.tabs.validation', '数据校验')}
        </span>
        <div className="flex items-center gap-1">
          {report && (
            <button
              onClick={() => void handleExport()}
              disabled={!report}
              title={t('common:logPanel.tabs.exportReport', '导出校验报告 JSON')}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-app-hover rounded"
            >
              <FileDown size={12} className="text-gray-500 dark:text-gray-400" />
            </button>
          )}
          <button
            onClick={handleRun}
            disabled={running}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            {running ? t('common:logPanel.tabs.running', '校验中…') : t('common:logPanel.tabs.run', '一键校验')}
          </button>
          {report && (
            <button
              onClick={() => useValidationStore.getState().reset()}
              title={t('common:logPanel.tabs.clear', '清空')}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-app-hover rounded"
            >
              <RefreshCw size={11} className="text-gray-500 dark:text-gray-400" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-app-surface">
        {error && <div className="px-2 py-1 text-2xs text-error-600 dark:text-error-300">{error}</div>}

        {!report && !running && (
          <div className="p-3 text-2xs text-gray-500 dark:text-gray-400">
            {t('common:logPanel.tabs.validationHint', '点击「一键校验」核对当前项目：规划↔设计一致性、导出数据、IP 规划')}
          </div>
        )}

        {report && (
          <div className="px-2 py-1.5 flex items-center justify-between border-b border-gray-200 dark:border-edge-subtle">
            <SummaryBadge report={report} />
            {lastRunAt && (
              <span className="text-2xs text-gray-400 dark:text-gray-500">
                {lastRunAt.slice(0, 19).replace('T', ' ')}
              </span>
            )}
          </div>
        )}

        {report && report.summary.byCategory && (
          <div className="px-2 py-1 border-b border-gray-200 dark:border-edge-subtle flex flex-wrap gap-1">
            {Object.entries(report.summary.byCategory).map(([cat, n]) => (
              <span key={cat} className="px-1 rounded text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {cat} {n}
              </span>
            ))}
          </div>
        )}

        {report &&
          report.problems.map((p, i) => (
            <ProblemRow key={`${p.ruleId}-${i}`} p={p} />
          ))}
        {report && report.problems.length === 0 && (
          <div className="px-2 py-2 text-2xs text-success-600 dark:text-success-300">
            {t('common:logPanel.tabs.noProblem', '未发现问题，数据链（规划→设计→渲染）一致')}
          </div>
        )}
      </div>
    </div>
  )
}

export const problemSeverityOrder = SEVERITY_ORDER
