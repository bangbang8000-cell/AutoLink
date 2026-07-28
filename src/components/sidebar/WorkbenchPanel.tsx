import React from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, FolderOpen, Settings } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { WorkbenchScopeCard } from '@/components/workbench/WorkbenchScopeCard'
import { WorkbenchReadinessCard } from '@/components/workbench/WorkbenchReadinessCard'
import { WorkbenchOutputCard } from '@/components/workbench/WorkbenchOutputCard'
import { WorkbenchActionCard } from '@/components/workbench/WorkbenchActionCard'
import { WorkbenchResultCard } from '@/components/workbench/WorkbenchResultCard'

export function WorkbenchPanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <Zap size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">{t('workbench:title')}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('workbench:noProject')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Title */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('workbench:title')}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Project info */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <FolderOpen size={13} className="text-gray-400" />
            <span className="text-gray-500 dark:text-gray-400">{t('workbench:name')}:</span>
            <span className="font-medium text-gray-700 dark:text-gray-200">{selectedProjectName}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Settings size={13} className="text-gray-400" />
            <span className="text-gray-500 dark:text-gray-400">{t('workbench:status')}:</span>
            <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              Ready
            </span>
          </div>
        </div>

        {/* Scope */}
        <WorkbenchScopeCard />

        {/* Readiness */}
        <WorkbenchReadinessCard />

        {/* Output types */}
        <WorkbenchOutputCard />

        {/* Actions */}
        <WorkbenchActionCard />

        {/* Results */}
        <WorkbenchResultCard />
      </div>
    </div>
  )
}