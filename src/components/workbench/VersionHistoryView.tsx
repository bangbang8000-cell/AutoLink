/**
 * M-F1（PRD v3.6）：AL 版本历史与评审 —— 版本列表 / 对比高亮 / 一键回滚
 * - F1-1：基于 plan_history 宏观参数版本间 diff 高亮（有差异字段着色）
 * - F1-2：版本列表 → 选择两版对比 → 一键回滚到历史版本（回滚前当前版本先存档）
 * - 空历史友好提示
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCompareArrows, History, RefreshCw, RotateCcw, Loader2, FileDown, Upload } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToastStore } from '@/stores/toast.store'
import {
  getFeatureBridge,
  diffPlans,
  buildVersionList,
  macroFieldLabel,
  type DiffEntry,
  type PlanVersionEntry,
} from '@/utils/planVersionDiff'

interface Props {
  projectName: string
  open: boolean
  onClose: () => void
}

const fmtTime = (iso: string) => (iso ? iso.replace('T', ' ').slice(0, 19) : '')

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function VersionHistoryView({ projectName, open, onClose }: Props) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [versions, setVersions] = useState<PlanVersionEntry[]>([])
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null)
  const [selectedA, setSelectedA] = useState<number | null>(null)
  const [selectedB, setSelectedB] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<PlanVersionEntry | null>(null)

  const currentVersion = useMemo(() => {
    const meta = (current?.meta ?? {}) as Record<string, unknown>
    return Number(meta.planVersion ?? 0) || 0
  }, [current])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getFeatureBridge().versionHistory.list(projectName)
      const list = buildVersionList(res.files ?? [])
      setVersions(list)
      setCurrent(res.current ?? null)
      if (list.length >= 2) {
        setSelectedA(list[list.length - 2].version)
        setSelectedB(list[list.length - 1].version)
      } else if (list.length === 1) {
        setSelectedA(list[0].version)
        setSelectedB(null)
      } else {
        setSelectedA(null)
        setSelectedB(null)
      }
    } catch (err) {
      addToast('error', t('workbench:versionHistory.loadFailed', { reason: (err as Error).message, defaultValue: '版本历史加载失败：{{reason}}' }), 4000)
    } finally {
      setLoading(false)
    }
  }, [projectName, addToast, t])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const versionOf = useCallback((n: number | null): PlanVersionEntry | null => {
    if (n === null) return null
    return versions.find((v) => v.version === n) ?? null
  }, [versions])

  const diff = useMemo<DiffEntry[] | null>(() => {
    const a = versionOf(selectedA)
    const b = versionOf(selectedB)
    if (!a || !b) return null
    return diffPlans(a.macro, b.macro)
  }, [versionOf, selectedA, selectedB])

  const diffStats = useMemo(() => {
    if (!diff) return null
    const stats = { changed: 0, added: 0, removed: 0, unchanged: 0 }
    for (const e of diff) stats[e.status]++
    return stats
  }, [diff])

  const confirmRollback = useCallback(async () => {
    if (!rollbackTarget) return
    setBusy(true)
    try {
      const res = await getFeatureBridge().versionHistory.rollback(projectName, rollbackTarget.version)
      if (!res?.ok) throw new Error(res?.error ?? '回滚失败')
      addToast('success', t('workbench:versionHistory.rollbackSuccess', { version: rollbackTarget.version, defaultValue: '已回滚到 v{{version}}（回滚前版本已存档）' }), 5000)
      setRollbackTarget(null)
      await load()
    } catch (err) {
      addToast('error', t('workbench:versionHistory.rollbackFailed', { reason: (err as Error).message, defaultValue: '回滚失败：{{reason}}' }), 5000)
    } finally {
      setBusy(false)
    }
  }, [rollbackTarget, projectName, addToast, t, load])

  // 48-b（F8-2）：版本历史 导出为文件 / 从文件回导（合并补齐缺失版本）
  const [historyBusy, setHistoryBusy] = useState(false)
  const handleExportHistory = useCallback(async () => {
    setHistoryBusy(true)
    try {
      const res = await getFeatureBridge().versionHistory.exportFile(projectName)
      if (res?.error) throw new Error(res.error)
      if (res?.canceled) return
      if (res?.path) {
        addToast('success', t('workbench:versionHistory.exported', { path: res.path, count: res.count ?? 0, defaultValue: '版本历史已导出 → {{path}}（{{count}} 个快照）' }), 5000)
      }
    } catch (err) {
      addToast('error', t('workbench:versionHistory.exportFailed', { reason: (err as Error).message, defaultValue: '版本历史导出失败：{{reason}}' }), 5000)
    } finally {
      setHistoryBusy(false)
    }
  }, [projectName, addToast, t])

  const handleImportHistory = useCallback(async () => {
    setHistoryBusy(true)
    try {
      const res = await getFeatureBridge().versionHistory.importFile(projectName)
      if (res?.error) throw new Error(res.error)
      if (res?.canceled) return
      if (res?.imported) {
        addToast('success', t('workbench:versionHistory.imported', { imported: res.imported, skipped: res.skipped ?? 0, defaultValue: '已导入 {{imported}} 个历史版本（合并跳过 {{skipped}} 个）' }), 5000)
      }
      await load()
    } catch (err) {
      addToast('error', t('workbench:versionHistory.importFailed', { reason: (err as Error).message, defaultValue: '版本历史导入失败：{{reason}}' }), 5000)
    } finally {
      setHistoryBusy(false)
    }
  }, [projectName, addToast, t, load])

  const statusClass = (status: DiffEntry['status']) => {
    switch (status) {
      case 'changed': return 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
      case 'added': return 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400'
      case 'removed': return 'bg-error-50 dark:bg-error-900/20 text-error-600 dark:text-error-400'
      default: return 'text-gray-500 dark:text-gray-400'
    }
  }

  const statusBadge = (status: DiffEntry['status']) => {
    const label = {
      changed: t('workbench:versionHistory.changed', '变更'),
      added: t('workbench:versionHistory.added', '新增'),
      removed: t('workbench:versionHistory.removed', '移除'),
      unchanged: t('workbench:versionHistory.unchanged', '无变化'),
    }[status]
    const cls = {
      changed: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
      added: 'bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300',
      removed: 'bg-error-100 dark:bg-error-900/40 text-error-600 dark:text-error-400',
      unchanged: 'bg-gray-100 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400',
    }[status]
    return <span className={`inline-block px-1.5 py-0.5 rounded text-2xs font-medium ${cls}`}>{label}</span>
  }

  const displayDiff = diff?.filter((e) => e.status !== 'unchanged') ?? []

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={760}
      maxHeight="85vh"
      title={t('workbench:versionHistory.title', '版本历史')}
    >
      <div className="space-y-4">
        {/* 当前版本 + 刷新 */}
        <div className="flex items-center gap-2">
          <History size={14} className="text-primary-500 shrink-0" />
          <span className="text-xs text-gray-600 dark:text-gray-300">
            {t('workbench:versionHistory.currentVersion', { version: currentVersion, defaultValue: '当前版本 v{{version}}' })}
          </span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="ml-auto flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} {t('workbench:output.refresh', '刷新')}
          </button>
          {/* 48-b（F8-2）：版本历史 导出/回导 文件 */}
          <button
            type="button"
            onClick={handleExportHistory}
            disabled={historyBusy}
            className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-sky-300 dark:border-sky-600 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 disabled:opacity-40"
          >
            {historyBusy ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />} {t('workbench:versionHistory.exportBtn', '导出历史')}
          </button>
          <button
            type="button"
            onClick={handleImportHistory}
            disabled={historyBusy}
            className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-sky-300 dark:border-sky-600 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 disabled:opacity-40"
          >
            {historyBusy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} {t('workbench:versionHistory.importBtn', '导入历史')}
          </button>
        </div>

        {/* 空历史提示 */}
        {!loading && versions.length === 0 && (
          <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
            <History size={28} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('workbench:versionHistory.empty', '暂无历史版本。保存 AIDC 规划后（宏观参数变更）将自动生成版本快照到 plan_history。')}</p>
          </div>
        )}

        {/* 版本列表 */}
        {versions.length > 0 && (
          <div className="border rounded overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b bg-gray-50 dark:bg-app/50">
              {t('workbench:versionHistory.listTitle', '版本列表')}
            </div>
            <div className="max-h-[160px] overflow-y-auto divide-y divide-gray-100 dark:divide-edge-subtle">
              {[...versions].reverse().map((v) => {
                const isCurrent = v.version === currentVersion
                const inCompare = v.version === selectedA || v.version === selectedB
                return (
                  <div key={v.version} className={`flex items-center gap-2 px-3 py-1.5 ${inCompare ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
                    <span className={`text-xs font-mono font-medium ${isCurrent ? 'text-success-600 dark:text-success-400' : 'text-gray-700 dark:text-gray-200'}`}>v{v.version}</span>
                    {isCurrent && (
                      <span className="inline-block px-1.5 py-0.5 rounded text-2xs bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300 font-medium">
                        {t('workbench:versionHistory.latest', '当前')}
                      </span>
                    )}
                    <span className="text-2xs text-gray-400">{fmtTime(v.generatedAt)}</span>
                    <span className="text-2xs text-gray-400 font-mono truncate max-w-[180px]" title={v.planHash}>{v.planHash.slice(0, 12)}</span>
                    <span className="ml-auto flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setRollbackTarget(v)}
                        disabled={busy || isCurrent}
                        className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-error-300 dark:border-error-700 text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 disabled:opacity-40"
                        title={t('workbench:versionHistory.rollback', { version: v.version, defaultValue: '回滚到 v{{version}}' })}
                      >
                        <RotateCcw size={11} /> {t('workbench:versionHistory.rollbackBtn', '回滚')}
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 版本对比 */}
        {versions.length >= 1 && (
          <div className="border rounded overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b bg-gray-50 dark:bg-app/50 flex items-center gap-2">
              <GitCompareArrows size={12} className="text-primary-500" />
              {t('workbench:versionHistory.compareTitle', '版本对比（宏观参数）')}
            </div>
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs text-gray-500 mb-1">{t('workbench:versionHistory.selectA', '对比版本 A')}</label>
                  <select
                    value={selectedA ?? ''}
                    onChange={(e) => setSelectedA(Number(e.target.value))}
                    className="w-full text-xs rounded border bg-white dark:bg-app px-2 py-1"
                  >
                    <option value="" disabled>{t('workbench:versionHistory.selectPlaceholder', '选择版本')}</option>
                    {[...versions].reverse().map((v) => (
                      <option key={v.version} value={v.version}>v{v.version}（{fmtTime(v.generatedAt)}）</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-2xs text-gray-500 mb-1">{t('workbench:versionHistory.selectB', '对比版本 B')}</label>
                  <select
                    value={selectedB ?? ''}
                    onChange={(e) => setSelectedB(Number(e.target.value))}
                    className="w-full text-xs rounded border bg-white dark:bg-app px-2 py-1"
                  >
                    <option value="" disabled>{t('workbench:versionHistory.selectPlaceholder', '选择版本')}</option>
                    {[...versions].reverse().map((v) => (
                      <option key={v.version} value={v.version}>v{v.version}（{fmtTime(v.generatedAt)}）</option>
                    ))}
                  </select>
                </div>
              </div>

              {diffStats && (
                <div className="flex flex-wrap items-center gap-2 text-2xs">
                  <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                    {t('workbench:versionHistory.changed', '变更')} {diffStats.changed}
                  </span>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300">
                    {t('workbench:versionHistory.added', '新增')} {diffStats.added}
                  </span>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-error-100 dark:bg-error-900/40 text-error-600 dark:text-error-400">
                    {t('workbench:versionHistory.removed', '移除')} {diffStats.removed}
                  </span>
                  {diffStats.unchanged > 0 && (
                    <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400">
                      {t('workbench:versionHistory.unchanged', '无变化')} {diffStats.unchanged}
                    </span>
                  )}
                </div>
              )}

              {/* 差异高亮渲染 */}
              {!diff && selectedA !== null && selectedB === null && (
                <p className="text-2xs text-gray-400">{t('workbench:versionHistory.pickB', '再选择一个版本 B 进行对比')}</p>
              )}
              {diff && displayDiff.length === 0 && (
                <p className="text-2xs text-gray-400">{t('workbench:versionHistory.noDiff', '两个版本宏观参数完全一致')}</p>
              )}
              {diff && displayDiff.length > 0 && (
                <div className="max-h-[240px] overflow-y-auto border rounded">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-gray-50 dark:bg-app/60">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium text-gray-500 w-[72px]">{t('workbench:versionHistory.statusCol', '状态')}</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-500">{t('workbench:versionHistory.fieldCol', '字段')}</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-500 w-[34%]">{t('workbench:versionHistory.oldCol', 'A 值')}</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-500 w-[34%]">{t('workbench:versionHistory.newCol', 'B 值')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayDiff.map((e) => (
                        <tr key={e.path} className={`border-t border-gray-100 dark:border-edge-subtle ${statusClass(e.status)}`}>
                          <td className="px-2 py-1 align-top">{statusBadge(e.status)}</td>
                          <td className="px-2 py-1 align-top font-mono break-all">{macroFieldLabel(e.path)}</td>
                          <td className="px-2 py-1 align-top break-all">{formatValue(e.oldValue)}</td>
                          <td className="px-2 py-1 align-top break-all">{formatValue(e.newValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!rollbackTarget}
        message={rollbackTarget
          ? t('workbench:versionHistory.rollbackConfirm', {
              version: rollbackTarget.version,
              next: currentVersion + 1,
              defaultValue: '回滚到 v{{version}}？回滚前当前版本（v{{next}}）将先存档，可复核/再次回滚。',
            })
          : ''}
        danger
        confirmText={t('workbench:versionHistory.rollback', { version: rollbackTarget?.version ?? '', defaultValue: '回滚到 v{{version}}' })}
        onConfirm={confirmRollback}
        onCancel={() => setRollbackTarget(null)}
      />
    </Modal>
  )
}
