import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sun, Moon, Monitor, Contrast } from 'lucide-react'
import { Popover } from '@/components/ui/Popover'
import { useUIStore, type ThemeMode } from '@/stores/ui.store'
import clsx from 'clsx'

/**
 * 4.1 F1-1/F1-2: 主题切换 Popover（light/dark/system/high-contrast）。
 * 与 ui.store setTheme 接线,选择即持久化(zustand persist),启动无闪变由
 * public/theme-init.js 保证。
 */
export function ThemePopover() {
  const { t } = useTranslation()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const [open, setOpen] = useState(false)

  const themes: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'light', icon: <Sun size={14} />, label: t('common:theme.light') },
    { mode: 'dark', icon: <Moon size={14} />, label: t('common:theme.dark') },
    { mode: 'system', icon: <Monitor size={14} />, label: t('common:theme.system') },
    { mode: 'high-contrast', icon: <Contrast size={14} />, label: t('common:theme.highContrast') },
  ]

  const triggerIcon =
    theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : theme === 'high-contrast' ? <Contrast size={16} /> : <Monitor size={16} />

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      panelClassName="top-8 right-0 w-36"
      trigger={
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-app-hover text-text-secondary"
          title={t('common:theme.title')}
        >
          {triggerIcon}
        </button>
      }
    >
      <div className="py-1">
        {themes.map((th) => (
          <button
            key={th.mode}
            type="button"
            onClick={() => { setTheme(th.mode); setOpen(false) }}
            className={clsx(
              'w-full px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-app-hover',
              theme === th.mode ? 'text-primary font-medium' : 'text-text-primary',
            )}
          >
            {th.icon}
            {th.label}
            {theme === th.mode && <span className="ml-auto text-primary">✓</span>}
          </button>
        ))}
      </div>
    </Popover>
  )
}
