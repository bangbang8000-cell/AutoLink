import { useTranslation } from 'react-i18next'
import { useUIStore, type ActivityType } from '@/stores/ui.store'
import {
  FolderOpen, Zap, Wrench, Server, GitBranch, FileCheck, Settings, PanelLeftClose, PanelLeft, Database,
} from 'lucide-react'
import clsx from 'clsx'

interface ActivityItem {
  id: ActivityType
  icon: React.ReactNode
  labelKey: string
  shortcut: string
}

const activities: ActivityItem[] = [
  { id: 'explorer', icon: <FolderOpen size={20} />, labelKey: 'menu.projectExplorer', shortcut: 'Ctrl+Shift+E' },
  { id: 'workbench', icon: <Zap size={20} />, labelKey: 'menu.workbench', shortcut: 'Ctrl+Shift+W' },
  { id: 'design', icon: <Wrench size={20} />, labelKey: 'menu.design', shortcut: 'Ctrl+Shift+D' },
  { id: 'rack', icon: <Server size={20} />, labelKey: 'menu.rack', shortcut: 'Ctrl+Shift+R' },
  { id: 'topology', icon: <GitBranch size={20} />, labelKey: 'menu.topology', shortcut: 'Ctrl+Shift+T' },
  { id: 'output', icon: <FileCheck size={20} />, labelKey: 'menu.outputResults', shortcut: 'Ctrl+Shift+O' },
  { id: 'deviceLibrary', icon: <Database size={20} />, labelKey: 'menu.deviceLibrary', shortcut: 'Ctrl+Shift+L' },
  { id: 'settings', icon: <Settings size={20} />, labelKey: 'menu.settings', shortcut: 'Ctrl+,' },
]

/** Activities that open as workspace tabs instead of sidebar panels */
const WORKSPACE_ACTIVITIES: ActivityType[] = ['workbench', 'rack', 'topology', 'output', 'deviceLibrary']

interface Props {
  onActivityClick?: (activity: ActivityType) => void
}

export function ActivityBar({ onActivityClick }: Props) {
  const { t } = useTranslation()
  const activeActivity = useUIStore((s) => s.activeActivity)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  const handleClick = (item: ActivityItem) => {
    if (WORKSPACE_ACTIVITIES.includes(item.id) && onActivityClick) {
      onActivityClick(item.id)
    } else {
      setActiveActivity(item.id)
    }
  }

  // Determine which activity is highlighted: either sidebar active or workspace active
  const isActive = (item: ActivityItem) => {
    if (WORKSPACE_ACTIVITIES.includes(item.id)) {
      // Content-type: highlight based on whether there's a tab of this type active
      return false // Let parent control highlighting for workspace tabs
    }
    return activeActivity === item.id
  }

  return (
    <div className="w-12 flex flex-col items-center py-2 gap-0.5 shrink-0 bg-gray-100 dark:bg-gray-900 border-e border-gray-200 dark:border-gray-700">
      <div className="flex-1 flex flex-col items-center gap-0.5 w-full">
        {activities.map((item) => {
          const active = isActive(item)
          return (
            <button
              key={item.id}
              onClick={() => handleClick(item)}
              title={`${t(`common:${item.labelKey}`)} (${item.shortcut})`}
              className={clsx(
                'w-12 h-12 flex items-center justify-center relative transition-colors',
                active
                  ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-gray-700'
                  : 'text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-200 dark:hover:bg-gray-700',
              )}
            >
              {active && (
                <div className="absolute start-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary-500 dark:bg-primary-400" />
              )}
              {item.icon}
            </button>
          )
        })}
      </div>
      <button
        onClick={toggleSidebar}
        title={sidebarVisible ? t('common:menu.hideSidebar') : t('common:menu.showSidebar')}
        className="w-12 h-10 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      >
        {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
      </button>
    </div>
  )
}
