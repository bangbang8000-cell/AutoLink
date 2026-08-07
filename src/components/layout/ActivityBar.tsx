import { useTranslation } from 'react-i18next'
import { useUIStore, type ActivityType } from '@/stores/ui.store'
import {
  FolderOpen, Zap, Wrench, Network, Settings, PanelLeftClose, PanelLeft, Server, Sparkles, Cloud, Search,
} from 'lucide-react'
import clsx from 'clsx'

interface ActivityItem {
  id: ActivityType
  icon: React.ReactNode
  labelKey: string
  shortcut: string
}

const activities: ActivityItem[] = [
  // V3.3.1: 全局搜索（本地 + 云端二合一）置顶
  { id: 'search', icon: <Search size={20} />, labelKey: 'menu.search', shortcut: 'Ctrl+Shift+F' },
  // V3.1.1-T5-5: AI 对话入口
  { id: 'ai', icon: <Sparkles size={20} />, labelKey: 'menu.ai', shortcut: 'Ctrl+Shift+A' },
  { id: 'project', icon: <FolderOpen size={20} />, labelKey: 'menu.projectExplorer', shortcut: 'Ctrl+Shift+E' },
  { id: 'design', icon: <Wrench size={20} />, labelKey: 'menu.design', shortcut: 'Ctrl+Shift+D' },
  { id: 'workbench', icon: <Zap size={20} />, labelKey: 'menu.workbench', shortcut: 'Ctrl+Shift+W' },
  { id: 'visualization', icon: <Network size={20} />, labelKey: 'menu.visualization', shortcut: 'Ctrl+Shift+V' },
  { id: 'device_library', icon: <Server size={20} />, labelKey: 'menu.deviceLibrary', shortcut: 'Ctrl+Shift+L' },
  // V3.3.0-T13: 云中心（登录 + 云端项目/模板）
  { id: 'cloud', icon: <Cloud size={20} />, labelKey: 'menu.cloud', shortcut: 'Ctrl+Shift+C' },
  { id: 'settings', icon: <Settings size={20} />, labelKey: 'menu.settings', shortcut: 'Ctrl+,' },
]

// v2.6.8: ActivityBar 入口语义色
const ACTIVITY_COLORS: Record<string, { icon: string; bar: string }> = {
  // V3.3.1: 全局搜索
  search: { icon: 'text-teal-500 dark:text-teal-400', bar: 'bg-teal-500' },
  project: { icon: 'text-primary-500 dark:text-primary-400', bar: 'bg-primary-500' },
  design: { icon: 'text-warning-500 dark:text-warning-400', bar: 'bg-warning-500' },
  workbench: { icon: 'text-success-500 dark:text-success-400', bar: 'bg-success-500' },
  visualization: { icon: 'text-info-500 dark:text-info-400', bar: 'bg-info-500' },
  device_library: { icon: 'text-purple-500 dark:text-purple-400', bar: 'bg-purple-500' },
  // V3.2.1: 修复 ai 入口缺失语义色导致点击后渲染崩溃白屏
  ai: { icon: 'text-fuchsia-500 dark:text-fuchsia-400', bar: 'bg-fuchsia-500' },
  // V3.3.0-T13: 云中心
  cloud: { icon: 'text-cyan-500 dark:text-cyan-400', bar: 'bg-cyan-500' },
  settings: { icon: 'text-gray-500 dark:text-gray-400', bar: 'bg-gray-500' },
}

interface Props {
  onActivityClick?: (activity: ActivityType) => void
}

export function ActivityBar({ onActivityClick }: Props) {
  const { t } = useTranslation()
  const activeActivity = useUIStore((s) => s.activeActivity)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  const handleClick = (item: ActivityItem) => {
    if (onActivityClick) {
      onActivityClick(item.id)
    }
  }

  return (
    <div className="w-12 flex flex-col items-center py-2 gap-0.5 shrink-0 bg-gray-100 dark:bg-app border-e border-gray-200 dark:border-edge-subtle">
      <div className="flex-1 flex flex-col items-center gap-0.5 w-full">
        {activities.map((item) => {
          const active = activeActivity === item.id
          const colors = ACTIVITY_COLORS[item.id]
          return (
            <button
              key={item.id}
              onClick={() => handleClick(item)}
              title={`${t(`common:${item.labelKey}`)} (${item.shortcut})`}
              className={clsx(
                'w-12 h-12 flex items-center justify-center relative transition-colors',
                active
                  ? `${colors.icon} bg-gray-200 dark:bg-app-hover`
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-app-hover',
              )}
            >
              {active && (
                <div className={clsx('absolute start-0 top-1.5 bottom-1.5 w-0.5 rounded-r', colors.bar)} />
              )}
              {item.icon}
            </button>
          )
        })}
      </div>
      <button
        onClick={toggleSidebar}
        title={sidebarVisible ? t('common:menu.hideSidebar') : t('common:menu.showSidebar')}
        className="w-12 h-10 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-app-hover transition-colors"
      >
        {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
      </button>
    </div>
  )
}
