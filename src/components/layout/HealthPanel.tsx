/**
 * 4.7.0（47-c / F7-3）：健康检查/自检面板
 * 主进程健康检查报告（环境 / 引擎 / 网络 / 依赖），可读展示 + 导出 JSON。
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, HeartPulse, Loader2, Play } from 'lucide-react'
import clsx from 'clsx'
import type { HealthReport } from '@/types/ops'
import { useToastStore } from '@/stores/toast.store'

const STATUS_META: Record<string, { dot: string; text: string; row: string }> = {
  ok: { dot: 'bg-success-500', text: 'text-success-600 dark:text-success-400', row: '' },
  warn: {
    dot: 'bg-warning-500',
    text: 'text-warning-600 dark:text-warning-400',
    row: 'bg-warning-50/40 dark:bg-warning-900/10',
  },
  fail: {
    dot: 'bg-error-500',
    text: 'text-error-600 dark:text-error-400',
    row: 'bg-error-50/40 dark:bg-error-900/10',
  },
  skip: { dot: 'bg-gray-300 dark:bg-gray-600', text: 'text-gray-400', row: '' },
}

export function HealthPanel() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [report, setReport] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadFlag, setReloadFlag] = useState(0)

  const run = useCallback(async () => {
    if (!window.electron?.health) return
    setLoading(true)
    try {
      const r = await window.electron.health.run()
      setReport(r)
    } catch {
      /* IPC 不可用时静默 */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void run()
  }, [run, reloadFlag])

  const handleExport = async () => {
    if (!window.electron?.health || !report) return
    try {
      const res = await window.electron.health.export(report)
      if (res?.canceled) return
      addToast('success', t('common:healthPanel.exported', '健康报告已导出'), 3000)
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : String(e), 4000)
    }
  }

  const statusLabel = (s: string): string => {
    switch (s) {
      case 'ok':
        return t('common:healthPanel.ok', '正常')
      case 'warn':
        return t('common:healthPanel.warn', '警告')
      case 'fail':
        return t('common:healthPanel.fail', '异常')
      default:
        return t('common:healthPanel.skip', '跳过')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        <span className="inline-flex items-center gap-1 text-2xs font-medium text-gray-600 dark:text-gray-300">
          <HeartPulse size={12} className="text-primary-600 dark:text-primary-400" />
          {t('common:healthPanel.title', '健康检查')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void handleExport()}
            disabled={!report}
            title={t('common:healthPanel.export', '导出健康报告 JSON')}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-app-hover rounded"
          >
            <FileDown size={12} className="text-gray-500 dark:text-gray-400" />
          </button>
          <button
            onClick={() => setReloadFlag((f) => f + 1)}
            disabled={loading}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            {loading
              ? t('common:healthPanel.running', '自检中…')
              : t('common:healthPanel.run', '运行自检')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-app-surface p-2 space-y-3">
        {!report && !loading && (
          <p className="text-2xs text-gray-400">
            {t('common:healthPanel.empty', '点击「运行自检」检查环境/引擎/网络/依赖')}
          </p>
        )}

        {report && (
          <>
            {/* 环境信息 */}
            <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
              <div className="px-2 py-1.5 bg-gray-100/60 dark:bg-app-hover flex items-center justify-between">
                <span className="text-2xs text-gray-600 dark:text-gray-300">
                  {t('common:healthPanel.env', '环境')}
                </span>
                <span className="text-2xs text-gray-400">
                  {report.env.platform} ({report.env.arch}) · Electron {report.env.electron}
                </span>
              </div>
              <div className="px-2 py-1 text-2xs text-gray-500 dark:text-gray-400 break-all">
                {report.env.userData}
              </div>
            </div>

            {/* 汇总 */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <SummaryPill
                n={report.summary.ok}
                label={t('common:healthPanel.ok', '正常')}
                cls="bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300"
              />
              <SummaryPill
                n={report.summary.warn}
                label={t('common:healthPanel.warn', '警告')}
                cls="bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300"
              />
              <SummaryPill
                n={report.summary.fail}
                label={t('common:healthPanel.fail', '异常')}
                cls="bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300"
              />
              <SummaryPill
                n={report.summary.skip}
                label={t('common:healthPanel.skip', '跳过')}
                cls="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              />
              {report.checkedAt && (
                <span className="ml-auto text-2xs text-gray-400">
                  {report.checkedAt.slice(0, 19).replace('T', ' ')}
                </span>
              )}
            </div>

            {/* 明细 */}
            <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden divide-y divide-gray-100 dark:divide-edge-subtle">
              {report.items.map((item) => {
                const meta = STATUS_META[item.status] ?? STATUS_META.skip
                return (
                  <div
                    key={item.id}
                    className={clsx('px-2 py-1.5 flex items-start gap-2', meta.row)}
                  >
                    <span className={clsx('w-1.5 h-1.5 rounded-full mt-1 shrink-0', meta.dot)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-2xs font-medium text-gray-700 dark:text-gray-200">
                          {item.label}
                        </span>
                        <span className={clsx('text-2xs font-medium', meta.text)}>
                          {statusLabel(item.status)}
                        </span>
                        {item.durationMs != null && (
                          <span className="text-[10px] text-gray-400">{item.durationMs}ms</span>
                        )}
                      </div>
                      {item.detail && (
                        <div className="text-2xs text-gray-500 dark:text-gray-400 break-all mt-0.5">
                          {item.detail}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SummaryPill({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium',
        cls,
      )}
    >
      {label} {n}
    </span>
  )
}
