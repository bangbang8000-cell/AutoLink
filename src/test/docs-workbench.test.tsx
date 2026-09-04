/**
 * 5.0.5-505-a：文档工作台组件测试
 * - 产物清单：doc:list 结果渲染（类型/文件名/时间/状态）+ 空态
 * - 一键生成：点击「生成」→ doc:generate 调用并刷新清单
 * - 用户指南：点击打开 guide Tab（复用 GuideTab）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DocsWorkbench } from '@/components/workbench/DocsWorkbench'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useToastStore } from '@/stores/toast.store'

const artifacts = [
  { id: 'doc-1', type: 'designReport', label: '设计报告 PDF', name: '设计报告_custom_20260101_000000.pdf', time: '2026-01-01T00:00:00.000Z', size: 2048, path: '/p/output/x.pdf', relPath: 'output/x.pdf', status: 'ready' as const },
  { id: 'doc-2', type: 'reviewPackage', label: '评审包', name: 'p1_评审包_2026-01-02.zip', time: '2026-01-02T00:00:00.000Z', size: 4096, path: '/p/output/y.zip', relPath: 'output/y.zip', status: 'ready' as const },
  { id: 'doc-3', type: 'compliance', label: '信创合规报告', name: '信创合规报告_custom_20260103.xlsx', time: '2026-01-03T00:00:00.000Z', size: 1024, path: '/p/output/z.xlsx', relPath: 'output/z.xlsx', status: 'ready' as const },
]

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useWorkspaceStore.setState({ tabs: [], activeTabId: null })
  ;(window.electron as unknown as { doc: { list: ReturnType<typeof vi.fn> } }).doc.list
    .mockReset()
    .mockResolvedValue({ ok: true, artifacts })
  ;(window.electron as unknown as { doc: { generate: ReturnType<typeof vi.fn> } }).doc.generate
    .mockReset()
    .mockResolvedValue({ ok: true, path: '/p/output/新产物.pdf', type: 'designReport' })
})

describe('DocsWorkbench（5.0.5-505-a 文档工作台）', () => {
  it('渲染产物清单（类型/文件名/时间/状态）', async () => {
    render(<DocsWorkbench projectName="p1" />)
    expect(await screen.findByText('设计报告 PDF')).toBeInTheDocument()
    expect(screen.getByText('p1_评审包_2026-01-02.zip')).toBeInTheDocument()
    expect(screen.getByText('信创合规报告_custom_20260103.xlsx')).toBeInTheDocument()
    expect(screen.getAllByText('已生成').length).toBeGreaterThan(0)
  })

  it('空态提示', async () => {
    ;(window.electron as unknown as { doc: { list: ReturnType<typeof vi.fn> } }).doc.list
      .mockResolvedValue({ ok: true, artifacts: [] })
    render(<DocsWorkbench projectName="p1" />)
    expect(await screen.findByText(/暂无文档产物/)).toBeInTheDocument()
  })

  it('点击「生成」→ doc:generate 调用并刷新清单', async () => {
    render(<DocsWorkbench projectName="p1" />)
    // 首个生成卡（设计报告 PDF）的「生成」按钮
    const generateBtns = await screen.findAllByText('生成')
    fireEvent.click(generateBtns[0])
    await waitFor(() =>
      expect(
        (window.electron as unknown as { doc: { generate: ReturnType<typeof vi.fn> } }).doc.generate,
      ).toHaveBeenCalledWith('p1', 'designReport'),
    )
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.type === 'success' && t.message.includes('新产物.pdf'))).toBe(true),
    )
    // 生成后刷新清单
    await waitFor(() => expect(screen.getAllByText('设计报告 PDF').length).toBeGreaterThan(0))
  })

  it('点击「用户指南」→ 打开 guide Tab', async () => {
    render(<DocsWorkbench projectName="p1" />)
    fireEvent.click(await screen.findByText('用户指南'))
    await waitFor(() =>
      expect(useWorkspaceStore.getState().tabs.some((t) => t.type === 'guide')).toBe(true),
    )
  })
})
