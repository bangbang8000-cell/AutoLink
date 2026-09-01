import { cloneElement, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import clsx from 'clsx'

interface PopoverProps {
  /** 触发元素(接收 onClick / aria-haspopup / aria-expanded 扩展) */
  trigger: ReactElement
  /** 面板内容 */
  children: ReactNode
  /** 受控:是否打开 */
  open?: boolean
  /** 非受控:默认打开 */
  defaultOpen?: boolean
  /** 打开状态变化回调 */
  onOpenChange?: (open: boolean) => void
  /** 点击外部关闭,默认 true */
  closeOnOutside?: boolean
  /** ESC 关闭,默认 true */
  closeOnEsc?: boolean
  /** 面板定位/附加类名,默认 'top-8 right-0' */
  panelClassName?: string
  className?: string
}

/**
 * 4.0 组件行为契约: Popover(与 MC 一致,行为基准以契约为准)
 * - 点击触发器切换打开/关闭(受控 + 非受控双模式)
 * - 点击外部关闭(closeOnOutside, 默认开)
 * - ESC 关闭(closeOnEsc, 默认开)
 * - a11y: 触发器 aria-haspopup="dialog" / aria-expanded, 面板 role="dialog"
 */
export function Popover({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  closeOnOutside = true,
  closeOnEsc = true,
  panelClassName = 'top-8 right-0',
  className,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const rootRef = useRef<HTMLDivElement>(null)

  const setOpen = useCallback((next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }, [isControlled, onOpenChange])

  // 外部点击 / ESC 关闭
  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (e: MouseEvent) => {
      if (closeOnOutside && rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) {
        e.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, closeOnOutside, closeOnEsc, setOpen])

  type TriggerProps = { onClick?: (e: React.MouseEvent) => void; 'aria-haspopup'?: string; 'aria-expanded'?: boolean }
  const triggerEl = trigger as ReactElement<TriggerProps>

  const mergedTrigger = cloneElement(triggerEl, {
    onClick: (e: React.MouseEvent) => {
      triggerEl.props.onClick?.(e)
      setOpen(!isOpen)
    },
    'aria-haspopup': 'dialog',
    'aria-expanded': isOpen,
  })

  return (
    <div ref={rootRef} className={clsx('relative inline-block', className)}>
      {mergedTrigger}
      {isOpen && (
        <div
          role="dialog"
          className={clsx(
            'absolute z-50 bg-app dark:bg-app-surface border border-edge-subtle rounded-lg shadow-lg',
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
