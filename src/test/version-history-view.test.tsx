/**
 * M-F1（PRD v3.6）：版本历史视图组件测试
 * - H-2 对比高亮：两版宏观参数 diff → 变更/新增/移除 行着色渲染
 * - H-3 回滚：点「回滚」→ ConfirmDialog 确认 → 调 feature.versionHistory.rollback(项目, 版本) → 成功后刷新
 * - H-5 空历史：plan_history 无版本 → 友好空态提示
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VersionHistoryView } from '@/components/workbench/VersionHistoryView'
import { useToastStore } from '@/stores/toast.store'

const makePlan = (version: number, macro: Record<string, unknown>) => ({
  meta: { projectId: 'p1', projectName: 'demo', planVersion: version, planHash: `hash-${version}`, generatedAt: `2026-08-29T00:00:0${version}Z` },
  macro,
})

const file = (name: string, content: string | null) => ({ name, content })

const versionsV1 = makePlan(1, {
  site: 'BJ01', gpuCount: 64, convergence: 1.0, rails: 8,
  ipSegments: { loopback: '10.1.0.0/20', compute: '10.1.16.0/20' },
  vlanRanges: { compute: [100, 199] },
})

const versionsV2 = makePlan(2, {
  site: 'BJ01', gpuCount: 128, convergence: 1.2, rails: 8,
  ipSegments: { loopback: '10.1.0.0/20', compute: '10.1.16.0/20' },
  vlanRanges: { compute: [100, 199] },
  siteName: '北京一号',
})

const mockList = (current: unknown, files: { name: string; content: string | null }[]) => {
  ;(window.electron as unknown as {
    feature: {
      versionHistory: {
        list: ReturnType<typeof vi.fn>
        rollback: ReturnType<typeof vi.fn>
      }
      reviewPdf: ReturnType<typeof vi.fn>
    }
  }).feature.versionHistory.list.mockReset().mockResolvedValue({ ok: true, projectName: 'p1', current, files })
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

describe('VersionHistoryView（M-F1）', () => {
  it('H-5 空历史 → 友好空态提示', async () => {
    mockList(null, [])
    render(<VersionHistoryView projectName="p1" open onClose={() => {}} />)
    expect(await screen.findByText(/暂无历史版本/)).toBeInTheDocument()
  })

  it('H-2 版本列表 → 选两版自动对比，差异字段高亮（变更/新增）', async () => {
    mockList(versionsV2, [file('v1.plan.json', JSON.stringify(versionsV1)), file('v2.plan.json', JSON.stringify(versionsV2))])
    render(<VersionHistoryView projectName="p1" open onClose={() => {}} />)
    // 版本列表展示
    expect(await screen.findByText('v2')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    // 默认选 v1/v2 → 差异渲染
    await waitFor(() => {
      expect(screen.getAllByText('变更').length).toBeGreaterThan(0)
      expect(screen.getAllByText('新增').length).toBeGreaterThan(0)
    })
    // 差异字段行：gpuCount（变更）、convergence（变更）、siteName（新增）
    expect(screen.getByText('GPU 数量')).toBeInTheDocument()
    expect(screen.getByText('siteName')).toBeInTheDocument()
    // 旧值/新值展示
    expect(screen.getByText('64')).toBeInTheDocument()
    expect(screen.getByText('128')).toBeInTheDocument()
    // 未变更字段不进入差异行（rails 无变化）
    expect(screen.queryByText('rails')).not.toBeInTheDocument()
  })

  it('H-2 两版完全一致 → 提示无差异', async () => {
    const sameMacro = versionsV2.macro
    const v1Same = makePlan(1, sameMacro)
    const v2Same = makePlan(2, sameMacro)
    mockList(v2Same, [file('v1.plan.json', JSON.stringify(v1Same)), file('v2.plan.json', JSON.stringify(v2Same))])
    render(<VersionHistoryView projectName="p1" open onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText(/宏观参数完全一致/)).toBeInTheDocument()
    })
  })

  it('H-3 点「回滚」→ 确认 → 调 rollback(项目, 版本) → 成功后刷新（重新 list）', async () => {
    const rollback = vi.fn().mockResolvedValue({ ok: true, projectName: 'p1', archivedVersion: 3, newVersion: 4 })
    ;(window.electron as unknown as {
      feature: {
        versionHistory: { list: ReturnType<typeof vi.fn>; rollback: ReturnType<typeof vi.fn> }
        reviewPdf: ReturnType<typeof vi.fn>
      }
    }).feature.versionHistory.rollback.mockReset().mockImplementation(rollback)
    mockList(versionsV2, [file('v1.plan.json', JSON.stringify(versionsV1)), file('v2.plan.json', JSON.stringify(versionsV2))])
    render(<VersionHistoryView projectName="p1" open onClose={() => {}} />)
    await screen.findByText('v1')
    // 点 v1 行的「回滚」按钮
    const rollbackButtons = screen.getAllByText('回滚')
    fireEvent.click(rollbackButtons[rollbackButtons.length - 1])
    // ConfirmDialog 确认（消息 + 按钮均含「回滚到 v1」，点按钮角色）
    expect(screen.getAllByText(/回滚到 v1/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /回滚到 v1/ }))
    await waitFor(() => {
      expect(rollback).toHaveBeenCalledWith('p1', 1)
    })
    // 成功后 toast
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((x) => x.type === 'success' && x.message.includes('已回滚到 v1'))).toBe(true),
    )
  })

  it('H-3 回滚失败 → error toast（不静默）', async () => {
    ;(window.electron as unknown as {
      feature: {
        versionHistory: { list: ReturnType<typeof vi.fn>; rollback: ReturnType<typeof vi.fn> }
        reviewPdf: ReturnType<typeof vi.fn>
      }
    }).feature.versionHistory.rollback.mockReset().mockResolvedValue({ ok: false, error: '历史版本 v9 不存在' })
    mockList(versionsV2, [file('v1.plan.json', JSON.stringify(versionsV1)), file('v2.plan.json', JSON.stringify(versionsV2))])
    render(<VersionHistoryView projectName="p1" open onClose={() => {}} />)
    await screen.findByText('v1')
    const rollbackButtons = screen.getAllByText('回滚')
    fireEvent.click(rollbackButtons[rollbackButtons.length - 1])
    fireEvent.click(screen.getByRole('button', { name: /回滚到 v1/ }))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((x) => x.type === 'error' && x.message.includes('历史版本 v9 不存在'))).toBe(true),
    )
  })
})
