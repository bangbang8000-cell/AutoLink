import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings, Sun, Moon, Monitor, Globe, Keyboard, Info, FolderOpen } from 'lucide-react'
import { useUIStore, type ThemeMode } from '@/stores/ui.store'
import { AboutDialog } from '@/components/layout/AboutDialog'

export function SettingsPanel() {
  const { t, i18n } = useTranslation()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)
  const [aboutOpen, setAboutOpen] = useState(false)

  const themes: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'light', icon: <Sun size={14} />, label: t('common:theme.light') },
    { mode: 'dark', icon: <Moon size={14} />, label: t('common:theme.dark') },
    { mode: 'system', icon: <Monitor size={14} />, label: t('common:theme.system') },
  ]

  const languages = [
    { code: 'zh-CN', label: '简体中文' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'zh-TW', label: '繁體中文' },
  ]

  const shortcuts = [
    { keys: 'Ctrl+Shift+E', desc: t('common:menu.projectExplorer') },
    { keys: 'Ctrl+Shift+W', desc: t('common:menu.workbench') },
    { keys: 'Ctrl+Shift+D', desc: t('common:menu.design') },
    { keys: 'Ctrl+Shift+R', desc: t('common:menu.rack') },
    { keys: 'Ctrl+Shift+T', desc: t('common:menu.topology') },
    { keys: 'Ctrl+Shift+O', desc: t('common:menu.outputResults') },
    { keys: 'Ctrl+,', desc: t('common:menu.settings') },
    { keys: 'Ctrl+B', desc: t('common:menu.hideSidebar') + '/' + t('common:menu.showSidebar') },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Title */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('common:menu.settings')}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-5">
        {/* Theme */}
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
            <Sun size={13} /> 主题
          </h4>
          <div className="grid grid-cols-3 gap-1.5">
            {themes.map((item) => (
              <button
                key={item.mode}
                onClick={() => setTheme(item.mode)}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg border text-xs transition-colors
                  ${theme === item.mode
                    ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
            <Globe size={13} /> 语言 / Language
          </h4>
          <div className="space-y-1">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => { setLanguage(lang.code); i18n.changeLanguage(lang.code) }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded border transition-colors
                  ${language === lang.code
                    ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
              >
                {lang.label}
                {language === lang.code && <span className="text-primary-500">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard shortcuts */}
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
            <Keyboard size={13} /> {t('common:menu.cheatsheet')}
          </h4>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {shortcuts.map((s) => (
              <div
                key={s.keys}
                className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 text-xs"
              >
                <span className="text-gray-600 dark:text-gray-400">{s.desc}</span>
                <kbd className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* About */}
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
            <Info size={13} /> 关于
          </h4>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <div className="flex justify-between">
                <span>版本</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">2.0.1</span>
              </div>
              <div className="flex justify-between">
                <span>许可证</span>
                <span className="text-gray-500">MIT</span>
              </div>
            </div>
            <button
              onClick={() => setAboutOpen(true)}
              className="mt-2 w-full py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              查看完整信息
            </button>
          </div>
        </div>
      </div>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}
