import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, GitBranch, ExternalLink } from 'lucide-react'

interface Props {
  onClose: () => void
}

export function AboutDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState('2.4.0')

  useEffect(() => {
    window.electron?.app?.getVersion?.().then((v: string) => {
      if (v) setAppVersion(v)
    }).catch(() => {
      // fallback to hardcoded version
    })
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[420px] border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {t('about.title')}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 text-center">
          {/* Logo */}
          <div className="flex justify-center mb-3">
            <img src="icons/logo.svg" alt="AutoLink" className="w-20 h-20" />
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">
            {t('app.title')}
          </h1>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {t('app.subtitle')}
          </p>

          <div className="mt-4 space-y-1 text-xs text-gray-500 dark:text-gray-400">
            <div>
              <span className="text-gray-400">{t('about.version')}:</span> {appVersion}
            </div>
            <div>
              <span className="text-gray-400">{t('about.electron')}:</span> 28.x
            </div>
            <div>
              <span className="text-gray-400">{t('about.react')}:</span> 18.x
            </div>
          </div>

          {/* Shortcuts reference */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-left">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
              {t('about.shortcuts.title')}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
              <span className="text-gray-400">{t('about.shortcuts.project')}</span>
              <span className="text-gray-500 text-right"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+Shift+E</kbd></span>
              <span className="text-gray-400">{t('about.shortcuts.design')}</span>
              <span className="text-gray-500 text-right"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+Shift+D</kbd></span>
              <span className="text-gray-400">{t('about.shortcuts.workbench')}</span>
              <span className="text-gray-500 text-right"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+Shift+W</kbd></span>
              <span className="text-gray-400">{t('about.shortcuts.visualization')}</span>
              <span className="text-gray-500 text-right"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+Shift+V</kbd></span>
              <span className="text-gray-400">{t('about.shortcuts.deviceLibrary')}</span>
              <span className="text-gray-500 text-right"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+Shift+L</kbd></span>
              <span className="text-gray-400">{t('about.shortcuts.settings')}</span>
              <span className="text-gray-500 text-right"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+,</kbd></span>
              <span className="text-gray-400">{t('about.shortcuts.toggleSidebar')}</span>
              <span className="text-gray-500 text-right"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+B</kbd></span>
              <span className="text-gray-400">{t('about.shortcuts.closeTab')}</span>
              <span className="text-gray-500 text-right"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+W</kbd></span>
              <span className="text-gray-400">{t('about.shortcuts.restoreTab')}</span>
              <span className="text-gray-500 text-right"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+Shift+T</kbd></span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <a
              href="https://github.com/bangbang8000-cell/AutoLink"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <GitBranch size={14} />
              {t('about.repository')}
              <ExternalLink size={10} />
            </a>
          </div>

          <p className="mt-3 text-[10px] text-gray-400 dark:text-gray-500">
            {t('about.copyright')}
          </p>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded bg-gray-500 hover:bg-gray-600 text-white"
          >
            {t('about.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
