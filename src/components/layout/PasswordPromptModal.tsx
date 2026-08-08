import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'

interface Props {
  title: string
  label: string
  confirmText?: string
  /** 二次确认密码（加密导出时） */
  requireConfirm?: boolean
  onConfirm: (password: string) => Promise<void>
  onClose: () => void
}

/**
 * V3.3.2-T15-2: 密码输入对话框（加密导出 / 加密导入）
 */
export function PasswordPromptModal({ title, label, confirmText, requireConfirm, onConfirm, onClose }: Props) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const input = document.getElementById('password-prompt-input') as HTMLInputElement
    input?.focus()
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!password) {
      setError(t('common:passwordPrompt.required'))
      return
    }
    if (requireConfirm && password !== confirm) {
      setError(t('common:passwordPrompt.mismatch'))
      return
    }
    setLoading(true)
    setError('')
    try {
      await onConfirm(password)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [password, confirm, requireConfirm, onConfirm, onClose, t])

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
            className="px-3 py-1.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
          >
            {t('common:cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !password}
            className="px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50"
          >
            {loading ? t('common:processing') : (confirmText || t('common:confirm'))}
          </button>
        </div>
      }
    >
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">{label}</label>
      <input
        id="password-prompt-input"
        type="password"
        value={password}
        onChange={(e) => { setPassword(e.target.value); setError('') }}
        onKeyDown={handleKeyDown}
        disabled={loading}
        autoComplete="off"
        className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      {requireConfirm && (
        <div className="mt-2">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('common:passwordPrompt.confirm')}</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setError('') }}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoComplete="off"
            className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-error-500">{error}</p>
      )}
    </Modal>
  )
}
