import { useState, useCallback, useRef, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useWorkspaceStore, type WorkspaceTab } from '@/stores/workspace.store'
import clsx from 'clsx'
import {
  Server, GitBranch, FileCheck, Database, LayoutDashboard,
} from 'lucide-react'

const TAB_ICONS: Record<string, React.ReactNode> = {
  workbench: <LayoutDashboard size={14} />,
  rack: <Server size={14} />,
  topology: <GitBranch size={14} />,
  output: <FileCheck size={14} />,
  deviceLibrary: <Database size={14} />,
}

interface ContextMenu {
  x: number
  y: number
  tabId: string
}

export function WorkspaceTabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const closeOtherTabs = useWorkspaceStore((s) => s.closeOtherTabs)
  const closeTabsToRight = useWorkspaceStore((s) => s.closeTabsToRight)
  const closeAllTabs = useWorkspaceStore((s) => s.closeAllTabs)

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShowLeftArrow(el.scrollLeft > 1)
    setShowRightArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true })
      window.addEventListener('resize', checkScroll)
      return () => {
        el.removeEventListener('scroll', checkScroll)
        window.removeEventListener('resize', checkScroll)
      }
    }
  }, [checkScroll, tabs.length])

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, tabId })
  }

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (contextMenu) {
      const handler = () => closeContextMenu()
      window.addEventListener('click', handler)
      return () => window.removeEventListener('click', handler)
    }
  }, [contextMenu, closeContextMenu])

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -150, behavior: 'smooth' })
  }
  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 150, behavior: 'smooth' })
  }

  if (tabs.length === 0) return null

  return (
    <div className="flex items-center h-9 shrink-0 bg-gray-100 dark:bg-gray-850 border-b border-gray-200 dark:border-gray-700 select-none">
      {showLeftArrow && (
        <button
          onClick={scrollLeft}
          className="shrink-0 h-full px-1 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
        >
          <ChevronLeft size={14} />
        </button>
      )}
      <div
        ref={scrollRef}
        className="flex-1 flex items-end overflow-x-auto overflow-y-hidden scrollbar-none"
        onWheel={(e) => {
          e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
          />
        ))}
      </div>
      {showRightArrow && (
        <button
          onClick={scrollRight}
          className="shrink-0 h-full px-1 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
        >
          <ChevronRight size={14} />
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenuDropdown
          x={contextMenu.x}
          y={contextMenu.y}
          tabId={contextMenu.tabId}
          onCloseTab={(id) => { closeTab(id); closeContextMenu() }}
          onCloseOthers={(id) => { closeOtherTabs(id); closeContextMenu() }}
          onCloseRight={(id) => { closeTabsToRight(id); closeContextMenu() }}
          onCloseAll={() => { closeAllTabs(); closeContextMenu() }}
        />
      )}
    </div>
  )
}

function TabItem({
  tab, isActive, onSelect, onClose, onContextMenu,
}: {
  tab: WorkspaceTab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={clsx(
        'group flex items-center gap-1.5 h-8 px-2.5 text-xs cursor-pointer shrink-0 border-r border-gray-200 dark:border-gray-700 transition-colors max-w-[180px]',
        isActive
          ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border-t-2 border-t-primary-500 border-b-transparent -mb-px'
          : 'bg-gray-100 dark:bg-gray-850 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-750',
      )}
    >
      <span className={clsx(
        'shrink-0',
        isActive ? 'text-primary-500' : 'text-gray-400 dark:text-gray-500',
      )}>
        {TAB_ICONS[tab.type] || TAB_ICONS.workbench}
      </span>
      <span className="truncate text-[11px]">{tab.title}</span>
      {tab.closable && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          className={clsx(
            'shrink-0 p-0.5 rounded-sm transition-opacity',
            hover || isActive ? 'opacity-100' : 'opacity-0',
            'hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-400 dark:text-gray-500',
          )}
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

function ContextMenuDropdown({
  x, y, tabId, onCloseTab, onCloseOthers, onCloseRight, onCloseAll,
}: {
  x: number; y: number; tabId: string
  onCloseTab: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseRight: (id: string) => void
  onCloseAll: () => void
}) {
  return (
    <div
      className="fixed z-[100] py-1 min-w-[140px] rounded-md shadow-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
      style={{ left: x, top: y }}
    >
      <button
        onClick={() => onCloseTab(tabId)}
        className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
      >
        关闭
      </button>
      <button
        onClick={() => onCloseOthers(tabId)}
        className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
      >
        关闭其他
      </button>
      <button
        onClick={() => onCloseRight(tabId)}
        className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
      >
        关闭右侧
      </button>
      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
      <button
        onClick={onCloseAll}
        className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
      >
        关闭全部
      </button>
    </div>
  )
}
