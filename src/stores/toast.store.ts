import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
  // v2.7.3-T15: 悬停暂停/恢复
  pauseToast: (id: string) => void
  resumeToast: (id: string) => void
}

let counter = 0

const MAX_TOASTS = 5

// v2.7.3-T15: 内部 timer 管理(支持悬停暂停)
const timers = new Map<string, { timer: ReturnType<typeof setTimeout> | null; expiresAt: number }>()

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  addToast: (type, message, duration = 4000) => {
    const id = `toast-${++counter}-${Date.now()}`
    const toasts = get().toasts
    // Remove oldest if exceeding max
    const trimmed = toasts.length >= MAX_TOASTS ? toasts.slice(toasts.length - MAX_TOASTS + 1) : toasts
    set({ toasts: [...trimmed, { id, type, message, duration }] })
    if (duration > 0) {
      const expiresAt = Date.now() + duration
      const timer = setTimeout(() => {
        get().removeToast(id)
        timers.delete(id)
      }, duration)
      timers.set(id, { timer, expiresAt })
    }
  },

  removeToast: (id) => {
    const entry = timers.get(id)
    if (entry?.timer) clearTimeout(entry.timer)
    timers.delete(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  // v2.7.3-T15: 悬停时暂停自动消失
  pauseToast: (id) => {
    const entry = timers.get(id)
    if (entry?.timer) {
      clearTimeout(entry.timer)
      timers.set(id, { timer: null, expiresAt: entry.expiresAt })
    }
  },

  // v2.7.3-T15: 鼠标离开后恢复计时
  resumeToast: (id) => {
    const entry = timers.get(id)
    if (entry && !entry.timer) {
      const remaining = entry.expiresAt - Date.now()
      if (remaining > 0) {
        const timer = setTimeout(() => {
          get().removeToast(id)
          timers.delete(id)
        }, remaining)
        timers.set(id, { timer, expiresAt: entry.expiresAt })
      } else {
        get().removeToast(id)
        timers.delete(id)
      }
    }
  },
}))
