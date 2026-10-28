/**
 * 5.2.1-521-b/c/d + 5.5.2 / A12：工作台状态 store 单测
 * - stepDone：子视图完成标记（唯一完成判据）与失效来源
 * - stale：级联失效置"待调整"集合（downstreamOf 落 store）
 * - 变更指纹检测：designConfig/planHash 变化 → 通知下游失效
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkbenchStore } from '@/stores/workbench.store'

describe('WorkbenchStore', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      stepDone: {},
      stale: {},
      configFingerprint: {},
      planHash: {},
    })
  })

  describe('stepDone（唯一完成判据，5.5.2 A12）', () => {
    it('markStepDone 记录完成时间，并解除该步待调整', () => {
      const s = useWorkbenchStore.getState()
      s.invalidateDownstream('p1', ['aidc'])
      expect(useWorkbenchStore.getState().getStale('p1')).toContain('design')
      s.markStepDone('p1', 'design')
      const rec = useWorkbenchStore.getState().getStepDone('p1', 'design')
      expect(rec?.done).toBe(true)
      expect(rec?.doneAt).toBeTruthy()
      expect(useWorkbenchStore.getState().getStale('p1')).not.toContain('design')
    })

    it('unmarkStepDone 撤销完成标记（参数变更自动回退入口）', () => {
      const s = useWorkbenchStore.getState()
      s.markStepDone('p1', 'aidc')
      s.unmarkStepDone('p1', 'aidc')
      expect(useWorkbenchStore.getState().getStepDone('p1', 'aidc')).toBeUndefined()
    })

    it('不同项目/不同子视图互不影响', () => {
      useWorkbenchStore.getState().markStepDone('p1', 'aidc')
      expect(useWorkbenchStore.getState().getStepDone('p2', 'aidc')).toBeUndefined()
      expect(useWorkbenchStore.getState().getStepDone('p1', 'design')).toBeUndefined()
    })
  })

  describe('invalidatedBy 级联标记（5.5.2 A12）', () => {
    it('已完成的下游 → 上游变更时写入 invalidatedBy（待重新确认）', () => {
      const s = useWorkbenchStore.getState()
      s.markStepDone('p1', 'design')
      s.markStepDone('p1', 'main')
      s.invalidateDownstream('p1', ['design'])
      expect(useWorkbenchStore.getState().getStepDone('p1', 'main')?.invalidatedBy).toBe('design')
    })

    it('未完成的下游不写 invalidatedBy（只进 stale）', () => {
      useWorkbenchStore.getState().invalidateDownstream('p1', ['design'])
      expect(useWorkbenchStore.getState().getStepDone('p1', 'main')).toBeUndefined()
      expect(useWorkbenchStore.getState().getStale('p1')).toContain('main')
    })

    it('resolveStale 清除 invalidatedBy', () => {
      const s = useWorkbenchStore.getState()
      s.markStepDone('p1', 'main')
      s.invalidateDownstream('p1', ['design'])
      expect(useWorkbenchStore.getState().getStepDone('p1', 'main')?.invalidatedBy).toBe('design')
      s.resolveStale('p1', ['main'])
      expect(useWorkbenchStore.getState().getStepDone('p1', 'main')?.invalidatedBy).toBeUndefined()
    })

    it('resolveAllStale 一次性清除全部 invalidatedBy', () => {
      const s = useWorkbenchStore.getState()
      s.markStepDone('p1', 'design')
      s.markStepDone('p1', 'main')
      s.invalidateDownstream('p1', ['aidc'])
      s.resolveAllStale('p1')
      expect(useWorkbenchStore.getState().getStepDone('p1', 'design')?.invalidatedBy).toBeUndefined()
      expect(useWorkbenchStore.getState().getStepDone('p1', 'main')?.invalidatedBy).toBeUndefined()
    })
  })

  describe('invalidateDownstream（级联失效，521-c）', () => {
    it('design 变更 → 下游 visualization/main/results/export 置待调整（不含自身）', () => {
      useWorkbenchStore.getState().invalidateDownstream('p1', ['design'])
      const stale = useWorkbenchStore.getState().getStale('p1')
      for (const v of ['visualization', 'main', 'results', 'export']) {
        expect(stale).toContain(v)
      }
      expect(stale).not.toContain('design')
      expect(stale).not.toContain('aidc')
    })

    it('aidc 变更 → 全链路下游待调整', () => {
      useWorkbenchStore.getState().invalidateDownstream('p1', ['aidc'])
      const stale = useWorkbenchStore.getState().getStale('p1')
      for (const v of ['design', 'roomdesign', 'rackdesign', 'main', 'visualization', 'results', 'export']) {
        expect(stale).toContain(v)
      }
    })

    it('多次调用合并去重', () => {
      const s = useWorkbenchStore.getState()
      s.invalidateDownstream('p1', ['design'])
      s.invalidateDownstream('p1', ['main'])
      const stale = useWorkbenchStore.getState().getStale('p1')
      expect(stale.length).toBe(new Set(stale).size)
      expect(stale).toContain('results')
    })

    it('不同项目隔离', () => {
      useWorkbenchStore.getState().invalidateDownstream('p1', ['design'])
      expect(useWorkbenchStore.getState().getStale('p2')).toEqual([])
    })
  })

  describe('resolveStale（一键重跑依赖链后清除，521-d）', () => {
    it('resolveStale 只移除指定子视图', () => {
      const s = useWorkbenchStore.getState()
      s.invalidateDownstream('p1', ['design'])
      s.resolveStale('p1', ['visualization', 'main'])
      const stale = useWorkbenchStore.getState().getStale('p1')
      expect(stale).not.toContain('visualization')
      expect(stale).not.toContain('main')
      expect(stale).toContain('results')
    })

    it('resolveStale 全部清除后为 null 态（空数组）', () => {
      const s = useWorkbenchStore.getState()
      s.invalidateDownstream('p1', ['design'])
      s.resolveStale('p1', ['visualization', 'main', 'results', 'export'])
      expect(useWorkbenchStore.getState().getStale('p1')).toEqual([])
    })

    it('resolveAllStale 清除该项目全部待调整（一键重跑依赖链）', () => {
      const s = useWorkbenchStore.getState()
      s.invalidateDownstream('p1', ['aidc'])
      s.resolveAllStale('p1')
      expect(useWorkbenchStore.getState().getStale('p1')).toEqual([])
    })

    it('resolveAllStale 不影响其他项目', () => {
      const s = useWorkbenchStore.getState()
      s.invalidateDownstream('p1', ['aidc'])
      s.invalidateDownstream('p2', ['design'])
      s.resolveAllStale('p1')
      expect(useWorkbenchStore.getState().getStale('p1')).toEqual([])
      expect(useWorkbenchStore.getState().getStale('p2')).toContain('main')
    })
  })

  describe('变更指纹检测（521-c）', () => {
    it('首次记录不判为变更（初始加载）', () => {
      expect(useWorkbenchStore.getState().detectConfigChange('p1', 'fp-a')).toBe(false)
      expect(useWorkbenchStore.getState().configFingerprint['p1']).toBe('fp-a')
    })

    it('指纹相同 → 无变更；指纹不同 → 变更并更新', () => {
      const s = useWorkbenchStore.getState()
      s.detectConfigChange('p1', 'fp-a')
      expect(s.detectConfigChange('p1', 'fp-a')).toBe(false)
      expect(s.detectConfigChange('p1', 'fp-b')).toBe(true)
      expect(useWorkbenchStore.getState().configFingerprint['p1']).toBe('fp-b')
    })

    it('plan hash 变化同样检测', () => {
      const s = useWorkbenchStore.getState()
      s.detectPlanChange('p1', 'h1')
      expect(s.detectPlanChange('p1', 'h1')).toBe(false)
      expect(s.detectPlanChange('p1', 'h2')).toBe(true)
    })
  })
})
