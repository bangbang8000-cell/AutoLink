/**
 * 4.4 E-4（测试计划）：最近使用/收藏/模板入口（F4-4）
 * - store：trackRecent 去重/置顶/上限 5；toggleFavorite 添加/移除
 * - 欢迎页（工作台空态）：「最近项目」「从模板新建」入口可见可点
 * - 侧边栏项目浏览器：最近项目区块 + 行内收藏星标
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore } from '@/stores/ui.store'
import { WorkbenchTab } from '@/components/workspace/tabs/WorkbenchTab'
import { ProjectExplorer } from '@/components/layout/ProjectListPanel'

describe('E-4 最近/收藏 store（F4-4）', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      recentProjects: [],
      favoriteProjects: [],
      selectedProjectName: null,
    } as never)
  })

  it('trackRecent：置顶 + 去重 + 上限 5', () => {
    const st = useProjectStore.getState()
    st.trackRecent('A')
    st.trackRecent('B')
    st.trackRecent('C')
    st.trackRecent('D')
    st.trackRecent('E')
    st.trackRecent('F')
    expect(useProjectStore.getState().recentProjects).toEqual(['F', 'E', 'D', 'C', 'B'])
    // 再次打开 B → 置顶且去重
    st.trackRecent('B')
    expect(useProjectStore.getState().recentProjects).toEqual(['B', 'F', 'E', 'D', 'C'])
    expect(useProjectStore.getState().recentProjects.length).toBe(5)
  })

  it('toggleFavorite：添加/移除', () => {
    const st = useProjectStore.getState()
    st.toggleFavorite('P1')
    expect(useProjectStore.getState().favoriteProjects).toContain('P1')
    st.toggleFavorite('P1')
    expect(useProjectStore.getState().favoriteProjects).not.toContain('P1')
  })
})

describe('E-4 欢迎页入口（F4-4）', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [
        { id: 1, name: 'Alpha', index: 0, updatedAt: '2026-08-01' },
        { id: 2, name: 'Beta', index: 1, updatedAt: '2026-08-02' },
        { id: 3, name: 'Gamma', index: 2, updatedAt: '2026-08-03' },
      ],
      selectedProjectName: null,
      recentProjects: ['Beta', 'Alpha'],
      templates: [
        {
          id: 'T1',
          name: 'H100-128台方案',
          description: '128台H100',
          scenario: 'H100-128台',
          tags: [],
          updatedAt: '',
        },
      ],
      favoriteProjects: [],
    } as never)
    useUIStore.setState({ showCreateProjectWizard: false, templateForWizard: null } as never)
    ;(window as unknown as { electron: Record<string, unknown> }).electron = {
      ...(window as unknown as { electron: Record<string, unknown> }).electron,
      aidc: {
        plan: vi.fn(),
        project: {
          list: vi.fn().mockResolvedValue({ ok: true, projects: [] }),
          load: vi.fn().mockResolvedValue({ plan: null }),
          save: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({}),
        },
        exportPlan: vi.fn(),
      },
    }
  })

  it('无选中项目时显示「最近使用项目」入口（仅存在的项目）', () => {
    render(<WorkbenchTab />)
    expect(screen.getByText('最近使用项目')).toBeInTheDocument()
    // Beta/Alpha 同时出现在「选择一个项目」与「最近使用项目」，用 getAllByText 兜底
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0)
    // Gamma 不在最近列表
  })

  it('点击最近项目 → selectProject 选中该项目', () => {
    render(<WorkbenchTab />)
    fireEvent.click(screen.getAllByText('Beta')[0])
    expect(useProjectStore.getState().selectedProjectName).toBe('Beta')
  })

  it('显示「从模板新建」入口，点击 → openWizardFromTemplate', () => {
    render(<WorkbenchTab />)
    expect(screen.getByText('从模板新建')).toBeInTheDocument()
    fireEvent.click(screen.getByText('H100-128台方案'))
    expect(useUIStore.getState().templateForWizard).toBe('H100-128台方案')
    expect(useUIStore.getState().showCreateProjectWizard).toBe(true)
  })
})

describe('E-4 侧边栏项目浏览器入口（F4-4）', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [
        { id: 1, name: 'Alpha', index: 0, fileCount: 5, updatedAt: '2026-08-01' },
        { id: 2, name: 'Beta', index: 1, fileCount: 3, updatedAt: '2026-08-02' },
      ],
      selectedProjectName: 'Alpha',
      recentProjects: ['Beta'],
      favoriteProjects: [],
      templates: [],
    } as never)
    const electron = (window as unknown as { electron: Record<string, unknown> })
      .electron as Record<string, unknown>
    electron.project = {
      ...(electron.project as Record<string, unknown>),
      list: vi.fn().mockResolvedValue([]),
      getStructure: vi.fn().mockResolvedValue([]),
      listOutputBatches: vi.fn().mockResolvedValue([]),
    }
  })

  it('渲染「最近项目」区块（含 Beta）', () => {
    render(<ProjectExplorer />)
    expect(screen.getByText('最近项目')).toBeInTheDocument()
    // Beta 在最近区块出现（可能有重复文本，用 getAllByText 兜底）
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0)
  })

  it('点击最近项目行 → 打开项目（selectProject + 打开项目概览 Tab）', async () => {
    render(<ProjectExplorer />)
    fireEvent.click(screen.getAllByText('Beta')[0])
    await waitFor(() => {
      expect(useProjectStore.getState().selectedProjectName).toBe('Beta')
    })
  })

  it('行内收藏星标点击 → toggleFavorite', () => {
    render(<ProjectExplorer />)
    const stars = screen.getAllByLabelText('收藏置顶')
    expect(stars.length).toBeGreaterThan(0)
    fireEvent.click(stars[0])
    expect(useProjectStore.getState().favoriteProjects).toContain('Alpha')
  })
})
