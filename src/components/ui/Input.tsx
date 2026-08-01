import clsx from 'clsx'
import { forwardRef } from 'react'

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ error, className, ...rest }, ref) => {
    return (
      <div className="w-full">
        <input
          ref={ref}
          className={clsx(
            'w-full px-2.5 py-1.5 text-sm rounded-md border bg-white dark:bg-app-surface',
            'text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500',
            'focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error
              ? 'border-error-300 dark:border-error-700'
              : 'border-gray-300 dark:border-gray-600',
            className,
          )}
          {...rest}
        />
        {error && (
          <p className="mt-1 text-xs text-error-500 dark:text-error-400">{error}</p>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'
