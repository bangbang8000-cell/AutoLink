import clsx from 'clsx'

interface Props {
  /** Current on/off state */
  checked: boolean
  /** Called with the new state on click */
  onChange: (value: boolean) => void
  /** Optional label rendered on the left; when omitted renders the switch only */
  label?: string
  /** Smaller variant (used in compact explorer forms) */
  size?: 'sm' | 'md'
  /** Extra classes on the outer label wrapper */
  className?: string
  /** Disable interaction */
  disabled?: boolean
}

/**
 * U3: Unified toggle switch. Replaces the inline `Toggle` / `ToggleMini`
 * previously defined inside FileExplorer.tsx.
 */
export function Toggle({ checked, onChange, label, size = 'md', className, disabled }: Props) {
  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        'relative rounded-full transition-colors',
        size === 'sm' ? 'w-7 h-4' : 'w-8 h-4',
        checked
          ? 'bg-primary-500'
          : 'bg-gray-300 dark:bg-gray-600',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
          checked
            ? size === 'sm' ? 'left-3.5' : 'left-4'
            : 'left-0.5',
        )}
      />
    </button>
  )

  if (!label) return switchEl

  return (
    <label
      className={clsx(
        'flex items-center justify-between gap-2',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
    >
      <span className="text-2xs text-gray-500 dark:text-gray-400">{label}</span>
      {switchEl}
    </label>
  )
}
