import clsx from 'clsx'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md'

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700 ' +
    'dark:bg-primary-600 dark:hover:bg-primary-500',
  secondary:
    'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 ' +
    'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
  danger:
    'bg-error-500 text-white hover:bg-error-600 active:bg-error-700 ' +
    'dark:bg-error-600 dark:hover:bg-error-500',
  ghost:
    'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs rounded',
  md: 'px-3.5 py-1.5 text-sm rounded-md',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
