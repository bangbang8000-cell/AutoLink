/**
 * AutoLink V3.2.0-T9-4 — 智能修复面板（校验错误 → 修复 patch → 复核 → 一键应用）
 *
 * 闭环：repair:plan 读取配置 → 校验 → 列出可自动修复的 error 级问题（rule_id 级修复项）
 * → 用户勾选 → repair:apply 应用并重新校验（复核 remainingErrors 下降）。
 * 权限：repair:plan AUTO（只读计算）/ repair:apply NOTIFY（写操作 + 复核）。
 */
import { useMemo, useState } from 'react'
import { X, Wrench, Loader2, ShieldCheck, ShieldAlert, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'

interface RepairFix {
  rule_id: string
  severity: string
  message: string
  recommendation: string
  patch: Record<string, Record<string, unknown>>
}

interface ReviewIssue {
  rule_id: string
  severity: string
  message: string
  recommendation: string
}

interface RepairReview {
  valid: boolean
  remainingErrors: number
  issues: ReviewIssue[]
}

const RULE_ICON: Record<string, string> = {
  V002: '⚡',
  V007: '⇄',
  V010: '↔',
  V016: '🔌',
  V018: '▦',
  V019: '🔋',
  V020: '⬡',
}

export function RepairPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addToast = useToastStore((s) => s.addToast)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [fixes, setFixes] = useState<RepairFix[]>([])
  const [unfixable, setUnfixable] = useState<ReviewIssue[]>([])
  const [totalErrors, setTotalErrors] = useState(0)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [review, setReview] = useState<RepairReview | null>(null)

  const selected = useMemo(
    () => fixes.filter((_, i) => checked.has(i)),
    [fixes, checked],
  )

  if (!open) return null

  const handlePlan = async () => {
    if (!selectedProjectName) {
      addToast('error', '请先选择一个项目', 4000)
      return
    }
    setLoading(true)
    setReview(null)
    try {
      const res = (await window.electron.repair.plan({ projectName: selectedProjectName }))
      if (!res.success) {
        addToast('error', res.error || '修复方案生成失败', 5000)
        setFixes([])
        setUnfixable([])
        return
      }
      setFixes(res.fixes ?? [])
      setUnfixable(res.issues ?? [])
      setTotalErrors(res.totalErrors ?? 0)
      setChecked(new Set((res.fixes ?? []).map((_, i) => i)))
      if ((res.fixes ?? []).length === 0 && (res.issues ?? []).length === 0) {
        addToast('success', '配置校验通过，无错误项', 4000)
      } else {
        addToast('info', `发现 ${res.totalErrors ?? 0} 个错误，可自动修复 ${res.fixes?.length ?? 0} 项`, 4000)
      }
    } catch (err) {
      addToast('error', `修复方案生成失败：${(err as Error).message}`, 5000)
    } finally {
      setLoading(false)
    }
  }

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const toggleAll = (value: boolean) => {
    setChecked(value ? new Set(fixes.map((_, i) => i)) : new Set())
  }

  const handleApply = async () => {
    if (!selectedProjectName || selected.length === 0) return
    setApplying(true)
    try {
      const res = (await window.electron.repair.apply({
        projectName: selectedProjectName,
        fixes: selected.map((f) => ({ rule_id: f.rule_id, message: f.message, patch: f.patch })),
      }))
      if (!res.success) {
        addToast('error', res.error || '修复应用失败', 5000)
        return
      }
      if (res.validation) {
        setReview(res.validation)
        const remain = res.validation.remainingErrors
        if (res.validation.valid) {
          addToast('success', `修复完成：${res.applied?.length ?? 0} 项已应用，复核通过`, 5000)
        } else {
          addToast('info', `已应用 ${res.applied?.length ?? 0} 项，复核剩余 ${remain} 个错误`, 5000)
        }
      } else {
        addToast('success', `已应用 ${res.applied?.length ?? 0} 项修复`, 5000)
      }
    } catch (err) {
      addToast('error', `修复应用失败：${(err as Error).message}`, 5000)
    } finally {
      setApplying(false)
    }
  }

  const flattenPatch = (patch: Record<string, Record<string, unknown>>): string[] => {
    const out: string[] = []
    for (const [section, kv] of Object.entries(patch ?? {})) {
      for (const [key, value] of Object.entries(kv ?? {})) {
        out.push(`${section}.${key} = ${JSON.stringify(value)}`)
      }
    }
    return out
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60" onClick={onClose}>
      <div
        className="w-[680px] max-h-[86vh] flex flex-col bg-white dark:bg-app-surface rounded-lg shadow-2xl border border-gray-200 dark:border-edge-subtle"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
            <Wrench size={15} className="text-primary-500" />
            智能修复
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-500">
            <X size={15} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-2xs">
          {/* project + plan */}
          <div className="flex items-center gap-3">
            <span className="text-gray-500 dark:text-gray-400 truncate">
              项目：<span className="font-medium text-gray-700 dark:text-gray-200">{selectedProjectName || '未选择'}</span>
            </span>
            <button
              onClick={handlePlan}
              disabled={loading || !selectedProjectName}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-60"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <ShieldAlert size={13} />}
              {loading ? '校验中…' : '生成修复方案'}
            </button>
          </div>

          {/* summary */}
          {totalErrors > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-app-hover/40 text-gray-500 dark:text-gray-400">
              <span>校验错误 {totalErrors} 项</span>
              <span className={`px-1.5 py-0.5 rounded text-[11px] ${fixes.length > 0
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'}`}>
                可自动修复 {fixes.length} 项
              </span>
              {unfixable.length > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[11px] bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                  需人工处理 {unfixable.length} 项
                </span>
              )}
            </div>
          )}

          {/* review (after apply) */}
          {review && (
            <div className={`p-3 rounded border ${
              review.valid
                ? 'border-success-200 dark:border-success-800 bg-success-50/60 dark:bg-success-900/10'
                : 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10'
            }`}>
              <div className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-200">
                {review.valid
                  ? <CheckCircle2 size={14} className="text-success-600 dark:text-success-400" />
                  : <ShieldAlert size={14} className="text-amber-600 dark:text-amber-400" />}
                复核结果：{review.valid ? '通过' : `剩余 ${review.remainingErrors} 个错误`}
              </div>
              {review.issues.length > 0 && (
                <ul className="mt-2 space-y-1 pl-1">
                  {review.issues.map((i, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 text-gray-500 dark:text-gray-400">
                      <span className="shrink-0 px-1 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-mono">{i.rule_id}</span>
                      {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* fix list */}
          {fixes.length === 0 && !loading && review === null ? (
            <div className="py-10 text-center text-gray-400 dark:text-gray-500 space-y-1">
              <ShieldCheck size={22} className="mx-auto" />
              <p>点击「生成修复方案」校验当前项目，自动给出可一键应用的修复项</p>
            </div>
          ) : (
            fixes.map((fx, i) => (
              <label
                key={`${fx.rule_id}-${i}`}
                className={`flex items-start gap-2.5 p-2.5 rounded border transition-colors cursor-pointer ${
                  checked.has(i)
                    ? 'border-primary-300 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-900/10'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-app-hover'
                }`}
              >
                <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} className="mt-0.5 accent-primary-600" />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="px-1 py-0.5 rounded font-mono text-[11px] bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                      {RULE_ICON[fx.rule_id] ?? '⚠'} {fx.rule_id}
                    </span>
                    <span className="font-medium text-gray-700 dark:text-gray-200 truncate">{fx.message}</span>
                  </span>
                  {fx.recommendation && (
                    <span className="block mt-0.5 text-gray-400 dark:text-gray-500">{fx.recommendation}</span>
                  )}
                  <span className="flex items-start gap-1 mt-1 text-success-600 dark:text-success-400">
                    <ArrowRight size={11} className="shrink-0 mt-0.5" />
                    <span className="break-all">{flattenPatch(fx.patch).join('；')}</span>
                  </span>
                </span>
              </label>
            ))
          )}

          {/* unfixable errors */}
          {unfixable.length > 0 && (
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                ⚠ 需人工处理
              </div>
              {unfixable.map((u, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2 rounded border border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-900/10 text-gray-500 dark:text-gray-400">
                  <span className="shrink-0 px-1 rounded font-mono bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">{u.rule_id}</span>
                  {u.message}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* footer */}
        {fixes.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleAll(!(checked.size === fixes.length))}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
            >
              {checked.size === fixes.length ? '全不选' : '全选'}
            </button>
            <span className="text-gray-400 dark:text-gray-500">已选 {selected.length} 项</span>
            <button
              onClick={handleApply}
              disabled={applying || selected.length === 0}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-60"
            >
              {applying ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
              {applying ? '修复中…' : `一键修复 (${selected.length})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
