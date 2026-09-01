import { Loader2 } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  label?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: { icon: 16, text: 'text-xs' },
  md: { icon: 24, text: 'text-sm' },
  lg: { icon: 32, text: 'text-sm' },
}

/**
 * 4.1 F1-5: 加载态组件,视觉收敛到契约 token（docs/双端设计Token契约_v1.0）。
 * - 旋转指示器使用契约 primary,文案 text-secondary
 */
export function Loading({ label, size = 'md', className }: Props) {
  const s = sizeMap[size]
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-2 py-10 px-4 text-center', className)} role="status" aria-live="polite">
      <Loader2 size={s.icon} className="animate-spin text-primary" />
      {label && <p className={clsx(s.text, 'text-text-secondary')}>{label}</p>}
    </div>
  )
}
