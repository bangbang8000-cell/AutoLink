import clsx from 'clsx'
import { forwardRef } from 'react'

interface Props extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, Props>(
  ({ options, className, ...rest }, ref) => {
    return (
      <select
        ref={ref}
        className={clsx(
          'w-full px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600',
          'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500',
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
