/**
 * M4（AL-N3 / E-2、E-3）：「本项目输出」导出动作组件测试
 * - 工具栏存在「导出机房设计 Excel」「导出机柜设计 Excel」两个动作
 * - 点击后调用 export util（落 output/ 根目录：electron export.saveFile 非 batch），成功后 toast 提示路径并刷新批次
 * - E-1 设计子视图无导出按钮见 rack-design-tab.test.tsx / room-editing.test.tsx
 * - E-4 导出结构正确见 export-room-design-excel.test.ts / export-rack-design-excel.test.ts
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OutputResultsView } from '@/components/workbench/OutputResultsView'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'

const makeMatrix = (): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: ['A'],
  cols: [1],
  cells: [{ row: 'A', col: 1, type: 'gpu', placeholder: null, cabinetId: 1 }],
})

const makeCabinets = (): RackCabinet[] => [
  { id: 1, name: '机柜 A1', totalU: 42, type: 'gpu', power_limit: 6000, devices: [] },
]

beforeEach(() => {
  useRoomStore.setState({ matrix: makeMatrix() })
  useRackStore.setState({ cabinets: makeCabinets(), topReservedU: 2, gpuPerCabinet: 1 })
  useToastStore.setState({ toasts: [] })
  useProjectStore.setState({
    projects: [{ id: 1, name: 'p1', index: 0, updatedAt: '2026-01-01' }],
    selectedProjectName: 'p1',
  })
  ;(window as unknown as { electron: { project: { listOutputBatches: ReturnType<typeof vi.fn> } } }).electron.project.listOutputBatches =
    vi.fn().mockResolvedValue([{ name: '[根目录]', files: [{ name: '旧文件.xlsx', path: 'output/旧文件.xlsx' }] }])
  ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile
    .mockReset()
    .mockResolvedValue('/workspace/p1/output/机房设计.xlsx')
})

describe('OutputResultsView（AL-N3 导出收敛）', () => {
  it('E-2 工具栏显示「导出机房设计 Excel」「导出机柜设计 Excel」两个动作', async () => {
    render(<OutputResultsView projectName="p1" />)
    expect(await screen.findByText('导出机房设计 Excel')).toBeInTheDocument()
    expect(screen.getByText('导出机柜设计 Excel')).toBeInTheDocument()
  })

  it('E-2/E-3 点「导出机房设计 Excel」→ 落 output/ 根目录（export.saveFile 非 batch）并 toast 提示路径', async () => {
    render(<OutputResultsView projectName="p1" />)
    fireEvent.click(await screen.findByText('导出机房设计 Excel'))
    await waitFor(() =>
      expect(
        (window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile,
      ).toHaveBeenCalledWith('p1', expect.stringContaining('机房设计_'), expect.any(String)),
    )
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.type === 'success' && t.message.includes('/workspace/p1/output/机房设计.xlsx'))).toBe(true),
    )
  })

  it('E-2/E-3 点「导出机柜设计 Excel」→ 落 output/ 根目录并 toast 提示路径', async () => {
    render(<OutputResultsView projectName="p1" />)
    fireEvent.click(await screen.findByText('导出机柜设计 Excel'))
    await waitFor(() =>
      expect(
        (window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile,
      ).toHaveBeenCalledWith('p1', expect.stringContaining('机柜设计_'), expect.any(String)),
    )
  })

  it('导出失败 → toast 提示错误（不静默）', async () => {
    ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile.mockResolvedValue('')
    render(<OutputResultsView projectName="p1" />)
    fireEvent.click(await screen.findByText('导出机房设计 Excel'))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error' && t.message.includes('导出失败'))).toBe(true),
    )
  })
})
