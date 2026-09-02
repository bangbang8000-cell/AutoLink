/**
 * 48-b（F8-2）：版本历史快照文件导出/回导（纯逻辑层）
 * - buildPlanHistoryFile：聚合 current + 历史 → 可移植文件（按版本去重排序）
 * - parsePlanHistoryFile：解析校验 → 回导
 * - mergePlanHistory：回导合并（默认补齐缺失；overwrite 覆盖同版本）
 */
import { describe, it, expect } from 'vitest'
import {
  PLAN_HISTORY_FILE_FORMAT,
  PLAN_HISTORY_FILE_VERSION,
  buildPlanHistoryFile,
  parsePlanHistoryFile,
  parseVersionFromHistoryName,
  mergePlanHistory,
  type PlanHistoryEntry,
} from '@/utils/planHistoryFile'

describe('buildPlanHistoryFile（版本历史导出为文件）', () => {
  it('聚合 current + 历史并按版本号去重排序', () => {
    const json = buildPlanHistoryFile({
      projectName: 'P',
      projectId: 'PID',
      current: { meta: { planVersion: 3 } },
      history: [
        { name: 'v2.plan.json', plan: { meta: { planVersion: 2 } } },
        { name: 'v1.plan.json', plan: { meta: { planVersion: 1 } } },
        { name: 'v2.plan.json', plan: { meta: { planVersion: 2, dup: true } } },
      ],
    })
    const parsed = JSON.parse(json)
    expect(parsed.format).toBe(PLAN_HISTORY_FILE_FORMAT)
    expect(parsed.schemaVersion).toBe(PLAN_HISTORY_FILE_VERSION)
    expect(parsed.project).toEqual({ projectName: 'P', projectId: 'PID' })
    expect(parsed.current).toEqual({ meta: { planVersion: 3 } })
    expect(parsed.history.map((h: PlanHistoryEntry) => h.version)).toEqual([1, 2])
  })

  it('空历史也能导出（仅 current）', () => {
    const parsed = JSON.parse(buildPlanHistoryFile({ current: { x: 1 } }))
    expect(parsed.history).toEqual([])
  })
})

describe('parsePlanHistoryFile（版本历史文件回导）', () => {
  it('解析合法文件', () => {
    const json = buildPlanHistoryFile({
      history: [{ name: 'v1.plan.json', plan: { meta: { planVersion: 1 } } }],
    })
    const r = parsePlanHistoryFile(json)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.history).toHaveLength(1)
  })

  it('非法 JSON / 格式不符 / 版本不符 / history 缺失或条目非法 → 失败', () => {
    expect(parsePlanHistoryFile('x').ok).toBe(false)
    expect(parsePlanHistoryFile(JSON.stringify({ format: 'other', schemaVersion: 1, history: [] })).ok).toBe(false)
    expect(parsePlanHistoryFile(JSON.stringify({ format: PLAN_HISTORY_FILE_FORMAT, schemaVersion: 9, history: [] })).ok).toBe(false)
    expect(parsePlanHistoryFile(JSON.stringify({ format: PLAN_HISTORY_FILE_FORMAT, schemaVersion: 1 })).ok).toBe(false)
    expect(parsePlanHistoryFile(JSON.stringify({ format: PLAN_HISTORY_FILE_FORMAT, schemaVersion: 1, history: [{ version: 0, plan: {} }] })).ok).toBe(false)
  })
})

describe('parseVersionFromHistoryName / mergePlanHistory', () => {
  it('从文件名解析版本号', () => {
    expect(parseVersionFromHistoryName('v3.plan.json')).toBe(3)
    expect(parseVersionFromHistoryName('plan.json')).toBe(0)
    expect(parseVersionFromHistoryName('')).toBe(0)
  })

  it('合并默认补齐缺失版本（保留目标端既有版本）', () => {
    const target: PlanHistoryEntry[] = [
      { version: 1, plan: { meta: { planVersion: 1, src: 'local' } } },
    ]
    const incoming: PlanHistoryEntry[] = [
      { version: 1, plan: { meta: { planVersion: 1, src: 'pkg' } } },
      { version: 2, plan: { meta: { planVersion: 2 } } },
      { version: 3, plan: { meta: { planVersion: 3 } } },
    ]
    const r = mergePlanHistory(target, incoming)
    expect(r.added).toBe(2)
    expect(r.skipped).toBe(1)
    expect(r.merged.map((e) => e.version)).toEqual([1, 2, 3])
    expect(r.merged[0].plan).toEqual({ meta: { planVersion: 1, src: 'local' } })
  })

  it('overwrite 时覆盖目标端同版本', () => {
    const target: PlanHistoryEntry[] = [{ version: 1, plan: { a: 1 } }]
    const incoming: PlanHistoryEntry[] = [{ version: 1, plan: { a: 2 } }]
    const r = mergePlanHistory(target, incoming, { overwrite: true })
    expect(r.added).toBe(1)
    expect(r.merged[0].plan).toEqual({ a: 2 })
  })

  it('非法条目（version<1 / plan 为空）被忽略', () => {
    const r = mergePlanHistory([], [
      { version: 0, plan: {} },
      { version: 1, plan: { x: 1 } },
    ])
    expect(r.added).toBe(1)
    expect(r.merged).toHaveLength(1)
  })
})
