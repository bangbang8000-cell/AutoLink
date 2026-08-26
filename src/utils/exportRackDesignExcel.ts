/**
 * M4: 导出机柜设计 Excel（单文件多 sheet）
 * - Sheet1 机柜平面图：机房矩阵网格（类型/柜号/占用）+ 机柜汇总
 * - Sheet2 每机柜设计：逐柜 U 位视图（U 位/设备/类型/功率，从顶部向下）
 * - Sheet3 上机表：全部设备明细
 */
import * as XLSX from 'xlsx'
import type { RackCabinet, RackDevice } from '@/stores/rack.store'
import type { RoomMatrixData } from '@/stores/room.store'

export async function exportRackDesignExcel(
  projectName: string,
  cabinets: RackCabinet[],
  matrix: RoomMatrixData | null,
): Promise<string> {
  const wb = XLSX.utils.book_new()

  // ---- Sheet1: 机柜平面图 ----
  const planRows: (string | number)[][] = [
    ['机柜平面图', `项目: ${projectName}`, `机柜数: ${cabinets.length}`, `生成时间: ${new Date().toLocaleString()}`],
    [],
  ]
  if (matrix && matrix.rows.length > 0) {
    planRows.push(['', ...matrix.cols.map((c) => `列${c}`)])
    for (const row of matrix.rows) {
      const line: (string | number)[] = [`行${row}`]
      for (const col of matrix.cols) {
        const cell = matrix.cells.find((c) => c.row === row && c.col === col)
        const cab = cell?.cabinetId != null ? cabinets.find((c) => c.id === cell.cabinetId) : null
        if (cell?.placeholder) {
          line.push(cell.placeholder === 'ac' ? '空调' : '柱')
        } else if (cab) {
          line.push(`${cab.name}(${cab.type})\n${cab.devices.length}台·${cab.power_limit}W`)
        } else if (cell) {
          line.push(cell.type)
        } else {
          line.push('')
        }
      }
      planRows.push(line)
    }
  }
  planRows.push([], ['机柜汇总'])
  planRows.push(['机柜', '类型', 'U位', '设备数', '功率上限(W)', '已用功率(W)'])
  for (const c of cabinets) {
    const usedPower = c.devices.reduce((s, d) => s + d.power_watts, 0)
    planRows.push([c.name, c.type, `${c.totalU}U`, c.devices.length, c.power_limit, usedPower])
  }
  const ws1 = XLSX.utils.aoa_to_sheet(planRows)
  ws1['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws1, '机柜平面图')

  // ---- Sheet2: 每机柜设计（U 位视图，从顶部向下） ----
  const designRows: (string | number)[][] = []
  for (const c of cabinets) {
    designRows.push([`机柜 ${c.name}`, `类型: ${c.type}`, `${c.totalU}U`, `功率上限 ${c.power_limit}W`])
    designRows.push(['U位', '设备', '类型', '功率(W)'])
    const firstU = new Map<number, RackDevice>()
    for (const d of c.devices) firstU.set(d.startU, d)
    for (let u = c.totalU; u >= 1; u--) {
      const d = firstU.get(u)
      if (d) {
        designRows.push([`${d.startU}-${d.endU}U`, d.name, d.type, d.power_watts])
      } else {
        designRows.push([`U${u}`, '', '', ''])
      }
    }
    designRows.push([])
  }
  const ws2 = XLSX.utils.aoa_to_sheet(designRows)
  ws2['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws2, '每机柜设计')

  // ---- Sheet3: 上机表（全部设备明细） ----
  const mountRows: (string | number)[][] = [['机柜', '机柜类型', '设备', '设备类型', '起始U', '结束U', '功率(W)']]
  for (const c of cabinets) {
    for (const d of c.devices) {
      mountRows.push([c.name, c.type, d.name, d.type, d.startU, d.endU, d.power_watts])
    }
  }
  const ws3 = XLSX.utils.aoa_to_sheet(mountRows)
  ws3['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, ws3, '上机表')

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `机柜设计_${timestamp}.xlsx`
  const filePath = await window.electron?.export?.saveFile(projectName, fileName, wbout)
  return filePath || ''
}
