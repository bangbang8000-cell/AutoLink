/**
 * M7（AL-E1）：导出机房设计 Excel（单文件三 sheet）
 * - Sheet1 机房平面图：矩阵网格（格位/机柜类型/占用/柜名）
 * - Sheet2 机柜类型清单：类型/数量/单柜功率/总功率
 * - Sheet3 机房汇总：行列/柜数/已上架柜/总功率
 *
 * 数据来源：room.store（RoomMatrixData cells）/ rack.store（cabinets、getPowerUsageAll、topReservedU/gpuPerCabinet）。
 * buildRoomDesignWorkbook 为纯函数（内存 workbook，便于单测），落盘复用 electron 导出 IPC（与 exportRackDesignExcel 一致）。
 */
import * as XLSX from 'xlsx'
import { useRackStore, CABINET_TYPE_LABELS, type RackCabinet } from '@/stores/rack.store'
import type { RoomMatrixData } from '@/stores/room.store'

/** 机柜配置 + 功率汇总（来自 rack.store，供机房 Excel 汇总 sheet） */
export interface RoomDesignRackConfig {
  topReservedU: number
  gpuPerCabinet: number
  powerSummary: { total: number; limit: number; percent: number }
}

/** 从 rack.store 组装 rackConfig（导出入口/测试共用） */
export function buildRoomDesignRackConfig(): RoomDesignRackConfig {
  const rack = useRackStore.getState()
  return {
    topReservedU: rack.topReservedU,
    gpuPerCabinet: rack.gpuPerCabinet,
    powerSummary: rack.getPowerUsageAll(),
  }
}

/** 格子/机柜类型 → 中文标签（combined/empty 等域外类型回退原值） */
function typeLabel(type: string): string {
  return (CABINET_TYPE_LABELS as Record<string, string>)[type] || type
}

/** 格子文本：占位（空调/柱）> 已上架（柜名+类型）> 类型标记 > 空 */
function cellText(
  cell: Pick<RoomMatrixData['cells'][number], 'placeholder' | 'cabinetId' | 'type'>,
  cabinets: RackCabinet[],
): string {
  if (cell.placeholder) return cell.placeholder === 'ac' ? '空调' : '柱'
  if (cell.cabinetId != null) {
    const cab = cabinets.find((c) => c.id === cell.cabinetId)
    return cab ? `${cab.name}(${typeLabel(cab.type)})` : '已占用'
  }
  return cell.type === 'empty' ? '' : typeLabel(cell.type)
}

/** 纯函数：构建机房设计工作簿（三 sheet：机房平面图 / 机柜类型清单 / 机房汇总） */
export function buildRoomDesignWorkbook(
  roomMatrix: RoomMatrixData,
  cabinets: RackCabinet[],
  rackConfig: RoomDesignRackConfig,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const rows = [...roomMatrix.rows].sort()
  const cols = [...roomMatrix.cols].sort((a, b) => a - b)

  // ---- Sheet1: 机房平面图（矩阵网格） ----
  const planRows: (string | number)[][] = [
    ['机房平面图', `机房: ${roomMatrix.name}`, `矩阵: ${rows.length}排×${cols.length}列`, `机柜数: ${cabinets.length}`, `生成时间: ${new Date().toLocaleString()}`],
    [],
    ['', ...cols.map((c) => `列${c}`)],
  ]
  for (const r of rows) {
    const line: (string | number)[] = [`行${r}`]
    for (const col of cols) {
      const cell = roomMatrix.cells.find((c) => c.row === r && c.col === col)
      line.push(cell ? cellText(cell, cabinets) : '')
    }
    planRows.push(line)
  }
  planRows.push([], ['图例：空调/柱 = 占位；空格显示类型标记；已上架格显示 柜名(类型)'])
  const ws1 = XLSX.utils.aoa_to_sheet(planRows)
  ws1['!cols'] = [{ wch: 10 }, ...cols.map(() => ({ wch: 16 }))]
  XLSX.utils.book_append_sheet(wb, ws1, '机房平面图')

  // ---- Sheet2: 机柜类型清单（类型/数量/单柜功率/总功率） ----
  const typeRows: (string | number)[][] = [['机柜类型', '数量', '单柜功率(W)', '总功率(W)', '总功率上限(W)']]
  const byType = new Map<string, RackCabinet[]>()
  for (const c of cabinets) {
    const arr = byType.get(c.type) || []
    arr.push(c)
    byType.set(c.type, arr)
  }
  for (const [type, cabs] of byType) {
    const used = cabs.reduce((s, c) => s + c.devices.reduce((x, d) => x + d.power_watts, 0), 0)
    const limit = cabs.reduce((s, c) => s + c.power_limit, 0)
    const single = cabs.length > 0 ? Math.round(limit / cabs.length) : 0
    typeRows.push([typeLabel(type), cabs.length, single, used, limit])
  }
  const ws2 = XLSX.utils.aoa_to_sheet(typeRows)
  ws2['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, ws2, '机柜类型清单')

  // ---- Sheet3: 机房汇总（行列/柜数/已上架柜/总功率） ----
  const mountedIds = new Set(roomMatrix.cells.filter((c) => c.cabinetId != null).map((c) => c.cabinetId as number))
  const mounted = cabinets.filter((c) => mountedIds.has(c.id)).length
  const { total, limit, percent } = rackConfig.powerSummary
  const summaryRows: (string | number)[][] = [
    ['机房汇总'],
    [],
    ['机房名称', roomMatrix.name],
    ['矩阵行数', rows.length],
    ['矩阵列数', cols.length],
    ['矩阵格数', roomMatrix.cells.length],
    ['机柜总数', cabinets.length],
    ['已上架机柜数', mounted],
    ['未上架机柜数', cabinets.length - mounted],
    ['总功率(W)', total],
    ['总功率上限(W)', limit],
    ['功率使用率', `${percent}%`],
    ['柜顶预留U', rackConfig.topReservedU],
    ['每柜GPU数', rackConfig.gpuPerCabinet],
  ]
  const ws3 = XLSX.utils.aoa_to_sheet(summaryRows)
  ws3['!cols'] = [{ wch: 16 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, ws3, '机房汇总')

  return wb
}

/** 落盘：机房设计 Excel（复用 electron 导出 IPC，与 exportRackDesignExcel 落盘方式一致） */
export async function exportRoomDesignExcel(
  projectName: string,
  roomMatrix: RoomMatrixData,
  cabinets: RackCabinet[],
  rackConfig: RoomDesignRackConfig,
  batchName?: string,
  fileName?: string,
): Promise<string> {
  const wb = buildRoomDesignWorkbook(roomMatrix, cabinets, rackConfig)
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outName = fileName ?? `机房设计_${timestamp}.xlsx`
  // batchName 提供时写入版本归档目录 output/<batch>/（与机柜设计导出一致）
  const filePath = batchName
    ? await window.electron?.render?.saveOutputFile(projectName, `output/${batchName}/${outName}`, wbout)
    : await window.electron?.export?.saveFile(projectName, outName, wbout)
  return filePath || ''
}
