/**
 * 5.2.1-521-b/c/d：工作台状态 store 单测
 * - aidcDone：AIDC 规划手动标记完成（D5）
 * - stale：级联失效置"待调整"集合（downstreamOf 落 store）
 * - 变更指纹检测：designConfig/planHash 变化 → 通知下游失效
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkbenchStore } from '@/stores/workbench.store'

describe('WorkbenchStore', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      aidcDone: {},
      stale: {},
      configFingerprint: {},
      planHash: {},
    })
  })

  describe('aidcDone（AIDC 规划手动完成，521-b）', () => {
    it('markAidcDone 后该项目 aidc 状态为已完成', () => {
      useWorkbenchStore.getState().markAidcDone('p1')
      expect(useWorkbenchStore.getState().aidcDone['p1']).toBe(true)
    })

    it('unmarkAidcDone 撤销完成标记（参数变更自动回退入口）', () => {
      const s = useWorkbenchStore.getState()
      s.markAidcDone('p1')
      s.unmarkAidcDone('p1')
      expect(useWorkbenchStore.getState().aidcDone['p1']).toBeUndefined()
    })

    it('不同项目互不影响', () => {
      useWorkbenchStore.getState().markAidcDone('p1')
      expect(useWorkbenchStore.getState().aidcDone['p2']).toBeUndefined()
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
