import type { LucideIcon } from 'lucide-react'
import { Loader2, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  /**
   * 5.4.11-F54-11-2 / B-3（三态规范）：empty 空态 / loading 加载态 / error 错误态。
   * - empty：默认图标 + 引导文案 + 可选操作
   * - loading：转圈 + 文案（aria-busy 声明，供 a11y 感知）
   * - error：警示图标 + 错误文案 + 重试路径（action）
   */
  variant?: 'empty' | 'loading' | 'error'
  className?: string
}

/**
 * 4.1 F1-5: 空态组件,视觉收敛到契约 token（docs/双端设计Token契约_v1.0）。
 * - 图标 text-muted / 标题 text-secondary / 描述 text-muted
 * - 操作按钮使用契约 primary
 * - 5.4.11 B-3：三态统一（empty/loading/error），文案模板 + 重试路径规范
 */
export function EmptyState({ icon: Icon, title, description, action, variant = 'empty', className }: Props) {
  const isLoading = variant === 'loading'
  const isError = variant === 'error'
  const IconNode = isError ? AlertTriangle : Icon ?? (isLoading ? Loader2 : undefined)

  return (
    <div
      className={clsx('flex flex-col items-center justify-center py-12 px-4 text-center', className)}
      {...(isLoading ? { role: 'status', 'aria-busy': true, 'aria-live': 'polite' as const } : {})}
    >
      {IconNode && (
        <IconNode
          size={40}
          className={clsx(
            'mb-3',
            isError ? 'text-warning-500' : 'text-text-muted',
            isLoading && 'animate-spin',
          )}
        />
      )}
      <p className="text-sm text-text-secondary mb-1">{title}</p>
      {description && (
        <p className="text-xs text-text-muted max-w-xs">{description}</p>
      )}
      {(action || isError) && (
        <button
          onClick={action?.onClick}
          className="mt-4 px-4 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-md transition-colors"
        >
          {action?.label ?? '重试'}
        </button>
      )}
    </div>
  )
}
