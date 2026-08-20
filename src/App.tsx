import { useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { useProjectStore } from '@/stores/project.store'
import { ProjectProvider } from '@/stores/ProjectContext'
import { useUIStore, type ActivityType, type WorkbenchSubview } from '@/stores/ui.store'
import { useCloudStore } from '@/stores/cloud.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useDesignStore } from '@/stores/design.store'
import { Header } from '@/components/layout/Header'
import { ActivityBar } from '@/components/layout/ActivityBar'
import { StatusBar } from '@/components/layout/StatusBar'
import { ResizableAppLayout } from '@/components/layout/ResizableAppLayout'
import { ToastContainer } from '@/components/layout/ToastContainer'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { LogPanel } from '@/components/layout/LogPanel'
import { FileExplorer } from '@/components/layout/FileExplorer'
import { ShortcutsDialog } from '@/components/layout/ShortcutsDialog'
import { WorkspaceView } from '@/components/workspace/WorkspaceView'
import { WorkspaceErrorBoundary } from '@/components/workspace/WorkspaceErrorBoundary'
import { ServerProfileForm } from '@/components/device/ServerProfileForm'
import { SwitchProfileForm } from '@/components/device/SwitchProfileForm'
import { DeviceImportModal } from '@/components/device/DeviceImportModal'
import { OnboardingModal } from '@/components/onboarding/OnboardingModal'
import { DeviceExportModal } from '@/components/device/DeviceExportModal'
import { CreateProjectWizardModal } from '@/components/wizard/CreateProjectWizardModal'
import { matchShortcut } from '@/utils/shortcuts'
import i18n from '@/i18n'

/** Map activity types to workspace tab config（打磨轮 P-A：design/aidc_plan/visualization 已并入工作台子视图，不再映射独立 Tab） */
const WORKSPACE_TAB_CONFIG: Record<string, { type: 'workbench' | 'deviceLibrary' | 'chat'; titleKey: string; closable: boolean }> = {
  workbench: { type: 'workbench', titleKey: 'common:tabs.workbench', closable: false },
  device_library: { type: 'deviceLibrary', titleKey: 'common:tabs.deviceLibrary', closable: true },
  // V3.2.1: ai 入口 → AI 对话 Tab（此前点击仅高亮侧栏，无实际内容）
  ai: { type: 'chat', titleKey: 'common:menu.ai', closable: true },
}

export default function App() {
  const { t } = useTranslation()
  const fetchProjects = useProjectStore((s) => s.fetchProjects)
  const fetchTemplates = useProjectStore((s) => s.fetchTemplates)
  const activeActivity = useUIStore((s) => s.activeActivity)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const togglePanel = useUIStore((s) => s.togglePanel)
  const panelVisible = useUIStore((s) => s.panelVisible)
  const isDark = useUIStore((s) => s.isDark)
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const syncSystemTheme = useUIStore((s) => s.syncSystemTheme)
  const language = useUIStore((s) => s.language)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const reopenLastClosed = useWorkspaceStore((s) => s.reopenLastClosed)
  const showCreateProjectWizard = useUIStore((s) => s.showCreateProjectWizard)
  const setShowCreateProjectWizard = useUIStore((s) => s.setShowCreateProjectWizard)
  const templateForWizard = useUIStore((s) => s.templateForWizard)
  const showShortcutsDialog = useUIStore((s) => s.showShortcutsDialog)
  const setShowShortcutsDialog = useUIStore((s) => s.setShowShortcutsDialog)
  // v2.7.3-T1: Ctrl+S 保存配置
  const saveConfig = useDesignStore((s) => s.saveConfig)
  // V3.2.1-T10-1: 品牌主题色
  const accent = useUIStore((s) => s.accent)

  // Apply dark mode to HTML element
  useEffect(() => {
    const root = document.documentElement
    if (isDark) root.classList.add('dark')
    else root.classList.remove('dark')
  }, [isDark])

  // V3.2.1-T10-1: 应用品牌主题色(驱动 --primary-* token)
  useEffect(() => {
    document.documentElement.dataset.accent = accent
  }, [accent])

  // v2.7.3-T11: 应用外观设置(fontSize/animations) — 启动时从 localStorage 读取并应用
  // 避免哑设置项:设置面板的控件必须有实际效果
  useEffect(() => {
    const root = document.documentElement
    try {
      const fontSize = JSON.parse(localStorage.getItem('autolink-font-size') || '14')
      if (typeof fontSize === 'number' && fontSize > 0) {
        root.style.setProperty('--font-size-base', `${fontSize}px`)
      }
    } catch { /* ignore */ }
    try {
      const animations = JSON.parse(localStorage.getItem('autolink-animations') || 'true')
      root.classList.toggle('motion-off', !animations)
    } catch { /* ignore */ }
  }, [])

  // v2.6.8: 根据持久化的 theme 初始化 isDark (isDark 不会被 persist, 需在挂载时计算)
  useEffect(() => {
    setTheme(theme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync i18n language with persisted UI store language
  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language)
    }
  }, [language])

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

    // V3.3.0-T13: 初始化云平台（同步服务器地址 + 恢复登录态 + 健康探测）
    useCloudStore.getState().init().catch(() => {})

    // Retry fetchProjects: Electron preload may need a tick to expose window.electron
    let retries = 0
    const maxRetries = 5
    const tryFetch = async () => {
      try {
        await fetchProjects()
        console.log('[App] Projects loaded successfully')

        // 打磨轮（v1.6 / AL-N1a/N1b）：启动恢复上次项目（行为='ask' 时每次询问 → 不清空选择但显示引导）
        const state = useProjectStore.getState()
        const launchBehavior = (() => { try { return localStorage.getItem('autolink-launch-behavior') } catch { return null } })()
        if (state.selectedProjectName && launchBehavior !== 'ask') {
          const project = state.projects.find((p) => p.name === state.selectedProjectName)
          if (project) {
            state.selectProject(project)
            console.log('[App] Session restored: auto-selected project', state.selectedProjectName)
          }
        } else if (launchBehavior === 'ask') {
          // 每次询问：清空选择 → 工作台显示项目引导面板
          state.selectProject(null)
          console.log('[App] Launch behavior = ask: showing project picker')
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
      const title = t(config.titleKey)
      openTab({ type: config.type, title, closable: config.closable })
    }
  }, [openTab, setActiveActivity, t])

  // 打磨轮（P-A）：打开工作台并聚焦指定子视图（快捷键/入口直达 AIDC/设计/可视化）
  const openWorkbenchSubview = useCallback((view: WorkbenchSubview) => {
    setActiveActivity('workbench')
    setWorkbenchSubview(view)
    openTab({ type: 'workbench', title: t('common:tabs.workbench'), closable: false })
  }, [openTab, setActiveActivity, setWorkbenchSubview, t])

  // v2.7.3-T1: 统一快捷键派发(从 shortcuts.ts 映射表驱动)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入框内不拦截(除 Ctrl+S/Ctrl+,等全局快捷键)
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      const def = matchShortcut(e)
      if (!def) return
      // 输入框内仅允许 Ctrl+S/Ctrl+,/Ctrl+K
      if (isInput && !['saveConfig', 'preferences', 'showShortcuts'].includes(def.action)) return
      e.preventDefault()
      switch (def.action) {
        case 'newProject': setShowCreateProjectWizard(true); break
        case 'saveConfig':
          if (selectedProjectName) saveConfig(selectedProjectName)
          break
        case 'preferences': setActiveActivity('settings'); break
        case 'toggleSidebar': toggleSidebar(); break
        case 'togglePanel': togglePanel(); break
        case 'view-project': setActiveActivity('project'); break
        case 'view-search': handleActivityClick('search'); break
        // 打磨轮（P-A）：设计/可视化/AIDC 规划已并入工作台，快捷键直达对应子视图
        case 'view-design': openWorkbenchSubview('design'); break
        case 'view-workbench': handleActivityClick('workbench'); break
        case 'view-visualization': openWorkbenchSubview('visualization'); break
        case 'view-aidcPlan': openWorkbenchSubview('aidc'); break
        case 'view-deviceLibrary': handleActivityClick('device_library'); break
        case 'view-ai': handleActivityClick('ai'); break
        case 'view-cloud': handleActivityClick('cloud'); break
        case 'closeTab': if (activeTabId) closeTab(activeTabId); break
        case 'reopenTab': reopenLastClosed(); break
        case 'showShortcuts': setShowShortcutsDialog(true); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setActiveActivity, toggleSidebar, togglePanel, handleActivityClick, openWorkbenchSubview, activeTabId, closeTab, reopenLastClosed, setShowCreateProjectWizard, setShowShortcutsDialog, saveConfig, selectedProjectName])

  const renderSidebarContent = useCallback(() => {
    return <ErrorBoundary key={activeActivity}><FileExplorer /></ErrorBoundary>
  }, [activeActivity])

  return (
    <ProjectProvider>
    <div
      className={clsx(
        'h-screen w-screen flex flex-col overflow-hidden',
        isDark ? 'dark bg-app text-gray-100' : 'bg-gray-50 text-gray-900',
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
      {/* V2.9.2-T7: 首次启动引导 */}
      <OnboardingModal />
      {showShortcutsDialog && <ShortcutsDialog onClose={() => setShowShortcutsDialog(false)} />}
      <ServerProfileForm />
      <SwitchProfileForm />
      <DeviceImportModal />
      <DeviceExportModal />
      {showCreateProjectWizard && (
        <CreateProjectWizardModal
          templateName={templateForWizard}
          onClose={() => setShowCreateProjectWizard(false)}
        />
      )}
    </div>
    </ProjectProvider>
  )
}
