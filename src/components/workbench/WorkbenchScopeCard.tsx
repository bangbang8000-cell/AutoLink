import React from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Layers } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useRenderStore } from '@/stores/render.store'

export function WorkbenchScopeCard() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const projects = useProjectStore((s) => s.projects)
  const batchMode = useRenderStore((s) => s.batchMode)
  const batchProjects = useRenderStore((s) => s.batchProjects)
  const setBatchMode = useRenderStore((s) => s.setBatchMode)
  const toggleBatchProject = useRenderStore((s) => s.toggleBatchProject)

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
        <FolderOpen size={12} />
        {t('workbench:scope')}
      </div>
      <div className="p-3 space-y-2">
        {/* Current project */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            checked={!batchMode}
            onChange={() => setBatchMode(false)}
            className="text-primary-500"
          />
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {t('workbench:currentProject')}:
          </span>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
            {selectedProjectName || t('workbench:notSelected')}
          </span>
        </label>

        {/* Batch mode */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            checked={batchMode}
            onChange={() => setBatchMode(true)}
            className="text-primary-500"
          />
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {t('workbench:batchMode')}
          </span>
        </label>

        {batchMode && (
          <div className="ml-6 max-h-32 overflow-auto space-y-0.5">
            {projects.length === 0 ? (
              <p className="text-[10px] text-gray-400">{t('workbench:noProjects')}</p>
            ) : (
              projects.map((p) => (
                <label key={p.name} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={batchProjects.includes(p.name)}
                    onChange={() => toggleBatchProject(p.name)}
                    className="text-primary-500"
                  />
                  <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate">{p.name}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}