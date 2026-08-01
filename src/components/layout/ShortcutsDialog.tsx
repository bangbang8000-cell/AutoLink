import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { SHORTCUT_GROUPS } from '@/utils/shortcuts'

/**
 * v2.7.3-T2: 快捷键参考对话框
 * 从 shortcuts.ts 映射表自动生成,确保列出的快捷键全部可用
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common')

  return (
    <Modal
      open
      onClose={onClose}
      title={t('menu.shortcuts.title')}
      width={520}
      maxHeight="80vh"
      closeOnEsc
      closeOnOverlay
      bodyClassName="p-4 space-y-4"
    >
      {SHORTCUT_GROUPS.map((group) => (
        <div key={group.categoryKey}>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
            {t(`menu.shortcuts.${group.categoryKey}`)}
          </h3>
          <div className="space-y-1">
            {group.items.map((item) => (
              <div key={item.keys} className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-600 dark:text-gray-300">
                  {t(`menu.shortcuts.${item.descKey}`)}
                </span>
                <kbd className="text-2xs font-mono px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300">
                  {item.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  )
}
