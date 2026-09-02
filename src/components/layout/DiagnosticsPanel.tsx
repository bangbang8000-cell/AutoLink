/**
 * 4.7.0（47-b / F7-2）：诊断中心面板
 * 聚合主进程日志 / 审计 / 崩溃 / 系统信息 + 渲染层性能快照（perf.ts）一处可查，
 * 一键导出诊断支持包（zip，保存对话框由主进程弹出）。
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Archive,
  ClipboardList,
  Cpu,
  Database,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import clsx from 'clsx'
import type { DiagnosticsReport } from '@/types/ops'
import { useToastStore } from '@/stores/toast.store'
import {
  getOps,
  getMemoryInfo,
  getRenderMetrics,
  getBenchmarkReference,
  formatMB,
} from '@/utils/perf'

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

/** 诊断报告性能快照（渲染层 perf.ts 数据，随支持包一并导出） */
interface PerfSnapshot {
  collectedAt: string
  memory: ReturnType<typeof getMemoryInfo>
  ops: ReturnType<typeof getOps>
  renderMetrics: ReturnType<typeof getRenderMetrics>
  benchmarkReference: ReturnType<typeof getBenchmarkReference>
}

function buildPerfSnapshot(): PerfSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    memory: getMemoryInfo(),
    ops: getOps().slice(-50),
    renderMetrics: getRenderMetrics(),
    benchmarkReference: getBenchmarkReference(),
  }
}

export function DiagnosticsPanel() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [reloadFlag, setReloadFlag] = useState(0)

  const load = useCallback(async () => {
    if (!window.electron?.diag) return
    setLoading(true)
    try {
      const r = await window.electron.diag.collect(200)
      setReport(r)
    } catch {
      /* IPC 不可用时静默 */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadFlag])

  const handleExport = async () => {
    if (!window.electron?.diag || !report) return
    setExporting(true)
    try {
      const res = await window.electron.diag.exportBundle(buildPerfSnapshot())
      if (res?.canceled) return
      addToast('success', t('common:diagnosticsPanel.exported', '诊断支持包已导出'), 3000)
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : String(e), 4000)
    } finally {
      setExporting(false)
    }
  }

  const perf = buildPerfSnapshot()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        <span className="inline-flex items-center gap-1 text-2xs font-medium text-gray-600 dark:text-gray-300">
          <ShieldAlert size={12} className="text-primary-600 dark:text-primary-400" />
          {t('common:diagnosticsPanel.title', '诊断中心')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void handleExport()}
            disabled={!report || exporting}
            title={t('common:diagnosticsPanel.exportBundle', '导出诊断支持包')}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            <Archive size={11} className={exporting ? 'animate-pulse' : ''} />
            {t('common:diagnosticsPanel.exportBundle', '导出支持包')}
          </button>
          <button
            onClick={() => setReloadFlag((f) => f + 1)}
            disabled={loading}
            title={t('common:diagnosticsPanel.refresh', '刷新')}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-app-hover rounded"
          >
            <RefreshCw
              size={12}
              className={clsx('text-gray-500 dark:text-gray-400', loading && 'animate-spin')}
            />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-app-surface p-2 space-y-3">
        {!report && !loading && (
          <p className="text-2xs text-gray-400">
            {t('common:diagnosticsPanel.empty', '暂无诊断数据')}
          </p>
        )}

        {/* 系统信息 */}
        {report && (
          <section>
            <SectionTitle icon={<Cpu size={12} className="text-gray-400" />}>
              {t('common:diagnosticsPanel.system.title', '系统信息')}
            </SectionTitle>
            <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
              <table className="w-full text-2xs">
                <tbody className="divide-y divide-gray-100 dark:divide-edge-subtle">
                  <InfoRow
                    k={t('common:diagnosticsPanel.system.appVersion', '应用版本')}
                    v={report.system.appVersion}
                  />
                  <InfoRow
                    k={t('common:diagnosticsPanel.system.os', '操作系统')}
                    v={`${report.system.platformLabel} (${report.system.arch})`}
                  />
                  <InfoRow
                    k={t('common:diagnosticsPanel.system.runtime', '运行时')}
                    v={`Electron ${report.system.electron} · Node ${report.system.node} · Chromium ${report.system.chromium}`}
                  />
                  <InfoRow
                    k={t('common:diagnosticsPanel.system.memory', '内存')}
                    v={`${formatMB(report.system.totalMemMB)} 总量 / ${formatMB(report.system.freeMemMB)} 可用`}
                  />
                  <InfoRow
                    k={t('common:diagnosticsPanel.system.disk', 'userData 磁盘')}
                    v={
                      report.system.freeDiskMB != null
                        ? `${report.system.freeDiskMB} MB 可用`
                        : t('common:diagnosticsPanel.system.diskUnavailable', '不可用')
                    }
                  />
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 错误日志 + 崩溃 */}
        {report && (
          <section>
            <SectionTitle
              icon={<Activity size={12} className="text-gray-400" />}
              right={
                report.crashes.dumpFiles.length > 0 || report.errorsLog.entries.length > 0 ? (
                  <span className="text-[10px] text-warning-500">
                    {t('common:diagnosticsPanel.crash.hasIssue', '存在崩溃/错误记录')}
                  </span>
                ) : undefined
              }
            >
              {t('common:diagnosticsPanel.crash.title', '错误与崩溃')}
            </SectionTitle>
            <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
              <div className="px-2 py-1.5 bg-gray-100/60 dark:bg-app-hover flex items-center justify-between">
                <span className="text-2xs text-gray-600 dark:text-gray-300">
                  {t('common:diagnosticsPanel.crash.errorsLog', '主进程错误日志')}（
                  {report.errorsLog.entries.length}）
                </span>
                <span className="text-2xs text-gray-400">
                  {t('common:diagnosticsPanel.crash.dumps', 'Crashpad dump')}:{' '}
                  {report.crashes.dumpFiles.length} ·{' '}
                  {t('common:diagnosticsPanel.crash.renderer', '渲染崩溃')}:{' '}
                  {report.crashes.rendererGoneCount}
                </span>
              </div>
              {report.errorsLog.entries.length === 0 ? (
                <div className="px-2 py-2 text-2xs text-success-600 dark:text-success-300">
                  {t('common:diagnosticsPanel.crash.noError', '无错误日志')}
                </div>
              ) : (
                <div className="max-h-32 overflow-y-auto bg-gray-900 text-gray-200 font-mono text-2xs leading-relaxed">
                  {report.errorsLog.entries.slice(-8).map((l, i) => (
                    <div key={i} className="px-2 py-0.5 truncate">
                      {l}
                    </div>
                  ))}
                </div>
              )}
              {report.crashes.dumpFiles.length > 0 && (
                <div className="px-2 py-1 border-t border-gray-100 dark:border-edge-subtle text-2xs text-gray-400 break-all">
                  {report.crashes.dumpFiles.map((f) => (
                    <div key={f}>• {f}</div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* 审计 */}
        {report && (
          <section>
            <SectionTitle icon={<ClipboardList size={12} className="text-gray-400" />}>
              {t('common:diagnosticsPanel.audit.title', '命令审计')}（{report.audit.entries.length}
              ）
            </SectionTitle>
            {report.audit.entries.length === 0 ? (
              <p className="text-2xs text-gray-400">
                {t('common:diagnosticsPanel.audit.empty', '暂无审计记录')}
              </p>
            ) : (
              <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden max-h-32 overflow-y-auto divide-y divide-gray-100 dark:divide-edge-subtle">
                {report.audit.entries
                  .slice(-8)
                  .reverse()
                  .map((e, i) => (
                    <div key={i} className="px-2 py-1 text-2xs flex items-start gap-1.5">
                      <span className={e.ok !== false ? 'text-success-500' : 'text-danger-500'}>
                        {e.ok !== false ? '✓' : '✗'}
                      </span>
                      <code className="text-gray-600 dark:text-gray-300">
                        {String(e.action ?? '')}
                      </code>
                      <span className="text-gray-400 ml-auto">
                        {String(e.ts ?? '').slice(11, 19)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </section>
        )}

        {/* 性能快照 */}
        <section>
          <SectionTitle
            icon={<Database size={12} className="text-gray-400" />}
            right={
              <span className="text-[10px] text-gray-400">
                {t('common:diagnosticsPanel.perf.hint', '随支持包导出')}
              </span>
            }
          >
            {t('common:diagnosticsPanel.perf.title', '性能快照')}
          </SectionTitle>
          <div className="grid grid-cols-3 gap-1">
            <PerfStat
              label={t('common:diagnosticsPanel.perf.ops', '操作记录')}
              value={String(perf.ops.length)}
            />
            <PerfStat
              label={t('common:diagnosticsPanel.perf.render', '渲染长任务')}
              value={String(perf.renderMetrics.count)}
            />
            <PerfStat
              label={t('common:diagnosticsPanel.perf.jsHeap', 'JS 堆')}
              value={perf.memory.available ? formatMB(perf.memory.usedJsHeapMB) : '—'}
            />
          </div>
        </section>
      </div>
    </div>
  )
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td className="px-2 py-1 text-gray-500 dark:text-gray-400 w-32 whitespace-nowrap">{k}</td>
      <td className="px-2 py-1 text-gray-700 dark:text-gray-200 break-all">{v}</td>
    </tr>
  )
}

function PerfStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-1.5 text-center rounded border border-gray-200 dark:border-edge-subtle">
      <div className="text-xs font-mono tabular-nums text-gray-800 dark:text-gray-100">{value}</div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  )
}
