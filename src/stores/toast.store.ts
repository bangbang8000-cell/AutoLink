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
}

let counter = 0

const MAX_TOASTS = 5

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  addToast: (type, message, duration = 4000) => {
    const id = `toast-${++counter}-${Date.now()}`
    const toasts = get().toasts
    // Remove oldest if exceeding max
    const trimmed = toasts.length >= MAX_TOASTS ? toasts.slice(toasts.length - MAX_TOASTS + 1) : toasts
    set({ toasts: [...trimmed, { id, type, message, duration }] })
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))
