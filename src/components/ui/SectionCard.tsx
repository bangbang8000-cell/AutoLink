import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'

interface Props {
  icon?: LucideIcon
  title: string
  className?: string
  children: React.ReactNode
}

export function SectionCard({ icon: Icon, title, className, children }: Props) {
  return (
    <div className={clsx('border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800', className)}>
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon size={15} className="text-gray-400 dark:text-gray-500" />}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</h3>
      </div>
      {children}
    </div>
  )
}
