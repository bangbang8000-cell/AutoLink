/**
 * M4（AL-N3 / E-2、E-3）：导出收敛——「本项目输出」导出动作的可测逻辑单测
 * - exportRoomDesignExcelToRoot：从设计 store 导出机房设计 Excel → output/ 根目录（非 batch → electron export.saveFile → 出现在 [根目录] 批次）
 * - exportRackDesignExcelToRoot：从设计 store 导出机柜设计 Excel → output/ 根目录（非 batch）
 * - 无矩阵 → 抛错提示；落盘失败（返回空路径）→ 抛错
 * - E-1 设计子视图无导出按钮：rack-design-tab.test.tsx / room-editing.test.tsx 组件断言
 * - E-2/E-3 本项目输出工具栏动作：output-results-view.test.tsx 组件断言
 * - E-4 导出结构正确：export-room-design-excel.test.ts / export-rack-design-excel.test.ts 已覆盖（三 sheet / 两 sheet）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  exportRoomDesignExcelToRoot,
  exportRackDesignExcelToRoot,
} from '@/components/workbench/OutputResultsView'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'

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

describe('导出收敛（本项目输出 → output/ 根目录）', () => {
  beforeEach(() => {
    useRoomStore.setState({ matrix: null })
    useRackStore.setState({ cabinets: [], topReservedU: 2, gpuPerCabinet: 1 })
    ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile.mockReset()
    // 保证「未走版本归档目录」断言可判定
    ;(window.electron as unknown as { render: { saveOutputFile: ReturnType<typeof vi.fn> } }).render.saveOutputFile = vi.fn()
  })

  it('E-2/E-3 导出机房设计 Excel：无 batchName → electron export.saveFile（落 output/ 根目录，出现在 [根目录] 批次）', async () => {
    useRoomStore.setState({ matrix: makeMatrix() })
    useRackStore.setState({ cabinets: makeCabinets() })
    ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile.mockResolvedValue('/out/机房设计.xlsx')
    const path = await exportRoomDesignExcelToRoot('p1')
    expect(path).toBe('/out/机房设计.xlsx')
    expect(
      (window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile,
    ).toHaveBeenCalledWith('p1', expect.stringContaining('机房设计_'), expect.any(String))
    // 未传 batchName → 不写版本归档目录 output/<batch>/
    expect(
      (window.electron as unknown as { render: { saveOutputFile: ReturnType<typeof vi.fn> } }).render.saveOutputFile,
    ).not.toHaveBeenCalled()
  })

  it('E-2/E-3 导出机柜设计 Excel：无 batchName → electron export.saveFile（落 output/ 根目录）', async () => {
    useRackStore.setState({ cabinets: makeCabinets() })
    ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile.mockResolvedValue('/out/机柜设计.xlsx')
    const path = await exportRackDesignExcelToRoot('p1')
    expect(path).toBe('/out/机柜设计.xlsx')
    expect(
      (window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile,
    ).toHaveBeenCalledWith('p1', expect.stringContaining('机柜设计_'), expect.any(String))
  })

  it('无矩阵 → 机房设计导出抛错（提示先完成机房设计）', async () => {
    useRoomStore.setState({ matrix: null })
    useRackStore.setState({ cabinets: makeCabinets() })
    await expect(exportRoomDesignExcelToRoot('p1')).rejects.toThrow(/机房设计/)
  })

  it('落盘失败（返回空路径）→ 抛错提示导出失败', async () => {
    useRoomStore.setState({ matrix: makeMatrix() })
    useRackStore.setState({ cabinets: makeCabinets() })
    ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile.mockResolvedValue('')
    await expect(exportRoomDesignExcelToRoot('p1')).rejects.toThrow(/导出失败/)
    await expect(exportRackDesignExcelToRoot('p1')).rejects.toThrow(/导出失败/)
  })
})
