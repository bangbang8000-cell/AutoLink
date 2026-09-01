/**
 * F2-5（42-e）：性能仪表盘面板（渲染耗时/内存/操作耗时/基准对比 一处可查，本地采集不遥测）
 * - 内存：performance.memory JS 堆（每秒刷新）
 * - 操作耗时：perf 环形缓冲（设计/渲染/优化/导出…）+ 手动测量按钮
 * - 渲染耗时：longtask 观察 + 合成大列表渲染测量点
 * - 基准对比：scripts/bench_perf.py 达标阈值参考
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Cpu, Gauge, MemoryStick, Play, RefreshCw, Trash2 } from 'lucide-react'
import {
  subscribe,
  getSnapshot,
  getOps,
  getOpStats,
  clearOps,
  clearRenderMetrics,
  startRenderObserver,
  stopRenderObserver,
  getRenderMetrics,
  getMemoryInfo,
  getBenchmarkReference,
  formatMs,
  formatMB,
  measureSync,
  runSyntheticRender,
  type PerfCategory,
} from '@/utils/perf'
import { serializeDesignState } from '@/utils/designSnapshot'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'

const CATEGORY_ORDER: PerfCategory[] = ['design', 'render', 'optimize', 'export', 'save', 'load', 'other']

const categoryLabelKey = (c: PerfCategory): string => `common:performancePanel.categories.${c}`

function CategoryBadge({ category }: { category: PerfCategory }) {
  const { t } = useTranslation()
  const palette: Record<PerfCategory, string> = {
    design: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    render: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    optimize: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    export: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    save: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    load: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    other: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  }
  return (
    <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${palette[category]}`}>
      {t(categoryLabelKey(category))}
    </span>
  )
}

function SectionTitle({ icon, children, right }: { icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <span className="flex items-center gap-1.5 text-2xs font-semibold text-gray-600 dark:text-gray-300">
        {icon}
        {children}
      </span>
      {right}
    </div>
  )
}

export function PerformancePanel() {
  const { t } = useTranslation()
  // 订阅 perf 状态：记录新增/清空/渲染任务变更时触发重渲染
  useSyncExternalStore(subscribe, getSnapshot)
  const [memory, setMemory] = useState(() => getMemoryInfo())

  // 内存每秒刷新
  useEffect(() => {
    const timer = window.setInterval(() => setMemory(getMemoryInfo()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // 挂载时启动渲染长任务观察（面板卸载即停止）
  useEffect(() => {
    const stop = startRenderObserver()
    return () => {
      stop()
      stopRenderObserver()
    }
  }, [])

  const ops = getOps()
  const renderMetrics = getRenderMetrics()
  const benchmark = getBenchmarkReference()

  const handleMeasureDesign = () => {
    const room = useRoomStore.getState()
    const rack = useRackStore.getState()
    if (!room.matrix && rack.cabinets.length === 0) return
    measureSync(t('common:performancePanel.operations.designMeasureLabel', '设计状态序列化'), 'design', () => {
      const snap = serializeDesignState(room, rack, { name: '性能测量' })
      // 强制完整序列化，避免惰性求值
      return JSON.stringify(snap).length
    })
  }

  const handleMeasureRender = () => {
    runSyntheticRender(20000)
  }

  return (
    <div className="h-full overflow-auto bg-white dark:bg-app-surface p-2.5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
          <Gauge size={13} className="text-primary-500" />
          {t('common:performancePanel.title')}
        </span>
        <button
          onClick={() => { clearOps(); clearRenderMetrics() }}
          className="p-1 hover:bg-gray-200 dark:hover:bg-app-hover rounded"
          title={t('common:performancePanel.clear')}
        >
          <Trash2 size={12} className="text-gray-400" />
        </button>
      </div>

      {/* 内存 */}
      <section>
        <SectionTitle icon={<MemoryStick size={12} className="text-gray-400" />}>
          {t('common:performancePanel.memory.title')}
        </SectionTitle>
        {memory.available ? (
          <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-gray-200 dark:divide-edge-subtle text-center">
              <StatCell label={t('common:performancePanel.memory.used')} value={formatMB(memory.usedJsHeapMB)} />
              <StatCell label={t('common:performancePanel.memory.total')} value={formatMB(memory.totalJsHeapMB)} />
              <StatCell label={t('common:performancePanel.memory.limit')} value={formatMB(memory.jsHeapLimitMB)} />
            </div>
            {memory.jsHeapUsedPct != null && (
              <div className="h-1 bg-gray-100 dark:bg-app-hover">
                <div
                  className="h-full bg-primary-500 transition-all"
                  style={{ width: `${Math.min(100, memory.jsHeapUsedPct)}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <p className="text-2xs text-gray-400">{t('common:performancePanel.memory.unavailable')}</p>
        )}
        {memory.deviceMemoryGB != null && (
          <p className="mt-1 text-2xs text-gray-400">
            {t('common:performancePanel.memory.deviceMemory')}: {memory.deviceMemoryGB} GB
          </p>
        )}
      </section>

      {/* 操作耗时 */}
      <section>
        <SectionTitle
          icon={<Cpu size={12} className="text-gray-400" />}
          right={
            <div className="flex items-center gap-1">
              <button
                onClick={handleMeasureDesign}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
              >
                <Play size={10} />{t('common:performancePanel.operations.measureDesign')}
              </button>
            </div>
          }
        >
          {t('common:performancePanel.operations.title')}
        </SectionTitle>
        {ops.length === 0 ? (
          <p className="text-2xs text-gray-400">{t('common:performancePanel.operations.empty')}</p>
        ) : (
          <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
            <table className="w-full text-2xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-app-hover text-gray-500 dark:text-gray-400">
                  <th className="text-left font-medium px-1.5 py-1">{t('common:performancePanel.operations.category')}</th>
                  <th className="text-left font-medium px-1.5 py-1">{t('common:performancePanel.operations.label')}</th>
                  <th className="text-right font-medium px-1.5 py-1">{t('common:performancePanel.operations.duration')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-edge-subtle">
                {ops.slice(-12).reverse().map((op) => (
                  <tr key={op.id} className="hover:bg-gray-50 dark:hover:bg-app-hover">
                    <td className="px-1.5 py-0.5"><CategoryBadge category={op.category} /></td>
                    <td className="px-1.5 py-0.5 text-gray-600 dark:text-gray-300 truncate max-w-[180px]">{op.label}</td>
                    <td className="px-1.5 py-0.5 text-right font-mono tabular-nums text-gray-700 dark:text-gray-200">
                      {formatMs(op.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-1.5 py-1 border-t border-gray-100 dark:border-edge-subtle text-[10px] text-gray-400 space-y-0.5">
              {CATEGORY_ORDER.map((c) => {
                const s = getOpStats(c)
                if (!s) return null
                return (
                  <div key={c} className="flex items-center gap-1.5">
                    <CategoryBadge category={c} />
                    <span>
                      {s.count}× · avg {formatMs(s.avgMs)} · max {formatMs(s.maxMs)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* 渲染耗时 */}
      <section>
        <SectionTitle
          icon={<Activity size={12} className="text-gray-400" />}
          right={
            <button
              onClick={handleMeasureRender}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
            >
              <Play size={10} />{t('common:performancePanel.render.run')}
            </button>
          }
        >
          {t('common:performancePanel.render.title')}
          <span
            className={`ml-1 inline-flex items-center gap-1 text-[10px] ${
              renderMetrics.observing ? 'text-success-500' : 'text-gray-400'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${renderMetrics.observing ? 'bg-success-500' : 'bg-gray-300'}`} />
            {renderMetrics.observing
              ? t('common:performancePanel.render.observing')
              : t('common:performancePanel.render.stopped')}
          </span>
        </SectionTitle>
        <div className="grid grid-cols-4 gap-1">
          <StatCell label={t('common:performancePanel.render.count')} value={String(renderMetrics.count)} />
          <StatCell label={t('common:performancePanel.render.avg')} value={formatMs(renderMetrics.avgMs)} />
          <StatCell label={t('common:performancePanel.render.max')} value={formatMs(renderMetrics.maxMs)} />
          <StatCell label={t('common:performancePanel.render.total')} value={formatMs(renderMetrics.totalMs)} />
        </div>
      </section>

      {/* 基准对比 */}
      <section>
        <SectionTitle icon={<RefreshCw size={12} className="text-gray-400" />}>
          {t('common:performancePanel.benchmark.title')}
        </SectionTitle>
        <p className="text-[10px] text-gray-400 mb-1">{t('common:performancePanel.benchmark.desc')}</p>
        <div className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
          <table className="w-full text-2xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-app-hover text-gray-500 dark:text-gray-400">
                <th className="text-left font-medium px-1.5 py-1">{t('common:performancePanel.operations.label')}</th>
                <th className="text-right font-medium px-1.5 py-1">{t('common:performancePanel.benchmark.threshold')}</th>
                <th className="text-left font-medium px-1.5 py-1 hidden sm:table-cell">{t('common:performancePanel.benchmark.source')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-edge-subtle">
              {benchmark.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-app-hover">
                  <td className="px-1.5 py-0.5 text-gray-600 dark:text-gray-300">{b.label}</td>
                  <td className="px-1.5 py-0.5 text-right font-mono tabular-nums text-gray-700 dark:text-gray-200">
                    ≤ {formatMs(b.thresholdMs)}
                  </td>
                  <td className="px-1.5 py-0.5 text-gray-400 hidden sm:table-cell">{b.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[10px] text-gray-400">{t('common:performancePanel.benchmark.note')}</p>
      </section>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-1.5 py-1 text-center">
      <div className="text-xs font-mono tabular-nums text-gray-800 dark:text-gray-100">{value}</div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  )
}
