import type { LucideIcon } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <div className={clsx('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
      {Icon && <Icon size={40} className="text-gray-300 dark:text-gray-600 mb-3" />}
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{title}</p>
      {description && (
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-1.5 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-md transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
