import React from 'react'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, GitBranch, Table2, List, Cable, Calculator } from 'lucide-react'
import { useRenderStore, type OutputType } from '@/stores/render.store'

const outputDefs: { type: OutputType; icon: React.ReactNode; labelKey: string; descKey: string }[] = [
  {
    type: 'connections',
    icon: <FileSpreadsheet size={14} className="text-gray-400" />,
    labelKey: 'workbench:connectionsTable',
    descKey: 'workbench:connectionsTableDesc',
  },
  {
    type: 'rackTable',
    icon: <Table2 size={14} className="text-gray-400" />,
    labelKey: 'workbench:rackTable',
    descKey: 'workbench:rackTableDesc',
  },
  {
    type: 'topology',
    icon: <GitBranch size={14} className="text-gray-400" />,
    labelKey: 'workbench:topologyImg',
    descKey: 'workbench:topologyImgDesc',
  },
  {
    type: 'deviceList',
    icon: <List size={14} className="text-gray-400" />,
    labelKey: 'workbench:deviceList',
    descKey: 'workbench:deviceListDesc',
  },
  {
    type: 'cablingGuide',
    icon: <Cable size={14} className="text-gray-400" />,
    labelKey: 'workbench:cablingGuide',
    descKey: 'workbench:cablingGuideDesc',
  },
  {
    type: 'bom',
    icon: <Calculator size={14} className="text-gray-400" />,
    labelKey: 'workbench:bom',
    descKey: 'workbench:bomDesc',
  },
]

export function WorkbenchOutputCard() {
  const { t } = useTranslation()
  const selectedOutputTypes = useRenderStore((s) => s.selectedOutputTypes)
  const toggleOutputType = useRenderStore((s) => s.toggleOutputType)

  return (
    <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-app/50 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
        <FileSpreadsheet size={12} />
        {t('workbench:outputTypes')}
      </div>
      <div className="p-3 space-y-1.5">
        {outputDefs.map((def) => (
          <label
            key={def.type}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-app-hover/50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedOutputTypes.includes(def.type)}
              onChange={() => toggleOutputType(def.type)}
              className="text-primary-500 shrink-0"
            />
            <div className="flex items-center gap-1.5 min-w-0">
              {def.icon}
              <span className="text-xs text-gray-700 dark:text-gray-300">
                {t(def.labelKey)}
              </span>
            </div>
            <span className="text-2xs text-gray-400 dark:text-gray-500 ml-auto hidden sm:inline">
              {t(def.descKey)}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}