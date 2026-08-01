import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useToastStore } from '@/stores/toast.store'

describe('ToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('addToast', () => {
    it('应将 toast 添加到列表', () => {
      useToastStore.getState().addToast('success', '操作成功')
      const toasts = useToastStore.getState().toasts
      expect(toasts).toHaveLength(1)
      expect(toasts[0].type).toBe('success')
      expect(toasts[0].message).toBe('操作成功')
      expect(toasts[0].id).toBeTruthy()
    })

    it('默认 duration 应为 4000ms', () => {
      useToastStore.getState().addToast('info', '提示')
      expect(useToastStore.getState().toasts[0].duration).toBe(4000)
    })

    it('应支持自定义 duration', () => {
      useToastStore.getState().addToast('warning', '警告', 8000)
      expect(useToastStore.getState().toasts[0].duration).toBe(8000)
    })

    it('每个 toast 应有唯一 id', () => {
      useToastStore.getState().addToast('success', 'a', 0)
      useToastStore.getState().addToast('success', 'b', 0)
      const ids = useToastStore.getState().toasts.map((t) => t.id)
      expect(new Set(ids).size).toBe(2)
    })
  })

  describe('removeToast', () => {
    it('应按 id 移除指定 toast', () => {
      useToastStore.getState().addToast('success', 'a', 0)
      useToastStore.getState().addToast('error', 'b', 0)
      const firstId = useToastStore.getState().toasts[0].id
      useToastStore.getState().removeToast(firstId)
      expect(useToastStore.getState().toasts).toHaveLength(1)
      expect(useToastStore.getState().toasts[0].message).toBe('b')
    })

    it('移除不存在的 id 不应报错也不影响列表', () => {
      useToastStore.getState().addToast('success', 'a', 0)
      expect(() => useToastStore.getState().removeToast('nonexistent')).not.toThrow()
      expect(useToastStore.getState().toasts).toHaveLength(1)
    })
  })

  describe('最大数量限制', () => {
    it('超过 5 个时应移除最旧的 toast', () => {
      // duration=0 防止自动移除干扰
      for (let i = 0; i < 6; i++) {
        useToastStore.getState().addToast('info', `toast-${i}`, 0)
      }
      const toasts = useToastStore.getState().toasts
      expect(toasts).toHaveLength(5)
      // 最旧的 toast-0 被移除,保留 toast-1 到 toast-5
      expect(toasts[0].message).toBe('toast-1')
      expect(toasts[4].message).toBe('toast-5')
    })
  })

  describe('自动移除(定时器)', () => {
    it('duration > 0 时应在 duration 后自动移除', () => {
      useToastStore.getState().addToast('success', '自动消失', 3000)
      expect(useToastStore.getState().toasts).toHaveLength(1)
      // 推进 2999ms 仍存在
      vi.advanceTimersByTime(2999)
      expect(useToastStore.getState().toasts).toHaveLength(1)
      // 推进到 3000ms 触发移除
      vi.advanceTimersByTime(1)
      expect(useToastStore.getState().toasts).toHaveLength(0)
    })

    it('duration=0 时应保持持久存在(不自动移除)', () => {
      useToastStore.getState().addToast('info', '持久', 0)
      vi.advanceTimersByTime(100000)
      expect(useToastStore.getState().toasts).toHaveLength(1)
    })
  })

  describe('清空全部(模拟 clearAll)', () => {
    it('通过 setState 清空 toasts 列表', () => {
      useToastStore.getState().addToast('success', 'a', 0)
      useToastStore.getState().addToast('error', 'b', 0)
      expect(useToastStore.getState().toasts).toHaveLength(2)
      useToastStore.setState({ toasts: [] })
      expect(useToastStore.getState().toasts).toHaveLength(0)
    })
  })
})
