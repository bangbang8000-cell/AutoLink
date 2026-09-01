/**
 * AutoLink V3.2.0-T9-3 — 批量优化面板（轨道 B）
 *
 * 收敛比/成本/散热建议批量预览：生成建议 → 列表（全选/逐条）→ 批量应用。
 * 复用 T7-2 预览应用模式：backend 只产出建议（optimize:suggest，AUTO），
 * 用户确认后经 optimize:apply（NOTIFY）落盘 project_config.json。
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Sparkles, Loader2, CheckCircle2, ListChecks, ArrowRight } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'

interface OptimizationSuggestion {
  /** 4.4 F4-2: 多项目批量优化——每条建议归属的项目 */
  projectName: string
  category: 'convergence' | 'cost' | 'thermal'
  categoryLabel: string
  title: string
  description: string
  patch: Record<string, Record<string, unknown>>
  impact: string
}

const CATEGORY_ORDER: OptimizationSuggestion['category'][] = ['convergence', 'cost', 'thermal']
const CATEGORY_ICON: Record<string, string> = {
  convergence: '↔',
  cost: '$',
  thermal: '❄',
}
const CATEGORY_COLOR: Record<string, string> = {
  convergence: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
  cost: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
  thermal: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
}

export function BatchOptimizePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const projects = useProjectStore((s) => s.projects)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [appliedCount, setAppliedCount] = useState(0)
  // 4.4 F4-2: 多项目批量优化——默认选中当前项目
  const [selectedProjects, setSelectedProjects] = useState<string[]>(() =>
    selectedProjectName ? [selectedProjectName] : [],
  )

  const grouped = useMemo(() => {
    return CATEGORY_ORDER
      .map((c) => ({
        category: c,
        categoryLabel: suggestions.find((s) => s.category === c)?.categoryLabel ?? c,
        items: suggestions.filter((s) => s.category === c),
      }))
      .filter((g) => g.items.length > 0)
  }, [suggestions])

  const selected = useMemo(
    () => suggestions.filter((_, i) => checked.has(i)),
    [suggestions, checked],
  )

  if (!open) return null

  const handleSuggest = async () => {
    if (selectedProjects.length === 0) {
      addToast('error', t('batchOptimize.selectFirst'), 4000)
      return
    }
    setLoading(true)
    setAppliedCount(0)
    setSuggestions([])
    setChecked(new Set())
    try {
      // 4.4 F4-2: 多项目逐个生成建议（聚合展示，按项目归属）
      const all: OptimizationSuggestion[] = []
      let total = 0
      for (const projectName of selectedProjects) {
        const res = (await window.electron.optimize.suggest({ projectName }))
        if (!res.success) {
          addToast('error', res.error || t('batchOptimize.failed'), 5000)
          continue
        }
        total += res.total ?? 0
        for (const s of res.suggestions ?? []) {
          all.push({ ...s, projectName })
        }
      }
      setSuggestions(all)
      setChecked(new Set(all.map((_, i) => i)))
      addToast('success', t('batchOptimize.generated', { count: total }), 4000)
    } catch (err) {
      addToast('error', `${t('batchOptimize.failed')}：${(err as Error).message}`, 5000)
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
    setChecked(value ? new Set(suggestions.map((_, i) => i)) : new Set())
  }

  const handleApply = async () => {
    if (selected.length === 0) return
    setApplying(true)
    try {
      // 4.4 F4-2: 多项目批量应用——按项目分组逐个 apply
      const byProject = new Map<string, OptimizationSuggestion[]>()
      for (const s of selected) {
        const list = byProject.get(s.projectName) ?? []
        list.push(s)
        byProject.set(s.projectName, list)
      }
      let appliedTotal = 0
      for (const [projectName, items] of byProject) {
        const res = (await window.electron.optimize.apply({
          projectName,
          suggestions: items.map((s) => ({ category: s.category, title: s.title, patch: s.patch })),
        }))
        if (!res.success) {
          addToast('error', res.error || t('batchOptimize.applyFailed'), 5000)
          continue
        }
        appliedTotal += res.applied?.length ?? 0
      }
      setAppliedCount(appliedTotal)
      addToast('success', t('batchOptimize.appliedMulti', { count: appliedTotal, names: byProject.size }), 5000)
      onClose()
    } catch (err) {
      addToast('error', `${t('batchOptimize.applyFailed')}：${(err as Error).message}`, 5000)
    } finally {
      setApplying(false)
    }
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
            <Sparkles size={15} className="text-primary-500" />
            {t('batchOptimize.title')}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-500">
            <X size={15} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-2xs">
          {/* 4.4 F4-2: 多项目选择 + suggest */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-gray-500 dark:text-gray-400 truncate">
                {t('batchOptimize.project')}
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {selectedProjects.length > 0 ? `${selectedProjects.length} 个项目` : t('batchOptimize.notSelected')}
                </span>
              </span>
              <button
                onClick={handleSuggest}
                disabled={loading || selectedProjects.length === 0}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-60"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />}
                {loading ? t('batchOptimize.analyzing') : t('batchOptimize.suggest')}
              </button>
            </div>
            {/* 多项目勾选（当前项目兜底） */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-24 overflow-auto">
              {(projects.length > 0 ? projects : (selectedProjectName ? [{ id: -1, name: selectedProjectName, index: 0 }] : []))
                .map((p) => {
                  const on = selectedProjects.includes(p.name)
                  return (
                    <label key={p.name} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          setSelectedProjects((prev) =>
                            on ? prev.filter((x) => x !== p.name) : [...prev, p.name],
                          )
                        }}
                        className="accent-primary-600"
                      />
                      <span className="text-gray-600 dark:text-gray-300">{p.name}</span>
                    </label>
                  )
                })}
            </div>
          </div>

          {/* summary */}
          {suggestions.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-app-hover/40 text-gray-500 dark:text-gray-400">
              <span>{t('batchOptimize.total', { count: suggestions.length })}</span>
              {grouped.map((g) => (
                <span key={g.category} className={`px-1.5 py-0.5 rounded text-[11px] ${CATEGORY_COLOR[g.category]}`}>
                  {g.categoryLabel} {g.items.length}
                </span>
              ))}
              {appliedCount > 0 && <span className="ml-auto text-success-600 dark:text-success-400">{t('batchOptimize.applied', { count: appliedCount })}</span>}
            </div>
          )}

          {/* suggestion list */}
          {grouped.length === 0 && !loading ? (
            <div className="py-10 text-center text-gray-400 dark:text-gray-500 space-y-1">
              <Sparkles size={22} className="mx-auto" />
              <p>{t('batchOptimize.empty')}</p>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.category} className="space-y-1.5">
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${CATEGORY_COLOR[group.category]}`}>
                  {CATEGORY_ICON[group.category]} {group.categoryLabel}
                </div>
                {group.items.map((s) => {
                  const idx = suggestions.indexOf(s)
                  return (
                    <label
                      key={idx}
                      className={`flex items-start gap-2.5 p-2.5 rounded border transition-colors cursor-pointer ${
                        checked.has(idx)
                          ? 'border-primary-300 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-900/10'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-app-hover'
                      }`}
                    >
                      <input type="checkbox" checked={checked.has(idx)} onChange={() => toggle(idx)} className="mt-0.5 accent-primary-600" />
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium text-gray-700 dark:text-gray-200">{s.title}</span>
                        <span className="block mt-0.5 text-gray-500 dark:text-gray-400">{s.description}</span>
                        <span className="flex items-start gap-1 mt-1 text-success-600 dark:text-success-400">
                          <ArrowRight size={11} className="shrink-0 mt-0.5" />{s.impact}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* footer */}
        {suggestions.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleAll(!(checked.size === suggestions.length))}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
            >
              {checked.size === suggestions.length ? t('batchOptimize.selectNone') : t('batchOptimize.selectAll')}
            </button>
            <span className="text-gray-400 dark:text-gray-500">{t('batchOptimize.selected', { count: selected.length })}</span>
            <button
              onClick={handleApply}
              disabled={applying || selected.length === 0}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-60"
            >
              {applying ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {applying ? t('batchOptimize.applying') : t('batchOptimize.applySelected', { count: selected.length })}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
