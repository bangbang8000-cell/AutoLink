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
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
    label: '错误',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800',
    label: '警告',
  },
  info: {
    icon: Info,
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-800',
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
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
              {issue.rule_id}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
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
                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                >
                  {item}
                </code>
              ))}
              {issue.affected_items.length > 5 && (
                <span className="text-[10px] text-gray-400">
                  +{issue.affected_items.length - 5}
                </span>
              )}
            </div>
          )}
          {issue.recommendation && (
            <div className="flex items-start gap-1 text-[11px] text-gray-500 dark:text-gray-400">
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
      <div className="flex items-center gap-2 text-xs px-3 py-2.5 rounded bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300">
        <CheckCircle size={14} />
        <span>{t('design:validationPassed')}</span>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={14} className="text-amber-500" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
            {t('design:validationIssues', '校验问题')}
          </span>
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
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
