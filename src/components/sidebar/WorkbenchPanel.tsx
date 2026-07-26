import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Zap, FolderOpen, LayoutGrid, GitBranch,
  FileSpreadsheet, Settings, Download,
  ArrowRight, Server, Table2,
} from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore } from '@/stores/ui.store'

function QuickActionCard({
  icon,
  title,
  description,
  activity,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  activity?: string
  onClick?: () => void
}) {
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)

  return (
    <button
      onClick={() => (onClick ? onClick() : activity && setActiveActivity(activity as any))}
      className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-sm transition-all text-left"
    >
      <div className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{title}</div>
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{description}</div>
      </div>
      <ArrowRight size={14} className="text-gray-300 dark:text-gray-600 shrink-0 mt-1" />
    </button>
  )
}

function OutputFileRow({
  icon,
  name,
  type,
  onClick,
}: {
  icon: React.ReactNode
  name: string
  type: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded cursor-pointer text-xs text-gray-600 dark:text-gray-400"
    >
      {icon}
      <span className="flex-1 truncate">{name}</span>
      <span className="text-[10px] text-gray-400 dark:text-gray-500">{type}</span>
    </div>
  )
}

export function WorkbenchPanel() {
  const { t } = useTranslation()
  const selectedProject = useProjectStore((s) => s.selectedProject)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)

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
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('workbench:title')}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Project Info */}
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
            {t('workbench:projectInfo')}
          </h4>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <FolderOpen size={13} className="text-amber-500" />
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
        </div>

        {/* Quick Actions */}
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
            {t('workbench:quickActions')}
          </h4>
          <div className="space-y-2">
            <QuickActionCard
              icon={<Server size={16} className="text-primary-500" />}
              title={t('workbench:rackLayout')}
              description={t('workbench:generateRack')}
              activity="rack"
            />
            <QuickActionCard
              icon={<GitBranch size={16} className="text-primary-500" />}
              title={t('workbench:topologyMap')}
              description={t('workbench:generateTopology')}
              activity="topology"
            />
            <QuickActionCard
              icon={<Table2 size={16} className="text-primary-500" />}
              title={t('workbench:connectionTable')}
              description={t('workbench:exportExcel')}
              activity="output"
            />
          </div>
        </div>

        {/* Output Files */}
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
            {t('workbench:outputs')}
          </h4>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
            <OutputFileRow
              icon={<FileSpreadsheet size={13} className="text-green-500" />}
              name={`${selectedProjectName}_rack_layout.xlsx`}
              type="Excel"
              onClick={() => setActiveActivity('output')}
            />
            <OutputFileRow
              icon={<FileSpreadsheet size={13} className="text-green-500" />}
              name={`${selectedProjectName}_connections.xlsx`}
              type="Excel"
              onClick={() => setActiveActivity('output')}
            />
            <OutputFileRow
              icon={<GitBranch size={13} className="text-blue-500" />}
              name={`${selectedProjectName}_topology.png`}
              type="Image"
              onClick={() => setActiveActivity('topology')}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
