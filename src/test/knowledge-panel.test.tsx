/**
 * 5.0.5-505-b：知识库面板组件测试
 * - 列表渲染（条目名/标题/分类/项目）
 * - 关键词检索 → aiHub.knowledge.search 调用
 * - 新增条目：打开 Modal → 校验必填 → add 调用
 * - 删除条目：确认后 delete 调用
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KnowledgePanel } from '@/components/workbench/KnowledgePanel'
import { useToastStore } from '@/stores/toast.store'

const entries = [
  {
    name: 'roc-conv', title: 'RoCE 收敛比规范', category: '设计规范', project: '', tags: ['roce'],
    enabled: true, updated_at: '2026-01-01T00:00:00', file: 'roc-conv.md',
  },
  {
    name: 'ib-switch', title: 'IB 交换机选型', category: '设备选型', project: 'p1', tags: ['ib'],
    enabled: true, updated_at: '2026-01-02T00:00:00', file: 'ib-switch.md',
  },
]

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  const bridge = window.electron as unknown as {
    aihub: { knowledge: {
      list: ReturnType<typeof vi.fn>
      search: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
      add: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
    } }
  }
  bridge.aihub.knowledge.list.mockReset().mockResolvedValue({ ok: true, entries, total: 2, categories: ['设计规范', '设备选型'] })
  bridge.aihub.knowledge.search.mockReset().mockResolvedValue({ ok: true, query: '', entries: [entries[0]], total: 1 })
  bridge.aihub.knowledge.get.mockReset().mockResolvedValue({ ok: true, entry: { ...entries[0], content: 'RoCE 收敛比建议 ≤ 1.2' } })
  bridge.aihub.knowledge.add.mockReset().mockResolvedValue({ ok: true, entry: {} })
  bridge.aihub.knowledge.delete.mockReset().mockResolvedValue({ ok: true, deleted: 'roc-conv' })
})

describe('KnowledgePanel（5.0.5-505-b 知识库）', () => {
  it('渲染条目列表（标题/分类/项目）', async () => {
    render(<KnowledgePanel projectName="p1" />)
    expect(await screen.findByText('RoCE 收敛比规范')).toBeInTheDocument()
    expect(screen.getByText('IB 交换机选型')).toBeInTheDocument()
  })

  it('检索：输入关键词 → search 调用并渲染命中', async () => {
    render(<KnowledgePanel projectName="p1" />)
    const input = await screen.findByPlaceholderText(/检索知识/)
    fireEvent.change(input, { target: { value: '收敛比' } })
    await waitFor(() =>
      expect((window.electron as unknown as { aihub: { knowledge: { search: ReturnType<typeof vi.fn> } } }).aihub.knowledge.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: '收敛比' }),
      ),
    )
  })

  it('新增条目：空内容校验拦截 + 合法提交调 add', async () => {
    render(<KnowledgePanel projectName="p1" />)
    fireEvent.click(await screen.findByText('新增条目'))
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true),
    )
    const bridge = window.electron as unknown as { aihub: { knowledge: { add: ReturnType<typeof vi.fn> } } }
    expect(bridge.aihub.knowledge.add).not.toHaveBeenCalled()

    // 填必填后提交
    fireEvent.change(screen.getByPlaceholderText('roc-convergence'), { target: { value: 'new-knowledge' } })
    fireEvent.change(screen.getByPlaceholderText(/设计规范/), { target: { value: '设计规范' } })
    fireEvent.change(screen.getByLabelText(/内容（markdown）/), { target: { value: '新知识内容' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() =>
      expect(bridge.aihub.knowledge.add).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'new-knowledge', content: '新知识内容' }),
      ),
    )
  })

  it('删除条目：确认后 delete 调用', async () => {
    render(<KnowledgePanel projectName="p1" />)
    // 确保条目渲染后取删除按钮（hover 显隐不影响 DOM 查询）
    expect(await screen.findByText('RoCE 收敛比规范')).toBeInTheDocument()
    const deleteBtn = Array.from(screen.getAllByRole('button')).find((b) => b.getAttribute('title') === '删除')
    expect(deleteBtn).toBeDefined()
    fireEvent.click(deleteBtn!)
    // ConfirmDialog 确认按钮
    expect(await screen.findByText(/删除知识条目/)).toBeInTheDocument()
    fireEvent.click(await screen.findByText('确认'))
    // 条目按更新时间倒序，首个删除按钮对应最新条目 ib-switch
    await waitFor(() =>
      expect((window.electron as unknown as { aihub: { knowledge: { delete: ReturnType<typeof vi.fn> } } }).aihub.knowledge.delete).toHaveBeenCalledWith('ib-switch'),
    )
  })
})
