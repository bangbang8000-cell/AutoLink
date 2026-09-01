/**
 * 4.4 E-2（测试计划）：批量操作增强——批量渲染失败汇总（进度可查）+ 批量优化多项目
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@/i18n'
import { summarizeBatch, type BatchItemResult } from '@/utils/batchOps'
import { useRenderStore } from '@/stores/render.store'
import { BatchOptimizePanel } from '@/components/chat/BatchOptimizePanel'
import { useProjectStore } from '@/stores/project.store'

describe('E-2 批量渲染（F4-2）', () => {
  it('summarizeBatch 汇总成功/失败（多项目/失败汇总）', () => {
    const results: BatchItemResult[] = [
      { project: 'A', ok: true },
      { project: 'B', ok: false, error: '渲染失败：无拓扑' },
      { project: 'C', ok: true },
      { project: 'D', ok: false, error: '导出失败' },
    ]
    const s = summarizeBatch(results)
    expect(s.total).toBe(4)
    expect(s.succeeded).toBe(2)
    expect(s.failed).toBe(2)
    expect(s.failures).toEqual([
      { project: 'B', error: '渲染失败：无拓扑' },
      { project: 'D', error: '导出失败' },
    ])
  })

  it('render.store 记录批量渲染摘要，进度可查（成功/失败/明细）', () => {
    const st = useRenderStore.getState()
    st.clearBatchSummary()
    expect(useRenderStore.getState().batchSummary).toBeNull()
    st.setBatchSummary({ total: 3, succeeded: 2, failed: 1, failures: [{ project: 'B', error: 'x' }] })
    const s = useRenderStore.getState().batchSummary!
    expect(s.total).toBe(3)
    expect(s.succeeded).toBe(2)
    expect(s.failed).toBe(1)
    expect(s.failures[0].project).toBe('B')
    expect(s.failures[0].error).toBe('x')
  })

  it('批量导出进度可在 render.store 查询', () => {
    const st = useRenderStore.getState()
    st.setBatchExportProgress({ total: 2, done: 1, current: 'P-B', message: '导出中…' })
    const p = useRenderStore.getState().batchExportProgress!
    expect(p.total).toBe(2)
    expect(p.done).toBe(1)
    expect(p.current).toBe('P-B')
    st.setBatchExportProgress(null)
    expect(useRenderStore.getState().batchExportProgress).toBeNull()
  })
})

describe('E-2 批量优化（F4-2，多项目复用 BatchOptimizePanel）', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [
        { id: 1, name: 'P-A', index: 0 },
        { id: 2, name: 'P-B', index: 1 },
      ],
      selectedProjectName: 'P-A',
    } as never)
  })

  it('支持多项目选择：按项目逐个生成建议（每个项目一次 suggest）', async () => {
    const suggest = vi.fn().mockImplementation(({ projectName }: { projectName: string }) =>
      Promise.resolve({
        success: true,
        suggestions: [
          { category: 'convergence', categoryLabel: '收敛比', title: `建议-${projectName}`, description: 'd', patch: { topology: { x: 1 } }, impact: 'i' },
        ],
        total: 1,
      }))
    const apply = vi.fn().mockResolvedValue({ success: true, applied: [] })
    ;(window as unknown as { electron: Record<string, unknown> }).electron = {
      ...(window as unknown as { electron: Record<string, unknown> }).electron,
      optimize: { suggest, apply },
    }

    render(<BatchOptimizePanel open onClose={() => {}} />)
    // 多选 P-A + P-B
    fireEvent.click(screen.getByLabelText('P-B'))
    fireEvent.click(screen.getByRole('button', { name: /生成建议/ }))
    await waitFor(() => {
      expect(suggest).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.getByText('建议-P-A')).toBeTruthy()
      expect(screen.getByText('建议-P-B')).toBeTruthy()
    })
  })

  it('应用时按项目分组逐个 apply（每个项目一次）', async () => {
    const suggest = vi.fn().mockImplementation(({ projectName }: { projectName: string }) =>
      Promise.resolve({
        success: true,
        suggestions: [
          { category: 'cost', categoryLabel: '成本', title: `建议-${projectName}`, description: 'd', patch: { topology: { p: 'RoCE' } }, impact: 'i' },
        ],
        total: 1,
      }))
    const apply = vi.fn().mockResolvedValue({ success: true, applied: [{ category: 'cost', title: 't', patch: {} }] })
    ;(window as unknown as { electron: Record<string, unknown> }).electron = {
      ...(window as unknown as { electron: Record<string, unknown> }).electron,
      optimize: { suggest, apply },
    }

    render(<BatchOptimizePanel open onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('P-B'))
    fireEvent.click(screen.getByRole('button', { name: /生成建议/ }))
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByText(/应用选中/))
    await waitFor(() => {
      expect(apply).toHaveBeenCalledTimes(2)
      const names = apply.mock.calls.map((c) => c[0].projectName).sort()
      expect(names).toEqual(['P-A', 'P-B'])
    })
  })
})
