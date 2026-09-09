/**
 * 5.2.1-521-b/f：工作台状态机 UI 验证（FileExplorer 迁移到 deriveWorkbenchState）
 * - AIDC 规划手动标记完成（aidcDone）→ AIDC 行「已完成」
 * - 级联失效（stale）→ 数据就绪也显示「待调整」
 * - resolveStale 重跑依赖链后 → 回到「已完成」
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileExplorer } from '@/components/layout/FileExplorer'
import { useUIStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRenderStore } from '@/stores/render.store'
import { useRoomStore } from '@/stores/room.store'
import { useExplorerStore } from '@/stores/explorer.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import type { RoomMatrixData } from '@/stores/room.store'

beforeEach(() => {
  localStorage.clear()
  useUIStore.setState({ activeActivity: 'workbench', workbenchSubview: 'main' })
  useProjectStore.setState({
    projects: [{ id: 1, name: 'projA', index: 0, updatedAt: '2026-08-01' }],
    selectedProjectName: 'projA',
  })
  useDesignStore.setState({ valid: null, summary: null, generating: false })
  useRackStore.setState({ cabinets: [], unplacedDevices: [] })
  useRenderStore.setState({ selectedOutputTypes: [] })
  useRoomStore.setState({ matrix: null })
  useExplorerStore.setState({ outputBatches: { projA: [] } })
  useWorkbenchStore.setState({ aidcDone: {}, stale: {}, configFingerprint: {}, planHash: {} })
  ;(window as unknown as { electron: { project: { listOutputBatches: ReturnType<typeof vi.fn> } } }).electron.project.listOutputBatches =
    vi.fn().mockResolvedValue([])
})

const row = (label: string) => screen.getByText(label).closest('button') as HTMLButtonElement

describe('5.2.1 工作台状态机 UI', () => {
  it('AIDC 规划手动标记完成 → AIDC 行显示「已完成」', () => {
    useWorkbenchStore.getState().markAidcDone('projA')
    render(<FileExplorer />)
    expect(row('AIDC 规划')).toHaveTextContent('已完成')
  })

  it('未标记完成 → AIDC 行显示「待操作」', () => {
    render(<FileExplorer />)
    expect(row('AIDC 规划')).toHaveTextContent('待操作')
  })

  it('组网设计被级联失效（aidc 变更）→ 即使数据就绪也显示「待调整」', () => {
    useDesignStore.setState({ valid: true })
    useRenderStore.setState({ selectedOutputTypes: ['connections'] })
    useWorkbenchStore.getState().invalidateDownstream('projA', ['aidc'])
    render(<FileExplorer />)
    expect(row('组网设计')).toHaveTextContent('待调整')
  })

  it('机房设计被级联失效 → 显示「待调整」而非「已完成」', () => {
    const matrix = { schemaVersion: 1, name: 'm', rows: ['A'], cols: [1], cells: [], finalized: true } as RoomMatrixData
    useRoomStore.setState({ matrix })
    useWorkbenchStore.getState().invalidateDownstream('projA', ['aidc'])
    render(<FileExplorer />)
    expect(row('机房设计')).toHaveTextContent('待调整')
  })

  it('resolveStale 重跑依赖链后 → 回到「已完成」', () => {
    useDesignStore.setState({ valid: true })
    useRenderStore.setState({ selectedOutputTypes: ['connections'] })
    useWorkbenchStore.getState().invalidateDownstream('projA', ['aidc'])
    useWorkbenchStore.getState().resolveStale('projA', ['design'])
    render(<FileExplorer />)
    expect(row('组网设计')).toHaveTextContent('已完成')
  })
})
