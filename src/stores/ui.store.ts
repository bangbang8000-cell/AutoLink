import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActivityType =
  | 'search'
  | 'project'
  | 'design'
  | 'aidc_plan'
  | 'workbench'
  | 'visualization'
  | 'device_library'
  | 'ai'
  | 'cloud'
  | 'settings'

export type ThemeMode = 'light' | 'dark' | 'system'

/** V3.2.1-T10-1: 品牌主题色（驱动 --primary-* token，默认 sky） */
export type AccentColor = 'sky' | 'emerald' | 'violet' | 'rose'

/** 项目浏览器分组模式:smart=智能分组(按文件用途),raw=真实分组(按文件系统目录) */
export type ExplorerGroupMode = 'smart' | 'raw'

/** V3.1.1-T5-5: AI Provider 配置（BYO-Key） */
export interface AIProviderConfig {
  apiKey: string
  model: string
  baseUrl: string
}

/** V3.1.1-T5-5: AI 全局配置 */
export interface AIConfig {
  defaultProvider: string
  autonomyMode: 'advisor' | 'semi_auto' | 'full_auto'
  providers: Record<string, AIProviderConfig>
}

interface UIState {
  activeActivity: ActivityType
  sidebarVisible: boolean
  panelVisible: boolean
  theme: ThemeMode
  isDark: boolean
  /** V3.2.1-T10-1: 品牌主题色 */
  accent: AccentColor
  language: string
  explorerProjectListHeight: number
  explorerGroupMode: ExplorerGroupMode
  showCreateProjectWizard: boolean
  /** V2.9.5-T4: 从模板打开向导时的模板名（手动新建时为 null） */
  templateForWizard: string | null
  showAboutDialog: boolean
  showShortcutsDialog: boolean
  /** V3.1.1-T5-5: AI 配置（默认厂商/自主模式/各厂商 BYO-Key） */
  aiConfig: AIConfig

  setActiveActivity: (activity: ActivityType) => void
  toggleSidebar: () => void
  togglePanel: () => void
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
  setAccent: (accent: AccentColor) => void
  syncSystemTheme: () => void
  setLanguage: (lang: string) => void
  setExplorerProjectListHeight: (height: number) => void
  setExplorerGroupMode: (mode: ExplorerGroupMode) => void
  setShowCreateProjectWizard: (show: boolean) => void
  openWizardFromTemplate: (name: string) => void
  setShowAboutDialog: (show: boolean) => void
  setShowShortcutsDialog: (show: boolean) => void
  /** V3.1.1-T5-5: AI 配置更新（浅合并） */
  setAIConfig: (updates: Partial<AIConfig>) => void
  /** V3.1.1-T5-5: 更新单个 Provider 配置 */
  setProviderConfig: (key: string, cfg: AIProviderConfig) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      activeActivity: 'project',
      sidebarVisible: true,
      panelVisible: false,
      theme: 'system',
      isDark: false,
      accent: 'sky',
      language: 'zh-CN',
      explorerProjectListHeight: 300,
      explorerGroupMode: 'smart',
      showCreateProjectWizard: false,
      templateForWizard: null,
      showAboutDialog: false,
      showShortcutsDialog: false,
      aiConfig: {
        defaultProvider: 'deepseek',
        autonomyMode: 'semi_auto',
        providers: {},
      },

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

      setAccent: (accent) => set({ accent }),

      setLanguage: (lang) => set({ language: lang }),

      setExplorerProjectListHeight: (height) => set({ explorerProjectListHeight: height }),

      setExplorerGroupMode: (mode) => set({ explorerGroupMode: mode }),

      setShowCreateProjectWizard: (show) => set({ showCreateProjectWizard: show, templateForWizard: null }),

      // V2.9.5-T4: 从模板打开向导（设置模板名 + 打开向导）
      openWizardFromTemplate: (name) => set({ templateForWizard: name, showCreateProjectWizard: true }),

      setShowAboutDialog: (show) => set({ showAboutDialog: show }),

      setShowShortcutsDialog: (show) => set({ showShortcutsDialog: show }),

      setAIConfig: (updates) =>
        set((s) => ({ aiConfig: { ...s.aiConfig, ...updates } })),

      setProviderConfig: (key, cfg) =>
        set((s) => ({
          aiConfig: {
            ...s.aiConfig,
            providers: { ...s.aiConfig.providers, [key]: cfg },
          },
        })),
    }),
    {
      name: 'autolink-ui-state',
      partialize: (state) => ({
        activeActivity: state.activeActivity,
        theme: state.theme,
        accent: state.accent,
        language: state.language,
        panelVisible: state.panelVisible,
        explorerProjectListHeight: state.explorerProjectListHeight,
        explorerGroupMode: state.explorerGroupMode,
        aiConfig: state.aiConfig,
      }),
    },
  ),
)
