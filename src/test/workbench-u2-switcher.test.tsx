/**
 * M8（AL-U2）：工作台 Header 项目切换器
 * - 多项目：Header 渲染下拉切换器，触发器显示当前项目名，列表含全部项目且当前项 aria-selected 高亮
 * - 切换项目：调用 selectProject → selectedProjectName 更新 + 子视图重置回 main（复用既有 useEffect）
 * - 单项目：降级为纯文本项目名，不渲染下拉
 * - U-3（store 级）：selectProject 触发项目数据加载入口（清理旧项目 Tab / loadConfig 被调用）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WorkbenchTab } from '@/components/workspace/tabs/WorkbenchTab'
import { useProjectStore, type ProjectInfo } from '@/stores/project.store'
import { useUIStore } from '@/stores/ui.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useDesignStore } from '@/stores/design.store'

const makeProject = (id: number, name: string): ProjectInfo => ({ id, name, index: id, updatedAt: '2026-08-01' })

beforeEach(() => {
  localStorage.clear()
  useProjectStore.setState({ projects: [], selectedProject: null, selectedProjectName: null, recentProjects: [] })
  useUIStore.setState({ activeActivity: 'workbench', workbenchSubview: 'main' })
  useWorkspaceStore.setState({ tabs: [], activeTabId: null, closedTabHistory: [] })
  useDesignStore.setState({ configLoaded: false, generating: false })
  // setup.ts 的 electron mock 未覆盖以下两处，测试内补全（真实 Electron 桥接存在）
  ;(window as unknown as { electron: { app: { getPath: ReturnType<typeof vi.fn> } } }).electron.app.getPath =
    vi.fn().mockResolvedValue('/workspace')
  ;(window as unknown as { electron: { aidc?: { project: { list: ReturnType<typeof vi.fn> } } } }).electron.aidc = {
    project: { list: vi.fn().mockResolvedValue({ ok: true, projects: [] }) },
  }
})

describe('M8 / AL-U2 工作台 Header 项目切换器', () => {
  it('多项目：Header 渲染下拉切换器，触发器显示当前项目名且列表高亮当前项', async () => {
    useProjectStore.setState({
      projects: [makeProject(1, 'projA'), makeProject(2, 'projB')],
      selectedProjectName: 'projA',
    })
    render(<WorkbenchTab />)
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
    // 下拉触发器显示当前项目名
    const trigger = await screen.findByRole('button', { name: /projA/ })
    fireEvent.click(trigger)
    // 列表含全部项目
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining(['projB']))
    // 当前项高亮（aria-selected）
    expect(screen.getByRole('option', { name: 'projA' }).getAttribute('aria-selected')).toBe('true')
  })

  it('切换项目 → selectProject 更新 selectedProjectName + 子视图重置回 main', async () => {
    useProjectStore.setState({
      projects: [makeProject(1, 'projA'), makeProject(2, 'projB')],
      selectedProjectName: 'projA',
    })
    render(<WorkbenchTab />)
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
    // 先切到非 main 子视图（导出），验证切换项目后子视图重置回 main
    act(() => useUIStore.getState().setWorkbenchSubview('export'))
    fireEvent.click(await screen.findByRole('button', { name: /projA/ }))
    fireEvent.click(await screen.findByRole('option', { name: 'projB' }))
    await waitFor(() => expect(useProjectStore.getState().selectedProjectName).toBe('projB'))
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
  })

  it('单项目：降级为纯文本项目名，不渲染下拉切换器', async () => {
    useProjectStore.setState({
      projects: [makeProject(1, 'onlyProj')],
      selectedProjectName: 'onlyProj',
    })
    render(<WorkbenchTab />)
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
    expect(screen.getAllByText('onlyProj').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /onlyProj/ })).not.toBeInTheDocument()
  })

  it('U-3 store 级：selectProject 更新选中并清理旧项目 Tab（数据加载入口被触发）', async () => {
    const projects = [makeProject(1, 'projA'), makeProject(2, 'projB')]
    useProjectStore.setState({ projects, selectedProjectName: 'projA' })
    useWorkspaceStore.getState().openTab({ type: 'design', title: 'A 设计', closable: true, projectName: 'projA' })
    const loadConfigSpy = vi.spyOn(useDesignStore.getState(), 'loadConfig').mockResolvedValue(undefined)
    useProjectStore.getState().selectProject(projects[1])
    expect(useProjectStore.getState().selectedProjectName).toBe('projB')
    // 旧项目 Tab 被清理（setProjectTabs 由 selectProject 触发）
    expect(useWorkspaceStore.getState().tabs.filter((t) => t.projectName === 'projA')).toHaveLength(0)
    // 切换后预加载新项目配置（loadConfig 被调用）
    expect(loadConfigSpy).toHaveBeenCalledWith('projB')
    loadConfigSpy.mockRestore()
  })
})
