import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import {
  Loader2, Server, Network, Rows, Zap, AlertTriangle, CheckCircle2, Eye, Pencil, Plus,
} from 'lucide-react'

// V2.9.7-T3: 模板预览结果摘要（来自 template:preview IPC）
interface TemplatePreviewSummary {
  numServers: number
  numGpuServers: number
  paramLeafCount: number
  paramSpineCount: number
  paramCoreCount: number
  storageLeafCount: number
  storageSpineCount: number
  paramSpeed: string
  storageSpeed: string
  paramProtocol: string
  totalRacks: number
  totalPowerWatts: number
  valid: boolean
  errors: string[]
  convergence: Array<{
    networkType?: string
    convergenceRatio?: number
    meetsTarget?: boolean
    recommendation?: string
  }> | null
}

interface Props {
  template: { id: string; name: string; isBuiltin?: boolean }
  onClose: () => void
  onCreateProject: (name: string) => void
  onEdit: (name: string, isBuiltin: boolean) => void
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-2 py-3 rounded-lg border border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-elevated">
      <span className="text-gray-400 mb-1">{icon}</span>
      <span className="text-base font-semibold text-gray-800 dark:text-gray-100">{value}</span>
      <span className="text-2xs text-gray-400 mt-0.5 text-center">{label}</span>
      {sub && <span className="text-2xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</span>}
    </div>
  )
}

export function TemplatePreviewModal({ template, onClose, onCreateProject, onEdit }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<TemplatePreviewSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    window.electron?.template?.preview(template.id)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.summary) {
          setResult(res.summary)
        } else if (res.error === 'template.noConfig') {
          setError(t('common:template.preview.noConfig', '模板缺少 project_config.json，无法预览。请先重建模板或手动编辑配置。'))
        } else {
          setError(t('common:template.preview.failed', '模板预览失败，请检查模板配置。'))
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err?.message || t('common:template.preview.failed', '模板预览失败，请检查模板配置。'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [template.id, t])

  const handleCreate = useCallback(() => onCreateProject(template.id), [onCreateProject, template.id])
  const handleEdit = useCallback(() => onEdit(template.id, !!template.isBuiltin), [onEdit, template.id, template.isBuiltin])

  const totalSwitches = (result?.paramLeafCount || 0) + (result?.paramSpineCount || 0) + (result?.paramCoreCount || 0)
    + (result?.storageLeafCount || 0) + (result?.storageSpineCount || 0)

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('common:template.preview.title', '预览方案')} - ${template.name}`}
      width={560}
      closeOnEsc
      bodyClassName="p-4 space-y-3"
      footer={
        <div className="flex justify-end gap-2">
          {result && (
            <>
              <button
                onClick={handleEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
              >
                <Pencil size={12} />
                {t('common:template.preview.edit', '去编辑')}
              </button>
              <button
                onClick={handleCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
              >
                <Plus size={12} />
                {t('common:template.preview.createProject', '基于此模板创建项目')}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
          >
            {t('common:close', '关闭')}
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="h-32 flex items-center justify-center gap-2 text-xs text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          {t('common:template.preview.loading', '正在生成方案...')}
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 px-3 py-4 text-xs text-warning-600 dark:text-warning-400 rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-900/20">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : result ? (
        <>
          {/* 校验状态横幅 */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
            result.valid
              ? 'text-success-600 dark:text-success-400 bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800'
              : 'text-warning-600 dark:text-warning-400 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800'
          }`}>
            {result.valid
              ? <CheckCircle2 size={14} className="shrink-0" />
              : <AlertTriangle size={14} className="shrink-0" />}
            <span>
              {result.valid
                ? t('common:template.preview.valid', '拓扑校验通过')
                : t('common:template.preview.invalid', '拓扑校验未通过（{{count}} 项错误）', { count: result.errors.length })}
            </span>
          </div>

          {/* 统计卡片 */}
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              icon={<Server size={14} />}
              label={t('common:template.preview.servers', '服务器')}
              value={String(result.numServers)}
              sub={`GPU ${result.numGpuServers}`}
            />
            <StatCard
              icon={<Network size={14} />}
              label={t('common:template.preview.switches', '交换机')}
              value={String(totalSwitches)}
              sub={`Leaf ${result.paramLeafCount + result.storageLeafCount}`}
            />
            <StatCard
              icon={<Rows size={14} />}
              label={t('common:template.preview.racks', '机柜')}
              value={String(result.totalRacks)}
            />
            <StatCard
              icon={<Zap size={14} />}
              label={t('common:template.preview.power', '总功率')}
              value={`${(result.totalPowerWatts / 1000).toFixed(1)}KW`}
            />
            <StatCard
              icon={<Network size={14} />}
              label={t('common:template.preview.protocol', '协议')}
              value={`${result.paramProtocol} ${result.paramSpeed}`}
            />
            <StatCard
              icon={<Eye size={14} />}
              label={t('common:template.preview.convergence', '收敛比')}
              value={result.convergence?.length
                ? String(result.convergence[0].convergenceRatio ?? '-')
                : '-'}
              sub={result.convergence?.[0]?.networkType || ''}
            />
          </div>

          {/* 校验错误列表 */}
          {!result.valid && result.errors.length > 0 && (
            <div className="rounded-lg border border-error-200 dark:border-error-800 bg-error-50 dark:bg-error-900/20 p-3 space-y-1">
              <p className="text-2xs font-medium text-error-600 dark:text-error-400">
                {t('common:template.preview.errorList', '校验错误')}
              </p>
              {result.errors.slice(0, 8).map((msg, i) => (
                <p key={i} className="text-2xs text-error-600 dark:text-error-400 break-words">• {msg}</p>
              ))}
              {result.errors.length > 8 && (
                <p className="text-2xs text-gray-400">… 等 {result.errors.length} 项</p>
              )}
            </div>
          )}
        </>
      ) : null}
    </Modal>
  )
}
