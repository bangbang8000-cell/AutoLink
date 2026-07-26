import React from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore, type ThemeMode } from '@/stores/ui.store'

export function SettingsPanel() {
  const { t, i18n } = useTranslation()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)

  return (
    <div className="p-3 space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('common:menu.settings')}</h3>
      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('common:theme.light')}/{t('common:theme.dark')}</label>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeMode)}
          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
        >
          <option value="light">{t('common:theme.light')}</option>
          <option value="dark">{t('common:theme.dark')}</option>
          <option value="system">{t('common:theme.system')}</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Language</label>
        <select
          value={language}
          onChange={(e) => { setLanguage(e.target.value); i18n.changeLanguage(e.target.value) }}
          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
        >
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="zh-TW">繁體中文</option>
        </select>
      </div>
    </div>
  )
}
