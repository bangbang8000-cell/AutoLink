import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { useUpdateStore } from '@/stores/update.store'

/**
 * AL-U1：下载完成后的重启确认框（对齐 MC Header.tsx:692-720）。
 *
 * 由 update.store 的 restartPromptVisible 驱动——onUpdateDownloaded 事件到达时自动弹出。
 *  - 立即重启 → quitAndInstall（退出并安装）
 *  - 稍后     → 仅关闭本框；右上角 UpdatePopover 入口因 status='downloaded' 仍保留「重启安装」按钮
 */
export function RestartPromptDialog() {
  const { t } = useTranslation()
  const open = useUpdateStore((s) => s.restartPromptVisible)
  const setOpen = useUpdateStore((s) => s.setRestartPromptVisible)
  const quitAndInstall = useUpdateStore((s) => s.quitAndInstall)

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={t('update.restartPromptTitle')}
      width={420}
      closeOnOverlay={false}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-600 dark:bg-app-hover dark:text-gray-300 dark:hover:bg-app-hover/70"
          >
            {t('update.later')}
          </button>
          <button
            onClick={quitAndInstall}
            className="px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
          >
            {t('update.restartNow')}
          </button>
        </div>
      }
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">{t('update.restartPromptMessage')}</p>
    </Modal>
  )
}
