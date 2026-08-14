import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// V2.7.6-T9: 新增 'topology3d' Tab 类型 (3D 拓扑可视化 PoC)
// V3.1.1-T5-5: 新增 'chat' Tab 类型 (AI 对话)
export type TabType = 'workbench' | 'design' | 'visualization' | 'aidcPlan' | 'rack' | 'topology' | 'output' | 'deviceLibrary' | 'projectOverview' | 'fileViewer' | 'guide' | 'chat'

export interface WorkspaceTab {
  id: string
  type: TabType
  title: string
  closable: boolean
  /** 所属项目 (V2.9.2-T4: 项目隔离, 无则视为全局 Tab) */
  projectName?: string
  /** 未保存标记 (V2.9.2-T4: 关闭时需确认) */
  dirty?: boolean
  /** Extra state for specific tab types (cabinetId, fileName, etc.) */
  state?: Record<string, unknown>
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  closedTabHistory: WorkspaceTab[]  // for Ctrl+Shift+T restore

  openTab: (tab: Omit<WorkspaceTab, 'id'>) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  closeAllTabs: () => void
  closeOtherTabs: (id: string) => void
  closeTabsToRight: (id: string) => void
  reopenLastClosed: () => void
  /** Find an existing tab by type and optional state predicate */
  findTab: (type: TabType, stateMatch?: Record<string, unknown>) => WorkspaceTab | undefined
  /** Update an existing tab's title / state in-place (without creating a new tab) */
  updateTab: (id: string, updates: Partial<Pick<WorkspaceTab, 'title' | 'state' | 'dirty'>>) => void
  /** V2.9.2-T4: 切换项目时清理非当前项目的项目级 Tab */
  setProjectTabs: (projectName: string | null) => void
  /** V2.9.2-T4: 删除项目时清理其持久化 Tab */
  clearTabsForProjects: (names: string[]) => void
}

let _idCounter = 0
function uid(): string {
  _idCounter++
  return `tab_${Date.now()}_${_idCounter}`
}

/**
 * Check if two state objects match (for tab deduplication).
 * Only compares the keys present in `matcher`.
 */
function stateMatches(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  for (const key of Object.keys(a)) {
    if (a[key] !== b[key]) return false
  }
  return true
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      closedTabHistory: [],

      findTab: (type, stateMatch) => {
        return get().tabs.find((t) => {
          if (t.type !== type) return false
          if (stateMatch) return stateMatches(stateMatch, t.state)
          return true
        })
      },

      openTab: (tab) => {
        const { tabs } = get()

        // Deduplication: 项目级 Tab 需 projectName 相同才复用 (V2.9.2-T4)
        const existing = tabs.find((t) =>
          t.type === tab.type &&
          (tab.projectName ? t.projectName === tab.projectName : true) &&
          stateMatches(tab.state, t.state)
        )
        if (existing) {
          set({ activeTabId: existing.id })
          return existing.id
        }

        const id = uid()
        const newTab: WorkspaceTab = { ...tab, id }

        // Design tab: always insert right after the last workbench tab
        if (tab.type === 'design') {
          const wbIdx = tabs.map((t) => t.type).lastIndexOf('workbench')
          const insertIdx = wbIdx >= 0 ? wbIdx + 1 : 0
          const newTabs = [...tabs]
          newTabs.splice(insertIdx, 0, newTab)
          set({ tabs: newTabs, activeTabId: id })
          return id
        }

        set((s) => ({
          tabs: [...s.tabs, newTab],
          activeTabId: id,
        }))
        return id
      },

      closeTab: (id) => {
        const { tabs, activeTabId } = get()
        const idx = tabs.findIndex((t) => t.id === id)
        if (idx === -1) return

        const tab = tabs[idx]
        if (!tab.closable) return

        const newTabs = tabs.filter((t) => t.id !== id)
        let nextActive = activeTabId

        if (activeTabId === id) {
          if (newTabs.length === 0) {
            nextActive = null
          } else if (idx < newTabs.length) {
            nextActive = newTabs[idx].id
          } else {
            nextActive = newTabs[newTabs.length - 1].id
          }
        }

        set((s) => ({
          tabs: newTabs,
          activeTabId: nextActive,
          closedTabHistory: [...s.closedTabHistory.slice(-9), tab],
        }))
      },

      setActiveTab: (id) => set({ activeTabId: id }),

      closeAllTabs: () => {
        const { tabs } = get()
        const closed = tabs.filter((t) => t.closable)
        const remaining = tabs.filter((t) => !t.closable)
        set({
          tabs: remaining,
          activeTabId: remaining.length > 0 ? remaining[0].id : null,
          closedTabHistory: closed,
        })
      },

      closeOtherTabs: (id) => {
        const { tabs } = get()
        const target = tabs.find((t) => t.id === id)
        if (!target) return
        const closed = tabs.filter((t) => t.id !== id && t.closable)
        set((s) => ({
          tabs: tabs.filter((t) => !t.closable || t.id === id),
          activeTabId: id,
          closedTabHistory: [...s.closedTabHistory, ...closed].slice(-10),
        }))
      },

      closeTabsToRight: (id) => {
        const { tabs, activeTabId } = get()
        const idx = tabs.findIndex((t) => t.id === id)
        if (idx === -1) return
        const closed = tabs.slice(idx + 1).filter((t) => t.closable)
        const newTabs = tabs.slice(0, idx + 1).concat(tabs.slice(idx + 1).filter((t) => !t.closable))
        set((s) => ({
          tabs: newTabs,
          activeTabId: activeTabId === id ? id : (newTabs.find((t) => t.id === activeTabId) ? activeTabId : id),
          closedTabHistory: [...s.closedTabHistory, ...closed].slice(-10),
        }))
      },

      reopenLastClosed: () => {
        const { closedTabHistory } = get()
        if (closedTabHistory.length === 0) return
        const history = [...closedTabHistory]
        const lastTab = history.pop()!
        const id = uid()
        const newTab: WorkspaceTab = { ...lastTab, id }
        set((s) => ({
          tabs: [...s.tabs, newTab],
          activeTabId: id,
          closedTabHistory: history,
        }))
      },

      updateTab: (id, updates) => {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id ? { ...t, ...updates } : t,
          ),
        }))
      },

      // V2.9.2-T4: 切换项目时清理非当前项目的项目级 Tab（保留全局 Tab）
      setProjectTabs: (projectName) => {
        set((s) => {
          const newTabs = s.tabs.filter((t) => !t.projectName || t.projectName === projectName)
          const newIds = new Set(newTabs.map((t) => t.id))
          const nextActive = s.activeTabId && newIds.has(s.activeTabId)
            ? s.activeTabId
            : newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null
          return { tabs: newTabs, activeTabId: nextActive }
        })
      },

      // V2.9.2-T4: 删除项目时清理其持久化 Tab
      clearTabsForProjects: (names) => {
        set((s) => {
          const removed = new Set(names)
          const newTabs = s.tabs.filter((t) => !(t.projectName && removed.has(t.projectName)))
          const newIds = new Set(newTabs.map((t) => t.id))
          const nextActive = s.activeTabId && newIds.has(s.activeTabId)
            ? s.activeTabId
            : newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null
          return { tabs: newTabs, activeTabId: nextActive }
        })
      },
    }),
    {
      name: 'autolink-workspace',
      version: 2,
      migrate: (persistedState, version) => {
        const state = persistedState as { tabs?: WorkspaceTab[]; activeTabId?: string | null }
        if (version < 2 && state.tabs) {
          // V2.9.2-T4: 旧持久化 Tab 无 projectName，保持原样(视为全局)即可
        }
        if (state.tabs) {
          state.tabs = state.tabs.map((t) => {
            // Fix: design and deviceLibrary tabs should always be closable
            if (t.type === 'design' || t.type === 'deviceLibrary') {
              return { ...t, closable: true }
            }
            return t
          })
        }
        return state as WorkspaceState
      },
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    },
  ),
)
