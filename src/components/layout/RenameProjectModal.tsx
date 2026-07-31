import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'

interface Props {
  title: string
  label: string
  defaultValue: string
  confirmText?: string
  onConfirm: (value: string) => Promise<void>
  onClose: () => void
}

export function RenameProjectModal({ title, label, defaultValue, confirmText, onConfirm, onClose }: Props) {
  const { t } = useTranslation()
  const [value, setValue] = useState(defaultValue)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Modal 自动聚焦第一个 input,这里补齐选中文本
  useEffect(() => {
    const input = document.getElementById('rename-project-input') as HTMLInputElement
    if (input) {
      input.focus()
      input.select()
    }
  }, [])

  const handleConfirm = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError(t('common:project.nameRequired'))
      return
    }
    if (trimmed === defaultValue) {
      onClose()
      return
    }
    setLoading(true)
    setError('')
    try {
      await onConfirm(trimmed)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [value, defaultValue, onConfirm, onClose, t])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={360}
      closeOnEsc
      bodyClassName="p-4"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {t('common:cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !value.trim()}
            className="px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50"
          >
            {loading ? t('common:processing') : (confirmText || t('common:confirm'))}
          </button>
        </div>
      }
    >
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">{label}</label>
      <input
        id="rename-project-input"
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError('') }}
        onKeyDown={handleKeyDown}
        disabled={loading}
        className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      {error && (
        <p className="mt-2 text-xs text-error-500">{error}</p>
      )}
    </Modal>
  )
}
