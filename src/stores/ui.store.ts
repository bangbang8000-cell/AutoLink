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

interface UIState {
  activeActivity: ActivityType
  sidebarVisible: boolean
  panelVisible: boolean
  theme: ThemeMode
  isDark: boolean
  language: string
  explorerProjectListHeight: number
  showCreateProjectWizard: boolean
  showAboutDialog: boolean

  setActiveActivity: (activity: ActivityType) => void
  toggleSidebar: () => void
  togglePanel: () => void
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
  syncSystemTheme: () => void
  setLanguage: (lang: string) => void
  setExplorerProjectListHeight: (height: number) => void
  setShowCreateProjectWizard: (show: boolean) => void
  setShowAboutDialog: (show: boolean) => void
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
      showCreateProjectWizard: false,
      showAboutDialog: false,

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

      setShowCreateProjectWizard: (show) => set({ showCreateProjectWizard: show }),

      setShowAboutDialog: (show) => set({ showAboutDialog: show }),
    }),
    {
      name: 'autolink-ui-state',
      partialize: (state) => ({
        activeActivity: state.activeActivity,
        theme: state.theme,
        language: state.language,
        panelVisible: state.panelVisible,
        explorerProjectListHeight: state.explorerProjectListHeight,
      }),
    },
  ),
)
