/**
 * AL-N2（PRD v3.2）：中栏步骤状态动态化 —— FileExplorer 组件级验证
 * - S-1：不再渲染 ①-⑤ 静态徽标（无步骤数字圆圈）
 * - S-2：渲染动态状态标签（已完成/待操作/进行中）
 * - S-3：状态随 design 就绪度 / 机柜就绪度 / 输出批次变化
 * 组件测试仅做轻断言（渲染/文本/随 store 变化）；映射规则细节由纯函数单测覆盖（见 subview-status.test.ts）。
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { FileExplorer } from '@/components/layout/FileExplorer'
import { useUIStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRenderStore } from '@/stores/render.store'
import { useRoomStore } from '@/stores/room.store'
import { useExplorerStore } from '@/stores/explorer.store'
import type { RoomMatrixData } from '@/stores/room.store'
import type { OutputBatch } from '@/types/file-tree'

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
  // 预置批次缓存（空）→ 避免懒加载异步 setState 触发 act 警告；S-3c 单独覆盖为有批次
  useExplorerStore.setState({ outputBatches: { projA: [] } })
  ;(window as unknown as { electron: { project: { listOutputBatches: ReturnType<typeof vi.fn> } } }).electron.project.listOutputBatches =
    vi.fn().mockResolvedValue([])
})

/** 定位中栏某子视图按钮（按 label 文本就近取 button） */
const row = (label: string) => screen.getByText(label).closest('button') as HTMLButtonElement

describe('AL-N2 中栏步骤状态动态化', () => {
  it('S-1 不再渲染 ①-⑤ 静态徽标', () => {
    render(<FileExplorer />)
    expect(screen.queryByText('①规划')).not.toBeInTheDocument()
    expect(screen.queryByText(/[①-⑤]/)).not.toBeInTheDocument()
  })

  it('S-2 渲染动态状态标签：active 子视图「进行中」+ 未就绪条目「待操作」', () => {
    render(<FileExplorer />)
    // 当前 active 子视图（默认 main）→ 进行中
    expect(screen.getByText('进行中')).toBeInTheDocument()
    // 未就绪条目（design 等）→ 待操作
    expect(screen.getAllByText('待操作').length).toBeGreaterThan(0)
    expect(row('组网设计')).toHaveTextContent('待操作')
  })

  it('S-3a 组网设计就绪（valid=true 且有输出类型）→ design/main/visualization 变「已完成」', () => {
    // active 子视图置为 aidc，避免 main（默认 active）被「进行中」覆盖
    useUIStore.setState({ workbenchSubview: 'aidc' })
    useDesignStore.setState({ valid: true })
    useRenderStore.setState({ selectedOutputTypes: ['connections'] })
    render(<FileExplorer />)
    expect(row('组网设计')).toHaveTextContent('已完成')
    expect(row('组网渲染')).toHaveTextContent('已完成')
    expect(row('拓扑')).toHaveTextContent('已完成')
  })

  it('S-3a 组网设计未通过（valid=false）→ design 保持「待操作」，即便有输出类型 main 也待操作', () => {
    useUIStore.setState({ workbenchSubview: 'aidc' })
    useDesignStore.setState({ valid: false })
    useRenderStore.setState({ selectedOutputTypes: ['connections'] })
    render(<FileExplorer />)
    expect(row('组网设计')).toHaveTextContent('待操作')
    expect(row('组网渲染')).toHaveTextContent('待操作')
  })

  it('S-3b 机柜就绪度：矩阵已定稿 + 有柜 → rackdesign 变「已完成」', () => {
    const matrix = { schemaVersion: 1, name: 'm', rows: ['A'], cols: [1], cells: [], finalized: true } as RoomMatrixData
    useRoomStore.setState({ matrix })
    useRackStore.setState({ cabinets: [{ id: 1, name: '机柜 1', totalU: 42, type: 'gpu', power_limit: 50000, devices: [] }] })
    render(<FileExplorer />)
    expect(row('机柜设计')).toHaveTextContent('已完成')
  })

  it('S-3b 机柜未就绪：矩阵已定稿但无柜 → rackdesign 保持「待操作」', () => {
    const matrix = { schemaVersion: 1, name: 'm', rows: ['A'], cols: [1], cells: [], finalized: true } as RoomMatrixData
    useRoomStore.setState({ matrix })
    render(<FileExplorer />)
    expect(row('机柜设计')).toHaveTextContent('待操作')
  })

  it('S-3c 输出批次非空 → results/export 变「已完成」', () => {
    const batches: OutputBatch[] = [{ name: '[根目录]', files: [{ name: 'x.xlsx', path: 'projA/output/x.xlsx' }] }]
    useExplorerStore.setState({ outputBatches: { projA: batches } })
    render(<FileExplorer />)
    expect(row('本项目输出')).toHaveTextContent('已完成')
    expect(row('导出')).toHaveTextContent('已完成')
  })

  it('S-3d 切换 active 子视图 → 该行变「进行中」（active 优先于就绪态）', () => {
    useDesignStore.setState({ valid: true })
    useRenderStore.setState({ selectedOutputTypes: ['connections'] })
    render(<FileExplorer />)
    expect(row('组网设计')).toHaveTextContent('已完成')
    act(() => useUIStore.getState().setWorkbenchSubview('design'))
    expect(row('组网设计')).toHaveTextContent('进行中')
  })
})
