import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileText, ChevronDown, ChevronRight, RefreshCw, Loader2,
  Server, Network, Zap, Cable, DollarSign, CheckCircle, XCircle,
  Download, AlertTriangle,
} from 'lucide-react'
import { useToastStore } from '@/stores/toast.store'
import { useProjectStore } from '@/stores/project.store'

interface Props {
  projectName: string
}

/** V5.2.5-525-f5：未匹配明细的聚合条目（后端 `module_selection.未匹配明细` 元素） */
interface ModuleSelectionDetail {
  '网络类型'?: string
  '速率'?: string
  '线缆类型'?: string
  '原因'?: string
  '条数'?: number
  '样例'?: string
}

/**
 * V5.2.5-525-f5（AL-F5）：光模块选型台账。
 *
 * ⚠️ 该段为**可选**：`generate_report_data` 自 v5.2.5 起才输出，接旧后端时不存在，
 * 因此字段全部可选、段缺失时不渲染任何内容（不得抛错）。
 */
interface ModuleSelection {
  '匹配链路数'?: number
  '无需光模块链路数'?: number
  '未匹配链路数'?: number
  '链路总数'?: number
  '未匹配明细'?: ModuleSelectionDetail[]
  '未匹配明细截断数'?: number
  '提示'?: string
}

interface ReportData {
  overview: Record<string, unknown>
  architecture: Record<string, unknown>
  power: Record<string, unknown>
  validation: { valid: boolean; issues?: unknown[]; [k: string]: unknown }
  modules: Record<string, { count: number; price: string; spec: string }>
  /** V5.2.5-525-f5：选型三态台账（可选段，见 ModuleSelection 注释） */
  module_selection?: ModuleSelection
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
    <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
      {/* Header (clickable) */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-app/50 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FileText size={14} className="text-primary-500" />
        {t('design:reportView')}
        {data?.generated_at && (
          <span className="ml-auto text-2xs text-gray-400 dark:text-gray-500">
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
                className="flex items-center gap-1.5 px-2.5 py-1 text-2xs rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 text-primary-600 dark:text-primary-400 disabled:opacity-50"
              >
                {exportingPdf ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                {t('design:exportPdf', '导出 PDF')}
              </button>
              <button
                onClick={loadReport}
                disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-1 text-2xs rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-500 dark:text-gray-400 disabled:opacity-50"
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
            <div className="flex items-start gap-2 p-3 rounded text-xs bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-300">
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
                        <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-edge-subtle">
                          <th className="py-1.5 pr-3">型号</th>
                          <th className="py-1.5 pr-3">数量</th>
                          <th className="py-1.5 pr-3">规格</th>
                          <th className="py-1.5">价位</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(data.modules).map(([id, m]) => (
                          <tr key={id} className="border-b border-gray-50 dark:border-edge-subtle/50">
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

              {/* 选型台账（V5.2.5-525-f5：未匹配链路必须显式可见） */}
              <ModuleSelectionSection data={data.module_selection} />

              {/* 成本估算 */}
              <Section icon={<DollarSign size={12} />} title={t('workbench:bom')}>
                <KvGrid data={data.cost} />
              </Section>

              {/* 校验结果 */}
              <Section icon={data.validation?.valid ? <CheckCircle size={12} /> : <XCircle size={12} />} title={t('design:validate')}>
                <div className={`text-xs px-2 py-1.5 rounded ${data.validation?.valid ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300' : 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-300'}`}>
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

/**
 * V5.2.5-525-f5（AL-F5）：光模块选型台账。
 *
 * 三分类（已匹配 / 无需光模块 / 未匹配）由后端 `module_selection` 给出，三者之和恒等于
 * 去重后的链路总数（后端有不变量测试守住）。此处的职责只有两个：
 *   1. 让「无需光模块」（双绞线链路，正常）与「未匹配」（库内缺档，是缺口）**可区分**；
 *   2. 未匹配 > 0 时**显式警示**——这些链路未计入光模块统计与成本估算，静默会让下游把
 *      不完整的 BOM 当完整的用（PRD §3.5）。
 *
 * 段缺失（旧后端）或链路总数为 0 时不渲染任何内容。
 */
function ModuleSelectionSection({ data }: { data?: ModuleSelection }) {
  const matched = data?.['匹配链路数'] ?? 0
  const notApplicable = data?.['无需光模块链路数'] ?? 0
  const unmatched = data?.['未匹配链路数'] ?? 0
  const total = data?.['链路总数'] ?? matched + notApplicable + unmatched
  const details = Array.isArray(data?.['未匹配明细']) ? data!['未匹配明细']! : []
  const truncated = data?.['未匹配明细截断数'] ?? 0

  if (!data || total === 0) return null

  return (
    <Section
      icon={<AlertTriangle size={12} />}
      title={unmatched > 0 ? `选型台账（${unmatched} 条未匹配）` : '选型台账'}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">链路总数</span>
          <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">{total}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">已匹配</span>
          <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">{matched}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">无需光模块</span>
          <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">{notApplicable}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">未匹配</span>
          <span
            className={`font-medium tabular-nums ${
              unmatched > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            {unmatched}
          </span>
        </div>
      </div>

      {unmatched > 0 && (
        <>
          <div className="mt-2 text-xs px-2 py-1.5 rounded bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-300">
            以下链路未匹配到同速率光模块，<strong>未计入</strong>成本估算。补齐设备库档位后请重新生成。
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-edge-subtle">
                  <th className="py-1.5 pr-3">网络</th>
                  <th className="py-1.5 pr-3">速率</th>
                  <th className="py-1.5 pr-3">线缆</th>
                  <th className="py-1.5 pr-3">条数</th>
                  <th className="py-1.5">原因</th>
                </tr>
              </thead>
              <tbody>
                {details.map((d, i) => (
                  <tr key={`${d['网络类型'] ?? ''}-${d['速率'] ?? ''}-${i}`} className="border-b border-gray-50 dark:border-edge-subtle/50">
                    <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-300">{d['网络类型'] || '-'}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-gray-600 dark:text-gray-300">{d['速率'] || '-'}</td>
                    <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">{d['线缆类型'] || '-'}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-gray-600 dark:text-gray-300">{d['条数'] ?? 0}</td>
                    <td className="py-1.5 text-gray-500 dark:text-gray-400">{d['原因'] || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {truncated > 0 && (
              <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">… 另有 {truncated} 类未列出</div>
            )}
          </div>
        </>
      )}
    </Section>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {  return (
    <div className="border border-gray-100 dark:border-edge-subtle rounded p-3">
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
