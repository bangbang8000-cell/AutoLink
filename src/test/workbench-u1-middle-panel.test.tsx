/**
 * M8（AL-U1）：移除左侧面板中段「本项目输出」中栏 OutputSection
 * - 说明：原计划挂接点 FileTreePanel.tsx:254-262 经 M1~M6 重构后已变为纯工具模块，
 *   「本项目输出」中栏实际位于 FileExplorer.tsx 的 WorkbenchExplorer（activeActivity=workbench）。
 * - results 子视图下不再渲染「本项目输出（点击文件在工作区预览）」中栏区块。
 * - 成果查看兜底保留：工作台子视图列表「本项目输出」（results，指向 OutputResultsView）仍在。
 */
import '@/i18n'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileExplorer } from '@/components/layout/FileExplorer'
import { useUIStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'

beforeEach(() => {
  localStorage.clear()
  useUIStore.setState({ activeActivity: 'workbench', workbenchSubview: 'results' })
  useProjectStore.setState({
    projects: [{ id: 1, name: 'projA', index: 0, updatedAt: '2026-08-01' }],
    selectedProjectName: 'projA',
  })
})

describe('M8 / AL-U1 中栏移除', () => {
  it('results 子视图下不再渲染「本项目输出」中栏 OutputSection', () => {
    render(<FileExplorer />)
    // 原中栏区块标题「本项目输出（点击文件在工作区预览）」不再出现
    expect(screen.queryByText('本项目输出（点击文件在工作区预览）')).not.toBeInTheDocument()
  })

  it('成果查看兜底保留：子视图列表「本项目输出」入口仍在（指向 OutputResultsView）', () => {
    render(<FileExplorer />)
    // WORKBENCH_SUBVIEWS 中 results 子视图按钮仍保留，作为成果查看兜底入口
    expect(screen.getByText('本项目输出')).toBeInTheDocument()
  })
})
