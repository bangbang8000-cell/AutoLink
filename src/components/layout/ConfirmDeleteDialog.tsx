import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Modal } from '@/components/ui/Modal'

export interface DeleteTarget {
  /** Label shown in title and confirmation input */
  name: string
  /** Type discriminator for UI text */
  type: 'project' | 'template' | 'file' | 'batch' | 'clearOutput'
}

interface Props {
  target: DeleteTarget
  onConfirm: () => Promise<void>
  onClose: () => void
}

/** Types that require typing the name to confirm deletion */
const REQUIRE_NAME_TYPES: Set<DeleteTarget['type']> = new Set(['project', 'template', 'clearOutput'])

export function ConfirmDeleteDialog({ target, onConfirm, onClose }: Props) {
  const { t } = useTranslation()
  const [confirmName, setConfirmName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requireName = REQUIRE_NAME_TYPES.has(target.type)
  const title = t(`common:confirmDelete.title.${target.type}`, { name: target.name })
  const warning = t(`common:confirmDelete.warning.${target.type}`)
  const canConfirm = !requireName || confirmName === target.name

  const handleConfirm = async () => {
    if (!canConfirm || loading) return
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:confirmDelete.deleteFailed'))
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={384}
      closeOnEsc
      closeOnOverlay
      showCloseButton={false}
      bodyClassName="p-0"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-edge-subtle">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-error-100 dark:bg-error-900/30 text-error-600 dark:text-error-400 shrink-0">
          <AlertTriangle size={18} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h3>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-3">
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
          {warning}
        </p>

        {requireName && (
          <div>
            <label className="block text-2xs text-gray-500 dark:text-gray-400 mb-1">
              {t('common:confirmDelete.confirmNamePrompt', { name: target.name })}
            </label>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={target.name}
              className={clsx(
                'w-full px-3 py-1.5 text-xs rounded-lg border',
                'bg-gray-50 dark:bg-app',
                'border-gray-200 dark:border-gray-600',
                'focus:outline-none focus:ring-2 focus:ring-error-400',
                'text-gray-900 dark:text-gray-100 placeholder-gray-400',
              )}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
            />
          </div>
        )}

        {error && (
          <p className="text-2xs text-error-600 dark:text-error-400">{error}</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-5 py-3 bg-gray-50 dark:bg-app border-t border-gray-100 dark:border-edge-subtle">
        <button
          onClick={onClose}
          disabled={loading}
          className={clsx(
            'px-3 py-1.5 text-xs rounded-lg transition-colors',
            'text-gray-600 dark:text-gray-400',
            'hover:bg-gray-200 dark:hover:bg-app-hover',
          )}
        >
          {t('common:cancel')}
        </button>
        <button
          onClick={handleConfirm}
          disabled={!canConfirm || loading}
          className={clsx(
            'px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-1.5',
            canConfirm && !loading
              ? 'bg-error-600 hover:bg-error-700 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed',
          )}
        >
          {loading && <Loader2 size={12} className="animate-spin" />}
          {t('common:confirmDelete.confirmDelete')}
        </button>
      </div>
    </Modal>
  )
}
