/**
 * M7（AL-E1）：机房设计 Excel 三 sheet 结构单测（纯函数 workbook 内存校验，不落盘）
 * - E-1a/1b：三 sheet 结构 + Sheet1 机房平面图网格（格位/类型/占用/柜名，行/列排序）
 * - E-1c：Sheet2 机柜类型清单（类型/数量/单柜功率/总功率）
 * - E-1d：Sheet3 机房汇总（行列/柜数/已上架柜/总功率）
 * - E-4：空机房/空机柜导出不崩溃
 * - 落盘：复用 electron export.saveFile（与 exportRackDesignExcel 一致）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildRoomDesignWorkbook,
  buildRoomDesignRackConfig,
  exportRoomDesignExcel,
  type RoomDesignRackConfig,
} from '@/utils/exportRoomDesignExcel'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import type { RoomMatrixData } from '@/stores/room.store'

/** 取 sheet 的非空行（去除整行空白分隔行与尾部补位空串，索引稳定便于断言） */
function rowsOf(ws: XLSX.WorkSheet): (string | number)[][] {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (string | number)[][]
  return aoa
    .filter((r) => Array.isArray(r) && r.some((v) => v !== ''))
    .map((r) => {
      while (r.length > 0 && r[r.length - 1] === '') r.pop()
      return r
    })
}

const makeMatrix = (): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  // 故意乱序：行/列应按 A→B、1→3 排序输出
  rows: ['B', 'A'],
  cols: [3, 1, 2],
  cells: [
    { row: 'A', col: 1, type: 'gpu', placeholder: null, cabinetId: 1 },
    { row: 'A', col: 2, type: 'power', placeholder: null, cabinetId: null },
    { row: 'A', col: 3, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 1, type: 'empty', placeholder: 'ac', cabinetId: null },
    { row: 'B', col: 2, type: 'network', placeholder: null, cabinetId: null },
    { row: 'B', col: 3, type: 'empty', placeholder: null, cabinetId: null },
  ],
})

const makeCabinets = (): RackCabinet[] => [
  {
    id: 1,
    name: '机柜 A1',
    totalU: 42,
    type: 'gpu',
    power_limit: 6000,
    devices: [{ id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 1000 }],
  },
  { id: 2, name: '机柜 B2', totalU: 42, type: 'network', power_limit: 4000, devices: [] },
]

const makeRackConfig = (): RoomDesignRackConfig => ({
  topReservedU: 2,
  gpuPerCabinet: 1,
  powerSummary: { total: 1000, limit: 10000, percent: 10 },
})

describe('buildRoomDesignWorkbook（机房设计 Excel 三 sheet）', () => {
  it('E-1a 结构：三个 sheet 名为 机房平面图 / 机柜类型清单 / 机房汇总', () => {
    const wb = buildRoomDesignWorkbook(makeMatrix(), makeCabinets(), makeRackConfig())
    expect(wb.SheetNames).toEqual(['机房平面图', '机柜类型清单', '机房汇总'])
  })

  it('E-1b Sheet1 机房平面图：矩阵网格（行/列排序 + 格位→类型/占用/柜名）', () => {
    const wb = buildRoomDesignWorkbook(makeMatrix(), makeCabinets(), makeRackConfig())
    const grid = rowsOf(wb.Sheets['机房平面图'])
    // 首行标题（含机房名/矩阵规模/机柜数）
    expect(grid[0][0]).toBe('机房平面图')
    expect(grid[0][1]).toBe('机房: 机房 A')
    expect(grid[0][2]).toBe('矩阵: 2排×3列')
    expect(grid[0][3]).toBe('机柜数: 2')
    // 列头（排序后 列1/列2/列3）
    expect(grid[1]).toEqual(['', '列1', '列2', '列3'])
    // 行A：A1 已上架机柜（柜名+类型）→ 机柜 A1(GPU柜)；A2 电源柜；A3 空
    expect(grid[2]).toEqual(['行A', '机柜 A1(GPU柜)', '电源柜'])
    // 行B：B1 空调占位；B2 网络柜；B3 空
    expect(grid[3]).toEqual(['行B', '空调', '网络柜'])
    // 图例行
    expect(grid[4][0]).toContain('图例')
  })

  it('E-1c Sheet2 机柜类型清单：类型/数量/单柜功率/总功率 正确', () => {
    const wb = buildRoomDesignWorkbook(makeMatrix(), makeCabinets(), makeRackConfig())
    const grid = rowsOf(wb.Sheets['机柜类型清单'])
    expect(grid[0]).toEqual(['机柜类型', '数量', '单柜功率(W)', '总功率(W)', '总功率上限(W)'])
    // GPU柜：1 台，单柜功率=功率上限 6000，总功率=已用 1000，总上限 6000
    expect(grid[1]).toEqual(['GPU柜', 1, 6000, 1000, 6000])
    // 网络柜：1 台，单柜功率 4000，总功率 0，总上限 4000
    expect(grid[2]).toEqual(['网络柜', 1, 4000, 0, 4000])
  })

  it('E-1d Sheet3 机房汇总：行列/柜数/已上架柜/总功率 正确', () => {
    const wb = buildRoomDesignWorkbook(makeMatrix(), makeCabinets(), makeRackConfig())
    const grid = rowsOf(wb.Sheets['机房汇总'])
    const kv = (label: string) => grid.find((r) => r[0] === label)?.[1]
    expect(kv('机房名称')).toBe('机房 A')
    expect(kv('矩阵行数')).toBe(2)
    expect(kv('矩阵列数')).toBe(3)
    expect(kv('矩阵格数')).toBe(6)
    expect(kv('机柜总数')).toBe(2)
    expect(kv('已上架机柜数')).toBe(1)
    expect(kv('未上架机柜数')).toBe(1)
    expect(kv('总功率(W)')).toBe(1000)
    expect(kv('总功率上限(W)')).toBe(10000)
    expect(kv('功率使用率')).toBe('10%')
    expect(kv('柜顶预留U')).toBe(2)
    expect(kv('每柜GPU数')).toBe(1)
  })

  it('E-4 空机柜：不崩溃，三 sheet 仍生成，类型清单仅表头、汇总计数为 0', () => {
    const wb = buildRoomDesignWorkbook(makeMatrix(), [], makeRackConfig())
    expect(wb.SheetNames).toEqual(['机房平面图', '机柜类型清单', '机房汇总'])
    expect(rowsOf(wb.Sheets['机柜类型清单'])).toEqual([['机柜类型', '数量', '单柜功率(W)', '总功率(W)', '总功率上限(W)']])
    const grid = rowsOf(wb.Sheets['机房汇总'])
    expect(grid.find((r) => r[0] === '机柜总数')?.[1]).toBe(0)
    expect(grid.find((r) => r[0] === '已上架机柜数')?.[1]).toBe(0)
  })

  it('E-4 空矩阵：不崩溃，Sheet1 仅标题/图例，无格子行', () => {
    const wb = buildRoomDesignWorkbook(
      { schemaVersion: 1, name: '空机房', rows: [], cols: [], cells: [] },
      makeCabinets(),
      makeRackConfig(),
    )
    expect(wb.SheetNames).toEqual(['机房平面图', '机柜类型清单', '机房汇总'])
    const grid = rowsOf(wb.Sheets['机房平面图'])
    expect(grid[0][0]).toBe('机房平面图')
    expect(grid[1][0]).toContain('图例')
    expect(grid.length).toBe(2)
  })
})

describe('buildRoomDesignRackConfig（从 rack.store 组装功率/配置）', () => {
  beforeEach(() => {
    useRackStore.setState({ cabinets: [], topReservedU: 2, gpuPerCabinet: 1 })
  })

  it('读取 topReservedU/gpuPerCabinet/getPowerUsageAll', () => {
    useRackStore.setState({ topReservedU: 3, gpuPerCabinet: 2, cabinets: makeCabinets() })
    const cfg = buildRoomDesignRackConfig()
    expect(cfg.topReservedU).toBe(3)
    expect(cfg.gpuPerCabinet).toBe(2)
    expect(cfg.powerSummary.total).toBe(1000)
    expect(cfg.powerSummary.limit).toBe(10000)
  })
})

describe('exportRoomDesignExcel（落盘）', () => {
  it('非 batch 路径走 electron export.saveFile', async () => {
    ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile.mockResolvedValue('/out/机房设计.xlsx')
    const path = await exportRoomDesignExcel('p1', makeMatrix(), makeCabinets(), makeRackConfig())
    expect(path).toBe('/out/机房设计.xlsx')
    expect(
      (window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile,
    ).toHaveBeenCalledWith('p1', expect.stringContaining('机房设计_'), expect.any(String))
  })

  it('提供 batchName 时走 electron render.saveOutputFile（版本归档目录）', async () => {
    ;(window.electron as unknown as { render: { saveOutputFile: ReturnType<typeof vi.fn> } }).render.saveOutputFile =
      vi.fn().mockResolvedValue('/out/b1/机房设计.xlsx')
    const path = await exportRoomDesignExcel('p1', makeMatrix(), makeCabinets(), makeRackConfig(), 'b1')
    expect(path).toBe('/out/b1/机房设计.xlsx')
    expect(
      (window.electron as unknown as { render: { saveOutputFile: ReturnType<typeof vi.fn> } }).render.saveOutputFile,
    ).toHaveBeenCalledWith('p1', expect.stringContaining('output/b1/机房设计_'), expect.any(String))
  })
})
