import clsx from 'clsx'

/**
 * U3: Shared class for the compact `<input>` / `<select>` used in the
 * Settings explorer. Imported by FileExplorer.tsx to eliminate the
 * repeated `text-xs px-1.5 py-0.5 rounded border ...` className string.
 */
export const INPUT_CLASS =
  'text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'

interface SettingsSectionProps {
  title: string
  className?: string
  children: React.ReactNode
}

/** U3: Titled group used by Settings explorer sections. */
export function SettingsSection({ title, className, children }: SettingsSectionProps) {
  return (
    <div className={clsx('mb-4', className)}>
      <h4 className="text-2xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
        {title}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

interface SettingsRowProps {
  label: string
  className?: string
  children: React.ReactNode
}

/** U3: Label + control row used throughout Settings explorer. */
export function SettingsRow({ label, className, children }: SettingsRowProps) {
  return (
    <div className={clsx('flex items-center justify-between gap-3', className)}>
      <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
