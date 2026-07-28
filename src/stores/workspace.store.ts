import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TabType = 'workbench' | 'design' | 'visualization' | 'rack' | 'topology' | 'output' | 'deviceLibrary' | 'projectOverview' | 'fileViewer'

export interface WorkspaceTab {
  id: string
  type: TabType
  title: string
  closable: boolean
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
        const { tabs, findTab } = get()

        // Deduplication logic
        const existing = findTab(tab.type, tab.state)
        if (existing) {
          set({ activeTabId: existing.id })
          return existing.id
        }

        const id = uid()
        const newTab: WorkspaceTab = { ...tab, id }
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
    }),
    {
      name: 'autolink-workspace',
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    },
  ),
)
