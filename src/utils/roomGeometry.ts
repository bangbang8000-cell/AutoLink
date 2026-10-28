/**
 * AL v5.5.7（A19 / FR-A19）— 机房几何参数 → 平面 mm 逻辑坐标
 *
 * 与 backend/room.py RoomGeometry 同源（同一份 JSON 字段名与取值范围）：
 *   - geometry 存米（0.6 / 1.2 / 2.0|2.2 / 1.2|1.35|1.6 / rowCount / cabinetsPerRow）
 *   - 平面绘制统一用毫米逻辑坐标，缩放交给 <svg viewBox>，不再有 px 硬编码
 *   - 柜宽:柜深 = 600:1200 = 1:2（A19 判据）
 *
 * 说明：字体/描边/角标等装饰尺寸由柜宽按旧像素版的相同比例派生（每格 64px → cellW mm），
 * 从而在 viewBox 缩放下保持与历史画面完全一致的观感。
 */
export const MM_PER_M = 1000

/** 柜宽（m）——与 backend room.py GEOMETRY_CABINET_WIDTH 同值 */
export const GEOMETRY_CABINET_WIDTH = 0.6
/** 柜深（m）——与 backend room.py GEOMETRY_CABINET_DEPTH 同值 */
export const GEOMETRY_CABINET_DEPTH = 1.2
/** 可选柜高（m）：42U ↔ 2.0 / 47U ↔ 2.2 */
export const GEOMETRY_CABINET_HEIGHTS = [2.0, 2.2] as const
/** 柜高（m）→ 标准 U 数（A20 / T-B4-05：42U ↔ 2.0 m、47U ↔ 2.2 m） */
export const GEOMETRY_CABINET_U: Readonly<Record<number, number>> = { 2.0: 42, 2.2: 47 }
/** 可选通道宽（m）：A19 三档 */
export const GEOMETRY_AISLE_WIDTHS = [1.2, 1.35, 1.6] as const
/** 行数范围 */
export const GEOMETRY_ROW_RANGE = [1, 26] as const
/** 每排列数范围（A22：上限 24） */
export const GEOMETRY_CABINETS_PER_ROW_RANGE = [6, 24] as const

/** 机房几何参数（对齐 backend RoomGeometry.to_dict：米制、camelCase） */
export interface RoomGeometryData {
  cabinetWidth: number
  cabinetDepth: number
  cabinetHeight: number
  aisleWidth: number
  rowCount: number
  cabinetsPerRow: number
}

/** 几何参数缺省值（v1 布局无 geometry 时补齐；行列数由矩阵实际维度覆盖） */
export function defaultGeometry(
  rowCount: number = GEOMETRY_ROW_RANGE[0],
  cabinetsPerRow: number = GEOMETRY_CABINETS_PER_ROW_RANGE[0],
): RoomGeometryData {
  return {
    cabinetWidth: GEOMETRY_CABINET_WIDTH,
    cabinetDepth: GEOMETRY_CABINET_DEPTH,
    cabinetHeight: GEOMETRY_CABINET_HEIGHTS[0],
    aisleWidth: GEOMETRY_AISLE_WIDTHS[0],
    rowCount: Math.max(1, Math.round(rowCount)),
    cabinetsPerRow: Math.max(1, Math.round(cabinetsPerRow)),
  }
}

type GeometrySource = { rows?: string[]; cols?: number[]; geometry?: Partial<RoomGeometryData> | null }

function positive(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * 解析矩阵的有效几何参数：
 *   - 行数/每排列数以矩阵实际 rows/cols 为准（几何字段仅作冗余记录）
 *   - 其余尺寸缺失/非法时回落到默认值（v1 布局兼容）
 */
export function resolveGeometry(matrix?: GeometrySource | null): RoomGeometryData {
  const geo = matrix?.geometry ?? {}
  const rows = matrix?.rows?.length
  const cols = matrix?.cols?.length
  return {
    cabinetWidth: positive(geo.cabinetWidth, GEOMETRY_CABINET_WIDTH),
    cabinetDepth: positive(geo.cabinetDepth, GEOMETRY_CABINET_DEPTH),
    cabinetHeight: positive(geo.cabinetHeight, GEOMETRY_CABINET_HEIGHTS[0]),
    aisleWidth: positive(geo.aisleWidth, GEOMETRY_AISLE_WIDTHS[0]),
    rowCount: rows && rows > 0 ? rows : positive(geo.rowCount, GEOMETRY_ROW_RANGE[0]),
    cabinetsPerRow: cols && cols > 0 ? cols : positive(geo.cabinetsPerRow, GEOMETRY_CABINETS_PER_ROW_RANGE[0]),
  }
}

/** 柜高对应的标准 U 数（2.0 m → 42U、2.2 m → 47U；未知高度按 42U） */
export function cabinetUCount(geo?: RoomGeometryData | null): number {
  const h = geo?.cabinetHeight ?? GEOMETRY_CABINET_HEIGHTS[0]
  return GEOMETRY_CABINET_U[h] ?? GEOMETRY_CABINET_U[GEOMETRY_CABINET_HEIGHTS[0]]
}

/** 平面绘制度量（全部为 mm 逻辑坐标） */
export interface PlanMetrics {
  rowCount: number
  colCount: number
  /** 柜宽（mm，A19：600） */
  cellW: number
  /** 柜深（mm，A19：1200） */
  cellH: number
  /** 同排柜间距（mm） */
  gap: number
  /** 排间通道宽（mm，1.2/1.35/1.6 m） */
  aisle: number
  labelW: number
  labelH: number
  widthMm: number
  heightMm: number
  /** 第 ci 列的左边缘 x（mm） */
  colLeft: (ci: number) => number
  /** 第 ri 排的上边缘 y（mm） */
  rowTop: (ri: number) => number
  colLabelX: (ci: number) => number
  colLabelY: number
  rowLabelX: number
  rowLabelY: (ri: number) => number
  /** 通道色带上边缘 y（mm） */
  aisleY: (ri: number) => number
  /** 通道色带宽度（mm） */
  aisleW: number
  aisleTextX: number
  aisleTextDy: number
  /** 通用小间距（旧版 6px） */
  inset: number
  /** 框选最小有效边长（旧版 4px），小于此视为点击 */
  marqueeMin: number
  fontColRow: number
  fontCellMain: number
  fontCellPos: number
  fontAisle: number
  fontBadge: number
  strokeW: number
  strokeWSelected: number
  radius: number
  textDyMain: number
  posTextX: number
  posTextY: number
  badge: { x: number; y: number; w: number; h: number; cx: number; cy: number }
  bar: { x: number; y: number; w: number; h: number }
}

const BASE_CELL_W = 64 // 旧像素版单格宽，用于派生装饰尺寸比例

export function planMetrics(geo: RoomGeometryData, colCount: number, rowCount: number): PlanMetrics {
  const cellW = geo.cabinetWidth * MM_PER_M
  const cellH = geo.cabinetDepth * MM_PER_M
  const aisle = geo.aisleWidth * MM_PER_M
  const u = cellW / BASE_CELL_W
  const gap = 3 * u
  const labelW = 34 * u
  const labelH = cellH / 2

  const colLeft = (ci: number) => labelW + ci * (cellW + gap)
  const rowTop = (ri: number) => labelH + ri * (cellH + gap) + ri * aisle

  return {
    rowCount,
    colCount,
    cellW,
    cellH,
    gap,
    aisle,
    labelW,
    labelH,
    widthMm: labelW + colCount * (cellW + gap) + gap,
    heightMm: labelH + rowCount * (cellH + gap) + rowCount * aisle + gap,
    colLeft,
    rowTop,
    colLabelX: (ci) => colLeft(ci) + cellW / 2,
    colLabelY: labelH - 7 * u,
    rowLabelX: labelW - 6 * u,
    rowLabelY: (ri) => rowTop(ri) + cellH / 2 + 4 * u,
    aisleY: (ri) => rowTop(ri) + cellH + gap / 2,
    aisleW: colCount * (cellW + gap),
    aisleTextX: labelW + 6 * u,
    aisleTextDy: aisle / 2 + 3 * u,
    inset: 6 * u,
    marqueeMin: 4 * u,
    fontColRow: 11 * u,
    fontCellMain: 10 * u,
    fontCellPos: 8 * u,
    fontAisle: 9 * u,
    fontBadge: 6.5 * u,
    strokeW: u,
    strokeWSelected: 2 * u,
    radius: 3 * u,
    textDyMain: 4 * u,
    posTextX: 4 * u,
    posTextY: 10 * u,
    badge: {
      x: cellW - 22 * u,
      y: 2 * u,
      w: 20 * u,
      h: 9 * u,
      cx: cellW - 12 * u,
      cy: 8.8 * u,
    },
    bar: {
      x: 2 * u,
      y: cellH - 5 * u,
      w: cellW - 4 * u,
      h: 3 * u,
    },
  }
}
