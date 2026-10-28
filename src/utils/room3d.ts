/**
 * AL v5.5.8（B4-02 / A20）— 机房矩阵 → 3D 世界坐标纯函数工具
 *
 * 世界单位统一为「米（m）」，尺寸全部取自 roomGeometry 单一事实源，
 * 与 2D 平面（mm 逻辑坐标 + viewBox）保持同一份 geometry，不再各自维护像素/世界单位常量：
 *   - 柜宽/柜深：geometry.cabinetWidth / cabinetDepth（0.6 / 1.2 m）
 *   - 柜高：geometry.cabinetHeight（2.0 / 2.2 m），每 U 高度 = 柜高 / 42
 *   - 排距：柜深 + geometry.aisleWidth（1.2 / 1.35 / 1.6 m 冷/热通道）
 *   - 排数：矩阵 rows.length（geometry.rowCount 与矩阵同源）
 *   - roomToWorld：矩阵行/列 → 3D 世界中心坐标（X=列方向，Z=行方向，居中于原点）
 *   - roomSceneScale / cameraForScale：按场景实际尺寸给出相机与网格尺度（行/列/通道变化时自适配）
 *   - powerToHeatColor：功率占比 → 热力材质色（复用 datacenter.store.getPowerColor 阈值，保证 2D↔3D 一致）
 */
import { getPowerColor } from '@/stores/datacenter.store'
import {
  GEOMETRY_AISLE_WIDTHS,
  GEOMETRY_CABINET_DEPTH,
  GEOMETRY_CABINET_HEIGHTS,
  GEOMETRY_CABINET_WIDTH,
  cabinetUCount,
  defaultGeometry,
  type RoomGeometryData,
} from '@/utils/roomGeometry'

/** 机柜足迹宽度（X 方向，单位：m） */
export const ROOM_CABINET_WIDTH = GEOMETRY_CABINET_WIDTH
/** 机柜足迹深度（Z 方向，单位：m） */
export const ROOM_CABINET_DEPTH = GEOMETRY_CABINET_DEPTH
/** 标准机柜 U 数（默认柜高 2.0 m） */
export const ROOM_U_COUNT = 42
/** 每 U 高度（单位：m），默认柜高 2.0 m 折算 */
export const ROOM_U_HEIGHT = GEOMETRY_CABINET_HEIGHTS[0] / ROOM_U_COUNT
/** 同排相邻柜列间距（X 方向，单位：m） */
export const ROOM_CABINET_GAP = 0.1
/** 排间通道默认间距（Z 方向，单位：m），实际以 geometry.aisleWidth 为准 */
export const ROOM_AISLE_SPACING = GEOMETRY_AISLE_WIDTHS[0]

/** 3D 平面坐标（X 列向、Z 行向；Y 高度由柜高单独决定） */
export interface RoomWorldPos {
  x: number
  z: number
}

/** 按柜型柜高折算每 U 高度（m）：2.0 m/42U ≈ 0.0476、2.2 m/47U ≈ 0.0468 */
export function uHeight(geo?: RoomGeometryData | null): number {
  const height = geo?.cabinetHeight ?? GEOMETRY_CABINET_HEIGHTS[0]
  return height / (geo ? cabinetUCount(geo) : ROOM_U_COUNT)
}

/**
 * 将矩阵格子的行/列索引映射为 3D XZ 世界中心坐标。
 * 整张网格以原点为中心；列沿 X 展开（柜宽 + 柜间距），行沿 Z 展开（柜深 + 通道宽），
 * 从而在排与排之间自然形成冷/热通道。
 */
export function roomToWorld(
  rowIndex: number,
  colIndex: number,
  rowCount: number,
  colCount: number,
  geo?: RoomGeometryData | null,
): RoomWorldPos {
  const g = geo ?? defaultGeometry(rowCount, colCount)
  const stepX = g.cabinetWidth + ROOM_CABINET_GAP
  const stepZ = g.cabinetDepth + g.aisleWidth
  const totalX = (colCount - 1) * stepX + g.cabinetWidth
  const totalZ = (rowCount - 1) * stepZ + g.cabinetDepth
  const left = -totalX / 2
  const top = -totalZ / 2
  const x = left + colIndex * stepX + g.cabinetWidth / 2
  const z = top + rowIndex * stepZ + g.cabinetDepth / 2
  return { x, z }
}

/** 场景包围尺寸（单位：m） */
export interface RoomSceneScale {
  /** X 方向总宽（含柜间距） */
  width: number
  /** Z 方向总深（含排间通道） */
  depth: number
  /** 柜高 */
  height: number
  /** 水平对角线跨度，用于相机/网格自适应 */
  span: number
}

/** 按 geometry + 矩阵行列数折算 3D 场景尺寸（平面与 3D 共用同一 geometry） */
export function roomSceneScale(
  geo: RoomGeometryData,
  rowCount: number,
  colCount: number,
): RoomSceneScale {
  const width = Math.max(colCount, 1) * (geo.cabinetWidth + ROOM_CABINET_GAP) - ROOM_CABINET_GAP
  const depth =
    Math.max(rowCount, 1) * (geo.cabinetDepth + geo.aisleWidth) - geo.aisleWidth
  return {
    width,
    depth,
    height: geo.cabinetHeight,
    span: Math.max(width, depth, geo.cabinetHeight),
  }
}

/** 相机与轨道控制参数（按场景尺寸自适应，避免大机房出画/小机房过远） */
export interface RoomCameraParams {
  position: [number, number, number]
  target: [number, number, number]
  minDistance: number
  maxDistance: number
  far: number
}

export function cameraForScale(scale: RoomSceneScale): RoomCameraParams {
  const span = scale.span
  return {
    position: [0, span * 0.75, span * 1.15],
    target: [0, scale.height * 0.5, 0],
    minDistance: span * 0.15,
    maxDistance: span * 4,
    far: Math.max(200, span * 8),
  }
}

/**
 * 功率占比（%）→ 3D 热力材质色。复用 getPowerColor 阈值保证与 2D 热力一致：
 *   <60% 绿 / 60-79% 黄 / ≥80% 红；percent 为 undefined（无功率数据）时返回中性灰。
 */
export function powerToHeatColor(percent: number | undefined): string {
  if (percent == null) return '#9ca3af'
  return getPowerColor(percent).stroke
}
