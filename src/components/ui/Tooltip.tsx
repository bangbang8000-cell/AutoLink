import { cloneElement, isValidElement, useCallback, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import clsx from 'clsx'

interface TooltipProps {
  /** 触发元素(需接受 ref 与 aria-describedby) */
  children: ReactElement
  /** 提示内容 */
  content: ReactNode
  /** 位置,默认 'top' */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** 延迟显示 ms,默认 300 */
  delay?: number
  /** 禁用 */
  disabled?: boolean
}

/**
 * v2.7.3-T10: Tooltip 组件
 * 纯 React 实现,无外部依赖。hover/focus 显示,blur/leave 隐藏。
 * 支持 a11y (aria-describedby + focus 触发)。
 */
export function Tooltip({ children, content, side = 'top', delay = 300, disabled }: TooltipProps) {
  const id = useId()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [visible, setVisible] = useState(false)

  const show = useCallback(() => {
    if (disabled || !content) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVisible(true), delay)
  }, [delay, disabled, content])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  if (!isValidElement(children)) return children

  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  }

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {cloneElement(children, { 'aria-describedby': visible ? id : undefined } as Record<string, unknown>)}
      {visible && (
        <span
          id={id}
          role="tooltip"
          className={clsx(
            'absolute z-[9999] px-2 py-1 text-2xs font-medium rounded shadow-lg whitespace-nowrap pointer-events-none',
            'bg-gray-900 text-white dark:bg-gray-700',
            'animate-dropdown-in',
            positionClasses[side],
          )}
        >
          {content}
        </span>
      )}
    </span>
  )
}
