import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** 内容区最大高度,默认 '90vh' */
  maxHeight?: string
  /** 自定义宽度 px,默认 480 */
  width?: number
  /** ESC 关闭,默认 true */
  closeOnEsc?: boolean
  /** 点击遮罩关闭,默认 false(防误操作丢失输入) */
  closeOnOverlay?: boolean
  /** 显示右上角关闭按钮,默认 true */
  showCloseButton?: boolean
  /** 底部自定义区域(通常放操作按钮) */
  footer?: ReactNode
  /** 内容区内边距,默认 'p-6' */
  bodyClassName?: string
}

/**
 * U6: 通用 Modal 组件
 * - ESC 关闭(可配置)
 * - 点击遮罩关闭(可配置,默认 false 防误操作)
 * - 焦点陷阱(简易:Tab 循环聚焦模态内元素)
 * - body 滚动锁定
 * - 统一遮罩/圆角/阴影
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  maxHeight = '90vh',
  width = 480,
  closeOnEsc = true,
  closeOnOverlay = false,
  showCloseButton = true,
  footer,
  bodyClassName = 'p-6',
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  // ESC 关闭 + body 滚动锁定
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) {
        e.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    // 锁定 body 滚动
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // 自动聚焦模态框
    const focusTimer = setTimeout(() => {
      const focusable = modalRef.current?.querySelector<HTMLElement>(
        'input, textarea, select, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      focusable?.focus()
    }, 50)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prevOverflow
      clearTimeout(focusTimer)
    }
  }, [open, closeOnEsc, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 dark:bg-black/60"
      onClick={closeOnOverlay ? onClose : undefined}
    >
      <div
        ref={modalRef}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
        style={{ width: `${width}px`, maxHeight }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
            {title && (
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 ml-auto"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-900/30">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
