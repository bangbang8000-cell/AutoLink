/**
 * 5.4.6（调研 P0-3）：WorkbenchReadinessCard AIDC 定稿状态行首页可见。
 * 5.5.2 / A12：完成判据统一为 stepDone['aidc'].done
 * - 已标记完成 → 显示「已标记完成」
 * - 未标记完成 → 显示「未完成」
 */
import '@/i18n'
import { describe, it, expect, beforeEach } from 'vitest'
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
  useWorkbenchStore.setState({ stepDone: {}, stale: {}, configFingerprint: {}, planHash: {} })
  // ReadinessCard 校验按钮依赖 design.validate → 走 IPC，测试里不触发即可
  ;(window as unknown as { electron: unknown }).electron = {}
})

const aidcRow = () => screen.getByText(/AIDC 规划/).closest('div') as HTMLDivElement

describe('5.4.6 WorkbenchReadinessCard AIDC 定稿状态', () => {
  it('已标记完成 → AIDC 行显示「已标记完成」', () => {
    useWorkbenchStore.getState().markStepDone('projA', 'aidc')
    render(<WorkbenchReadinessCard />)
    expect(aidcRow()).toHaveTextContent('已标记完成')
  })

  it('未标记完成 → AIDC 行显示「未完成」', () => {
    render(<WorkbenchReadinessCard />)
    expect(aidcRow()).toHaveTextContent('未完成')
  })

  it('撤销完成标记后 → 回到「未完成」', () => {
    useWorkbenchStore.getState().markStepDone('projA', 'aidc')
    useWorkbenchStore.getState().unmarkStepDone('projA', 'aidc')
    render(<WorkbenchReadinessCard />)
    expect(aidcRow()).toHaveTextContent('未完成')
  })
})
