import { useTranslation } from 'react-i18next'
import { useUIStore, type ActivityType } from '@/stores/ui.store'
import {
  FolderOpen, Zap, Settings, PanelLeftClose, PanelLeft, Server, Sparkles, Cloud, Search, Files,
} from 'lucide-react'
import clsx from 'clsx'

interface ActivityItem {
  id: ActivityType
  icon: React.ReactNode
  labelKey: string
  shortcut: string
}

// 打磨轮（P-A）：一级菜单重排 —— 搜索/云平台/AI助手/项目浏览器/工作台/设备库/设置
// （拓扑设计、AIDC 规划、可视化已并入工作台子视图）
const ACTIVITIES: ActivityItem[] = [
  { id: 'search', icon: <Search size={20} />, labelKey: 'nav:search', shortcut: 'Ctrl+Shift+F' },
  { id: 'cloud', icon: <Cloud size={20} />, labelKey: 'nav:cloud', shortcut: 'Ctrl+Shift+C' },
  { id: 'ai', icon: <Sparkles size={20} />, labelKey: 'nav:ai', shortcut: 'Ctrl+Shift+A' },
  { id: 'project', icon: <FolderOpen size={20} />, labelKey: 'nav:project', shortcut: 'Ctrl+Shift+E' },
  { id: 'workbench', icon: <Zap size={20} />, labelKey: 'nav:workbench', shortcut: 'Ctrl+Shift+W' },
  // 打磨轮（v1.6 / AL-O2a）：输出结果一级入口（全部项目）
  { id: 'output', icon: <Files size={20} />, labelKey: 'nav:output', shortcut: 'Ctrl+Shift+O' },
  { id: 'device_library', icon: <Server size={20} />, labelKey: 'nav:device_library', shortcut: 'Ctrl+Shift+L' },
  { id: 'settings', icon: <Settings size={20} />, labelKey: 'nav:settings', shortcut: 'Ctrl+,' },
]

// v2.6.8: ActivityBar 入口语义色
const ACTIVITY_COLORS: Record<string, { icon: string; bar: string }> = {
  // V3.3.1: 全局搜索
  search: { icon: 'text-teal-500 dark:text-teal-400', bar: 'bg-teal-500' },
  project: { icon: 'text-primary-500 dark:text-primary-400', bar: 'bg-primary-500' },
  design: { icon: 'text-warning-500 dark:text-warning-400', bar: 'bg-warning-500' },
  aidc_plan: { icon: 'text-emerald-500 dark:text-emerald-400', bar: 'bg-emerald-500' },
  workbench: { icon: 'text-success-500 dark:text-success-400', bar: 'bg-success-500' },
  visualization: { icon: 'text-info-500 dark:text-info-400', bar: 'bg-info-500' },
  device_library: { icon: 'text-purple-500 dark:text-purple-400', bar: 'bg-purple-500' },
  // V3.2.1: 修复 ai 入口缺失语义色导致点击后渲染崩溃白屏
  ai: { icon: 'text-fuchsia-500 dark:text-fuchsia-400', bar: 'bg-fuchsia-500' },
  // V3.3.0-T13: 云中心
  cloud: { icon: 'text-cyan-500 dark:text-cyan-400', bar: 'bg-cyan-500' },
  // 打磨轮（v1.6 / AL-O2a）：输出结果（全部项目）
  output: { icon: 'text-amber-500 dark:text-amber-400', bar: 'bg-amber-500' },
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
  // 打磨轮（v1.2 / M2）：云平台开关关闭时隐藏云一级菜单
  const cloudEnabled = useUIStore((s) => s.cloudEnabled)
  const activities = ACTIVITIES.filter((a) => a.id !== 'cloud' || cloudEnabled)

  const handleClick = (item: ActivityItem) => {
    if (onActivityClick) {
      onActivityClick(item.id)
    }
  }

  const renderItem = (item: ActivityItem) => {
    const active = activeActivity === item.id
    const colors = ACTIVITY_COLORS[item.id]
    return (
      <button
        key={item.id}
        onClick={() => handleClick(item)}
        title={`${t(item.labelKey)} (${item.shortcut})`}
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
  }

  return (
    <div className="w-12 flex flex-col items-center py-2 gap-0.5 shrink-0 bg-gray-100 dark:bg-app border-e border-gray-200 dark:border-edge-subtle">
      <div className="flex-1 flex flex-col items-center gap-0.5 w-full">
        {activities.map(renderItem)}
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
