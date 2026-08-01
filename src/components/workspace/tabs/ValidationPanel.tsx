/**
 * AutoLink V2.7.2 — 规则校验结果面板
 * 按规则 ID 分组展示结构化校验结果:
 * - 每条规则展示:规则名、状态(pass/warning/error)、详情
 * - 支持折叠/展开
 * - 错误优先展示,通过规则置底
 */
import { useState, useMemo } from 'react'
import {
  AlertTriangle, CheckCircle, Info, XCircle, Lightbulb,
  ChevronRight, ChevronDown,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDesignStore, type ValidationIssue } from '@/stores/design.store'

/* ---------- 规则元数据 ---------- */

interface RuleMeta {
  id: string
  name: string
  category: string
  description: string
}

/** V001-V010 规则元数据(与 backend/validation.py create_default_engine 对齐) */
const RULE_METADATA: RuleMeta[] = [
  { id: 'V001', name: '收敛比校验', category: '拓扑规则', description: '检查网络收敛比是否超过目标' },
  { id: 'V002', name: '机柜功率密度', category: '物理规则', description: '检查机柜功率是否超过散热上限' },
  { id: 'V003', name: 'PUE 达标', category: '散热规则', description: '检查 PUE 是否超过 1.25 目标' },
  { id: 'V004', name: '端口类型匹配', category: '兼容性规则', description: '检查两端光模块速率是否一致' },
  { id: 'V005', name: '速率匹配', category: '兼容性规则', description: '检查连接速率与网络类型是否匹配' },
  { id: 'V006', name: 'U位冲突', category: '物理规则', description: '检查机柜内 U 位是否重叠' },
  { id: 'V007', name: 'Rail 一致性', category: '拓扑规则', description: '检查 Rail-Optimized 端口数与 Rail 数是否匹配' },
  { id: 'V008', name: 'OOB 可达性', category: '网络规则', description: '检查带外管理网是否配置交换机' },
  { id: 'V009', name: '存储冗余', category: '网络规则', description: '检查存储网是否有冗余路径' },
  { id: 'V010', name: '参数网过载', category: '拓扑规则', description: '检查参数网收敛比是否严重过高' },
]

/* ---------- 严重级别配置 ---------- */

type Severity = 'error' | 'warning' | 'info' | 'pass'

const SEVERITY_CONFIG: Record<Severity, {
  icon: typeof XCircle
  dot: string
  text: string
  bg: string
  border: string
  label: string
}> = {
  error: {
    icon: XCircle,
    dot: 'bg-error-500',
    text: 'text-error-700 dark:text-error-300',
    bg: 'bg-error-50 dark:bg-error-900/20',
    border: 'border-error-200 dark:border-error-800',
    label: '错误',
  },
  warning: {
    icon: AlertTriangle,
    dot: 'bg-warning-500',
    text: 'text-warning-700 dark:text-warning-300',
    bg: 'bg-warning-50 dark:bg-warning-900/20',
    border: 'border-warning-200 dark:border-warning-800',
    label: '警告',
  },
  info: {
    icon: Info,
    dot: 'bg-info-500',
    text: 'text-info-700 dark:text-info-300',
    bg: 'bg-info-50 dark:bg-info-900/20',
    border: 'border-info-200 dark:border-info-800',
    label: '提示',
  },
  pass: {
    icon: CheckCircle,
    dot: 'bg-success-500',
    text: 'text-success-700 dark:text-success-300',
    bg: 'bg-success-50 dark:bg-success-900/20',
    border: 'border-success-200 dark:border-success-800',
    label: '通过',
  },
}

/* ---------- 单条问题展示 ---------- */

function IssueItem({ issue }: { issue: ValidationIssue }) {
  const sev = (issue.severity as Severity) || 'info'
  const cfg = SEVERITY_CONFIG[sev] || SEVERITY_CONFIG.info
  const Icon = cfg.icon

  return (
    <div className={`border rounded-md p-2.5 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-2">
        <Icon size={14} className={`mt-0.5 shrink-0 ${cfg.text}`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-700 dark:text-gray-200 mb-1.5 break-words">
            {issue.message}
          </p>
          {issue.affected_items.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {issue.affected_items.slice(0, 5).map((item, i) => (
                <code
                  key={i}
                  className="text-2xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-app-elevated text-gray-600 dark:text-gray-300"
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

/* ---------- 规则分组展示 ---------- */

interface RuleGroup {
  meta: RuleMeta
  issues: ValidationIssue[]
  status: Severity
}

function RuleGroupItem({ group }: { group: RuleGroup }) {
  const [expanded, setExpanded] = useState(group.status === 'error')
  const cfg = SEVERITY_CONFIG[group.status]
  const Icon = cfg.icon
  const Chevron = expanded ? ChevronDown : ChevronRight
  const hasIssues = group.issues.length > 0

  return (
    <div className={`border rounded-md ${cfg.border} ${cfg.bg} overflow-hidden`}>
      <button
        type="button"
        onClick={() => hasIssues && setExpanded((v) => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${
          hasIssues ? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5' : 'cursor-default'
        }`}
      >
        {hasIssues ? (
          <Chevron size={14} className="shrink-0 text-gray-400" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Icon size={14} className={`shrink-0 ${cfg.text}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {group.meta.name}
            </span>
            <span className="text-2xs text-gray-400 dark:text-gray-500 font-mono">
              {group.meta.id}
            </span>
          </div>
          <p className="text-2xs text-gray-500 dark:text-gray-400 truncate">
            {group.meta.description}
          </p>
        </div>
        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
          {cfg.label}
          {hasIssues && ` · ${group.issues.length}`}
        </span>
      </button>
      {expanded && hasIssues && (
        <div className="px-2 pb-2 space-y-2">
          {group.issues.map((issue, i) => (
            <IssueItem key={i} issue={issue} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- 主面板 ---------- */

export function ValidationPanel() {
  const { t } = useTranslation()
  const valid = useDesignStore((s) => s.valid)
  const issues = useDesignStore((s) => s.validationIssues)

  // 按规则 ID 分组,合并元数据,推断状态
  const groups = useMemo<RuleGroup[]>(() => {
    const byRule = new Map<string, ValidationIssue[]>()
    for (const issue of issues) {
      const rid = issue.rule_id || 'OTHER'
      if (!byRule.has(rid)) byRule.set(rid, [])
      byRule.get(rid)!.push(issue)
    }

    const result: RuleGroup[] = []
    // 先加入有元数据且有问题/无问题的规则
    for (const meta of RULE_METADATA) {
      const ruleIssues = byRule.get(meta.id) || []
      const status: Severity = ruleIssues.length === 0
        ? 'pass'
        : ruleIssues.some((i) => i.severity === 'error')
          ? 'error'
          : ruleIssues.some((i) => i.severity === 'warning')
            ? 'warning'
            : 'info'
      result.push({ meta, issues: ruleIssues, status })
    }
    // 再加入未知规则(无元数据)
    for (const [rid, ruleIssues] of byRule.entries()) {
      if (RULE_METADATA.some((m) => m.id === rid)) continue
      const status: Severity = ruleIssues.some((i) => i.severity === 'error')
        ? 'error'
        : ruleIssues.some((i) => i.severity === 'warning')
          ? 'warning'
          : 'info'
      result.push({
        meta: { id: rid, name: rid, category: '其他', description: '未分类规则' },
        issues: ruleIssues,
        status,
      })
    }
    return result
  }, [issues])

  // 统计
  const stats = useMemo(() => {
    let errors = 0, warnings = 0, passed = 0
    for (const g of groups) {
      if (g.status === 'error') errors++
      else if (g.status === 'warning') warnings++
      else if (g.status === 'pass') passed++
    }
    return { errors, warnings, passed, total: groups.length }
  }, [groups])

  // 排序: error → warning → info → pass
  const orderedGroups = useMemo(() => {
    const order: Record<Severity, number> = { error: 0, warning: 1, info: 2, pass: 3 }
    return [...groups].sort((a, b) => order[a.status] - order[b.status])
  }, [groups])

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
    <div className="border border-gray-200 dark:border-edge-subtle rounded-md overflow-hidden">
      {/* 头部:统计 */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-app/80 border-b border-gray-200 dark:border-edge-subtle">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={14} className="text-warning-500" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
            {t('design:validationIssues', '校验问题')}
          </span>
        </div>
        <div className="flex items-center gap-2 text-2xs">
          {stats.errors > 0 && (
            <span className="flex items-center gap-1 text-error-700 dark:text-error-300">
              <span className="w-1.5 h-1.5 rounded-full bg-error-500" />
              {stats.errors} 错误
            </span>
          )}
          {stats.warnings > 0 && (
            <span className="flex items-center gap-1 text-warning-700 dark:text-warning-300">
              <span className="w-1.5 h-1.5 rounded-full bg-warning-500" />
              {stats.warnings} 警告
            </span>
          )}
          <span className="flex items-center gap-1 text-success-700 dark:text-success-300">
            <span className="w-1.5 h-1.5 rounded-full bg-success-500" />
            {stats.passed} 通过
          </span>
        </div>
      </div>

      {/* 规则分组列表 */}
      <div className="p-2 space-y-1.5 max-h-80 overflow-y-auto">
        {orderedGroups.map((g) => (
          <RuleGroupItem key={g.meta.id} group={g} />
        ))}
      </div>
    </div>
  )
}
