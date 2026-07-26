import React from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Network } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'

export function TopologyPanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <GitBranch size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">{t('topology:title')}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('topology:noProject')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('topology:title')}
        </span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <Network size={32} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
          {t('topology:networkTopology')}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {selectedProjectName} - {t('topology:noProject')}
        </p>
      </div>
    </div>
  )
}
