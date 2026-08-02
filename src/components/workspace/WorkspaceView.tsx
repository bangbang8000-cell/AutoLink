import { useCallback, useState, useRef, useEffect, Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { X, LayoutDashboard, Server, GitBranch, Network, FileOutput, Library, Monitor, Wrench, FolderOpen, Play, Building2, LayoutTemplate, Upload, BookOpen, Sparkles, Box } from 'lucide-react'
import { useWorkspaceStore, type TabType } from '@/stores/workspace.store'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore } from '@/stores/ui.store'
import { useToastStore } from '@/stores/toast.store'
import { Modal } from '@/components/ui/Modal'

// v2.7.3-T8: Tab 懒加载,首屏仅加载当前 Tab 代码
const WorkbenchTab = lazy(() => import('./tabs/WorkbenchTab').then(m => ({ default: m.WorkbenchTab })))
const TopologyTab = lazy(() => import('./tabs/TopologyTab').then(m => ({ default: m.TopologyTab })))
// V2.7.6-T9: 3D 拓扑可视化 PoC (懒加载, 避免影响首屏性能)
const Topology3DTab = lazy(() => import('./tabs/Topology3DTab').then(m => ({ default: m.Topology3DTab })))
const RackTab = lazy(() => import('./tabs/RackTab').then(m => ({ default: m.RackTab })))
const OutputTab = lazy(() => import('./tabs/OutputTab').then(m => ({ default: m.OutputTab })))
const ProjectOverviewTab = lazy(() => import('./tabs/ProjectOverviewTab').then(m => ({ default: m.ProjectOverviewTab })))
const DesignTab = lazy(() => import('./tabs/DesignTab').then(m => ({ default: m.DesignTab })))
const DeviceLibraryTab = lazy(() => import('./tabs/DeviceLibraryTab').then(m => ({ default: m.DeviceLibraryTab })))
const FileViewerTab = lazy(() => import('./tabs/FileViewerTab').then(m => ({ default: m.FileViewerTab })))
const DataCenterTab = lazy(() => import('./tabs/DataCenterTab').then(m => ({ default: m.DataCenterTab })))
const GuideTab = lazy(() => import('./tabs/GuideTab').then(m => ({ default: m.GuideTab })))

const TAB_ICONS: Record<TabType, React.ComponentType<{ size?: number; className?: string }>> = {
  workbench: LayoutDashboard,
  design: Wrench,
  visualization: Network,
  rack: Server,
  topology: GitBranch,
  // V2.7.6-T9: 3D 拓扑可视化使用 Box 图标
  topology3d: Box,
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

  // V2.9.2-T4: dirty Tab 关闭前确认
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null)
  const pendingCloseTab = pendingCloseTabId ? tabs.find((t) => t.id === pendingCloseTabId) : undefined

  // 单个 Tab 关闭: dirty 需确认, 其余直接关闭
  const requestCloseTab = useCallback((id: string) => {
    const target = tabs.find((t) => t.id === id)
    if (target?.dirty) {
      setPendingCloseTabId(id)
    } else {
      closeTab(id)
    }
  }, [tabs, closeTab])

  const handleConfirmDirtyClose = useCallback(() => {
    if (pendingCloseTabId) closeTab(pendingCloseTabId)
    setPendingCloseTabId(null)
  }, [pendingCloseTabId, closeTab])

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
      // V2.7.6-T9: 3D 拓扑可视化 PoC
      case 'topology3d': return <Topology3DTab />
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
        // T6: 非模板项目文件传 projectName + filePath(相对项目根),
        // 此处组合为 FileViewerTab 期望的 `${projectName}/${filePath}` 形式
        const projectName = fvState?.projectName as string | undefined
        const rawFilePath = fvState?.filePath as string | undefined
        const filePath = projectName && !fvState?.isTemplate && rawFilePath
          ? `${projectName}/${rawFilePath}`
          : rawFilePath
        return (
          <FileViewerTab
            templateName={fvState?.templateName as string | undefined}
            filePath={filePath}
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
        <div className="flex items-center bg-gray-100 dark:bg-app-surface border-b border-gray-200 dark:border-edge-subtle shrink-0 overflow-x-auto">
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
                  border-r border-gray-200 dark:border-edge-subtle shrink-0 max-w-[180px]
                  ${isActive
                    ? 'bg-white dark:bg-app-elevated text-primary-600 dark:text-primary-400 border-t-2 border-t-primary-500'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-app-hover border-t-2 border-t-transparent'}
                `}
              >
                <Icon size={13} className="shrink-0" />
                <span className="truncate">{tab.title}</span>
                {tab.closable && (
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                    className="shrink-0 ml-0.5 p-0.5 rounded hover:bg-gray-300 dark:hover:bg-app-hover opacity-0 group-hover:opacity-100 transition-opacity"
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
          className="fixed z-[9999] bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded-lg shadow-lg py-1 min-w-[140px] animate-contextmenu-in"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { requestCloseTab(contextMenu.tabId); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300"
          >
            {t('welcome.closeTab')}
          </button>
          <button
            onClick={() => { closeOtherTabs(contextMenu.tabId); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300"
          >
            {t('welcome.closeOthers')}
          </button>
          <button
            onClick={() => { closeTabsToRight(contextMenu.tabId); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300"
          >
            {t('welcome.closeRight')}
          </button>
          <div className="my-1 border-t border-gray-200 dark:border-edge-subtle" />
          <button
            onClick={() => { closeAllTabs(); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300"
          >
            {t('welcome.closeAll')}
          </button>
        </div>
      )}

      {/* V2.9.2-T4: dirty Tab 关闭确认 */}
      <Modal
        open={pendingCloseTabId !== null}
        onClose={() => setPendingCloseTabId(null)}
        title={t('welcome.dirtyCloseTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPendingCloseTabId(null)}
              className="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleConfirmDirtyClose}
              className="px-3 py-1.5 text-xs rounded-md bg-error-500 hover:bg-error-600 text-white transition-colors"
            >
              {t('welcome.dirtyCloseConfirm')}
            </button>
          </div>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t('welcome.dirtyCloseMessage', { title: pendingCloseTab?.title ?? '' })}
        </p>
      </Modal>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto bg-white dark:bg-app-elevated">
        {activeTab ? (
          <div className="h-full">
            <Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">...</div>}>
              {renderTabContent()}
            </Suspense>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-white dark:bg-app-elevated">
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
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-elevated hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
                  >
                    <LayoutTemplate size={22} className="text-gray-500 dark:text-gray-400" />
                    <div>
                      <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('welcome.fromTemplate')}</div>
                      <div className="text-2xs text-gray-400 dark:text-gray-500">{t('welcome.fromTemplateDesc')}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { setActiveActivity('project'); addToast('info', t('common:toast.selectProjectFromList')) }}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-elevated hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
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
                      } catch (err) {
                        addToast('error', t('common:toast.importFailed', { error: err instanceof Error ? err.message : String(err) }))
                      }
                    }}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-elevated hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
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
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-elevated hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
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
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-elevated hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
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
