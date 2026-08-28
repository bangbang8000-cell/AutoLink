/**
 * M7（AL-E2）：导出机柜设计 Excel（单文件两 sheet）
 * - Sheet1 每机柜设计：逐柜 U 位视图（U 位/设备/类型/功率/占用，从顶部向下）
 * - Sheet2 上机表：全部设备明细 + 功率汇总
 *
 * 原「机柜平面图」sheet 已移至机房设计 Excel（exportRoomDesignExcel Sheet1）。
 * buildRackDesignWorkbook 为纯函数（内存 workbook，便于单测）；exportRackDesignExcel 负责落盘。
 */
import * as XLSX from 'xlsx'
import type { RackCabinet, RackDevice } from '@/stores/rack.store'

/** 纯函数：构建机柜设计工作簿（两 sheet：每机柜设计 / 上机表） */
export function buildRackDesignWorkbook(cabinets: RackCabinet[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  // ---- Sheet1: 每机柜设计（U 位视图，从顶部向下） ----
  const designRows: (string | number)[][] = []
  for (const c of cabinets) {
    const usedPower = c.devices.reduce((s, d) => s + d.power_watts, 0)
    const occupiedU = c.devices.reduce((s, d) => s + (d.endU - d.startU + 1), 0)
    designRows.push([`机柜 ${c.name}`, `类型: ${c.type}`, `${c.totalU}U`, `功率上限 ${c.power_limit}W`, `已用功率 ${usedPower}W`, `占用 ${occupiedU}U`])
    designRows.push(['U位', '设备', '类型', '功率(W)', '占用(U)'])
    const firstU = new Map<number, RackDevice>()
    for (const d of c.devices) firstU.set(d.startU, d)
    for (let u = c.totalU; u >= 1; u--) {
      const d = firstU.get(u)
      if (d) {
        designRows.push([`${d.startU}-${d.endU}U`, d.name, d.type, d.power_watts, d.endU - d.startU + 1])
      } else {
        designRows.push([`U${u}`, '', '', '', ''])
      }
    }
    designRows.push([])
  }
  const ws1 = XLSX.utils.aoa_to_sheet(designRows)
  ws1['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 12 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, ws1, '每机柜设计')

  // ---- Sheet2: 上机表（全部设备明细 + 功率汇总） ----
  const mountRows: (string | number)[][] = [['机柜', '机柜类型', '设备', '设备类型', '起始U', '结束U', '占用(U)', '功率(W)']]
  for (const c of cabinets) {
    for (const d of c.devices) {
      mountRows.push([c.name, c.type, d.name, d.type, d.startU, d.endU, d.endU - d.startU + 1, d.power_watts])
    }
  }
  mountRows.push([], ['--- 功率汇总 ---'])
  mountRows.push(['机柜', '机柜类型', '功率上限(W)', '已用功率(W)', '使用率', '状态'])
  let totalUsed = 0
  let totalLimit = 0
  for (const c of cabinets) {
    const used = c.devices.reduce((s, d) => s + d.power_watts, 0)
    const pct = c.power_limit > 0 ? Math.round((used / c.power_limit) * 100) : 0
    totalUsed += used
    totalLimit += c.power_limit
    mountRows.push([c.name, c.type, c.power_limit, used, `${pct}%`, used > c.power_limit ? '超限' : '正常'])
  }
  const totalPct = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0
  mountRows.push([], ['合计', '', totalLimit, totalUsed, `${totalPct}%`, ''])
  const ws2 = XLSX.utils.aoa_to_sheet(mountRows)
  ws2['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, ws2, '上机表')

  return wb
}

export async function exportRackDesignExcel(
  projectName: string,
  cabinets: RackCabinet[],
  batchName?: string,
  fileName?: string,
): Promise<string> {
  const wb = buildRackDesignWorkbook(cabinets)
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outName = fileName ?? `机柜设计_${timestamp}.xlsx`
  // batchName 提供时写入版本归档目录 output/<batchName>/（改布局前归档当前设计）
  const filePath = batchName
    ? await window.electron?.render?.saveOutputFile(projectName, `output/${batchName}/${outName}`, wbout)
    : await window.electron?.export?.saveFile(projectName, outName, wbout)
  return filePath || ''
}
