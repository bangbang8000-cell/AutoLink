import { useEffect, useRef, type ComponentType } from 'react'
import clsx from 'clsx'

export interface ContextMenuItem {
  label?: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
  danger?: boolean
  icon?: ComponentType<{ size?: number; className?: string }>
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  x: number
  y: number
  onClose: () => void
}

/**
 * U7: 通用 ContextMenu 组件
 * - 统一 z-index z-[100]
 * - 点击外部/ESC 关闭
 * - 最小宽度 min-w-[180px]
 * - 分隔线、禁用态、危险态、图标
 */
export function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // v2.7.3-T3: 边界检测,防止菜单超出视窗
  const menuWidth = 200
  const menuHeight = items.length * 32
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8)
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8)

  return (
    <>
      {/* 点击遮罩关闭 — 同时拦截右键事件，防止默认浏览器菜单弹出 */}
      <div
        className="fixed inset-0 z-[99]"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
      />\n      <div
        ref={menuRef}
        className="fixed z-[100] bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded-lg shadow-lg py-1 min-w-[180px]"
        style={{ left: adjustedX, top: adjustedY }}
      >
        {items.map((item, idx) => {
          if (item.separator) {
            return <div key={idx} className="my-1 border-t border-gray-200 dark:border-edge-subtle" />
          }
          const Icon = item.icon
          return (
            <button
              key={idx}
              onClick={() => {
                if (item.disabled) return
                item.action?.()
                onClose()
              }}
              disabled={item.disabled}
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                item.disabled
                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : item.danger
                    ? 'text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover',
              )}
            >
              {Icon && <Icon size={13} className="shrink-0" />}
              {item.label}
            </button>
          )
        })}
      </div>
    </>
  )
}
