import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, CheckCircle, AlertTriangle, Loader2, RefreshCw, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { useUpdateStore } from '@/stores/update.store'

export function UpdatePopover() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  // AL-U1：全部更新状态受控来自单点聚合 store（与 AboutDialog/RestartPromptDialog 同源）
  const status = useUpdateStore((s) => s.status)
  const updateVersion = useUpdateStore((s) => s.version)
  const releaseNotes = useUpdateStore((s) => s.releaseNotes)
  const downloadPercent = useUpdateStore((s) => s.percent)
  const errorMessage = useUpdateStore((s) => s.error)
  const check = useUpdateStore((s) => s.check)
  const download = useUpdateStore((s) => s.download)
  const quitAndInstall = useUpdateStore((s) => s.quitAndInstall)
  const openReleasesPage = useUpdateStore((s) => s.openReleasesPage)

  const handleCheckUpdate = () => check()
  const handleDownload = () => download()
  const handleQuitAndInstall = () => quitAndInstall()

  const hasUpdate = status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'checking'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500 dark:text-gray-400 relative"
        title={t('common:update.title')}
      >
        {status === 'downloaded' ? (
          <CheckCircle size={15} className="text-success-500" />
        ) : status === 'error' ? (
          <AlertTriangle size={15} className="text-gray-400" />
        ) : status === 'downloading' ? (
          <Loader2 size={15} className="animate-spin text-gray-400" />
        ) : (
          <RefreshCw size={15} />
        )}
        {hasUpdate && (
          <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-info-500" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-8 right-0 bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded-lg shadow-lg py-2 z-50 w-72">
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
                        className="flex items-center gap-1 text-2xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        {showNotes ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {t('common:update.releaseNotes')}
                      </button>
                      {showNotes && (
                        <div className="mt-1 max-h-32 overflow-y-auto p-2 bg-gray-50 dark:bg-app/50 rounded text-2xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap border border-gray-200 dark:border-edge-subtle">
                          {releaseNotes}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={handleDownload}
                    className="w-full px-3 py-1.5 text-xs bg-info-500 hover:bg-info-600 text-white rounded transition-colors flex items-center justify-center gap-1.5"
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
                      className="h-full bg-info-500 rounded-full transition-all duration-300"
                      style={{ width: `${downloadPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {status === 'downloaded' && (
                <div className="space-y-2">
                  <p className="text-xs text-success-600 dark:text-success-400 flex items-center gap-1">
                    <CheckCircle size={13} />
                    {t('common:update.downloaded')}
                  </p>
                  {/* 47-e（F7-5）：下载完整性校验显示（Content-Length 字节一致 + 离线可安装） */}
                  <p className="text-2xs text-gray-400">{t('common:update.integrityOk', '下载完整性校验通过，可离线安装使用')}</p>
                  <button
                    onClick={handleQuitAndInstall}
                    className="w-full px-3 py-1.5 text-xs bg-success-500 hover:bg-success-600 text-white rounded transition-colors"
                  >
                    {t('common:update.restartToInstall')}
                  </button>
                </div>
              )}

              {status === 'error' && (
                <div className="space-y-2">
                  <p className="text-xs text-warning-500 flex items-center gap-1">
                    <AlertTriangle size={13} />
                    {errorMessage || t('common:update.downloadFailed')}
                  </p>
                  <p className="text-2xs text-gray-400">{t('common:update.downloadFailedHint')}</p>
                  {/* 47-e（F7-5）：无网络/离线场景友好提示（安装包离线可用） */}
                  <p className="text-2xs text-gray-400">
                    {t('common:update.offlineHint', '若处于无网络/离线环境，可跳过在线更新——安装包为离线安装包，安装后离线可用')}
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleCheckUpdate}
                      className="flex-1 px-3 py-1.5 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded transition-colors"
                    >
                      {t('common:update.retry')}
                    </button>
                    <button
                      onClick={openReleasesPage}
                      className="flex-1 px-3 py-1.5 text-xs bg-info-500 hover:bg-info-600 text-white rounded transition-colors flex items-center justify-center gap-1"
                    >
                      <ExternalLink size={12} />
                      {t('common:update.manualDownload')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
