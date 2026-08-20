/**
 * 打磨轮（v1.5 / AL-O1d）：图形产物生成
 *  - 机房-机柜布局图（roomLayoutSvg → PNG）
 *  - 每柜设备上架图（rackElevationSvg → PNG）
 * 复用 rack.store/room.store 数据，纯 SVG 字符串 → canvas → PNG base64（无新依赖）。
 */
import { useRoomStore } from '@/stores/room.store'
import { useRackStore, RACK_TYPE_COLORS, CABINET_TYPE_LABELS, type RackCabinet } from '@/stores/rack.store'

/** SVG 字符串 → PNG base64（白底） */
export function svgToPngBase64(svg: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('canvas 不可用'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png').split(',')[1] ?? '')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 渲染失败'))
    }
    img.src = url
  })
}

const CELL_W = 64
const CELL_H = 48
const CELL_GAP = 3
const LABEL_W = 34
const LABEL_H = 24

const ROOM_FILL: Record<string, { bg: string; text: string; border: string }> = {
  gpu: RACK_TYPE_COLORS.gpu,
  network: RACK_TYPE_COLORS.network,
  storage: RACK_TYPE_COLORS.storage,
  compute: RACK_TYPE_COLORS.compute,
  power: RACK_TYPE_COLORS.power,
  combined: { bg: '#f3e8ff', text: '#7e22ce', border: '#c084fc' },
  empty: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
}

/** 机房-机柜布局图 SVG（镜像 RoomMatrixView：格子类型配色 + 机柜名） */
export function roomLayoutSvg(): string {
  const art = roomLayoutArt()
  return art ? art.svg : ''
}

/** 机房-机柜布局图（SVG + 尺寸，供转 PNG） */
export function roomLayoutArt(): { svg: string; width: number; height: number } | null {
  const { matrix } = useRoomStore.getState()
  const cabinets = useRackStore.getState().cabinets
  if (!matrix) return null
  const rows = [...matrix.rows].sort()
  const cols = [...matrix.cols].sort((a, b) => a - b)
  const width = LABEL_W + cols.length * (CELL_W + CELL_GAP) + CELL_GAP
  const height = LABEL_H + rows.length * (CELL_H + CELL_GAP) + CELL_GAP
  const cabName = new Map(cabinets.map((c) => [c.id, c.name]))
  const rowIndex = new Map(rows.map((r, i) => [r, i]))

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Segoe UI,Microsoft YaHei,sans-serif">`
  s += `<rect width="${width}" height="${height}" fill="#ffffff"/>`
  cols.forEach((c, ci) => {
    s += `<text x="${LABEL_W + ci * (CELL_W + CELL_GAP) + CELL_W / 2}" y="15" text-anchor="middle" font-size="11" font-weight="bold" fill="#6b7280">${c}</text>`
  })
  rows.forEach((r, ri) => {
    s += `<text x="${LABEL_W - 6}" y="${LABEL_H + ri * (CELL_H + CELL_GAP) + CELL_H / 2 + 4}" text-anchor="end" font-size="11" font-weight="bold" fill="#6b7280">${r}</text>`
  })
  for (const cell of matrix.cells) {
    const ri = rowIndex.get(cell.row)
    const ci = cols.indexOf(cell.col)
    if (ri == null || ci < 0) continue
    const x = LABEL_W + ci * (CELL_W + CELL_GAP)
    const y = LABEL_H + ri * (CELL_H + CELL_GAP)
    const color = cell.placeholder ? { bg: '#e5e7eb', text: '#4b5563', border: '#9ca3af' } : ROOM_FILL[cell.type] || ROOM_FILL.empty
    const label = cell.placeholder
      ? (cell.placeholder === 'ac' ? '空调' : '柱子')
      : cell.cabinetId != null
        ? (cabName.get(cell.cabinetId) ?? `${cell.row}${cell.col}`)
        : (cell.type === 'empty' ? '' : CABINET_TYPE_LABELS[cell.type as keyof typeof CABINET_TYPE_LABELS] ?? '')
    s += `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" rx="3" fill="${color.bg}" stroke="${cell.cabinetId != null ? '#2563eb' : color.border}" stroke-width="${cell.cabinetId != null ? 1.5 : 1}"/>`
    s += `<text x="${x + 4}" y="${y + 10}" font-size="8" fill="#6b7280">${cell.row}${cell.col}</text>`
    if (label) {
      s += `<text x="${x + CELL_W / 2}" y="${y + CELL_H / 2 + 4}" text-anchor="middle" font-size="10" font-weight="bold" fill="${color.text}">${label.length > 8 ? label.slice(0, 7) + '…' : label}</text>`
    }
  }
  s += '</svg>'
  return { svg: s, width, height }
}

const RACK_W = 120
const RACK_SLOT = 7
/** 单柜上架图宽/高（供调用方确定 PNG 画布） */
export function rackElevationSize(cabinet: RackCabinet): { width: number; height: number } {
  return { width: RACK_W + 46, height: (cabinet.totalU || 42) * RACK_SLOT + 26 }
}

/** 单柜设备上架图 SVG（镜像 RackTab basic：U 标尺 + 设备块） */
export function rackElevationSvg(cabinet: RackCabinet): string {
  const totalU = cabinet.totalU || 42
  const height = totalU * RACK_SLOT + 26
  const devices = cabinet.devices
  const deviceColor = (type: string) => {
    const t = type.toLowerCase()
    if (t.includes('gpu')) return '#3b82f6'
    if (t.includes('存储') || t.includes('storage')) return '#22c55e'
    if (t.includes('switch') || t.includes('交换机')) return '#f59e0b'
    if (t.includes('通算') || t.includes('compute')) return '#a855f7'
    return '#94a3b8'
  }
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${RACK_W + 46}" height="${height}" font-family="Segoe UI,Microsoft YaHei,sans-serif">`
  s += `<rect width="${RACK_W + 46}" height="${height}" fill="#ffffff"/>`
  s += `<text x="4" y="14" font-size="12" font-weight="bold" fill="#374151">${cabinet.name}</text>`
  s += `<text x="4" y="26" font-size="9" fill="#6b7280">${CABINET_TYPE_LABELS[cabinet.type] ?? cabinet.type} · ${totalU}U</text>`
  // U 标尺
  for (let u = totalU; u >= 1; u--) {
    const y = 30 + (totalU - u) * RACK_SLOT
    s += `<text x="${RACK_W + 6}" y="${y + RACK_SLOT - 2}" font-size="7" fill="#9ca3af">${u}</text>`
  }
  // 设备块
  for (const d of devices) {
    const y = 30 + (totalU - d.endU) * RACK_SLOT
    const h = (d.endU - d.startU + 1) * RACK_SLOT - 1
    const color = deviceColor(d.type)
    s += `<rect x="24" y="${y}" width="${RACK_W - 24}" height="${Math.max(h, 4)}" rx="1.5" fill="${color}" opacity="0.85"/>`
    if (h >= 12) {
      s += `<text x="28" y="${y + 10}" font-size="8" fill="#ffffff" font-weight="bold">${d.name}</text>`
    }
  }
  // 柜框
  s += `<rect x="24" y="30" width="${RACK_W - 24}" height="${totalU * RACK_SLOT}" fill="none" stroke="#cbd5e1" stroke-width="1"/>`
  s += '</svg>'
  return s
}
