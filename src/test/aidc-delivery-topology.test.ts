/**
 * AL-P2：交付包「拓扑图.png」渲染源选择逻辑单测（设计优先、plan 兜底）。
 *
 * PNG 渲染依赖 DOM（react-flow / html-to-image），不便在 jsdom 中跑真实截图；
 * 故把「选择渲染源」抽成纯函数 pickDeliveryTopologyRenderer 单测，
 * 渲染调用 renderDeliveryTopologyPng 保持薄壳（渲染器注入，可 mock 验证回退）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PlanSummary } from '@/components/aidc/aidcTypes'
import type { ProjectTopologyJson } from '@/utils/deliveryTopologyRenderer'
import {
  pickDeliveryTopologyRenderer,
  renderDeliveryTopologyPng,
  parseProjectTopology,
} from '@/utils/deliveryTopologyRenderer'

const plan = {
  deviceList: [{ role: 'SPINE', name: 'Spine-01' }],
  connections: [],
} as unknown as PlanSummary

const designTopology: ProjectTopologyJson = {
  topology: {
    nodes: [{ id: 'Spine-01', type: 'param_spine', group: '参数网', podid: '' }],
    edges: [],
  },
  layout: null,
}

describe('pickDeliveryTopologyRenderer（渲染源选择：设计优先、plan 兜底）', () => {
  it('有设计拓扑 → 选 design', () => {
    expect(pickDeliveryTopologyRenderer(designTopology, plan)).toBe('design')
  })

  it('缺设计拓扑（null/undefined）→ 选 plan', () => {
    expect(pickDeliveryTopologyRenderer(null, plan)).toBe('plan')
    expect(pickDeliveryTopologyRenderer(undefined, plan)).toBe('plan')
  })

  it('设计拓扑节点为空/结构不完整 → 选 plan', () => {
    expect(pickDeliveryTopologyRenderer({ topology: { nodes: [], edges: [] }, layout: null }, plan)).toBe('plan')
    expect(pickDeliveryTopologyRenderer({ topology: null, layout: null }, plan)).toBe('plan')
    expect(pickDeliveryTopologyRenderer({}, plan)).toBe('plan')
  })
})

describe('renderDeliveryTopologyPng（design 渲染失败回退 plan）', () => {
  const renderPlan = vi.fn(async (p: PlanSummary) => `plan-png:${p.deviceList.length}`)
  beforeEach(() => {
    renderPlan.mockClear()
  })

  it('选 design 时走设计渲染', async () => {
    const renderDesign = vi.fn(async () => 'design-png')
    const out = await renderDeliveryTopologyPng(designTopology, plan, { renderDesign, renderPlan })
    expect(renderDesign).toHaveBeenCalledTimes(1)
    expect(renderPlan).not.toHaveBeenCalled()
    expect(out).toBe('design-png')
  })

  it('设计渲染失败 → 回退 plan 渲染', async () => {
    const renderDesign = vi.fn(async () => {
      throw new Error('design render failed')
    })
    const out = await renderDeliveryTopologyPng(designTopology, plan, { renderDesign, renderPlan })
    expect(renderDesign).toHaveBeenCalledTimes(1)
    expect(renderPlan).toHaveBeenCalledTimes(1)
    expect(out).toBe('plan-png:1')
  })

  it('无设计拓扑 → 直接 plan 渲染（不触发设计渲染）', async () => {
    const renderDesign = vi.fn(async () => 'design-png')
    const out = await renderDeliveryTopologyPng(null, plan, { renderDesign, renderPlan })
    expect(renderDesign).not.toHaveBeenCalled()
    expect(renderPlan).toHaveBeenCalledTimes(1)
    expect(out).toBe('plan-png:1')
  })
})

describe('parseProjectTopology（topology.json 解析，非法输入回退 plan）', () => {
  it('合法 JSON → 结构化对象', () => {
    const parsed = parseProjectTopology(JSON.stringify(designTopology))
    expect(parsed?.topology?.nodes?.length).toBe(1)
  })

  it('非法 JSON → null（触发 plan 兜底）', () => {
    expect(parseProjectTopology('not-json{')).toBeNull()
  })
})