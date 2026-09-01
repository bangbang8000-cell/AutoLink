import type { LucideIcon } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  className?: string
}

/**
 * 4.1 F1-5: 空态组件,视觉收敛到契约 token（docs/双端设计Token契约_v1.0）。
 * - 图标 text-muted / 标题 text-secondary / 描述 text-muted
 * - 操作按钮使用契约 primary
 */
export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <div className={clsx('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
      {Icon && <Icon size={40} className="text-text-muted mb-3" />}
      <p className="text-sm text-text-secondary mb-1">{title}</p>
      {description && (
        <p className="text-xs text-text-muted max-w-xs">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-md transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
