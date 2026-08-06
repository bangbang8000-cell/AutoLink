/**
 * V3.1.4-T8-2: 机房智能落位向导
 *
 * 双模式：
 *   - 按机柜落位：未上架机柜自动填入空格（可选清空已上架重排）
 *   - 按数量落位：GPU/网络/存储/通算数量 → counts 模式（类型标记可视化）
 * 流程：计算方案（backend room:optimize）→ 评分/未放置展示 → 应用方案（applyOptimize）
 */
import { useState } from 'react'
import { Loader2, Sparkles, AlertTriangle, CheckCircle2, Wand2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToastStore } from '@/stores/toast.store'
import { useRoomStore, type RoomOptimizeResult } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'

const SCORE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'power_balance', label: '功率均衡' },
  { key: 'thermal_zones', label: '散热分区' },
  { key: 'network_locality', label: '网络就近' },
  { key: 'shortest_cable', label: '布线最短' },
]

const COUNT_TYPES: Array<{ key: string; label: string }> = [
  { key: 'gpu', label: 'GPU 柜' },
  { key: 'network', label: '网络柜' },
  { key: 'storage', label: '存储柜' },
  { key: 'compute', label: '通算柜' },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function RoomOptimizeModal({ open, onClose }: Props) {
  const addToast = useToastStore((s) => s.addToast)
  const [mode, setMode] = useState<'cabinets' | 'counts'>('cabinets')
  const [resetExisting, setResetExisting] = useState(false)
  const [counts, setCounts] = useState<Record<string, number>>({ gpu: 0, network: 0, storage: 0, compute: 0 })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RoomOptimizeResult | null>(null)

  // 当前矩阵中未上架机柜数（cabinets 模式可落位数提示；直接计算保持与 store 同步）
  const matrix = useRoomStore((s) => s.matrix)
  const mountedIds = new Set((matrix?.cells ?? []).filter((c) => c.cabinetId != null).map((c) => c.cabinetId))
  const unmountedCount = useRackStore((s) => s.cabinets).filter((c) => !mountedIds.has(c.id)).length

  const totalCount = Object.values(counts).reduce((s, n) => s + (Number(n) || 0), 0)

  const handleRun = async () => {
    setLoading(true)
    setResult(null)
    try {
      const room = useRoomStore.getState()
      const res = mode === 'cabinets'
        ? await room.optimizeCabinets({ resetExisting })
        : await room.optimizeCounts(counts)
      setResult(res)
    } finally {
      setLoading(false)
    }
  }

  const handleApply = () => {
    if (!result) return
    const r = useRoomStore.getState().applyOptimize(result)
    if (r.ok) {
      addToast('success', `已应用落位方案（${result.stats.placed}/${result.stats.total_items} 柜）`, 4000)
      onClose()
    } else {
      addToast('error', `应用落位方案失败: ${r.errors.join('; ')}`, 5000)
    }
  }

  const canRun = !loading && (mode === 'counts' ? totalCount > 0 : resetExisting || unmountedCount > 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="机房智能落位"
      width={560}
      footer={
        result && (
          <div className="flex justify-end">
            <button
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
            >
              <CheckCircle2 size={13} />
              应用方案
            </button>
          </div>
        )
      }
    >
      <div className="space-y-3">
        {/* 模式切换 */}
        <div className="flex gap-2">
          <button
            onClick={() => { setMode('cabinets'); setResult(null) }}
            className={`flex-1 px-3 py-2 rounded text-xs border transition-colors ${
              mode === 'cabinets'
                ? 'bg-primary-500 text-white border-primary-500'
                : 'bg-white dark:bg-app text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            按机柜落位
          </button>
          <button
            onClick={() => { setMode('counts'); setResult(null) }}
            className={`flex-1 px-3 py-2 rounded text-xs border transition-colors ${
              mode === 'counts'
                ? 'bg-primary-500 text-white border-primary-500'
                : 'bg-white dark:bg-app text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            按数量落位
          </button>
        </div>

        {mode === 'cabinets' ? (
          <div className="space-y-2.5">
            <div className="text-2xs text-gray-500 dark:text-gray-400">
              {resetExisting
                ? '全部机柜重新落位（忽略当前已上架位置）'
                : `将 ${unmountedCount} 个未上架机柜自动填入空格，已上架机柜保持不动`}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={resetExisting}
                onChange={(e) => { setResetExisting(e.target.checked); setResult(null) }}
                className="accent-primary-500"
              />
              清空已上架重排
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {COUNT_TYPES.map((ct) => (
              <label key={ct.key} className="flex flex-col gap-1">
                <span className="text-2xs text-gray-500 dark:text-gray-400">{ct.label}</span>
                <input
                  type="number"
                  min={0}
                  value={counts[ct.key] ?? 0}
                  onChange={(e) => {
                    setCounts((prev) => ({ ...prev, [ct.key]: Math.max(0, Number(e.target.value) || 0) }))
                    setResult(null)
                  }}
                  className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
                />
              </label>
            ))}
          </div>
        )}

        <button
          onClick={handleRun}
          disabled={!canRun}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
          {loading ? '计算中...' : '计算落位方案'}
        </button>

        {/* 结果：统计 + 评分 + issues */}
        {result && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500 dark:text-gray-400">
                已落位 <b className="text-green-600 dark:text-green-400">{result.stats.placed}</b>/
                {result.stats.total_items}
              </span>
              {result.stats.unplaced > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  未放置 {result.stats.unplaced}
                </span>
              )}
              {result.stats.elapsed_ms != null && (
                <span className="text-gray-400">{result.stats.elapsed_ms}ms</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SCORE_LABELS.map((s) => (
                <div key={s.key} className="flex items-center justify-between border border-gray-200 dark:border-edge-subtle rounded-lg px-2.5 py-1.5 text-2xs">
                  <span className="text-gray-500 dark:text-gray-400">{s.label}</span>
                  <span className="font-medium text-gray-800 dark:text-gray-100">
                    {((result.scores[s.key] ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between border border-primary-200 dark:border-primary-900/50 rounded-lg px-2.5 py-1.5 text-2xs bg-primary-50 dark:bg-primary-900/10">
                <span className="text-primary-600 dark:text-primary-400">综合评分</span>
                <span className="font-bold text-primary-700 dark:text-primary-300">
                  {((result.scores.total ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            {result.issues.length > 0 && (
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {result.issues.slice(0, 8).map((msg, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-2xs text-warning-600 dark:text-warning-400">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                    <span>{msg}</span>
                  </div>
                ))}
                {result.issues.length > 8 && (
                  <div className="text-2xs text-gray-400 pl-4">… 共 {result.issues.length} 条</div>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-2xs text-gray-400">
              <Sparkles size={11} className="shrink-0" />
              应用后可通过拖拽继续手动调整，保存前按「保存」持久化
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
