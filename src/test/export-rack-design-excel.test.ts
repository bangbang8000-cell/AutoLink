/**
 * M7（AL-E2）：机柜设计 Excel 两 sheet 结构单测（纯函数 workbook 内存校验，不落盘）
 * - E-2a：结构收敛为两 sheet（每机柜设计 + 上机表），无「机柜平面图」sheet
 * - E-2b：Sheet1 每机柜设计（柜名/设备/起始U/功率/占用，U 位从顶部向下）
 * - E-2c：Sheet2 上机表（全部设备明细 + 功率汇总）
 * - E-3：保留 sheet 内容与当前设计一致（每机柜设计 U 位视图 / 上机表明细列）
 * - E-4：空机柜导出不崩溃
 * - 落盘：复用 electron export.saveFile / render.saveOutputFile
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as XLSX from 'xlsx'
import { buildRackDesignWorkbook, exportRackDesignExcel } from '@/utils/exportRackDesignExcel'
import type { RackCabinet } from '@/stores/rack.store'

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

const makeCabinets = (): RackCabinet[] => [
  {
    id: 1,
    name: 'A01',
    totalU: 42,
    type: 'gpu',
    power_limit: 8000,
    devices: [{ id: 'd1', name: 'GPU服务器_1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 1000 }],
  },
  {
    id: 2,
    name: 'A02',
    totalU: 42,
    type: 'network',
    power_limit: 4000,
    devices: [{ id: 'd2', name: '核心交换机', type: 'Switch', cabinetId: 2, startU: 33, endU: 34, power_watts: 500 }],
  },
]

describe('buildRackDesignWorkbook（机柜设计 Excel 两 sheet）', () => {
  it('E-2a 结构：收敛为 每机柜设计 + 上机表 两 sheet，无「机柜平面图」sheet', () => {
    const wb = buildRackDesignWorkbook(makeCabinets())
    expect(wb.SheetNames).toEqual(['每机柜设计', '上机表'])
    expect(wb.SheetNames).not.toContain('机柜平面图')
  })

  it('E-2b Sheet1 每机柜设计：柜名/设备/起始U/功率/占用，U 位从顶部向下', () => {
    const wb = buildRackDesignWorkbook(makeCabinets())
    const grid = rowsOf(wb.Sheets['每机柜设计'])
    // 柜头行：柜名/类型/U 高/功率上限/已用功率/占用
    expect(grid[0]).toEqual(['机柜 A01', '类型: gpu', '42U', '功率上限 8000W', '已用功率 1000W', '占用 8U'])
    expect(grid[1]).toEqual(['U位', '设备', '类型', '功率(W)', '占用(U)'])
    // 设备行出现在 U42..U9 之后（U 位从顶部向下），内容含起始U段与占用
    const devIdx = grid.findIndex((r) => r[0] === '1-8U')
    const topIdx = grid.findIndex((r) => r[0] === 'U42')
    expect(topIdx).toBeGreaterThanOrEqual(2)
    expect(devIdx).toBeGreaterThan(topIdx)
    expect(grid[devIdx]).toEqual(['1-8U', 'GPU服务器_1', 'GPU Server', 1000, 8])
    // 第二个柜（A02 网络柜）也存在
    expect(grid.some((r) => r[0] === '机柜 A02')).toBe(true)
  })

  it('E-2c Sheet2 上机表：全部设备明细 + 功率汇总', () => {
    const wb = buildRackDesignWorkbook(makeCabinets())
    const grid = rowsOf(wb.Sheets['上机表'])
    expect(grid[0]).toEqual(['机柜', '机柜类型', '设备', '设备类型', '起始U', '结束U', '占用(U)', '功率(W)'])
    expect(grid[1]).toEqual(['A01', 'gpu', 'GPU服务器_1', 'GPU Server', 1, 8, 8, 1000])
    expect(grid[2]).toEqual(['A02', 'network', '核心交换机', 'Switch', 33, 34, 2, 500])
    // 功率汇总：逐柜 + 合计
    expect(grid).toContainEqual(['--- 功率汇总 ---'])
    expect(grid[grid.length - 3]).toEqual(['A01', 'gpu', 8000, 1000, '13%', '正常'])
    expect(grid[grid.length - 2]).toEqual(['A02', 'network', 4000, 500, '13%', '正常'])
    expect(grid[grid.length - 1]).toEqual(['合计', '', 12000, 1500, '13%'])
  })

  it('E-3 保留 sheet 内容与当前设计一致（每机柜设计 U 位视图 / 上机表明细列）', () => {
    const wb = buildRackDesignWorkbook(makeCabinets())
    // 每机柜设计：U位/设备/类型/功率(W) 表头（沿用现状）+ 占用列
    const designGrid = rowsOf(wb.Sheets['每机柜设计'])
    expect(designGrid[1].slice(0, 4)).toEqual(['U位', '设备', '类型', '功率(W)'])
    // 上机表：机柜/机柜类型/设备/设备类型/起始U/结束U 明细列（沿用现状）+ 功率(W)/占用/汇总
    const mountGrid = rowsOf(wb.Sheets['上机表'])
    expect(mountGrid[0].slice(0, 6)).toEqual(['机柜', '机柜类型', '设备', '设备类型', '起始U', '结束U'])
    expect(mountGrid[0]).toContain('功率(W)')
  })

  it('E-4 空机柜：不崩溃，两 sheet 仅表头/无设备明细', () => {
    const wb = buildRackDesignWorkbook([])
    expect(wb.SheetNames).toEqual(['每机柜设计', '上机表'])
    expect(rowsOf(wb.Sheets['每机柜设计'])).toEqual([])
    const grid = rowsOf(wb.Sheets['上机表'])
    expect(grid[0]).toEqual(['机柜', '机柜类型', '设备', '设备类型', '起始U', '结束U', '占用(U)', '功率(W)'])
    expect(grid.some((r) => r[0] === '合计')).toBe(true)
  })
})

describe('exportRackDesignExcel（落盘）', () => {
  beforeEach(() => {
    ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile.mockReset()
  })

  it('非 batch 路径走 electron export.saveFile', async () => {
    ;(window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile.mockResolvedValue('/out/机柜设计.xlsx')
    const path = await exportRackDesignExcel('p1', makeCabinets())
    expect(path).toBe('/out/机柜设计.xlsx')
    expect(
      (window.electron as unknown as { export: { saveFile: ReturnType<typeof vi.fn> } }).export.saveFile,
    ).toHaveBeenCalledWith('p1', expect.stringContaining('机柜设计_'), expect.any(String))
  })

  it('提供 batchName 时走 electron render.saveOutputFile（版本归档目录）', async () => {
    ;(window.electron as unknown as { render: { saveOutputFile: ReturnType<typeof vi.fn> } }).render.saveOutputFile =
      vi.fn().mockResolvedValue('/out/b1/机柜设计.xlsx')
    const path = await exportRackDesignExcel('p1', makeCabinets(), 'b1')
    expect(path).toBe('/out/b1/机柜设计.xlsx')
    expect(
      (window.electron as unknown as { render: { saveOutputFile: ReturnType<typeof vi.fn> } }).render.saveOutputFile,
    ).toHaveBeenCalledWith('p1', expect.stringContaining('output/b1/机柜设计_'), expect.any(String))
  })
})
