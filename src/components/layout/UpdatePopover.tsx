import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, CheckCircle, AlertTriangle, Loader2, ArrowUpCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { useToastStore } from '@/stores/toast.store'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

interface UpdateInfo {
  version?: string
  releaseNotes?: string | unknown
}

export function UpdatePopover() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const addToast = useToastStore((s) => s.addToast)
  const autoNotifiedRef = useRef(false)

  const parseReleaseNotes = (notes: unknown): string => {
    if (!notes) return ''
    if (typeof notes === 'string') return notes
    // electron-updater may return { notes: string } or array of { version, notes }
    if (Array.isArray(notes)) {
      return notes.map((n: { version?: string; notes?: string }) => `## v${n.version}\n${n.notes || ''}`).join('\n\n')
    }
    if (typeof notes === 'object' && notes !== null) {
      const n = notes as { notes?: string }
      return n.notes || ''
    }
    return ''
  }

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
        addToast('info', t('common:update.upToDate'), 3000)
      }
    } catch {
      setStatus('error')
      setErrorMessage(t('common:update.checkFailed'))
    }
  }, [t, addToast])

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
    const unsubAvailable = window.electron?.app?.onUpdateAvailable((data: UpdateInfo) => {
      setUpdateVersion(data.version || '')
      setReleaseNotes(parseReleaseNotes(data.releaseNotes))
      setStatus('available')
      // Auto toast notification on startup auto-check (only once)
      if (!autoNotifiedRef.current) {
        autoNotifiedRef.current = true
        addToast('info', t('common:update.newVersionAvailable', { version: data.version }), 6000)
      }
    })
    const unsubProgress = window.electron?.app?.onUpdateDownloadProgress((data: { percent: number }) => {
      setDownloadPercent(Math.round(data.percent))
    })
    const unsubDownloaded = window.electron?.app?.onUpdateDownloaded(() => {
      setStatus('downloaded')
      addToast('success', t('common:update.downloaded'), 5000)
    })
    const unsubError = window.electron?.app?.onUpdateError((message: string) => {
      setStatus('error')
      setErrorMessage(message)
    })

    return () => {
      unsubAvailable?.()
      unsubProgress?.()
      unsubDownloaded?.()
      unsubError?.()
    }
  }, [addToast, t])

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
          <AlertTriangle size={15} className="text-gray-400" />
        ) : status === 'downloading' ? (
          <Loader2 size={15} className="animate-spin text-gray-400" />
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
          <div className="absolute top-8 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 z-50 w-72">
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
                  {releaseNotes && (
                    <div>
                      <button
                        onClick={() => setShowNotes(!showNotes)}
                        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        {showNotes ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {t('common:update.releaseNotes')}
                      </button>
                      {showNotes && (
                        <div className="mt-1 max-h-32 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-900/50 rounded text-[10px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap border border-gray-200 dark:border-gray-700">
                          {releaseNotes}
                        </div>
                      )}
                    </div>
                  )}
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
                    <AlertTriangle size={13} />
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
