import { describe, it, expect, beforeEach, vi } from 'vitest'
import { type ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { ProjectProvider, useProjectContext } from '@/stores/ProjectContext'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'

function renderContext() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ProjectProvider>{children}</ProjectProvider>
  )
  return renderHook(() => useProjectContext(), { wrapper })
}

describe('ProjectContext', () => {
  beforeEach(() => {
    localStorage.clear()
    useProjectStore.setState({
      projects: [],
      selectedProject: null,
      selectedProjectName: null,
      favoriteProjects: [],
      recentProjects: [],
    })
    // 阻断 selectProject 触发的 design/rack store IPC 级联,使用 mock 替代
    useDesignStore.setState({
      loadConfig: vi.fn().mockResolvedValue(undefined),
      loadSavedTopology: vi.fn().mockResolvedValue(undefined),
    })
    useRackStore.setState({
      loadRackLayout: vi.fn().mockResolvedValue(undefined),
    })
    window.electron.app.getPath = vi.fn().mockResolvedValue('D:\\workspace')
    vi.clearAllMocks()
  })

  describe('初始状态', () => {
    it('currentProject 初始为 null, projectPath 初始为空', async () => {
      const { result } = renderContext()
      // 等待挂载时异步加载 workspace 路径
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.currentProject).toBeNull()
      expect(result.current.setCurrentProject).toBeInstanceOf(Function)
    })

    it('挂载后应通过 electron.app.getPath 加载 workspace 路径', async () => {
      renderContext()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(window.electron.app.getPath).toHaveBeenCalledWith('workspace')
    })
  })

  describe('setCurrentProject', () => {
    it('应更新 currentProject 并拼接出 projectPath', async () => {
      const { result } = renderContext()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => {
        result.current.setCurrentProject('proj1')
        // 刷新 selectProject 触发的异步链
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.current.currentProject).toBe('proj1')
      expect(result.current.projectPath).toBe('D:\\workspace\\proj1')
    })

    it('应同步更新 project store 的 selectedProjectName', async () => {
      const { result } = renderContext()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => {
        result.current.setCurrentProject('proj-sync')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(useProjectStore.getState().selectedProjectName).toBe('proj-sync')
    })

    it('当 projects 列表中存在同名项目时应使用其真实信息调用 selectProject', async () => {
      const spy = vi.spyOn(useProjectStore.getState(), 'selectProject')
      useProjectStore.setState({
        projects: [{ id: 7, name: 'known', index: 0 }],
      })

      const { result } = renderContext()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => {
        result.current.setCurrentProject('known')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(spy).toHaveBeenCalledWith({ id: 7, name: 'known', index: 0 })
      spy.mockRestore()
    })

    it('当 projects 列表中不存在同名项目时应使用兜底对象调用 selectProject', async () => {
      const spy = vi.spyOn(useProjectStore.getState(), 'selectProject')
      const { result } = renderContext()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => {
        result.current.setCurrentProject('unknown')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(spy).toHaveBeenCalledWith({ id: 0, name: 'unknown', index: 0 })
      spy.mockRestore()
    })
  })

  describe('从 project store 外部同步', () => {
    it('selectedProjectName 外部变化时应同步到 currentProject', async () => {
      const { result } = renderContext()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => {
        useProjectStore.setState({ selectedProjectName: 'ext-proj' })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.current.currentProject).toBe('ext-proj')
    })

    it('selectedProjectName 与 currentProject 相同时不应重复设置', async () => {
      const { result } = renderContext()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      // 先通过 setCurrentProject 设置
      await act(async () => {
        result.current.setCurrentProject('same')
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.currentProject).toBe('same')
      // 再次设置相同的 selectedProjectName,currentProject 应保持不变
      await act(async () => {
        useProjectStore.setState({ selectedProjectName: 'same' })
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.currentProject).toBe('same')
    })
  })

  describe('projectPath 边界情况', () => {
    it('currentProject 为 null 时 projectPath 应为空', async () => {
      const { result } = renderContext()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.currentProject).toBeNull()
      expect(result.current.projectPath).toBe('')
    })

    it('electron 不可用时不崩溃且 projectPath 保持为空', async () => {
      const saved = window.electron
      // @ts-expect-error 测试 electron 不可用边界
      delete window.electron
      const { result } = renderContext()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.currentProject).toBeNull()
      expect(result.current.projectPath).toBe('')
      window.electron = saved
    })
  })
})
