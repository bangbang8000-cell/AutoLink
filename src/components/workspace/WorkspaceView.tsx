import { useCallback, useState, useRef, useEffect } from 'react'
import { X, LayoutDashboard, Server, GitBranch, Network, FileOutput, Library, Monitor, Wrench, FolderOpen, Plus, Play, Building2 } from 'lucide-react'
import { useWorkspaceStore, type TabType } from '@/stores/workspace.store'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore } from '@/stores/ui.store'
import { WorkbenchTab } from './tabs/WorkbenchTab'
import { TopologyTab } from './tabs/TopologyTab'
import { RackTab } from './tabs/RackTab'
import { OutputTab } from './tabs/OutputTab'
import { ProjectOverviewTab } from './tabs/ProjectOverviewTab'
import { DesignTab } from './tabs/DesignTab'
import { DeviceLibraryTab } from './tabs/DeviceLibraryTab'
import { FileViewerTab } from './tabs/FileViewerTab'
import { DataCenterTab } from './tabs/DataCenterTab'

const TAB_ICONS: Record<TabType, React.ComponentType<{ size?: number; className?: string }>> = {
  workbench: LayoutDashboard,
  design: Wrench,
  visualization: Network,
  rack: Server,
  topology: GitBranch,
  output: FileOutput,
  deviceLibrary: Library,
  projectOverview: FolderOpen,
  fileViewer: Monitor,
  datacenter: Building2,
}

export function WorkspaceView() {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const closeOtherTabs = useWorkspaceStore((s) => s.closeOtherTabs)
  const closeAllTabs = useWorkspaceStore((s) => s.closeAllTabs)
  const closeTabsToRight = useWorkspaceStore((s) => s.closeTabsToRight)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const setShowCreateProjectWizard = useUIStore((s) => s.setShowCreateProjectWizard)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)

  const activeTab = tabs.find((t) => t.id === activeTabId)

  // Context menu for tabs
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }, [])

  const renderTabContent = useCallback(() => {
    if (!activeTab) return null
    switch (activeTab.type) {
      case 'workbench': return <WorkbenchTab />
      case 'design': return <DesignTab />
      case 'visualization': return <TopologyTab />
      case 'rack': return <RackTab cabinetId={activeTab?.state?.cabinetId as number | null | undefined} />
      case 'topology': return <TopologyTab />
      case 'output': {
        const state = activeTab?.state
        return <OutputTab fileName={state?.fileName as string | null} fileType={state?.fileType as string} />
      }
      case 'deviceLibrary': {
        return <DeviceLibraryTab initialCategory={activeTab?.state?.category as string | undefined} />
      }
      case 'projectOverview': {
        return <ProjectOverviewTab projectName={activeTab?.state?.projectName as string} />
      }
      case 'fileViewer': {
        const fvState = activeTab?.state
        return (
          <FileViewerTab
            templateName={fvState?.templateName as string | undefined}
            filePath={fvState?.filePath as string | undefined}
            isTemplate={fvState?.isTemplate as boolean | undefined}
          />
        )
      }
      case 'datacenter': return <DataCenterTab />
    }
  }, [activeTab])

  return (
    <div className="h-full flex flex-col">
      {/* Tab Bar */}
      {tabs.length > 0 && (
        <div className="flex items-center bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab.type] || Monitor
            const isActive = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                className={`
                  group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer select-none
                  border-r border-gray-200 dark:border-gray-700 shrink-0 max-w-[180px]
                  ${isActive
                    ? 'bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 border-t-2 border-t-primary-500'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-750 border-t-2 border-t-transparent'}
                `}
              >
                <Icon size={13} className="shrink-0" />
                <span className="truncate">{tab.title}</span>
                {tab.closable && (
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                    className="shrink-0 ml-0.5 p-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Tab Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[9999] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { closeTab(contextMenu.tabId); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            关闭
          </button>
          <button
            onClick={() => { closeOtherTabs(contextMenu.tabId); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            关闭其他
          </button>
          <button
            onClick={() => { closeTabsToRight(contextMenu.tabId); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            关闭右侧
          </button>
          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
          <button
            onClick={() => { closeAllTabs(); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            关闭全部
          </button>
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
        {activeTab ? (
          <div className="h-full">{renderTabContent()}</div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-white dark:bg-gray-800">
            <Monitor size={48} className="text-gray-300 dark:text-gray-600 mb-4" />
            {selectedProjectName ? (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">当前项目：{selectedProjectName}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">从左侧活动栏打开功能面板</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-gray-600 dark:text-gray-300 mb-1">欢迎使用 AutoLink</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">AI 智算中心网络规划与可视化工具</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCreateProjectWizard(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors shadow-sm"
                  >
                    <Plus size={16} /> 新建项目
                  </button>
                  <button
                    onClick={() => {
                      setActiveActivity('workbench')
                      openTab({ type: 'workbench', title: '工作台', closable: false })
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                  >
                    <Play size={16} /> 打开 Demo 项目
                  </button>
                </div>
                <div className="mt-6 text-[11px] text-gray-400 dark:text-gray-500 space-y-0.5">
                  <p><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">Ctrl+Shift+N</kbd> 新建项目</p>
                  <p><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">Ctrl+Shift+W</kbd> 工作台</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
