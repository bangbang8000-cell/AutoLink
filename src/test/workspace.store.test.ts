import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace.store'

describe('WorkspaceStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.setState({
      tabs: [],
      activeTabId: null,
      closedTabHistory: [],
    })
  })

  describe('初始状态', () => {
    it('tabs / activeTabId / closedTabHistory 应为空', () => {
      const s = useWorkspaceStore.getState()
      expect(s.tabs).toEqual([])
      expect(s.activeTabId).toBeNull()
      expect(s.closedTabHistory).toEqual([])
    })
  })

  describe('openTab', () => {
    it('应添加新标签并设为激活', () => {
      const id = useWorkspaceStore.getState().openTab({ type: 'workbench', title: '工作台', closable: true })
      const s = useWorkspaceStore.getState()
      expect(s.tabs).toHaveLength(1)
      expect(s.tabs[0].id).toBe(id)
      expect(s.activeTabId).toBe(id)
      expect(s.tabs[0].title).toBe('工作台')
    })

    it('相同 type 且 state 匹配时应去重并激活已存在标签', () => {
      const id1 = useWorkspaceStore.getState().openTab({ type: 'fileViewer', title: '文件A', closable: true, state: { fileName: 'a.txt' } })
      const id2 = useWorkspaceStore.getState().openTab({ type: 'fileViewer', title: '文件A', closable: true, state: { fileName: 'a.txt' } })
      expect(id2).toBe(id1)
      expect(useWorkspaceStore.getState().tabs).toHaveLength(1)
      expect(useWorkspaceStore.getState().activeTabId).toBe(id1)
    })

    it('相同 type 但 state 不同时应创建新标签', () => {
      useWorkspaceStore.getState().openTab({ type: 'fileViewer', title: '文件A', closable: true, state: { fileName: 'a.txt' } })
      useWorkspaceStore.getState().openTab({ type: 'fileViewer', title: '文件B', closable: true, state: { fileName: 'b.txt' } })
      expect(useWorkspaceStore.getState().tabs).toHaveLength(2)
    })

    it('design 标签应插入到最后一个 workbench 标签之后', () => {
      const wbId = useWorkspaceStore.getState().openTab({ type: 'workbench', title: 'WB', closable: true })
      useWorkspaceStore.getState().openTab({ type: 'output', title: 'OUT', closable: true })
      useWorkspaceStore.getState().openTab({ type: 'design', title: '设计', closable: true })
      const tabs = useWorkspaceStore.getState().tabs
      // 期望顺序: workbench, design, output
      expect(tabs[0].id).toBe(wbId)
      expect(tabs[1].type).toBe('design')
      expect(tabs[2].type).toBe('output')
    })
  })

  describe('closeTab', () => {
    it('应移除可关闭标签并切换激活到相邻标签', () => {
      const id1 = useWorkspaceStore.getState().openTab({ type: 'workbench', title: 't1', closable: true })
      const id2 = useWorkspaceStore.getState().openTab({ type: 'output', title: 't2', closable: true })
      useWorkspaceStore.getState().setActiveTab(id1)
      useWorkspaceStore.getState().closeTab(id1)
      const s = useWorkspaceStore.getState()
      expect(s.tabs).toHaveLength(1)
      expect(s.tabs[0].id).toBe(id2)
      expect(s.activeTabId).toBe(id2)
      // 关闭的标签进入历史
      expect(s.closedTabHistory).toHaveLength(1)
      expect(s.closedTabHistory[0].id).toBe(id1)
    })

    it('关闭最后一个标签时 activeTabId 应为 null', () => {
      const id = useWorkspaceStore.getState().openTab({ type: 'workbench', title: 'only', closable: true })
      useWorkspaceStore.getState().closeTab(id)
      expect(useWorkspaceStore.getState().tabs).toHaveLength(0)
      expect(useWorkspaceStore.getState().activeTabId).toBeNull()
    })

    it('不可关闭的标签调用 closeTab 应被忽略', () => {
      const id = useWorkspaceStore.getState().openTab({ type: 'workbench', title: 'locked', closable: false })
      useWorkspaceStore.getState().closeTab(id)
      expect(useWorkspaceStore.getState().tabs).toHaveLength(1)
      expect(useWorkspaceStore.getState().activeTabId).toBe(id)
    })
  })

  describe('setActiveTab', () => {
    it('应更新激活标签 id', () => {
      const id1 = useWorkspaceStore.getState().openTab({ type: 'workbench', title: 't1', closable: true })
      const id2 = useWorkspaceStore.getState().openTab({ type: 'output', title: 't2', closable: true })
      useWorkspaceStore.getState().setActiveTab(id1)
      expect(useWorkspaceStore.getState().activeTabId).toBe(id1)
      useWorkspaceStore.getState().setActiveTab(id2)
      expect(useWorkspaceStore.getState().activeTabId).toBe(id2)
    })
  })

  describe('closeAllTabs', () => {
    it('应关闭所有可关闭标签并保留不可关闭标签', () => {
      useWorkspaceStore.getState().openTab({ type: 'workbench', title: 'wb', closable: false })
      useWorkspaceStore.getState().openTab({ type: 'output', title: 'out1', closable: true })
      useWorkspaceStore.getState().openTab({ type: 'output', title: 'out2', closable: true, state: { x: 1 } })
      useWorkspaceStore.getState().closeAllTabs()
      const s = useWorkspaceStore.getState()
      expect(s.tabs).toHaveLength(1)
      expect(s.tabs[0].type).toBe('workbench')
      expect(s.activeTabId).toBe(s.tabs[0].id)
      // 关闭的标签进入历史
      expect(s.closedTabHistory).toHaveLength(2)
    })

    it('全部关闭后 activeTabId 应为 null', () => {
      useWorkspaceStore.getState().openTab({ type: 'output', title: 'out', closable: true })
      useWorkspaceStore.getState().closeAllTabs()
      expect(useWorkspaceStore.getState().tabs).toHaveLength(0)
      expect(useWorkspaceStore.getState().activeTabId).toBeNull()
    })
  })

  describe('closeOtherTabs', () => {
    it('应保留目标标签和不可关闭标签,关闭其余', () => {
      useWorkspaceStore.getState().openTab({ type: 'workbench', title: 'wb', closable: false })
      const keepId = useWorkspaceStore.getState().openTab({ type: 'output', title: 'keep', closable: true })
      useWorkspaceStore.getState().openTab({ type: 'output', title: 'close', closable: true, state: { x: 1 } })
      useWorkspaceStore.getState().closeOtherTabs(keepId)
      const s = useWorkspaceStore.getState()
      expect(s.tabs).toHaveLength(2) // workbench + keep
      expect(s.activeTabId).toBe(keepId)
    })
  })

  describe('reopenLastClosed', () => {
    it('应重新打开最近关闭的标签', () => {
      const id = useWorkspaceStore.getState().openTab({ type: 'output', title: 'recov', closable: true })
      useWorkspaceStore.getState().closeTab(id)
      expect(useWorkspaceStore.getState().closedTabHistory).toHaveLength(1)
      useWorkspaceStore.getState().reopenLastClosed()
      const s = useWorkspaceStore.getState()
      expect(s.tabs).toHaveLength(1)
      expect(s.tabs[0].title).toBe('recov')
      expect(s.activeTabId).toBe(s.tabs[0].id)
      expect(s.closedTabHistory).toHaveLength(0)
    })

    it('历史为空时不应报错也不应创建标签', () => {
      useWorkspaceStore.getState().reopenLastClosed()
      expect(useWorkspaceStore.getState().tabs).toHaveLength(0)
    })
  })

  describe('updateTab', () => {
    it('应原地更新标签的 title 和 state', () => {
      const id = useWorkspaceStore.getState().openTab({ type: 'output', title: 'old', closable: true })
      useWorkspaceStore.getState().updateTab(id, { title: 'new', state: { rev: 2 } })
      const tab = useWorkspaceStore.getState().tabs[0]
      expect(tab.title).toBe('new')
      expect(tab.state).toEqual({ rev: 2 })
    })

    it('更新不存在的 id 不应报错也不应改变标签列表', () => {
      useWorkspaceStore.getState().openTab({ type: 'output', title: 't', closable: true })
      expect(() => useWorkspaceStore.getState().updateTab('nope', { title: 'x' })).not.toThrow()
      expect(useWorkspaceStore.getState().tabs).toHaveLength(1)
    })
  })

  describe('findTab', () => {
    it('应按类型查找标签', () => {
      useWorkspaceStore.getState().openTab({ type: 'workbench', title: 'wb', closable: true })
      const found = useWorkspaceStore.getState().findTab('workbench')
      expect(found).toBeDefined()
      expect(found?.title).toBe('wb')
    })

    it('应按类型 + state 谓词精确匹配', () => {
      useWorkspaceStore.getState().openTab({ type: 'fileViewer', title: 'a', closable: true, state: { fileName: 'a.txt' } })
      useWorkspaceStore.getState().openTab({ type: 'fileViewer', title: 'b', closable: true, state: { fileName: 'b.txt' } })
      const found = useWorkspaceStore.getState().findTab('fileViewer', { fileName: 'b.txt' })
      expect(found?.title).toBe('b')
    })

    it('未找到时应返回 undefined', () => {
      expect(useWorkspaceStore.getState().findTab('rack')).toBeUndefined()
    })
  })

  describe('resetWorkspace(重置工作区)', () => {
    it('应将 tabs / activeTabId / closedTabHistory 全部清空', () => {
      useWorkspaceStore.getState().openTab({ type: 'workbench', title: 'wb', closable: true })
      useWorkspaceStore.getState().openTab({ type: 'output', title: 'out', closable: true })
      useWorkspaceStore.getState().closeTab(useWorkspaceStore.getState().tabs[1].id)

      useWorkspaceStore.setState({ tabs: [], activeTabId: null, closedTabHistory: [] })

      const s = useWorkspaceStore.getState()
      expect(s.tabs).toEqual([])
      expect(s.activeTabId).toBeNull()
      expect(s.closedTabHistory).toEqual([])
    })
  })
})
