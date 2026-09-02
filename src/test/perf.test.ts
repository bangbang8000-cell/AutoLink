/**
 * F2-5（42-e / S-6）：性能仪表盘采集 单测（TDD，本地采集不遥测）
 * - P-1 操作耗时：recordOp 按分类环形缓冲；measureSync/measureAsync 采集真实耗时
 * - P-2 内存：getMemoryInfo 返回 JS 堆/设备内存（不可用时优雅降级）
 * - P-3 渲染耗时：startRenderObserver 捕获 longtask；measureRender 手动测量点
 * - P-4 基准对比：BENCH_REFERENCE 引用 scripts/bench_perf.py 阈值（2048 GPU ≤30s / 225 柜 ≤5s）
 * - P-5 格式化：formatMs / formatMB / subscribe 通知
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  recordOp,
  getOps,
  getOpStats,
  clearOps,
  measureSync,
  measureAsync,
  measureRender,
  getMemoryInfo,
  startRenderObserver,
  getRenderMetrics,
  runSyntheticRender,
  getBenchmarkReference,
  BENCH_REFERENCE,
  formatMs,
  formatMB,
  subscribe,
  resetPerf,
  PERF_MAX_ENTRIES_PER_CATEGORY,
  type PerfEntry,
} from '@/utils/perf'

beforeEach(() => {
  resetPerf()
})

describe('recordOp / getOps（P-1 操作耗时环形缓冲）', () => {
  it('记录操作并按分类查询', () => {
    recordOp('design', '设计序列化', 120)
    recordOp('render', '大列表渲染', 80)
    recordOp('design', '设计恢复', 60)
    const design = getOps('design')
    expect(design).toHaveLength(2)
    expect(design.map((e) => e.label)).toEqual(['设计序列化', '设计恢复'])
    expect(getOps('render')).toHaveLength(1)
    expect(getOps()).toHaveLength(3)
  })

  it('单分类环形缓冲：超过 PERF_MAX_ENTRIES_PER_CATEGORY 淘汰最旧', () => {
    for (let i = 0; i < PERF_MAX_ENTRIES_PER_CATEGORY + 5; i++) {
      recordOp('export', `导出${i}`, i)
    }
    const ops = getOps('export')
    expect(ops).toHaveLength(PERF_MAX_ENTRIES_PER_CATEGORY)
    expect(ops[0].label).toBe('导出5')
  })

  it('getOpStats 给出 count/avg/max/min/total', () => {
    recordOp('optimize', '优化1', 100)
    recordOp('optimize', '优化2', 300)
    const s = getOpStats('optimize')
    expect(s).not.toBeNull()
    expect(s!.count).toBe(2)
    expect(s!.avgMs).toBe(200)
    expect(s!.maxMs).toBe(300)
    expect(s!.minMs).toBe(100)
    expect(s!.totalMs).toBe(400)
    expect(getOpStats('save')).toBeNull()
  })

  it('clearOps 清空（可按分类）', () => {
    recordOp('design', 'a', 1)
    recordOp('render', 'b', 2)
    clearOps('design')
    expect(getOps('design')).toHaveLength(0)
    expect(getOps()).toHaveLength(1)
  })
})

describe('measureSync / measureAsync（P-1 耗时采集）', () => {
  it('measureSync 返回结果并记录耗时', () => {
    const r = measureSync('同步测量', 'design', () => {
      let x = 0
      for (let i = 0; i < 1000; i++) x += i
      return x
    })
    expect(r).toBeGreaterThan(0)
    const ops = getOps('design')
    expect(ops).toHaveLength(1)
    expect(ops[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('measureAsync 等待异步完成并记录耗时', async () => {
    const r = await measureAsync('异步测量', 'load', async () => {
      await new Promise((res) => setTimeout(res, 80))
      return 'done'
    })
    expect(r).toBe('done')
    const ops = getOps('load')
    expect(ops).toHaveLength(1)
    expect(ops[0].durationMs).toBeGreaterThanOrEqual(60)
  })

  it('measureAsync 异常时仍记录耗时并抛出', async () => {
    await expect(
      measureAsync('失败测量', 'other', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(getOps('other')).toHaveLength(1)
  })
})

describe('getMemoryInfo（P-2 内存）', () => {
  it('返回结构完整；JS 堆不可用时 available=false 且值为 null', () => {
    const m = getMemoryInfo()
    expect(typeof m.available).toBe('boolean')
    expect('usedJsHeapMB' in m).toBe(true)
    expect('totalJsHeapMB' in m).toBe(true)
    expect('deviceMemoryGB' in m).toBe(true)
    if (m.available) {
      expect(typeof m.usedJsHeapMB).toBe('number')
      expect(m.usedJsHeapMB!).toBeGreaterThanOrEqual(0)
    } else {
      expect(m.usedJsHeapMB).toBeNull()
      expect(m.totalJsHeapMB).toBeNull()
    }
  })
})

describe('startRenderObserver（P-3 渲染耗时 longtask）', () => {
  it('捕获 longtask 并汇总 render metrics；stop 后停止', () => {
    let cb: ((list: { getEntries: () => unknown[] }) => void) | null = null
    class MockPerformanceObserver {
      constructor(fn: typeof cb) {
        cb = fn
      }
      observe(): void {}
      disconnect(): void {
        cb = null
      }
    }
    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver)
    const stop = startRenderObserver()
    expect(getRenderMetrics().observing).toBe(true)
    cb!({ getEntries: () => [{ startTime: 10, duration: 250, name: 'longtask' }] })
    cb!({ getEntries: () => [{ startTime: 30, duration: 150, name: 'longtask' }] })
    const m = getRenderMetrics()
    expect(m.count).toBe(2)
    expect(m.totalMs).toBe(400)
    expect(m.avgMs).toBe(200)
    expect(m.maxMs).toBe(250)
    stop()
    expect(getRenderMetrics().observing).toBe(false)
    vi.unstubAllGlobals()
  })

  it('PerformanceObserver 不可用时静默降级', () => {
    vi.stubGlobal('PerformanceObserver', undefined)
    const stop = startRenderObserver()
    expect(getRenderMetrics().observing).toBe(false)
    stop()
    vi.unstubAllGlobals()
  })
})

describe('measureRender / runSyntheticRender（P-3 大列表渲染测量点）', () => {
  it('measureRender 记录渲染耗时', () => {
    const r = measureRender('测量渲染', () => {
      let acc = 0
      for (let i = 0; i < 1000; i++) acc += i
      return acc
    })
    expect(r).toBeGreaterThan(0)
    expect(getOps('render').some((e) => e.label === '测量渲染')).toBe(true)
  })

  it('runSyntheticRender 构建大列表 DOM 并记录 render 操作', () => {
    const ms = runSyntheticRender(200)
    expect(ms).toBeGreaterThanOrEqual(0)
    const ops = getOps('render')
    expect(ops.some((e) => e.label.includes('合成大列表渲染'))).toBe(true)
    expect(ops.some((e) => e.label.includes('200'))).toBe(true)
  })
})

describe('BENCH_REFERENCE（P-4 基准对比）', () => {
  it('引用 bench_perf.py 达标阈值（2048 GPU ≤30s / 225 柜 ≤5s）', () => {
    const refs = getBenchmarkReference()
    const design = refs.find((r) => r.id === 'design-2048')
    const room = refs.find((r) => r.id === 'room-225')
    expect(design).toBeDefined()
    expect(design!.thresholdMs).toBe(30_000)
    expect(room).toBeDefined()
    expect(room!.thresholdMs).toBe(5_000)
    expect(BENCH_REFERENCE.length).toBeGreaterThanOrEqual(2)
  })
})

describe('formatMs / formatMB（P-5 格式化）', () => {
  it('formatMs：<1s 显示 ms，≥1s 显示 s', () => {
    expect(formatMs(500)).toBe('500ms')
    expect(formatMs(2500)).toBe('2.50s')
  })

  it('formatMB：≥1GB 显示 GB，否则 MB，null 显示占位', () => {
    expect(formatMB(512)).toBe('512.0MB')
    expect(formatMB(2048)).toBe('2.0GB')
    expect(formatMB(null)).toBe('—')
  })
})

describe('subscribe（通知机制，供 useSyncExternalStore）', () => {
  it('recordOp 触发订阅回调；退订后不再触发', () => {
    const listener = vi.fn()
    const unsub = subscribe(listener)
    recordOp('design', '通知', 10)
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
    recordOp('design', '通知2', 10)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('getSnapshot 返回含操作记录的快照', () => {
    recordOp('design', '快照操作', 5)
    const snap = getOps() as PerfEntry[]
    expect(snap.some((e) => e.label === '快照操作')).toBe(true)
  })
})
