import { useEffect, useCallback, useRef } from 'react'
import clsx from 'clsx'
import { useProjectStore } from '@/stores/project.store'
import { ProjectProvider } from '@/stores/ProjectContext'
import { useUIStore, type ActivityType } from '@/stores/ui.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { Header } from '@/components/layout/Header'
import { ActivityBar } from '@/components/layout/ActivityBar'
import { StatusBar } from '@/components/layout/StatusBar'
import { ResizableAppLayout } from '@/components/layout/ResizableAppLayout'
import { ToastContainer } from '@/components/layout/ToastContainer'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { LogPanel } from '@/components/layout/LogPanel'
import { FileExplorer } from '@/components/layout/FileExplorer'
import { WorkspaceView } from '@/components/workspace/WorkspaceView'
import { WorkspaceErrorBoundary } from '@/components/workspace/WorkspaceErrorBoundary'
import { ServerProfileForm } from '@/components/device/ServerProfileForm'
import { SwitchProfileForm } from '@/components/device/SwitchProfileForm'
import { DeviceImportModal } from '@/components/device/DeviceImportModal'
import { DeviceExportModal } from '@/components/device/DeviceExportModal'
import '@/i18n'

/** Map activity types to workspace tab config */
const WORKSPACE_TAB_CONFIG: Record<string, { type: 'workbench' | 'design' | 'visualization' | 'deviceLibrary'; title: string; closable: boolean }> = {
  workbench: { type: 'workbench', title: '工作台', closable: false },
  design: { type: 'design', title: '设计', closable: true },
  visualization: { type: 'visualization', title: '可视化', closable: true },
  device_library: { type: 'deviceLibrary', title: '设备库', closable: true },
}

export default function App() {
  const fetchProjects = useProjectStore((s) => s.fetchProjects)
  const fetchTemplates = useProjectStore((s) => s.fetchTemplates)
  const activeActivity = useUIStore((s) => s.activeActivity)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const togglePanel = useUIStore((s) => s.togglePanel)
  const panelVisible = useUIStore((s) => s.panelVisible)
  const isDark = useUIStore((s) => s.isDark)
  const syncSystemTheme = useUIStore((s) => s.syncSystemTheme)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const reopenLastClosed = useWorkspaceStore((s) => s.reopenLastClosed)

  // Apply dark mode to HTML element
  useEffect(() => {
    const root = document.documentElement
    if (isDark) root.classList.add('dark')
    else root.classList.remove('dark')
  }, [isDark])

  // Sync system theme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => syncSystemTheme()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [syncSystemTheme])

  // Initialize on mount
  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    // Templates are hardcoded, always available
    fetchTemplates()

    // Retry fetchProjects: Electron preload may need a tick to expose window.electron
    let retries = 0
    const maxRetries = 5
    const tryFetch = async () => {
      try {
        await fetchProjects()
        console.log('[App] Projects loaded successfully')

        // Session restore: auto-select previously selected project
        const state = useProjectStore.getState()
        if (state.selectedProjectName) {
          const project = state.projects.find((p) => p.name === state.selectedProjectName)
          if (project) {
            state.selectProject(project)
            console.log('[App] Session restored: auto-selected project', state.selectedProjectName)
          }
        }
      } catch {
        retries++
        if (retries < maxRetries) {
          console.log(`[App] Retrying fetchProjects (${retries}/${maxRetries})...`)
          setTimeout(tryFetch, 600)
        } else {
          console.warn('[App] Failed to fetch projects after', maxRetries, 'retries')
        }
      }
    }
    // Small delay to let preload bridge settle
    setTimeout(tryFetch, 300)
  }, [fetchProjects, fetchTemplates])

  /** Handle ActivityBar clicks: always highlight, content type → workspace tab, config type → sidebar panel */
  const handleActivityClick = useCallback((activity: ActivityType) => {
    setActiveActivity(activity)
    const config = WORKSPACE_TAB_CONFIG[activity]
    if (config) {
      // Resolve dynamic title
      let title = config.title
      if (activity === 'visualization' && selectedProjectName) {
        title = `可视化 - ${selectedProjectName}`
      }
      openTab({ type: config.type, title, closable: config.closable })
    }
  }, [openTab, setActiveActivity, selectedProjectName])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey

      if (ctrl && shift) {
        switch (e.key.toLowerCase()) {
          case 'e': e.preventDefault(); setActiveActivity('project'); break
          case 'd': e.preventDefault(); handleActivityClick('design'); break
          case 'w': e.preventDefault(); handleActivityClick('workbench'); break
          case 'v': e.preventDefault(); handleActivityClick('visualization'); break
          case 'l': e.preventDefault(); handleActivityClick('device_library'); break
        }
      }
      if (ctrl && e.key === ',') {
        e.preventDefault(); setActiveActivity('settings')
      }
      if (ctrl && e.key.toLowerCase() === 'b') {
        e.preventDefault(); toggleSidebar()
      }
      if (ctrl && e.key.toLowerCase() === 'j') {
        e.preventDefault(); togglePanel()
      }
      // Workspace tab shortcuts
      if (ctrl && e.key.toLowerCase() === 'w' && !shift) {
        e.preventDefault()
        if (activeTabId) closeTab(activeTabId)
      }
      if (ctrl && shift && e.key.toLowerCase() === 't') {
        e.preventDefault()
        reopenLastClosed()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setActiveActivity, toggleSidebar, togglePanel, handleActivityClick, activeTabId, closeTab, reopenLastClosed])

  const renderSidebarContent = useCallback(() => {
    return <ErrorBoundary key={activeActivity}><FileExplorer /></ErrorBoundary>
  }, [activeActivity])

  return (
    <ProjectProvider>
    <div
      className={clsx(
        'h-screen w-screen flex flex-col overflow-hidden',
        isDark ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900',
      )}
    >
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <ActivityBar onActivityClick={handleActivityClick} />
        <ResizableAppLayout
          isDark={isDark}
          sidebarVisible={sidebarVisible}
          panelVisible={panelVisible}
          sidebar={renderSidebarContent()}
          editor={
            <WorkspaceErrorBoundary>
              <WorkspaceView />
            </WorkspaceErrorBoundary>
          }
          bottomPanel={<LogPanel />}
        />
      </div>
      <StatusBar />
      <ToastContainer />
      <ServerProfileForm />
      <SwitchProfileForm />
      <DeviceImportModal />
      <DeviceExportModal />
    </div>
    </ProjectProvider>
  )
}
