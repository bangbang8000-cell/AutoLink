import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, CheckCircle, AlertCircle, Loader2, ArrowUpCircle } from 'lucide-react'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export function UpdatePopover() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')

  const handleCheckUpdate = useCallback(async () => {
    setStatus('checking')
    setErrorMessage('')
    try {
      const result = await window.electron?.app?.checkUpdate()
      if (result?.updateAvailable) {
        setStatus('available')
        setUpdateVersion(result.version || '')
      } else {
        setStatus('idle')
      }
    } catch {
      setStatus('error')
      setErrorMessage(t('common:update.checkFailed'))
    }
  }, [t])

  const handleDownload = useCallback(async () => {
    setStatus('downloading')
    setErrorMessage('')
    try {
      await window.electron?.app?.downloadUpdate()
    } catch {
      setStatus('error')
      setErrorMessage(t('common:update.downloadFailed'))
    }
  }, [t])

  const handleQuitAndInstall = useCallback(() => {
    window.electron?.app?.quitAndInstall()
  }, [])

  // Listen for update events from main process
  useEffect(() => {
    const unsubAvailable = window.electron?.app?.onUpdateAvailable((data) => {
      setUpdateVersion(data.version)
      setStatus('available')
    })
    const unsubProgress = window.electron?.app?.onUpdateDownloadProgress((data) => {
      setDownloadPercent(Math.round(data.percent))
    })
    const unsubDownloaded = window.electron?.app?.onUpdateDownloaded(() => {
      setStatus('downloaded')
    })
    const unsubError = window.electron?.app?.onUpdateError((message) => {
      setStatus('error')
      setErrorMessage(message)
    })

    return () => {
      unsubAvailable?.()
      unsubProgress?.()
      unsubDownloaded?.()
      unsubError?.()
    }
  }, [])

  const hasUpdate = status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'checking'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 relative"
        title={t('common:update.title')}
      >
        {status === 'downloaded' ? (
          <CheckCircle size={15} className="text-green-500" />
        ) : status === 'error' ? (
          <AlertCircle size={15} className="text-red-500" />
        ) : status === 'downloading' ? (
          <Loader2 size={15} className="animate-spin text-blue-500" />
        ) : (
          <ArrowUpCircle size={15} />
        )}
        {hasUpdate && (
          <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-blue-500" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-8 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 z-50 w-64">
            <div className="px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
              {t('common:update.title')}
            </div>

            <div className="px-3 py-2">
              {status === 'idle' && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('common:update.upToDate')}
                  </p>
                  <button
                    onClick={handleCheckUpdate}
                    className="w-full px-3 py-1.5 text-xs bg-primary-500 hover:bg-primary-600 text-white rounded transition-colors"
                  >
                    {t('common:update.checkNow')}
                  </button>
                </div>
              )}

              {status === 'checking' && (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-1">
                  <Loader2 size={14} className="animate-spin" />
                  {t('common:update.checking')}
                </div>
              )}

              {status === 'available' && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-700 dark:text-gray-300">
                    {t('common:update.newVersion')}: <span className="font-semibold">v{updateVersion}</span>
                  </p>
                  <button
                    onClick={handleDownload}
                    className="w-full px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Download size={13} />
                    {t('common:update.download')}
                  </button>
                </div>
              )}

              {status === 'downloading' && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-700 dark:text-gray-300">
                    {t('common:update.downloading')} ({downloadPercent}%)
                  </p>
                  <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${downloadPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {status === 'downloaded' && (
                <div className="space-y-2">
                  <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <CheckCircle size={13} />
                    {t('common:update.downloaded')}
                  </p>
                  <button
                    onClick={handleQuitAndInstall}
                    className="w-full px-3 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                  >
                    {t('common:update.restartToInstall')}
                  </button>
                </div>
              )}

              {status === 'error' && (
                <div className="space-y-2">
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle size={13} />
                    {errorMessage || t('common:update.error')}
                  </p>
                  <button
                    onClick={handleCheckUpdate}
                    className="w-full px-3 py-1.5 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded transition-colors"
                  >
                    {t('common:update.retry')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}