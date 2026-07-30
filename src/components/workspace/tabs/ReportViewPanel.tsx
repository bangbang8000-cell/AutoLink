import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileText, ChevronDown, ChevronRight, RefreshCw, Loader2,
  Server, Network, Zap, Cable, DollarSign, CheckCircle, XCircle,
  Download,
} from 'lucide-react'
import { useToastStore } from '@/stores/toast.store'
import { useProjectStore } from '@/stores/project.store'

interface Props {
  projectName: string
}

interface ReportData {
  overview: Record<string, unknown>
  architecture: Record<string, unknown>
  power: Record<string, unknown>
  validation: { valid: boolean; issues?: unknown[]; [k: string]: unknown }
  modules: Record<string, { count: number; price: string; spec: string }>
  cost: Record<string, unknown>
  generated_at: string
  error?: string
}

export function ReportViewPanel({ projectName }: Props) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ReportData | null>(null)

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!window.electron?.design?.report) {
        throw new Error('IPC 桥接未就绪')
      }
      const result = (await window.electron.design.report(projectName)) as ReportData
      setData(result)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectName])

  // V2.4.6: 导出 PDF 报告
  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true)
    try {
      if (!window.electron?.render?.exportConnections) {
        throw new Error('IPC 桥接未就绪')
      }
      addToast('info', t('design:exportingPdf', '正在生成 PDF 报告...'))
      await window.electron.render.exportConnections(projectName, ['pdfReport'])
      addToast('success', t('design:pdfExported', 'PDF 报告已导出到项目 output 目录'))
      useProjectStore.getState().fetchProjects()
    } catch (err) {
      addToast('error', `${t('design:pdfExportFailed', 'PDF 导出失败')}: ${(err as Error).message}`)
    } finally {
      setExportingPdf(false)
    }
  }, [projectName, addToast, t])

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next && !data && !loading) {
      loadReport()
    }
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header (clickable) */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FileText size={14} className="text-primary-500" />
        {t('design:reportView')}
        {data?.generated_at && (
          <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">
            {data.generated_at}
          </span>
        )}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {/* Action bar */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 dark:text-gray-500">{projectName}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportPdf}
                disabled={exportingPdf}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 text-primary-600 dark:text-primary-400 disabled:opacity-50"
              >
                {exportingPdf ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                {t('design:exportPdf', '导出 PDF')}
              </button>
              <button
                onClick={loadReport}
                disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {t('design:reEstimate')}
              </button>
            </div>
          </div>

          {loading && !data && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-primary-500" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
              <XCircle size={13} className="shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          {data && !data.error && (
            <>
              {/* 概览 */}
              <Section icon={<Server size={12} />} title={t('design:designSummary')}>
                <KvGrid data={data.overview} />
              </Section>

              {/* 网络架构 */}
              <Section icon={<Network size={12} />} title={t('design:switchConfig')}>
                <KvGrid data={data.architecture} />
              </Section>

              {/* 功耗 */}
              <Section icon={<Zap size={12} />} title={t('design:itPower')}>
                <KvGrid data={data.power} />
              </Section>

              {/* 光模块汇总 */}
              <Section icon={<Cable size={12} />} title={t('workbench:cablingGuide')}>
                {Object.keys(data.modules).length === 0 ? (
                  <Empty />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                          <th className="py-1.5 pr-3">型号</th>
                          <th className="py-1.5 pr-3">数量</th>
                          <th className="py-1.5 pr-3">规格</th>
                          <th className="py-1.5">价位</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(data.modules).map(([id, m]) => (
                          <tr key={id} className="border-b border-gray-50 dark:border-gray-700/50">
                            <td className="py-1.5 pr-3 font-medium text-gray-700 dark:text-gray-300">{id}</td>
                            <td className="py-1.5 pr-3 tabular-nums">{m.count}</td>
                            <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">{m.spec || '-'}</td>
                            <td className="py-1.5 text-gray-500 dark:text-gray-400">{m.price || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              {/* 成本估算 */}
              <Section icon={<DollarSign size={12} />} title={t('workbench:bom')}>
                <KvGrid data={data.cost} />
              </Section>

              {/* 校验结果 */}
              <Section icon={data.validation?.valid ? <CheckCircle size={12} /> : <XCircle size={12} />} title={t('design:validate')}>
                <div className={`text-xs px-2 py-1.5 rounded ${data.validation?.valid ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
                  {data.validation?.valid ? t('design:validationPassed') : t('design:validationFailed')}
                </div>
                {Array.isArray(data.validation?.issues) && data.validation.issues.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400 list-disc list-inside">
                    {(data.validation.issues as Array<{ message?: string; rule_id?: string }>).slice(0, 5).map((iss, i) => (
                      <li key={i}>{iss.message || iss.rule_id || JSON.stringify(iss)}</li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded p-3">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function KvGrid({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data || {})
  if (entries.length === 0) return <Empty />
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">{k}</span>
          <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">{formatVal(v)}</span>
        </div>
      ))}
    </div>
  )
}

function Empty() {
  return <div className="text-xs text-gray-400 dark:text-gray-500 py-2">—</div>
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  return String(v)
}

export default ReportViewPanel
