import clsx from 'clsx'
import { AlertTriangle, Zap } from 'lucide-react'

interface Props {
  /** Used power in watts */
  used: number
  /** Power limit in watts */
  limit: number
  /** Whether to show compact mode (sidebar) or full mode */
  compact?: boolean
  className?: string
}

function formatPower(watts: number): string {
  if (watts >= 1000) return `${(watts / 1000).toFixed(1)}kW`
  return `${watts}W`
}

/**
 * Rack power usage progress bar.
 * Green  (<60%): normal
 * Yellow (<80%): warning
 * Red    (≥80%): exceeded / alert
 */
export function RackPowerBar({ used, limit, compact = false, className }: Props) {
  const percent = limit > 0 ? Math.round((used / limit) * 100) : 0
  const exceeded = percent >= 80
  const warning = percent >= 60 && percent < 80

  const barColor = exceeded
    ? 'bg-error-500 dark:bg-error-600'
    : warning
      ? 'bg-warning-500 dark:bg-warning-600'
      : 'bg-success-500 dark:bg-success-600'

  const textColor = exceeded
    ? 'text-error-600 dark:text-error-400'
    : warning
      ? 'text-warning-600 dark:text-warning-400'
      : 'text-success-600 dark:text-success-400'

  if (compact) {
    return (
      <div className={clsx('flex items-center gap-2', className)}>
        <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all duration-300', barColor)}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
        <span className={clsx('text-xs font-medium shrink-0', textColor)}>
          {percent}%
        </span>
        {exceeded && <AlertTriangle size={12} className="text-gray-400 shrink-0" />}
      </div>
    )
  }

  return (
    <div className={clsx('p-4 rounded-lg border', className,
      exceeded
        ? 'bg-error-50 dark:bg-error-900/10 border-error-200 dark:border-error-800'
        : warning
          ? 'bg-warning-50 dark:bg-warning-900/10 border-warning-200 dark:border-warning-800'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700',
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Zap size={16} className={textColor} />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            机柜功率
          </span>
          {exceeded && (
            <span className="flex items-center gap-1 text-xs text-error-600 dark:text-error-400 font-medium bg-error-100 dark:bg-error-900/30 px-2 py-0.5 rounded">
              <AlertTriangle size={11} />
              功率超限
            </span>
          )}
        </div>
        <span className={clsx('text-sm font-bold', textColor)}>
          {formatPower(used)} / {formatPower(limit)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-5 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>

      {/* Labels */}
      <div className="flex justify-between mt-2 text-xs text-gray-400 dark:text-gray-500">
        <span>0W</span>
        <span className={clsx('font-medium', textColor)}>
          {percent}% · {formatPower(used)} 已用
        </span>
        <span>{formatPower(limit)}</span>
      </div>
    </div>
  )
}
