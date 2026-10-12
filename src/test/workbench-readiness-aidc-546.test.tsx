/**
 * 5.4.6（调研 P0-3）：WorkbenchReadinessCard AIDC 定稿状态行首页可见。
 * - aidcDone=true → 显示「已标记完成」
 * - aidcDone=false → 显示「未完成」
 * - 无项目 → 不显示 AIDC 行（或显示未完成）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkbenchReadinessCard } from '@/components/workbench/WorkbenchReadinessCard'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRoomStore } from '@/stores/room.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useToastStore } from '@/stores/toast.store'

beforeEach(() => {
  localStorage.clear()
  useToastStore.setState({ toasts: [] })
  useProjectStore.setState({
    projects: [{ id: 1, name: 'projA', index: 0, updatedAt: '2026-10-01' }],
    selectedProjectName: 'projA',
  })
  useDesignStore.setState({ valid: null, summary: null, generating: false })
  useRackStore.setState({ cabinets: [], unplacedDevices: [] })
  useRoomStore.setState({ matrix: null })
  useWorkbenchStore.setState({ aidcDone: {}, stale: {}, configFingerprint: {}, planHash: {} })
  // ReadinessCard 校验按钮依赖 design.validate → 走 IPC，测试里不触发即可
  ;(window as unknown as { electron: unknown }).electron = {}
})

const aidcRow = () => screen.getByText(/AIDC 规划/).closest('div') as HTMLDivElement

describe('5.4.6 WorkbenchReadinessCard AIDC 定稿状态', () => {
  it('aidcDone=true → AIDC 行显示「已标记完成」', () => {
    useWorkbenchStore.getState().markAidcDone('projA')
    render(<WorkbenchReadinessCard />)
    expect(aidcRow()).toHaveTextContent('已标记完成')
  })

  it('aidcDone=false → AIDC 行显示「未完成」', () => {
    render(<WorkbenchReadinessCard />)
    expect(aidcRow()).toHaveTextContent('未完成')
  })

  it('unmarkAidcDone 后 → 回到「未完成」', () => {
    useWorkbenchStore.getState().markAidcDone('projA')
    useWorkbenchStore.getState().unmarkAidcDone('projA')
    render(<WorkbenchReadinessCard />)
    expect(aidcRow()).toHaveTextContent('未完成')
  })
})
