import { describe, it, expect } from 'vitest'
import {
  shouldAutoFetchModels,
  buildModelOptions,
  AUTO_FETCH_MODELS_THROTTLE_MS,
} from '@/components/layout/SettingsPanel'

describe('shouldAutoFetchModels（AI-3 自动拉取节流判断）', () => {
  it('无 apiKey 时不拉取', () => {
    expect(shouldAutoFetchModels({ apiKey: '' })).toBe(false)
    expect(shouldAutoFetchModels({ apiKey: '   ' })).toBe(false)
  })

  it('有 apiKey 且从未拉取过 → 应拉取', () => {
    expect(shouldAutoFetchModels({ apiKey: 'sk-test', lastAutoFetchAt: null })).toBe(true)
  })

  it('节流窗口内不重复拉取（默认 30s）', () => {
    const now = 1_000_000
    expect(
      shouldAutoFetchModels({ apiKey: 'sk-test', lastAutoFetchAt: now - 10_000, now }),
    ).toBe(false)
    expect(
      shouldAutoFetchModels({ apiKey: 'sk-test', lastAutoFetchAt: now - AUTO_FETCH_MODELS_THROTTLE_MS + 1, now }),
    ).toBe(false)
  })

  it('超过节流窗口后允许再次拉取', () => {
    const now = 1_000_000
    expect(
      shouldAutoFetchModels({ apiKey: 'sk-test', lastAutoFetchAt: now - AUTO_FETCH_MODELS_THROTTLE_MS, now }),
    ).toBe(true)
    expect(
      shouldAutoFetchModels({ apiKey: 'sk-test', lastAutoFetchAt: now - 60_000, now }),
    ).toBe(true)
  })

  it('支持自定义节流窗口', () => {
    const now = 1_000_000
    expect(shouldAutoFetchModels({ apiKey: 'sk', lastAutoFetchAt: now - 5_000, now, throttleMs: 10_000 })).toBe(false)
    expect(shouldAutoFetchModels({ apiKey: 'sk', lastAutoFetchAt: now - 15_000, now, throttleMs: 10_000 })).toBe(true)
  })
})

describe('buildModelOptions（AI-3 下拉选项组装）', () => {
  it('优先级：本次拉取 > 已持久化 > 静态目录', () => {
    const opts = {
      fetched: ['m-fetched-1', 'm-fetched-2'],
      persisted: ['m-persisted-1'],
      catalog: ['m-catalog-1'],
    }
    const out = buildModelOptions(opts)
    expect(out[0]).toBe('m-fetched-1')
    expect(out).toEqual(['m-fetched-1', 'm-fetched-2', 'm-persisted-1', 'm-catalog-1'])
  })

  it('无本次拉取结果时回退已持久化，再回退静态目录', () => {
    expect(buildModelOptions({ fetched: [], persisted: ['p1'], catalog: ['c1'] })).toEqual(['p1', 'c1'])
    expect(buildModelOptions({ fetched: [], persisted: [], catalog: ['c1', 'c2'] })).toEqual(['c1', 'c2'])
    expect(buildModelOptions({ fetched: [], persisted: [], catalog: [] })).toEqual([])
  })

  it('跨来源去重保序（相同模型只保留最先出现的来源）', () => {
    const out = buildModelOptions({
      fetched: ['deepseek-chat'],
      persisted: ['deepseek-chat', 'deepseek-v4'],
      catalog: ['deepseek-chat'],
    })
    expect(out).toEqual(['deepseek-chat', 'deepseek-v4'])
  })

  it('并入当前值，保证下拉能选中当前模型', () => {
    const out = buildModelOptions({ fetched: ['m1'], catalog: ['m2'], current: 'm3' })
    expect(out).toEqual(['m1', 'm2', 'm3'])
  })

  it('忽略空字符串与重复的当前值', () => {
    expect(buildModelOptions({ fetched: ['m1', ''], current: 'm1' })).toEqual(['m1'])
    expect(buildModelOptions({ fetched: [], persisted: [], catalog: [], current: '' })).toEqual([])
  })
})