import clsx from 'clsx'
import { forwardRef } from 'react'

interface Props extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
}

/**
 * 4.1 F1-3: 选择器视觉收敛到契约 token（docs/双端设计Token契约_v1.0）。
 * - 边框 edge-subtle（契约 §2）、focus ring 契约 primary
 * - 文本/占位符 text-primary / text-muted
 */
export const Select = forwardRef<HTMLSelectElement, Props>(
  ({ options, className, ...rest }, ref) => {
    return (
      <select
        ref={ref}
        className={clsx(
          'w-full px-2.5 py-1.5 text-sm rounded-md border border-edge-subtle',
          'bg-white dark:bg-app-surface text-text-primary',
          'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    )
  },
)

Select.displayName = 'Select'
