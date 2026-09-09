/**
 * 5.2.1-521-a/c：工作台状态机核心纯逻辑单测
 * - WORKBENCH_DEPENDENCIES：子视图声明式依赖图（前置条件）
 * - downstreamOf：变更指纹触发级联失效的传递闭包（下游置"待调整"）
 * - deriveWorkbenchState：状态推导（待调整/进行中/已完成/待操作），取代旧 deriveSubviewStatus 三态
 * - fingerprintConfig：设计配置变更指纹（sha256 canonical JSON）
 * 纯函数测试（不依赖 store 实例 / jsdom）。
 */
import { describe, it, expect } from 'vitest'
import {
  downstreamOf,
  deriveWorkbenchState,
  fingerprintConfig,
  renderGateReady,
  WORKBENCH_DEPENDENCIES,
} from '@/utils/workbenchState'
import type { WorkbenchStateDeps } from '@/utils/workbenchState'
import type { WorkbenchSubview } from '@/stores/ui.store'

const baseDeps: WorkbenchStateDeps = {
  designValid: null,
  roomMatrixFinalized: false,
  rackHasCabinets: false,
  hasOutputBatches: false,
  hasSelectedOutputTypes: false,
  activeSubview: null,
}

describe('WORKBENCH_DEPENDENCIES 依赖图', () => {
  it('主流程前置关系正确：aidc 是 design/roomdesign/rackdesign 前置', () => {
    expect(WORKBENCH_DEPENDENCIES.design).toContain('aidc')
    expect(WORKBENCH_DEPENDENCIES.roomdesign).toContain('aidc')
    expect(WORKBENCH_DEPENDENCIES.rackdesign).toContain('roomdesign')
    expect(WORKBENCH_DEPENDENCIES.rackdesign).toContain('aidc')
  })

  it('渲染前置：main 依赖 design+roomdesign+rackdesign；results/export 依赖 main', () => {
    for (const d of ['design', 'roomdesign', 'rackdesign']) {
      expect(WORKBENCH_DEPENDENCIES.main).toContain(d)
    }
    expect(WORKBENCH_DEPENDENCIES.results).toEqual(['main'])
    expect(WORKBENCH_DEPENDENCIES.export).toEqual(['main'])
  })

  it('依赖图无环（拓扑可排序）', () => {
    const visited: WorkbenchSubview[] = []
    const visit = (v: WorkbenchSubview, stack: WorkbenchSubview[]) => {
      expect(stack).not.toContain(v)
      if (visited.includes(v)) return
      visited.push(v)
      for (const d of WORKBENCH_DEPENDENCIES[v] ?? []) visit(d, [...stack, v])
    }
    for (const v of Object.keys(WORKBENCH_DEPENDENCIES) as WorkbenchSubview[]) visit(v, [])
  })
})

describe('downstreamOf 级联失效传递闭包', () => {
  it('aidc 变更 → 下游全链路置待调整（design/roomdesign/rackdesign/main/visualization/results/export）', () => {
    const ds = downstreamOf(['aidc'])
    for (const v of ['design', 'roomdesign', 'rackdesign', 'main', 'visualization', 'results', 'export']) {
      expect(ds).toContain(v)
    }
    expect(ds).not.toContain('aidc')
  })

  it('design 变更 → visualization/main/results/export 待调整', () => {
    const ds = downstreamOf(['design'])
    for (const v of ['visualization', 'main', 'results', 'export']) {
      expect(ds).toContain(v)
    }
    expect(ds).not.toContain('design')
    expect(ds).not.toContain('aidc')
  })

  it('roomdesign 变更 → rackdesign/main/results/export 待调整', () => {
    const ds = downstreamOf(['roomdesign'])
    for (const v of ['rackdesign', 'main', 'results', 'export']) expect(ds).toContain(v)
    expect(ds).not.toContain('roomdesign')
  })

  it('rackdesign 变更 → main/results/export 待调整', () => {
    const ds = downstreamOf(['rackdesign'])
    for (const v of ['main', 'results', 'export']) expect(ds).toContain(v)
  })

  it('main 变更 → results/export 待调整；export 变更 → 无下游', () => {
    expect(downstreamOf(['main'])).toEqual(expect.arrayContaining(['results', 'export']))
    expect(downstreamOf(['export'])).toEqual([])
  })

  it('多源变更去重且传递', () => {
    const ds = downstreamOf(['aidc', 'main'])
    expect(new Set(ds).size).toBe(ds.length)
    expect(ds).toContain('results')
  })
})

describe('deriveWorkbenchState 状态推导', () => {
  it('aidc：手动标记完成 → 已完成，否则待操作', () => {
    expect(deriveWorkbenchState('aidc', { ...baseDeps, aidcDone: true })).toEqual('done')
    expect(deriveWorkbenchState('aidc', baseDeps)).toEqual('pending')
  })

  it('design：designValid 通过 → 已完成，否则待操作', () => {
    expect(deriveWorkbenchState('design', { ...baseDeps, designValid: true })).toEqual('done')
    expect(deriveWorkbenchState('design', baseDeps)).toEqual('pending')
  })

  it('roomdesign/rackdesign/main/results 沿用既有完成条件', () => {
    expect(deriveWorkbenchState('roomdesign', { ...baseDeps, roomMatrixFinalized: true })).toEqual('done')
    expect(deriveWorkbenchState('rackdesign', { ...baseDeps, roomMatrixFinalized: true, rackHasCabinets: true })).toEqual('done')
    expect(deriveWorkbenchState('main', { ...baseDeps, designValid: true, hasSelectedOutputTypes: true })).toEqual('done')
    expect(deriveWorkbenchState('results', { ...baseDeps, hasOutputBatches: true })).toEqual('done')
  })

  it('被标记为待调整（stale）的子视图即使数据就绪也显示待调整', () => {
    expect(deriveWorkbenchState('design', { ...baseDeps, designValid: true, stale: ['design'] })).toEqual('needs_update')
    expect(deriveWorkbenchState('roomdesign', { ...baseDeps, roomMatrixFinalized: true, stale: ['roomdesign'] })).toEqual('needs_update')
  })

  it('读取中（reading）优先于 stale → 进行中', () => {
    expect(deriveWorkbenchState('design', { ...baseDeps, designValid: true, stale: ['design'], reading: true })).toEqual('in_progress')
  })

  it('当前 active 子视图（非 stale）→ 进行中', () => {
    expect(deriveWorkbenchState('design', { ...baseDeps, designValid: true, activeSubview: 'design' })).toEqual('in_progress')
  })

  it('未在依赖图内的孤儿视图恒待操作', () => {
    expect(deriveWorkbenchState('docs', baseDeps)).toEqual('pending')
    expect(deriveWorkbenchState('knowledge', baseDeps)).toEqual('pending')
  })
})

describe('fingerprintConfig 变更指纹', () => {
  it('相同配置产生相同指纹；字段变化指纹变化', () => {
    const a = fingerprintConfig({ num_servers: 64, param_speed: '400G' })
    const b = fingerprintConfig({ num_servers: 64, param_speed: '400G' })
    const c = fingerprintConfig({ num_servers: 128, param_speed: '400G' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('键顺序无关（canonical 序列化）', () => {
    const a = fingerprintConfig({ num_servers: 64, param_speed: '400G' })
    const b = fingerprintConfig({ param_speed: '400G', num_servers: 64 })
    expect(a).toBe(b)
  })
})

describe('renderGateReady 渲染门禁收敛（521-f）', () => {
  it('design 就绪（valid 或 有拓扑）且无待调整 → 可渲染', () => {
    expect(renderGateReady({ designValid: true, hasTopology: false, stale: [] })).toBe(true)
    expect(renderGateReady({ designValid: null, hasTopology: true, stale: [] })).toBe(true)
  })

  it('design/main 被级联失效（待调整）→ 不可渲染（即使拓扑就绪）', () => {
    expect(renderGateReady({ designValid: true, hasTopology: false, stale: ['design'] })).toBe(false)
    expect(renderGateReady({ designValid: true, hasTopology: false, stale: ['main'] })).toBe(false)
  })

  it('非设计链路待调整（如 roomdesign）→ 不影响渲染门禁', () => {
    expect(renderGateReady({ designValid: true, hasTopology: false, stale: ['roomdesign'] })).toBe(true)
  })

  it('design 未就绪且无拓扑 → 不可渲染', () => {
    expect(renderGateReady({ designValid: null, hasTopology: false, stale: [] })).toBe(false)
    expect(renderGateReady({ designValid: false, hasTopology: false, stale: [] })).toBe(false)
  })
})
