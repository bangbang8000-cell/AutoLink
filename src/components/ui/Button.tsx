import clsx from 'clsx'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/**
 * 4.1 F1-3: 按钮视觉收敛到契约 token（docs/双端设计Token契约_v1.0）。
 * - variant: primary/secondary/ghost/danger
 * - size: sm/md/lg（radius-md 统一, 契约 §3）
 * - hover/active: 使用 primary-hover / danger 透明度 / app-hover
 * - focus ring: 契约 primary（高对比下自动加宽, style.css :focus-visible）
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary-hover active:bg-primary-hover/90',
  secondary:
    'border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 ' +
    'text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40',
  danger:
    'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
  ghost:
    'text-text-secondary hover:bg-app-hover hover:text-text-primary active:bg-app-hover',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs rounded-md',
  md: 'px-3.5 py-1.5 text-sm rounded-md',
  lg: 'px-4 py-2 text-sm rounded-md',
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
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]',
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
