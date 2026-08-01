import type { ReactNode } from 'react'
import clsx from 'clsx'

interface Props {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}

export function FormSection({ label, htmlFor, hint, error, children, className }: Props) {
  return (
    <div className={clsx(className)}>
      <div className="flex items-center justify-between mb-1">
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium text-gray-600 dark:text-gray-400"
        >
          {label}
        </label>
        {hint && (
          <span className="text-2xs text-gray-400 dark:text-gray-500">{hint}</span>
        )}
      </div>
      {children}
      {error && (
        <p className="mt-0.5 text-2xs text-error-500 dark:text-error-400">{error}</p>
      )}
    </div>
  )
}

interface NumberInputProps {
  label?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  hint?: string
  className?: string
}

export function NumberInput({
  label, value, onChange, min, max, step = 1, disabled, hint, className,
}: NumberInputProps) {
  const content = (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={clsx(
        'w-full px-2 py-1 text-xs rounded border',
        'border-gray-300 dark:border-gray-600 bg-white dark:bg-app-surface',
        'text-gray-900 dark:text-gray-100',
        'focus:outline-none focus:ring-1 focus:ring-primary-500',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'text-right font-mono tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
        className,
      )}
    />
  )

  if (!label) return content

  return (
    <FormSection label={label} hint={hint}>
      {content}
    </FormSection>
  )
}
