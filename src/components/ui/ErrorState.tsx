import { AlertCircle } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  title?: string
  description?: string
  retry?: { label: string; onClick: () => void }
  className?: string
}

/**
 * 4.1 F1-5: 错误态组件,视觉收敛到契约 token（docs/双端设计Token契约_v1.0）。
 * - 图标/文案 danger,重试按钮契约 primary
 */
export function ErrorState({ title, description, retry, className }: Props) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-2 py-10 px-4 text-center', className)} role="alert">
      <AlertCircle size={32} className="text-danger mb-1" />
      {title && <p className="text-sm font-medium text-text-primary">{title}</p>}
      {description && <p className="text-xs text-text-secondary max-w-sm">{description}</p>}
      {retry && (
        <button
          onClick={retry.onClick}
          className="mt-3 px-4 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-md transition-colors"
        >
          {retry.label}
        </button>
      )}
    </div>
  )
}
