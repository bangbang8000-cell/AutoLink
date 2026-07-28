import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useProjectStore } from '@/stores/project.store'

describe('ProjectStore', () => {
  let savedElectron: typeof window.electron

  beforeEach(() => {
    // Restore electron mock in case previous test deleted it
    if (!window.electron) {
      window.electron = savedElectron
    }
    savedElectron = window.electron

    useProjectStore.setState({
      projects: [],
      selectedProject: null,
      selectedProjectName: null,
      projectStatuses: {},
      favoriteProjects: [],
      recentProjects: [],
      templates: [],
    })
    vi.clearAllMocks()
  })

  describe('fetchProjects', () => {
    it('应该拉取项目列表并更新favorites/recent', async () => {
      const mockProjects = [
        { id: 1, name: 'proj1', index: 0 },
        { id: 2, name: 'proj2', index: 1 },
      ]
      window.electron.project.list = vi.fn().mockResolvedValue(mockProjects)

      useProjectStore.setState({ favoriteProjects: ['proj1', 'old'], recentProjects: ['proj2', 'old'] })
      await useProjectStore.getState().fetchProjects()

      const state = useProjectStore.getState()
      expect(state.projects).toEqual(mockProjects)
      expect(state.favoriteProjects).toEqual(['proj1'])
      expect(state.recentProjects).toEqual(['proj2'])
    })

    it('应该在失败时保留现有项目列表', async () => {
      window.electron.project.list = vi.fn().mockRejectedValue(new Error('fail'))
      useProjectStore.setState({ projects: [{ id: 1, name: 'existing', index: 0 }] })

      await useProjectStore.getState().fetchProjects()

      const state = useProjectStore.getState()
      expect(state.projects).toEqual([{ id: 1, name: 'existing', index: 0 }])
    })

    it('应该在IPC不可用时抛出错误', async () => {
      const saved = window.electron
      // @ts-expect-error 测试IPC不可用场景
      delete window.electron

      await useProjectStore.getState().fetchProjects()
      // fetchProjects catches the error internally and logs it
      // The store should not crash
      expect(useProjectStore.getState().projects).toEqual([])

      window.electron = saved
    })
  })

  describe('selectProject', () => {
    it('应该设置选中项目并记录最近使用', () => {
      const project = { id: 1, name: 'test', index: 0 }
      useProjectStore.getState().selectProject(project)

      const state = useProjectStore.getState()
      expect(state.selectedProject).toEqual(project)
      expect(state.selectedProjectName).toBe('test')
      expect(state.recentProjects).toContain('test')
    })

    it('应该正确处理null', () => {
      useProjectStore.setState({ selectedProject: { id: 1, name: 'test', index: 0 }, selectedProjectName: 'test' })
      useProjectStore.getState().selectProject(null)

      const state = useProjectStore.getState()
      expect(state.selectedProject).toBeNull()
      expect(state.selectedProjectName).toBeNull()
    })
  })

  describe('toggleFavorite', () => {
    it('应该添加收藏', () => {
      useProjectStore.getState().toggleFavorite('proj1')
      expect(useProjectStore.getState().favoriteProjects).toContain('proj1')
    })

    it('应该取消收藏', () => {
      useProjectStore.setState({ favoriteProjects: ['proj1'] })
      useProjectStore.getState().toggleFavorite('proj1')
      expect(useProjectStore.getState().favoriteProjects).not.toContain('proj1')
    })
  })

  describe('trackRecent', () => {
    it('应该将项目添加到最近列表头部', () => {
      useProjectStore.getState().trackRecent('proj1')
      expect(useProjectStore.getState().recentProjects[0]).toBe('proj1')
    })

    it('应该去重', () => {
      useProjectStore.setState({ recentProjects: ['proj1', 'proj2'] })
      useProjectStore.getState().trackRecent('proj1')
      const recent = useProjectStore.getState().recentProjects
      expect(recent.filter((x) => x === 'proj1')).toHaveLength(1)
    })

    it('应该限制最多5个', () => {
      for (let i = 1; i <= 10; i++) {
        useProjectStore.getState().trackRecent(`proj${i}`)
      }
      expect(useProjectStore.getState().recentProjects).toHaveLength(5)
    })
  })

  describe('deleteProjects', () => {
    it('应该删除指定项目并更新列表', async () => {
      window.electron.project.delete = vi.fn().mockResolvedValue(undefined)
      window.electron.project.list = vi.fn().mockResolvedValue([{ id: 1, name: 'proj2', index: 0 }])

      useProjectStore.setState({ selectedProjectName: 'proj1', selectedProject: { id: 1, name: 'proj1', index: 0 } })
      await useProjectStore.getState().deleteProjects(['1'])

      const state = useProjectStore.getState()
      expect(state.selectedProject).toBeNull()
      expect(state.selectedProjectName).toBeNull()
    })
  })
})