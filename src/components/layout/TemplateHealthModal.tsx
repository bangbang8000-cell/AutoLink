import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import {
  Loader2, HeartPulse, CheckCircle2, AlertTriangle, ShieldAlert, FileQuestion, FileX2,
} from 'lucide-react'

// V2.9.8-T2: 模板健康检查结果（来自 template:healthCheck IPC）
export interface TemplateHealthIssue {
  type: 'missing_json' | 'invalid_json' | 'invalid_config' | 'bad_ref' | 'unresolved_ref'
  detail: string
}

export interface TemplateHealthResult {
  checked: number
  healthyCount: number
  unhealthy: Array<{
    id: string
    name: string
    isBuiltin: boolean
    issues: TemplateHealthIssue[]
  }>
}

interface Props {
  onClose: () => void
}

// 问题类型 → 图标 + i18n key
const ISSUE_META: Record<TemplateHealthIssue['type'], { icon: React.ReactNode; labelKey: string }> = {
  missing_json: { icon: <FileQuestion size={12} />, labelKey: 'common:template.health.issueMissingJson' },
  invalid_json: { icon: <FileX2 size={12} />, labelKey: 'common:template.health.issueInvalidJson' },
  invalid_config: { icon: <ShieldAlert size={12} />, labelKey: 'common:template.health.issueInvalidConfig' },
  bad_ref: { icon: <ShieldAlert size={12} />, labelKey: 'common:template.health.issueBadRef' },
  unresolved_ref: { icon: <ShieldAlert size={12} />, labelKey: 'common:template.health.issueUnresolvedRef' },
}

export function TemplateHealthModal({ onClose }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<TemplateHealthResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    window.electron?.template?.healthCheck()
      .then((res) => {
        if (!cancelled) setResult(res)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err?.message || t('common:template.health.failed', '健康检查失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [t])

  const unhealthyCount = result?.unhealthy.length ?? 0

  return (
    <Modal
      open
      onClose={onClose}
      title={t('common:template.health.title', '模板健康检查')}
      width={520}
      closeOnEsc
      bodyClassName="p-4 space-y-3"
      footer={
        <div className="flex justify-end">
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
          {t('common:template.health.checking', '正在检查模板健康状态...')}
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 px-3 py-4 text-xs text-error-600 dark:text-error-400 rounded-lg border border-error-200 dark:border-error-800 bg-error-50 dark:bg-error-900/20">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : result ? (
        <>
          {/* 汇总横幅 */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
            unhealthyCount === 0
              ? 'text-success-600 dark:text-success-400 bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800'
              : 'text-warning-600 dark:text-warning-400 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800'
          }`}>
            {unhealthyCount === 0
              ? <CheckCircle2 size={14} className="shrink-0" />
              : <HeartPulse size={14} className="shrink-0" />}
            <span>
              {unhealthyCount === 0
                ? t('common:template.health.allHealthy', '所有模板均健康')
                : t('common:template.health.summary', '共检查 {{checked}} 个模板，健康 {{healthy}} 个，异常 {{unhealthy}} 个', {
                    checked: result.checked,
                    healthy: result.healthyCount,
                    unhealthy: unhealthyCount,
                  })}
            </span>
          </div>

          {/* 异常清单 */}
          {result.unhealthy.length > 0 && (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {result.unhealthy.map((tpl) => (
                <div
                  key={tpl.id}
                  className="rounded-lg border border-error-200 dark:border-error-800 bg-error-50 dark:bg-error-900/20 p-2.5 space-y-1"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-error-700 dark:text-error-300">
                    <AlertTriangle size={12} className="shrink-0" />
                    <span className="truncate">{tpl.name}</span>
                    {tpl.isBuiltin && (
                      <span className="shrink-0 text-3xs bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1 rounded">
                        {t('common:template.builtin', '内置')}
                      </span>
                    )}
                  </div>
                  {tpl.issues.map((issue, i) => {
                    const meta = ISSUE_META[issue.type] || ISSUE_META.invalid_config
                    return (
                      <div key={i} className="flex items-start gap-1.5 pl-0.5 text-2xs text-error-600 dark:text-error-400">
                        <span className="shrink-0 mt-px">{meta.icon}</span>
                        <span className="break-words">
                          <span className="font-medium">{t(meta.labelKey)}</span>
                          <span className="text-gray-500 dark:text-gray-400"> — {issue.detail}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </Modal>
  )
}
