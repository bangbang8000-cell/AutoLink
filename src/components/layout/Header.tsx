import { useUIStore } from '@/stores/ui.store'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Moon, Sun, Globe, X, Minus, Square, Maximize2 } from 'lucide-react'
import type { ThemeMode } from '@/stores/ui.store'
import { UpdatePopover } from '@/components/layout/UpdatePopover'
import { MenuBar } from '@/components/layout/MenuBar'
import clsx from 'clsx'

const languages = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh-TW', label: '繁體中文' },
]

export function Header() {
  const { t, i18n } = useTranslation()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)
  const [themeOpen, setThemeOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)

  const isMac = window.electron?.versions?.platform === 'darwin'

  useEffect(() => {
    const unsub = window.electron?.window?.onMaximizeChange?.((maximized: boolean) => {
      setIsMaximized(maximized)
    })
    return () => { unsub?.() }
  }, [])

  const themeIcon =
    theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <Monitor size={16} />

  const themes: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'light', icon: <Sun size={14} />, label: t('common:theme.light') },
    { mode: 'dark', icon: <Moon size={14} />, label: t('common:theme.dark') },
    { mode: 'system', icon: <Monitor size={14} />, label: t('common:theme.system') },
  ]

  const handleMinimize = () => window.electron?.window?.minimize()
  const handleMaximize = () => window.electron?.window?.maximize()
  const handleClose = () => window.electron?.window?.close()

  return (
    <header
      className={clsx(
        'h-9 flex items-center justify-between shrink-0 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 select-none',
        isMac && 'pl-20',
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* T4: Logo 放到菜单栏左侧 */}
        <img src="icons/logo.svg" alt="AutoLink" className="w-5 h-5 shrink-0 ml-1" draggable={false} />
        <MenuBar />
      </div>

      <div className="flex items-center gap-1 px-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Theme */}
        <div className="relative">
          <button
            onClick={() => { setThemeOpen(!themeOpen); setLangOpen(false) }}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          >
            {themeIcon}
          </button>
          {themeOpen && (
            <div className="absolute top-8 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 w-36">
              {themes.map((t) => (
                <button
                  key={t.mode}
                  onClick={() => { setTheme(t.mode); setThemeOpen(false) }}
                  className="w-full px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  {t.icon}
                  {t.label}
                  {theme === t.mode && <span className="ml-auto text-gray-500">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Language */}
        <div className="relative">
          <button
            onClick={() => { setLangOpen(!langOpen); setThemeOpen(false) }}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          >
            <Globe size={16} />
          </button>
          {langOpen && (
            <div className="absolute top-8 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 w-36">
              {languages.map((l) => (
                <button
                  key={l.code}
                  onClick={() => { setLanguage(l.code); i18n.changeLanguage(l.code); setLangOpen(false) }}
                  className="w-full px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  {l.label}
                  {language === l.code && <span className="ml-auto text-gray-500">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Update */}
        <UpdatePopover />

        {/* Window controls */}
        <div className="flex items-center ml-2">
          <button onClick={handleMinimize} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500">
            <Minus size={14} />
          </button>
          <button onClick={handleMaximize} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500">
            {isMaximized ? <Square size={12} /> : <Maximize2 size={12} />}
          </button>
          <button onClick={handleClose} className="w-7 h-7 flex items-center justify-center hover:bg-red-500 hover:text-white text-gray-500">
            <X size={14} />
          </button>
        </div>
      </div>
    </header>
  )
}
