/**
 * AutoLink V2.4.6 — 规则校验结果面板
 * 展示后端返回的结构化校验问题列表 + 修复建议
 */
import { AlertTriangle, CheckCircle, Info, XCircle, Lightbulb } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDesignStore, type ValidationIssue } from '@/stores/design.store'

const SEVERITY_CONFIG = {
  error: {
    icon: XCircle,
    bg: 'bg-error-50 dark:bg-error-900/20',
    text: 'text-error-700 dark:text-error-300',
    border: 'border-error-200 dark:border-error-800',
    label: '错误',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-warning-50 dark:bg-warning-900/20',
    text: 'text-warning-700 dark:text-warning-300',
    border: 'border-warning-200 dark:border-warning-800',
    label: '警告',
  },
  info: {
    icon: Info,
    bg: 'bg-info-50 dark:bg-info-900/20',
    text: 'text-info-700 dark:text-info-300',
    border: 'border-info-200 dark:border-info-800',
    label: '提示',
  },
} as const

function IssueItem({ issue }: { issue: ValidationIssue }) {
  const cfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.info
  const Icon = cfg.icon

  return (
    <div className={`border rounded-md p-2.5 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-2">
        <Icon size={14} className={`mt-0.5 shrink-0 ${cfg.text}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
            <span className="text-2xs text-gray-400 dark:text-gray-500 font-mono">
              {issue.rule_id}
            </span>
            <span className="text-2xs text-gray-400 dark:text-gray-500">
              · {issue.category}
            </span>
          </div>
          <p className="text-xs text-gray-700 dark:text-gray-200 mb-1.5 break-words">
            {issue.message}
          </p>
          {issue.affected_items.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {issue.affected_items.slice(0, 5).map((item, i) => (
                <code
                  key={i}
                  className="text-2xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                >
                  {item}
                </code>
              ))}
              {issue.affected_items.length > 5 && (
                <span className="text-2xs text-gray-400">
                  +{issue.affected_items.length - 5}
                </span>
              )}
            </div>
          )}
          {issue.recommendation && (
            <div className="flex items-start gap-1 text-2xs text-gray-500 dark:text-gray-400">
              <Lightbulb size={11} className="mt-0.5 shrink-0" />
              <span>{issue.recommendation}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function ValidationPanel() {
  const { t } = useTranslation()
  const valid = useDesignStore((s) => s.valid)
  const issues = useDesignStore((s) => s.validationIssues)

  if (valid === null) return null

  if (valid && issues.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs px-3 py-2.5 rounded bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300">
        <CheckCircle size={14} />
        <span>{t('design:validationPassed')}</span>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={14} className="text-warning-500" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
            {t('design:validationIssues', '校验问题')}
          </span>
        </div>
        <span className="text-2xs text-gray-400 dark:text-gray-500">
          {issues.length} 项
        </span>
      </div>
      <div className="p-2 space-y-2 max-h-64 overflow-y-auto">
        {issues.map((issue, i) => (
          <IssueItem key={i} issue={issue} />
        ))}
      </div>
    </div>
  )
}
