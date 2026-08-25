import { useTranslation } from 'react-i18next'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  /** 确认提示文案 */
  message: string
  /** 可选标题,默认 common.confirmTitle */
  title?: string
  /** 危险操作（删除等）红色确认按钮 */
  danger?: boolean
  /** 确认按钮文案,默认 common.confirm */
  confirmText?: string
  /** 取消按钮文案,默认 common.cancel */
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * AL-M5b：项目内 Modal 确认体系（替代 window.confirm）
 * - danger 场景红色确认按钮,ESC/遮罩可关闭
 */
export function ConfirmDialog({
  open,
  message,
  title,
  danger,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      onClose={onCancel}
      closeOnEsc
      closeOnOverlay
      title={title ?? t('common:confirmAction', '确认操作')}
      width={420}
      showCloseButton={false}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-edge-default text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
          >
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-xs rounded text-white ${
              danger
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-primary-500 hover:bg-primary-600'
            }`}
          >
            {confirmText ?? t('common.confirm')}
          </button>
        </div>
      }
    >
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{message}</p>
    </Modal>
  )
}