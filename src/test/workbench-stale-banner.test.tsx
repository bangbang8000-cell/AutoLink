/**
 * 5.2.1-521-d：工作台"待调整"横幅（一键重跑依赖链 / 同步规划 / 确认偏离）
 * - 无待调整 → 不渲染
 * - 有待调整 → 渲染列表 + 三个操作按钮
 * - 重跑依赖链 → 清除全部 stale + 跳转到第一个待调整子视图（依赖顺序）
 * - 同步规划 → 跳转 AIDC 规划子视图
 * - 确认偏离 → 清除 design 链路待调整，保留机房/机柜等其余项
 */
import '@/i18n'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkbenchStaleBanner } from '@/components/workbench/WorkbenchStaleBanner'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useUIStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'

beforeEach(() => {
  localStorage.clear()
  useWorkbenchStore.setState({ aidcDone: {}, stale: {}, configFingerprint: {}, planHash: {} })
  useUIStore.setState({ workbenchSubview: 'main' })
  useProjectStore.setState({
    projects: [{ id: 1, name: 'projA', index: 0, updatedAt: '2026-08-01' }],
    selectedProjectName: 'projA',
  })
})

describe('WorkbenchStaleBanner（521-d）', () => {
  it('无待调整 → 不渲染横幅', () => {
    const { container } = render(<WorkbenchStaleBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('有待调整 → 渲染列表与三个操作按钮', () => {
    useWorkbenchStore.getState().invalidateDownstream('projA', ['aidc'])
    render(<WorkbenchStaleBanner />)
    expect(screen.getByRole('button', { name: '重跑依赖链' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '同步规划' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认偏离' })).toBeInTheDocument()
    expect(screen.getByText(/组网设计/)).toBeInTheDocument()
  })

  it('重跑依赖链 → 清除全部待调整并跳转到第一个待调整子视图（依赖顺序）', () => {
    useWorkbenchStore.getState().invalidateDownstream('projA', ['aidc'])
    render(<WorkbenchStaleBanner />)
    fireEvent.click(screen.getByRole('button', { name: '重跑依赖链' }))
    expect(useWorkbenchStore.getState().getStale('projA')).toEqual([])
    expect(useUIStore.getState().workbenchSubview).toBe('design')
  })

  it('同步规划 → 跳转 AIDC 规划子视图', () => {
    useWorkbenchStore.getState().invalidateDownstream('projA', ['design'])
    render(<WorkbenchStaleBanner />)
    fireEvent.click(screen.getByRole('button', { name: '同步规划' }))
    expect(useUIStore.getState().workbenchSubview).toBe('aidc')
    // 同步仅跳转，不擅自清除待调整（待用户在 AIDC 视图操作）
    expect(useWorkbenchStore.getState().getStale('projA')).not.toEqual([])
  })

  it('确认偏离 → 仅清除 design 链路待调整，机房/机柜保留', () => {
    useWorkbenchStore.getState().invalidateDownstream('projA', ['aidc'])
    render(<WorkbenchStaleBanner />)
    fireEvent.click(screen.getByRole('button', { name: '确认偏离' }))
    const stale = useWorkbenchStore.getState().getStale('projA')
    expect(stale).not.toContain('design')
    expect(stale).not.toContain('main')
    expect(stale).toContain('roomdesign')
    expect(stale).toContain('rackdesign')
  })
})
