import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActivityType =
  | 'project'
  | 'design'
  | 'workbench'
  | 'visualization'
  | 'device_library'
  | 'settings'

export type ThemeMode = 'light' | 'dark' | 'system'

/** 项目浏览器分组模式:smart=智能分组(按文件用途),raw=真实分组(按文件系统目录) */
export type ExplorerGroupMode = 'smart' | 'raw'

interface UIState {
  activeActivity: ActivityType
  sidebarVisible: boolean
  panelVisible: boolean
  theme: ThemeMode
  isDark: boolean
  language: string
  explorerProjectListHeight: number
  explorerGroupMode: ExplorerGroupMode
  showCreateProjectWizard: boolean
  /** V2.9.5-T4: 从模板打开向导时的模板名（手动新建时为 null） */
  templateForWizard: string | null
  showAboutDialog: boolean
  showShortcutsDialog: boolean

  setActiveActivity: (activity: ActivityType) => void
  toggleSidebar: () => void
  togglePanel: () => void
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
  syncSystemTheme: () => void
  setLanguage: (lang: string) => void
  setExplorerProjectListHeight: (height: number) => void
  setExplorerGroupMode: (mode: ExplorerGroupMode) => void
  setShowCreateProjectWizard: (show: boolean) => void
  openWizardFromTemplate: (name: string) => void
  setShowAboutDialog: (show: boolean) => void
  setShowShortcutsDialog: (show: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      activeActivity: 'project',
      sidebarVisible: true,
      panelVisible: false,
      theme: 'system',
      isDark: false,
      language: 'zh-CN',
      explorerProjectListHeight: 300,
      explorerGroupMode: 'smart',
      showCreateProjectWizard: false,
      templateForWizard: null,
      showAboutDialog: false,
      showShortcutsDialog: false,

      setActiveActivity: (activity) => set({ activeActivity: activity }),

      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

      togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible })),

      setTheme: (mode) => {
        const isDark =
          mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
        set({ theme: mode, isDark })
      },

      toggleTheme: () => {
        const { isDark } = get()
        const nextDark = !isDark
        set({ theme: nextDark ? 'dark' : 'light', isDark: nextDark })
      },

      syncSystemTheme: () => {
        const { theme } = get()
        if (theme === 'system') {
          const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
          set({ isDark })
        }
      },

      setLanguage: (lang) => set({ language: lang }),

      setExplorerProjectListHeight: (height) => set({ explorerProjectListHeight: height }),

      setExplorerGroupMode: (mode) => set({ explorerGroupMode: mode }),

      setShowCreateProjectWizard: (show) => set({ showCreateProjectWizard: show, templateForWizard: null }),

      // V2.9.5-T4: 从模板打开向导（设置模板名 + 打开向导）
      openWizardFromTemplate: (name) => set({ templateForWizard: name, showCreateProjectWizard: true }),

      setShowAboutDialog: (show) => set({ showAboutDialog: show }),

      setShowShortcutsDialog: (show) => set({ showShortcutsDialog: show }),
    }),
    {
      name: 'autolink-ui-state',
      partialize: (state) => ({
        activeActivity: state.activeActivity,
        theme: state.theme,
        language: state.language,
        panelVisible: state.panelVisible,
        explorerProjectListHeight: state.explorerProjectListHeight,
        explorerGroupMode: state.explorerGroupMode,
      }),
    },
  ),
)
