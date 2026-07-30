/**
 * AutoLink V2.4.7 — 机房平面布局 Store
 *
 * 功能：
 *   - 基于 RackStore 的机柜列表，自动计算机房平面布局
 *   - 每排 N 个机柜（默认 8），冷热通道交替
 *   - 功率热力图：绿 <60% / 黄 <80% / 红 ≥80%
 *   - 机房统计：机柜数 / 总功率 / 散热需求 / PUE
 */
import { create } from 'zustand'
import { useRackStore, type RackCabinet } from './rack.store'

/** 机柜在机房中的位置 */
export interface CabinetPlacement {
  id: number
  name: string
  type: string
  row: number              // 排号 (0-indexed)
  col: number              // 列号 (0-indexed)
  x: number                // 画布 X 坐标 (px)
  y: number                // 画布 Y 坐标 (px)
  width: number            // 机柜宽度 (px)
  height: number           // 机柜高度 (px)
  facing: 'north' | 'south' // 朝向（冷通道侧）
  powerUsage: { used: number; limit: number; percent: number; exceeded: boolean }
  deviceCount: number
}

/** 机房排信息 */
export interface CabinetRowInfo {
  row: number
  y: number
  height: number
  cabinetCount: number
  aisleType: 'cold' | 'hot'  // 该排与下一排之间的通道类型
}

/** 机房统计 */
export interface DataCenterStats {
  totalCabinets: number
  totalDevices: number
  totalPowerKW: number
  avgPowerPerCabinetKW: number
  maxPowerCabinetKW: number
  coolingLoadKW: number     // 制冷负荷（按 PUE 1.4 估算）
  totalAreaSqm: number      // 机房面积（m²）
  powerDensity: number      // 功率密度 (kW/m²)
  exceededCabinets: number  // 超功率机柜数
}

/** 布局参数 */
export interface LayoutParams {
  cabinetsPerRow: number    // 每排机柜数（默认 8）
  cabinetWidth: number      // 机柜宽度 (px, 默认 60)
  cabinetHeight: number     // 机柜高度 (px, 默认 100)
  rowGap: number            // 排间距 (px, 默认 60，含冷热通道)
  sidePadding: number       // 两侧留白 (px, 默认 40)
  topPadding: number        // 顶部留白 (px, 默认 40)
}

const DEFAULT_PARAMS: LayoutParams = {
  cabinetsPerRow: 8,
  cabinetWidth: 60,
  cabinetHeight: 100,
  rowGap: 60,
  sidePadding: 40,
  topPadding: 40,
}

/** 功率热力颜色 */
export function getPowerColor(percent: number): { fill: string; stroke: string; text: string } {
  if (percent >= 80) {
    return { fill: '#fee2e2', stroke: '#dc2626', text: '#991b1b' }  // 红
  }
  if (percent >= 60) {
    return { fill: '#fef3c7', stroke: '#d97706', text: '#92400e' }  // 黄
  }
  return { fill: '#dcfce7', stroke: '#16a34a', text: '#166534' }    // 绿
}

interface DataCenterState {
  placements: CabinetPlacement[]
  rows: CabinetRowInfo[]
  stats: DataCenterStats | null
  params: LayoutParams
  selectedCabinetId: number | null

  computeLayout: (cabinets: RackCabinet[]) => void
  setParams: (params: Partial<LayoutParams>) => void
  selectCabinet: (id: number | null) => void
}

export const useDataCenterStore = create<DataCenterState>()((set, get) => ({
  placements: [],
  rows: [],
  stats: null,
  params: { ...DEFAULT_PARAMS },
  selectedCabinetId: null,

  computeLayout: (cabinets) => {
    const { params } = get()
    const placements: CabinetPlacement[] = []
    const rows: CabinetRowInfo[] = []

    const rowCount = Math.ceil(cabinets.length / params.cabinetsPerRow)

    for (let i = 0; i < cabinets.length; i++) {
      const cab = cabinets[i]
      const row = Math.floor(i / params.cabinetsPerRow)
      const col = i % params.cabinetsPerRow

      // 偶数排朝南（冷通道在上方），奇数排朝北（冷通道在下方）
      const facing: 'north' | 'south' = row % 2 === 0 ? 'south' : 'north'

      const x = params.sidePadding + col * params.cabinetWidth
      const y = params.topPadding + row * (params.cabinetHeight + params.rowGap)

      // 功率使用
      const used = cab.devices.reduce((sum, d) => sum + (d.power_watts || 0), 0)
      const limit = cab.power_limit || 6000
      const percent = limit > 0 ? Math.round((used / limit) * 100) : 0
      const exceeded = percent >= 100

      placements.push({
        id: cab.id,
        name: cab.name,
        type: cab.type,
        row,
        col,
        x,
        y,
        width: params.cabinetWidth,
        height: params.cabinetHeight,
        facing,
        powerUsage: { used, limit, percent, exceeded },
        deviceCount: cab.devices.length,
      })
    }

    // 排信息
    for (let r = 0; r < rowCount; r++) {
      const y = params.topPadding + r * (params.cabinetHeight + params.rowGap)
      const cabinetCount = cabinets.filter((_, i) => Math.floor(i / params.cabinetsPerRow) === r).length
      rows.push({
        row: r,
        y,
        height: params.cabinetHeight,
        cabinetCount,
        aisleType: r % 2 === 0 ? 'cold' : 'hot',
      })
    }

    // 统计
    const totalPowerW = cabinets.reduce(
      (sum, cab) => sum + cab.devices.reduce((s, d) => s + (d.power_watts || 0), 0),
      0,
    )
    const totalDevices = cabinets.reduce((sum, cab) => sum + cab.devices.length, 0)
    const totalPowerKW = totalPowerW / 1000
    const maxPowerKW = Math.max(
      ...cabinets.map((c) => c.devices.reduce((s, d) => s + (d.power_watts || 0), 0) / 1000),
      0,
    )
    const exceededCabinets = placements.filter((p) => p.powerUsage.exceeded).length
    const canvasWidth = params.sidePadding * 2 + params.cabinetsPerRow * params.cabinetWidth
    const canvasHeight = params.topPadding * 2 + rowCount * (params.cabinetHeight + params.rowGap)
    // 机房面积：1px ≈ 1cm，转换为 m²
    const totalAreaSqm = (canvasWidth * canvasHeight) / 10000

    const stats: DataCenterStats = {
      totalCabinets: cabinets.length,
      totalDevices,
      totalPowerKW: Math.round(totalPowerKW * 100) / 100,
      avgPowerPerCabinetKW: cabinets.length > 0 ? Math.round((totalPowerKW / cabinets.length) * 100) / 100 : 0,
      maxPowerCabinetKW: Math.round(maxPowerKW * 100) / 100,
      coolingLoadKW: Math.round(totalPowerKW * 0.4 * 100) / 100,  // PUE 1.4 → 制冷占 40%
      totalAreaSqm: Math.round(totalAreaSqm * 100) / 100,
      powerDensity: totalAreaSqm > 0 ? Math.round((totalPowerKW / totalAreaSqm) * 100) / 100 : 0,
      exceededCabinets,
    }

    set({ placements, rows, stats })
  },

  setParams: (newParams) => {
    const params = { ...get().params, ...newParams }
    set({ params })
    // 重新计算布局
    const cabinets = useRackStore.getState().cabinets
    if (cabinets.length > 0) {
      get().computeLayout(cabinets)
    }
  },

  selectCabinet: (id) => set({ selectedCabinetId: id }),
}))
