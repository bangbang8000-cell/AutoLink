import { useTranslation } from 'react-i18next'
import { Zap, FolderOpen, Settings } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useRenderStore } from '@/stores/render.store'
import { WorkbenchScopeCard } from '@/components/workbench/WorkbenchScopeCard'
import { WorkbenchReadinessCard } from '@/components/workbench/WorkbenchReadinessCard'
import { WorkbenchOutputCard } from '@/components/workbench/WorkbenchOutputCard'
import { WorkbenchActionCard } from '@/components/workbench/WorkbenchActionCard'
import { WorkbenchResultCard } from '@/components/workbench/WorkbenchResultCard'

export function WorkbenchTab() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const progress = useRenderStore((s) => s.progress)
  const isRendering = progress.status === 'rendering'

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <Zap size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">{t('workbench:title')}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('workbench:noProject')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-edge-subtle shrink-0 bg-gray-50 dark:bg-app/50">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t('workbench:title')}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {selectedProjectName}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Row 1: Project info card (full width) */}
        <div className="bg-white dark:bg-app-elevated border border-gray-200 dark:border-edge-subtle rounded-lg p-4 mb-4 flex items-center gap-4">
          <div className="p-2 rounded-lg bg-warning-100 dark:bg-warning-900/30">
            <FolderOpen size={20} className="text-warning-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {selectedProjectName}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {t('workbench:name')}
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <Settings size={14} className="text-gray-400" />
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('workbench:status')}:</span>
            <span className="inline-block px-2 py-0.5 text-2xs rounded bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300 font-medium">
              Ready
            </span>
          </div>
        </div>

        {/* Row 2 (2 columns): Scope card | Readiness card */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <WorkbenchScopeCard />
          <WorkbenchReadinessCard />
        </div>

        {/* Row 3 (2 columns): Output type checkboxes | Action buttons */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <WorkbenchOutputCard />
          <WorkbenchActionCard />
        </div>

        {/* Progress bar between row 3 and 4 when rendering */}
        {isRendering && (
          <div className="mb-4 space-y-1.5">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                {progress.message}
              </span>
              <span className="font-medium tabular-nums">{progress.progress}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-300"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Row 4: Results list (full width) */}
        <div>
          <WorkbenchResultCard />
        </div>
      </div>
    </div>
  )
}
