import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Download, AlertTriangle, Loader2 } from 'lucide-react'
import { useCloudStore } from '@/stores/cloud.store'

type PullDialogProps = {
  owner: string
  repo: string
  projectName: string
  existsLocally: boolean
  onClose: () => void
  onSuccess: () => void
}

export function PullDialog({ owner, repo, projectName, existsLocally, onClose, onSuccess }: PullDialogProps) {
  const { t } = useTranslation()
  const [strategy, setStrategy] = useState<'overwrite' | 'rename' | null>(existsLocally ? null : 'overwrite')
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pullProject = useCloudStore((s) => s.pullProject)

  const handlePull = useCallback(async () => {
    setPulling(true)
    setError(null)
    try {
      const targetName = strategy === 'rename' ? `${projectName}-remote` : projectName
      await pullProject(owner, repo, targetName, strategy === 'overwrite')
      onSuccess()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPulling(false)
    }
  }, [owner, repo, projectName, strategy, pullProject, onSuccess, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-app-surface rounded-lg shadow-xl w-[420px] max-h-[90vh] overflow-auto border border-gray-200 dark:border-edge-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-edge-default">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('cloud:sync.pullTitle')}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-900 dark:text-white">{owner}/{repo}</span>
          </div>

          {existsLocally && (
            <div className="p-3 bg-warning-50 dark:bg-warning-900/20 rounded-md">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-warning-500 mt-0.5 shrink-0" />
                <div className="text-sm text-warning-700 dark:text-warning-400">
                  <p className="font-medium mb-1">{t('cloud:sync.conflict')}</p>
                  <p>{t('cloud:projects.existsLocally', { name: projectName })}</p>
                </div>
              </div>
            </div>
          )}

          {existsLocally && (
            <div className="space-y-2">
              <label
                className="flex items-start gap-3 p-3 border rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
                onClick={() => setStrategy('overwrite')}
              >
                <input type="radio" name="strategy" checked={strategy === 'overwrite'} onChange={() => setStrategy('overwrite')}
                  className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cloud:sync.overwrite')}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('cloud:sync.overwriteHint')}</p>
                </div>
              </label>
              <label
                className="flex items-start gap-3 p-3 border rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
                onClick={() => setStrategy('rename')}
              >
                <input type="radio" name="strategy" checked={strategy === 'rename'} onChange={() => setStrategy('rename')}
                  className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cloud:sync.rename')}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{projectName}-remote</p>
                </div>
              </label>
            </div>
          )}

          {!existsLocally && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('cloud:sync.pull')}: {projectName}
            </p>
          )}

          {error && (
            <div className="p-3 text-sm text-error-700 bg-error-50 dark:bg-error-900/20 dark:text-error-400 rounded-md">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-edge-default">
          <button
            onClick={onClose}
            disabled={pulling}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover rounded-md transition-colors"
          >
            {t('cloud:cancel')}
          </button>
          <button
            onClick={handlePull}
            disabled={pulling || (existsLocally && !strategy)}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-primary-500 hover:bg-primary-600 rounded-md transition-colors disabled:opacity-50"
          >
            {pulling ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t('cloud:sync.pull')}
              </>
            ) : (
              <>
                <Download size={14} />
                {t('cloud:confirm')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
