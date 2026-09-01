/**
 * F2-5（42-e）：性能仪表盘采集（渲染层纯逻辑，本地采集不遥测）
 * - 操作耗时：recordOp / measureSync / measureAsync → 按分类环形缓冲（设计/渲染/优化/导出…）
 * - 内存：performance.memory（JS 堆）+ deviceMemory，不可用时优雅降级
 * - 渲染耗时：PerformanceObserver('longtask') 捕获渲染长任务 + measureRender/runSyntheticRender 手动测量点
 * - 基准对比：BENCH_REFERENCE 引用 scripts/bench_perf.py 达标阈值（2048 GPU ≤30s / 225 柜 ≤5s）
 * - 通知：subscribe/getOps 供 React useSyncExternalStore 订阅刷新
 */

export type PerfCategory = 'design' | 'render' | 'optimize' | 'export' | 'save' | 'load' | 'other'

export interface PerfEntry {
  id: string
  category: PerfCategory
  label: string
  durationMs: number
  startedAt: number
}

export interface RenderTask {
  startTime: number
  durationMs: number
  name?: string
}

/** 单分类操作耗时的环形缓冲上限 */
export const PERF_MAX_ENTRIES_PER_CATEGORY = 50
/** 渲染长任务保留上限 */
export const PERF_MAX_RENDER_TASKS = 200
/** 全局操作记录上限（多分类总和的保险阀） */
const PERF_GLOBAL_CAP = PERF_MAX_ENTRIES_PER_CATEGORY * 8

interface PerfState {
  ops: PerfEntry[]
  renderLongTasks: RenderTask[]
  renderObserving: boolean
}

let state: PerfState = { ops: [], renderLongTasks: [], renderObserving: false }
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): PerfState {
  return state
}

export function resetPerf(): void {
  stopRenderObserver()
  state = { ops: [], renderLongTasks: [], renderObserving: false }
  emit()
}

let seq = 0

export function recordOp(
  category: PerfCategory,
  label: string,
  durationMs: number,
  now: number = performance.now(),
): PerfEntry {
  const entry: PerfEntry = {
    id: `perf-${Date.now()}-${++seq}`,
    category,
    label,
    durationMs: Math.max(0, durationMs),
    startedAt: now - Math.max(0, durationMs),
  }
  let list = [...state.ops, entry]
  // 单分类环形：只保留该分类最近 N 条
  let toTrim = list.filter((e) => e.category === category).length - PERF_MAX_ENTRIES_PER_CATEGORY
  if (toTrim > 0) {
    list = list.filter((e) => {
      if (e.category === category && toTrim > 0) {
        toTrim--
        return false
      }
      return true
    })
  }
  // 全局保险阀
  if (list.length > PERF_GLOBAL_CAP) list = list.slice(-PERF_GLOBAL_CAP)
  state = { ...state, ops: list }
  emit()
  return entry
}

export function getOps(category?: PerfCategory): PerfEntry[] {
  if (!category) return state.ops
  return state.ops.filter((e) => e.category === category)
}

export function clearOps(category?: PerfCategory): void {
  state = { ...state, ops: category ? state.ops.filter((e) => e.category !== category) : [] }
  emit()
}

export interface OpStats {
  count: number
  avgMs: number
  maxMs: number
  minMs: number
  totalMs: number
}

export function getOpStats(category?: PerfCategory): OpStats | null {
  const ops = getOps(category)
  if (ops.length === 0) return null
  const totalMs = ops.reduce((a, e) => a + e.durationMs, 0)
  return {
    count: ops.length,
    avgMs: totalMs / ops.length,
    maxMs: Math.max(...ops.map((e) => e.durationMs)),
    minMs: Math.min(...ops.map((e) => e.durationMs)),
    totalMs,
  }
}

/* ---------------- 测量辅助 ---------------- */

export function measureSync<T>(label: string, category: PerfCategory, fn: () => T): T {
  const t0 = performance.now()
  try {
    return fn()
  } finally {
    recordOp(category, label, performance.now() - t0, performance.now())
  }
}

export async function measureAsync<T>(
  label: string,
  category: PerfCategory,
  fn: () => Promise<T> | T,
): Promise<T> {
  const t0 = performance.now()
  try {
    return await fn()
  } finally {
    recordOp(category, label, performance.now() - t0, performance.now())
  }
}

export function measureRender<T>(label: string, fn: () => T): T {
  return measureSync(label, 'render', fn)
}

/* ---------------- 内存采集 ---------------- */

interface MemoryInfo {
  available: boolean
  usedJsHeapMB: number | null
  totalJsHeapMB: number | null
  jsHeapLimitMB: number | null
  jsHeapUsedPct: number | null
  deviceMemoryGB: number | null
}

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
}

export function getMemoryInfo(): MemoryInfo {
  const mem = (performance as PerformanceWithMemory).memory
  const used = mem?.usedJSHeapSize ?? null
  const total = mem?.totalJSHeapSize ?? null
  const limit = mem?.jsHeapSizeLimit ?? null
  const deviceMemory =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null)
      : null
  return {
    available: used != null,
    usedJsHeapMB: used != null ? used / (1024 * 1024) : null,
    totalJsHeapMB: total != null ? total / (1024 * 1024) : null,
    jsHeapLimitMB: limit != null ? limit / (1024 * 1024) : null,
    jsHeapUsedPct: used != null && limit ? (used / limit) * 100 : null,
    deviceMemoryGB: deviceMemory,
  }
}

/* ---------------- 渲染耗时（longtask） ---------------- */

interface PerfObserver {
  observe: (opts: { entryTypes: string[] }) => void
  disconnect: () => void
}

type PerfObserverEntryList = { getEntries: () => Array<{ startTime: number; duration: number; name?: string }> }

let observer: PerfObserver | null = null

export function startRenderObserver(): () => void {
  if (state.renderObserving) return () => {}
  const Ctor = (
    globalThis as {
      PerformanceObserver?: new (cb: (list: PerfObserverEntryList) => void) => PerfObserver
    }
  ).PerformanceObserver
  if (!Ctor) return () => {}
  try {
    observer = new Ctor((list) => {
      const entries = list
        .getEntries()
        .map((en) => ({ startTime: en.startTime, durationMs: en.duration, name: en.name }))
      if (entries.length === 0) return
      const next = [...state.renderLongTasks, ...entries].slice(-PERF_MAX_RENDER_TASKS)
      state = { ...state, renderLongTasks: next }
      emit()
    })
    observer.observe({ entryTypes: ['longtask'] })
    state = { ...state, renderObserving: true }
    emit()
  } catch {
    // 环境不支持时静默降级
  }
  return () => {
    stopRenderObserver()
  }
}

export function stopRenderObserver(): void {
  if (observer) {
    try {
      observer.disconnect()
    } catch {
      // ignore
    }
    observer = null
  }
  if (state.renderObserving) {
    state = { ...state, renderObserving: false }
    emit()
  }
}

export interface RenderMetrics {
  count: number
  avgMs: number
  maxMs: number
  totalMs: number
  lastMs: number
  observing: boolean
}

export function getRenderMetrics(): RenderMetrics {
  const tasks = state.renderLongTasks
  if (tasks.length === 0) {
    return { count: 0, avgMs: 0, maxMs: 0, totalMs: 0, lastMs: 0, observing: state.renderObserving }
  }
  const totalMs = tasks.reduce((a, t) => a + t.durationMs, 0)
  return {
    count: tasks.length,
    avgMs: totalMs / tasks.length,
    maxMs: Math.max(...tasks.map((t) => t.durationMs)),
    totalMs,
    lastMs: tasks[tasks.length - 1].durationMs,
    observing: state.renderObserving,
  }
}

export function clearRenderMetrics(): void {
  state = { ...state, renderLongTasks: [] }
  emit()
}

/** 合成大列表渲染测量点：构建 nodeCount 个 DOM 节点并强制布局，记录为 render 操作 */
export function runSyntheticRender(nodeCount = 20000): number {
  const t0 = performance.now()
  const frag = document.createDocumentFragment()
  for (let i = 0; i < nodeCount; i++) {
    const div = document.createElement('div')
    div.setAttribute('data-idx', String(i))
    div.textContent = String(i)
    frag.appendChild(div)
  }
  const host = document.createElement('div')
  host.appendChild(frag)
  // 强制布局/样式计算
  void host.offsetHeight
  const ms = performance.now() - t0
  recordOp('render', `合成大列表渲染 ${nodeCount} 节点`, ms, performance.now())
  return ms
}

/* ---------------- 性能基准参考（对齐 scripts/bench_perf.py） ---------------- */

export interface BenchReference {
  id: string
  label: string
  thresholdMs: number
  description: string
}

export const BENCH_REFERENCE: BenchReference[] = [
  {
    id: 'design-2048',
    label: '2048 GPU 设计/渲染',
    thresholdMs: 30_000,
    description: 'bench_perf.py 场景 A',
  },
  {
    id: 'room-225',
    label: '225 柜机房落位',
    thresholdMs: 5_000,
    description: 'bench_perf.py 场景 B',
  },
]

export function getBenchmarkReference(): BenchReference[] {
  return BENCH_REFERENCE
}

/* ---------------- 格式化 ---------------- */

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms.toFixed(0)}ms`
}

export function formatMB(mb: number | null): string {
  if (mb == null) return '—'
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`
  return `${mb.toFixed(1)}MB`
}
