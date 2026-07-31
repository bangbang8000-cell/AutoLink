import { useCallback, useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, LayoutDashboard, Server, GitBranch, Network, FileOutput, Library, Monitor, Wrench, FolderOpen, Play, Building2, LayoutTemplate, Upload, BookOpen, Sparkles } from 'lucide-react'
import { useWorkspaceStore, type TabType } from '@/stores/workspace.store'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore } from '@/stores/ui.store'
import { useToastStore } from '@/stores/toast.store'
import { WorkbenchTab } from './tabs/WorkbenchTab'
import { TopologyTab } from './tabs/TopologyTab'
import { RackTab } from './tabs/RackTab'
import { OutputTab } from './tabs/OutputTab'
import { ProjectOverviewTab } from './tabs/ProjectOverviewTab'
import { DesignTab } from './tabs/DesignTab'
import { DeviceLibraryTab } from './tabs/DeviceLibraryTab'
import { FileViewerTab } from './tabs/FileViewerTab'
import { DataCenterTab } from './tabs/DataCenterTab'
import { GuideTab } from './tabs/GuideTab'

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
  guide: BookOpen,
}

export function WorkspaceView() {
  const { t } = useTranslation('common')
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const closeOtherTabs = useWorkspaceStore((s) => s.closeOtherTabs)
  const closeAllTabs = useWorkspaceStore((s) => s.closeAllTabs)
  const closeTabsToRight = useWorkspaceStore((s) => s.closeTabsToRight)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const importProject = useProjectStore((s) => s.importProject)
  const setShowCreateProjectWizard = useUIStore((s) => s.setShowCreateProjectWizard)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)
  const addToast = useToastStore((s) => s.addToast)

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
      case 'guide': return <GuideTab />
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
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 border-t-2 border-t-transparent'}
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
            {t('welcome.closeTab')}
          </button>
          <button
            onClick={() => { closeOtherTabs(contextMenu.tabId); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            {t('welcome.closeOthers')}
          </button>
          <button
            onClick={() => { closeTabsToRight(contextMenu.tabId); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            {t('welcome.closeRight')}
          </button>
          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
          <button
            onClick={() => { closeAllTabs(); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            {t('welcome.closeAll')}
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
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('welcome.currentProject', { name: selectedProjectName })}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">{t('welcome.openFromSidebar')}</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-gray-600 dark:text-gray-300 mb-1">{t('welcome.title')}</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">{t('welcome.subtitle')}</p>
                <div className="grid grid-cols-3 gap-3 max-w-2xl">
                  <button
                    onClick={() => setShowCreateProjectWizard(true)}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
                  >
                    <Sparkles size={22} className="text-primary-500" />
                    <div>
                      <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('welcome.newProject')}</div>
                      <div className="text-2xs text-gray-400 dark:text-gray-500">{t('welcome.newProjectDesc')}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { setActiveActivity('project'); addToast('info', t('common:toast.templateHint')) }}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    <LayoutTemplate size={22} className="text-gray-500 dark:text-gray-400" />
                    <div>
                      <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('welcome.fromTemplate')}</div>
                      <div className="text-2xs text-gray-400 dark:text-gray-500">{t('welcome.fromTemplateDesc')}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { setActiveActivity('project'); addToast('info', t('common:toast.selectProjectFromList')) }}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    <FolderOpen size={22} className="text-gray-500 dark:text-gray-400" />
                    <div>
                      <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('welcome.openProject')}</div>
                      <div className="text-2xs text-gray-400 dark:text-gray-500">{t('welcome.openProjectDesc')}</div>
                    </div>
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const result = await importProject()
                        if (!result.canceled) addToast('success', t('common:toast.projectImported', { name: result.projectName }))
                      } catch (err: any) {
                        addToast('error', t('common:toast.importFailed', { error: err?.message || err }))
                      }
                    }}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    <Upload size={22} className="text-gray-500 dark:text-gray-400" />
                    <div>
                      <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('welcome.importProject')}</div>
                      <div className="text-2xs text-gray-400 dark:text-gray-500">{t('welcome.importProjectDesc')}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setActiveActivity('workbench')
                      openTab({ type: 'workbench', title: t('menu.workbench'), closable: false })
                    }}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    <Play size={22} className="text-gray-500 dark:text-gray-400" />
                    <div>
                      <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('welcome.openWorkbench')}</div>
                      <div className="text-2xs text-gray-400 dark:text-gray-500">{t('welcome.openWorkbenchDesc')}</div>
                    </div>
                  </button>
                  <button
                    // P2: 使用指南改为本地加载(工作区标签页),不再跳转 GitHub
                    onClick={() => openTab({ type: 'guide', title: t('guide.title'), closable: true })}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    <BookOpen size={22} className="text-gray-500 dark:text-gray-400" />
                    <div>
                      <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('welcome.userGuide')}</div>
                      <div className="text-2xs text-gray-400 dark:text-gray-500">{t('welcome.userGuideDesc')}</div>
                    </div>
                  </button>
                </div>
                <div className="mt-6 text-2xs text-gray-400 dark:text-gray-500 space-y-0.5">
                  <p><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-2xs">Ctrl+N</kbd> {t('welcome.shortcutNewProject')}</p>
                  <p><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-2xs">Ctrl+Shift+W</kbd> {t('welcome.shortcutWorkbench')}</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
