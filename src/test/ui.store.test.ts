import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useUIStore } from '@/stores/ui.store'

// jsdom 不内置 matchMedia,需手动 mock 以支持 theme=system 的判定
function mockMatchMedia(matches: boolean) {
  const mm = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mm),
  })
}

describe('UIStore', () => {
  beforeEach(() => {
    localStorage.clear()
    mockMatchMedia(false)
    useUIStore.setState({
      activeActivity: 'project',
      sidebarVisible: true,
      panelVisible: false,
      theme: 'system',
      isDark: false,
      language: 'zh-CN',
      explorerProjectListHeight: 300,
      explorerGroupMode: 'smart',
      showCreateProjectWizard: false,
      showAboutDialog: false,
      showShortcutsDialog: false,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('初始状态', () => {
    it('应有正确的默认值', () => {
      const s = useUIStore.getState()
      expect(s.activeActivity).toBe('project')
      expect(s.sidebarVisible).toBe(true)
      expect(s.panelVisible).toBe(false)
      expect(s.theme).toBe('system')
      expect(s.language).toBe('zh-CN')
      expect(s.explorerGroupMode).toBe('smart')
    })
  })

  describe('setActiveActivity', () => {
    it('应切换当前激活的活动', () => {
      useUIStore.getState().setActiveActivity('design')
      expect(useUIStore.getState().activeActivity).toBe('design')
    })

    it('应支持切换到所有活动类型', () => {
      const activities = ['project', 'design', 'workbench', 'visualization', 'device_library', 'settings'] as const
      for (const a of activities) {
        useUIStore.getState().setActiveActivity(a)
        expect(useUIStore.getState().activeActivity).toBe(a)
      }
    })
  })

  describe('toggleSidebar / togglePanel', () => {
    it('toggleSidebar 应切换侧边栏可见性', () => {
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarVisible).toBe(false)
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarVisible).toBe(true)
    })

    it('togglePanel 应切换面板可见性', () => {
      useUIStore.getState().togglePanel()
      expect(useUIStore.getState().panelVisible).toBe(true)
      useUIStore.getState().togglePanel()
      expect(useUIStore.getState().panelVisible).toBe(false)
    })
  })

  describe('setTheme', () => {
    it('light 模式应设置 isDark=false', () => {
      useUIStore.getState().setTheme('light')
      const s = useUIStore.getState()
      expect(s.theme).toBe('light')
      expect(s.isDark).toBe(false)
    })

    it('dark 模式应设置 isDark=true', () => {
      useUIStore.getState().setTheme('dark')
      const s = useUIStore.getState()
      expect(s.theme).toBe('dark')
      expect(s.isDark).toBe(true)
    })

    it('system 模式应跟随系统 prefers-color-scheme(浅色)', () => {
      mockMatchMedia(false)
      useUIStore.getState().setTheme('system')
      expect(useUIStore.getState().theme).toBe('system')
      expect(useUIStore.getState().isDark).toBe(false)
    })

    it('system 模式应跟随系统 prefers-color-scheme(深色)', () => {
      mockMatchMedia(true)
      useUIStore.getState().setTheme('system')
      expect(useUIStore.getState().isDark).toBe(true)
    })
  })

  describe('toggleTheme', () => {
    it('从浅色切换应变为深色', () => {
      useUIStore.setState({ isDark: false })
      useUIStore.getState().toggleTheme()
      const s = useUIStore.getState()
      expect(s.isDark).toBe(true)
      expect(s.theme).toBe('dark')
    })

    it('从深色切换应变为浅色', () => {
      useUIStore.setState({ isDark: true })
      useUIStore.getState().toggleTheme()
      const s = useUIStore.getState()
      expect(s.isDark).toBe(false)
      expect(s.theme).toBe('light')
    })
  })

  describe('syncSystemTheme', () => {
    it('theme=system 时应同步系统主题', () => {
      useUIStore.setState({ theme: 'system', isDark: false })
      mockMatchMedia(true)
      useUIStore.getState().syncSystemTheme()
      expect(useUIStore.getState().isDark).toBe(true)
    })

    it('theme 非 system 时不应改变 isDark', () => {
      useUIStore.setState({ theme: 'light', isDark: false })
      mockMatchMedia(true)
      useUIStore.getState().syncSystemTheme()
      expect(useUIStore.getState().isDark).toBe(false)
    })
  })

  describe('setLanguage', () => {
    it('应更新语言设置', () => {
      useUIStore.getState().setLanguage('en')
      expect(useUIStore.getState().language).toBe('en')
    })
  })

  describe('其他 UI 状态', () => {
    it('setExplorerProjectListHeight 应更新高度', () => {
      useUIStore.getState().setExplorerProjectListHeight(500)
      expect(useUIStore.getState().explorerProjectListHeight).toBe(500)
    })

    it('setExplorerGroupMode 应更新分组模式', () => {
      useUIStore.getState().setExplorerGroupMode('raw')
      expect(useUIStore.getState().explorerGroupMode).toBe('raw')
    })

    it('setShowCreateProjectWizard 应切换向导可见性', () => {
      useUIStore.getState().setShowCreateProjectWizard(true)
      expect(useUIStore.getState().showCreateProjectWizard).toBe(true)
    })
  })
})
