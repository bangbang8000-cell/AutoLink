import clsx from 'clsx'
import { forwardRef } from 'react'

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

/**
 * 4.1 F1-3: 输入框视觉收敛到契约 token（docs/双端设计Token契约_v1.0）。
 * - 边框 edge-subtle（契约 §2）、focus ring 契约 primary
 * - 文本/占位符 text-primary / text-muted
 * - 错误态 danger（契约 §1）
 */
export const Input = forwardRef<HTMLInputElement, Props>(
  ({ error, className, ...rest }, ref) => {
    return (
      <div className="w-full">
        <input
          ref={ref}
          className={clsx(
            'w-full px-2.5 py-1.5 text-sm rounded-md border bg-white dark:bg-app-surface',
            'text-text-primary placeholder-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error
              ? 'border-danger'
              : 'border-edge-subtle',
            className,
          )}
          {...rest}
        />
        {error && (
          <p className="mt-1 text-xs text-danger">{error}</p>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'
