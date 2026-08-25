import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActivityType =
  | 'search'
  | 'project'
  | 'design'          // 废弃保留：拓扑设计已并入工作台子视图（无一级入口，留作向后兼容）
  | 'aidc_plan'       // 废弃保留：AIDC 规划已并入工作台子视图
  | 'workbench'
  | 'visualization'   // 废弃保留：可视化已并入工作台子视图
  | 'device_library'
  | 'ai'
  | 'cloud'
  | 'output'           // 打磨轮（v1.6 / AL-O2a）：全部项目输出结果（最左边栏一级入口）
  | 'settings'

export type ThemeMode = 'light' | 'dark' | 'system'

/** V3.2.1-T10-1: 品牌主题色（驱动 --primary-* token，默认 sky） */
export type AccentColor = 'sky' | 'emerald' | 'violet' | 'rose'

/** 项目浏览器分组模式:smart=智能分组(按文件用途),raw=真实分组(按文件系统目录) */
export type ExplorerGroupMode = 'smart' | 'raw'

/** 打磨轮（P-A/v1.3）：工作台子视图——流程：规划→设计→渲染→校对（拓扑/机柜/结果）→归档导出 */
export type WorkbenchSubview = 'aidc' | 'design' | 'main' | 'visualization' | 'rack' | 'results' | 'export'

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
  /** AL-S3: 各 Provider 是否已配置密钥（只存布尔，不落明文 key；密钥本体归后端 ai_secrets.json） */
  aiKeyConfigured: Record<string, boolean>
  /** 打磨轮（P-A）：工作台当前子视图 */
  workbenchSubview: WorkbenchSubview
  /** 打磨轮（v1.2 / M2）：云平台总体开关（默认关；关时隐藏云一级菜单/云入口） */
  cloudEnabled: boolean

  setActiveActivity: (activity: ActivityType) => void
  /** 打磨轮（P-A）：切换工作台子视图 */
  setWorkbenchSubview: (view: WorkbenchSubview) => void
  /** 打磨轮（v1.2 / M2）：设置云平台开关 */
  setCloudEnabled: (v: boolean) => void
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
      aiKeyConfigured: {},
      workbenchSubview: 'main',
      cloudEnabled: false,

      setActiveActivity: (activity) => set({ activeActivity: activity }),
      setWorkbenchSubview: (view) => set({ workbenchSubview: view }),
      setCloudEnabled: (v) => set({ cloudEnabled: v }),

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
        set((s) => {
          const aiConfig = { ...s.aiConfig, ...updates }
          // AL-S3: providers 变化时同步 key 配置标记
          const aiKeyConfigured = { ...s.aiKeyConfigured }
          if (updates.providers) {
            for (const [k, cfg] of Object.entries(updates.providers)) {
              aiKeyConfigured[k] = Boolean(cfg?.apiKey)
            }
          }
          return { aiConfig, aiKeyConfigured }
        }),

      setProviderConfig: (key, cfg) =>
        set((s) => ({
          aiConfig: {
            ...s.aiConfig,
            providers: { ...s.aiConfig.providers, [key]: cfg },
          },
          // AL-S3: 记录该 Provider 是否已配置密钥（仅布尔标记）
          aiKeyConfigured: { ...s.aiKeyConfigured, [key]: Boolean(cfg.apiKey) },
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
        // AL-S3: 只持久化 aiConfig（剥离 apiKey 明文）与 aiKeyConfigured 布尔标记
        aiConfig: {
          ...state.aiConfig,
          providers: Object.fromEntries(
            Object.entries(state.aiConfig.providers).map(([k, cfg]) => [k, { ...cfg, apiKey: '' }]),
          ),
        },
        aiKeyConfigured: state.aiKeyConfigured,
        cloudEnabled: state.cloudEnabled,
      }),
    },
  ),
)
