/**
 * M-F1（PRD v3.6）：版本差异纯函数测试
 * - H-1 diffPlans 正确性：changed/added/removed/unchanged + 嵌套对象/数组扁平化递归
 * - H-3 回滚往返含存档：planRollback 存档当前版本（新版本号）→ 以目标覆盖（新版本号 +1）
 * - buildVersionList 解析与排序
 */
import { describe, it, expect } from 'vitest'
import {
  diffPlans,
  buildVersionList,
  planRollback,
} from '@/utils/planVersionDiff'

const makeMacro = (overrides: Record<string, unknown> = {}) => ({
  site: 'BJ01',
  gpuCount: 64,
  pfcQueue: 3,
  cnpQueue: 6,
  bgpMaxPaths: 16,
  convergence: 1.0,
  rails: 8,
  naming: { format: '{site}-R{rack:02d}-AIDC-{vendor}-{abbr}-{seq:02d}', abbr: { SPINE: 'P-Spine', LEAF: 'P-Leaf' } },
  ipSegments: { loopback: '10.1.0.0/20', compute: '10.1.16.0/20' },
  vlanRanges: { compute: [100, 199], storage: [200, 299] },
  asRange: [65001, 65500],
  ospf: { process: 10, area: '0.0.0.0' },
  deviceModels: { SPINE: 'H3C S9827', LEAF: 'H3C S9827' },
  ...overrides,
})

const makePlan = (version: number, macro: Record<string, unknown>): Record<string, unknown> => ({
  meta: { projectId: 'p1', projectName: 'demo', planVersion: version, planHash: `hash-${version}`, generatedAt: `2026-08-29T00:00:0${version}Z` },
  macro,
  topology: { layers: 2, spines: 2, leaves: 8 },
})

describe('diffPlans（H-1 字段级 diff）', () => {
  it('相同对象 → 全部 unchanged', () => {
    const a = makeMacro()
    const d = diffPlans(a, makeMacro())
    expect(d.length).toBeGreaterThan(0)
    expect(d.every((e) => e.status === 'unchanged')).toBe(true)
    expect(d.every((e) => e.oldValue === e.newValue)).toBe(true)
  })

  it('标量变更 → changed（含嵌套对象叶子路径）', () => {
    const a = makeMacro({ gpuCount: 64, convergence: 1.0 })
    const b = makeMacro({ gpuCount: 128, convergence: 1.2 })
    const d = diffPlans(a, b)
    const gpu = d.find((e) => e.path === 'gpuCount')
    expect(gpu?.status).toBe('changed')
    expect(gpu?.oldValue).toBe(64)
    expect(gpu?.newValue).toBe(128)
    const conv = d.find((e) => e.path === 'convergence')
    expect(conv?.status).toBe('changed')
  })

  it('嵌套对象叶子变更 → 子路径 changed，顶层不整体变更', () => {
    const a = makeMacro({ ipSegments: { loopback: '10.1.0.0/20', compute: '10.1.16.0/20' } })
    const b = makeMacro({ ipSegments: { loopback: '10.2.0.0/20', compute: '10.1.16.0/20' } })
    const d = diffPlans(a, b)
    const loopback = d.find((e) => e.path === 'ipSegments.loopback')
    expect(loopback?.status).toBe('changed')
    expect(loopback?.oldValue).toBe('10.1.0.0/20')
    expect(loopback?.newValue).toBe('10.2.0.0/20')
    const compute = d.find((e) => e.path === 'ipSegments.compute')
    expect(compute?.status).toBe('unchanged')
    // 扁平化：容器对象 ipSegments 不作为独立叶子出现，仅叶子路径参与 diff
    expect(d.find((e) => e.path === 'ipSegments')).toBeUndefined()
    expect(d.some((e) => e.path.startsWith('ipSegments') && e.status === 'changed')).toBe(true)
  })

  it('数组元素级 diff（asRange / vlanRanges）', () => {
    const a = makeMacro({ asRange: [65001, 65500], vlanRanges: { compute: [100, 199] } })
    const b = makeMacro({ asRange: [65001, 65510], vlanRanges: { compute: [100, 200] } })
    const d = diffPlans(a, b)
    const as1 = d.find((e) => e.path === 'asRange[1]')
    expect(as1?.status).toBe('changed')
    expect(as1?.oldValue).toBe(65500)
    expect(as1?.newValue).toBe(65510)
    const vlan1 = d.find((e) => e.path === 'vlanRanges.compute[1]')
    expect(vlan1?.status).toBe('changed')
  })

  it('added / removed 字段', () => {
    const a = makeMacro({ site: 'BJ01', rails: 8 })
    const b = makeMacro({ site: 'BJ01', rails: 8, siteName: '北京一号' })
    const d = diffPlans(a, b)
    expect(d.find((e) => e.path === 'siteName')?.status).toBe('added')
    expect(d.find((e) => e.path === 'siteName')?.newValue).toBe('北京一号')
    const a2 = makeMacro({ site: 'BJ01', legacy: 'x' })
    const b2 = makeMacro({ site: 'BJ01' })
    const d2 = diffPlans(a2, b2)
    expect(d2.find((e) => e.path === 'legacy')?.status).toBe('removed')
    expect(d2.find((e) => e.path === 'legacy')?.oldValue).toBe('x')
  })

  it('空对象/空数组作为原子值处理', () => {
    const a = { emptyObj: {}, emptyArr: [] }
    const b = { emptyObj: {}, emptyArr: [] }
    const d = diffPlans(a, b)
    expect(d.every((e) => e.status === 'unchanged')).toBe(true)
    const d2 = diffPlans({ emptyArr: [] }, { emptyArr: [1] })
    expect(d2.find((e) => e.path === 'emptyArr[0]')?.status).toBe('added')
  })

  it('路径排序稳定（localeCompare 升序）', () => {
    const a = makeMacro()
    const b = makeMacro({ site: 'BJ02' })
    const d = diffPlans(a, b)
    const paths = d.map((e) => e.path)
    expect([...paths].sort((x, y) => x.localeCompare(y))).toEqual(paths)
  })

  it('非对象输入（null / undefined）健壮性', () => {
    expect(diffPlans(null, null)).toEqual([])
    expect(diffPlans(undefined, undefined)).toEqual([])
    const d = diffPlans(undefined, { a: 1 })
    expect(d.find((e) => e.path === 'a')?.status).toBe('added')
  })
})

describe('buildVersionList', () => {
  const file = (name: string, content: string | null) => ({ name, content })

  it('按版本号升序解析（忽略非 v*.plan.json 文件）', () => {
    const files = [
      file('v3.plan.json', JSON.stringify(makePlan(3, makeMacro()))),
      file('v1.plan.json', JSON.stringify(makePlan(1, makeMacro()))),
      file('v2.plan.json', JSON.stringify(makePlan(2, makeMacro()))),
      file('README.md', 'x'),
      file('v10.plan.json', JSON.stringify(makePlan(10, makeMacro()))),
    ]
    const list = buildVersionList(files)
    expect(list.map((e) => e.version)).toEqual([1, 2, 3, 10])
    expect(list[0].fileName).toBe('v1.plan.json')
    expect(list[3].fileName).toBe('v10.plan.json')
  })

  it('损坏 JSON / 空内容 / 非对象根 被跳过', () => {
    const files = [
      file('v1.plan.json', JSON.stringify(makePlan(1, makeMacro()))),
      file('v2.plan.json', null),
      file('v3.plan.json', '{bad json'),
      file('v4.plan.json', JSON.stringify([1, 2])),
    ]
    const list = buildVersionList(files)
    expect(list.map((e) => e.version)).toEqual([1])
  })

  it('提取 macro / meta（planHash / generatedAt）', () => {
    const files = [file('v1.plan.json', JSON.stringify(makePlan(1, makeMacro({ gpuCount: 128 }))))]
    const [entry] = buildVersionList(files)
    expect(entry.planHash).toBe('hash-1')
    expect(entry.generatedAt).toContain('2026-08-29')
    expect(entry.macro.gpuCount).toBe(128)
  })

  it('meta.planVersion 缺失时回退文件名序号', () => {
    const plan = makePlan(5, makeMacro())
    delete (plan.meta as Record<string, unknown>).planVersion
    const files = [file('v7.plan.json', JSON.stringify(plan))]
    expect(buildVersionList(files)[0].version).toBe(7)
  })
})

describe('planRollback（H-3 回滚往返含存档）', () => {
  const current = makePlan(4, makeMacro({ gpuCount: 64 }))
  const target = makePlan(1, makeMacro({ gpuCount: 128 }))

  it('存档当前版本（新版本号 +1），目标覆盖为新版本号 +2', () => {
    const r = planRollback(current, target)
    expect(r.archivedVersion).toBe(5)
    expect(r.newVersion).toBe(6)
    expect(r.archived.fileName).toBe('v5.plan.json')
    // 存档内容 = 当前 plan，版本号更新为 5
    expect(r.archived.plan.macro).toEqual(current.macro)
    expect((r.archived.plan.meta as Record<string, unknown>).planVersion).toBe(5)
    expect((r.archived.plan.meta as Record<string, unknown>).archivedAt).toBeDefined()
    // 回滚后当前内容 = 目标 macro，版本号更新为 6
    expect(r.restored.macro).toEqual(target.macro)
    expect((r.restored.meta as Record<string, unknown>).planVersion).toBe(6)
    expect((r.restored.meta as Record<string, unknown>).generatedAt).toBeDefined()
  })

  it('回滚往返：restored 与 archived 宏观不同且各自 planHash 随 macro 一致', () => {
    const r = planRollback(current, target)
    const restoredMacro = r.restored.macro as Record<string, unknown>
    const archivedMacro = r.archived.macro as Record<string, unknown>
    expect(restoredMacro.gpuCount).toBe(128)
    expect(archivedMacro.gpuCount).toBe(64)
    // 往返后可用 diffPlans 还原出差异
    const d = diffPlans(archivedMacro, restoredMacro)
    expect(d.find((e) => e.path === 'gpuCount')?.status).toBe('changed')
  })

  it('无 meta 的极简输入也可归档（版本号从 0 起）', () => {
    const r = planRollback({ macro: makeMacro() }, { macro: makeMacro({ site: 'SH01' }) })
    expect(r.archivedVersion).toBe(1)
    expect(r.newVersion).toBe(2)
    expect(r.archived.plan.macro).toEqual(makeMacro())
  })
})
