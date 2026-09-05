/**
 * AL v5.0.6「3D 可视化」— 机房矩阵 → 3D 世界坐标纯函数工具
 *
 * 只为可测试性提供纯函数（无 store / DOM 依赖），并与现有的 2D 平面保持一致：
 *   - 尺寸常量派生自 RackIsometricView（CAB_WIDTH=60 / CAB_DEPTH=40 / U_HEIGHT=4），
 *     统一缩放到 WebGL 友好尺度（÷10）
 *   - roomToWorld：矩阵行/列 → 3D 世界中心坐标（X=列方向，Z=行方向，居中于原点，排间留冷/热通道）
 *   - powerToHeatColor：功率占比 → 热力材质色（复用 datacenter.store.getPowerColor 阈值，保证 2D↔3D 一致）
 */
import { getPowerColor } from '@/stores/datacenter.store'

/** 机柜足迹宽度（X 方向，单位：world）= CAB_WIDTH/10 */
export const ROOM_CABINET_WIDTH = 60 / 10
/** 机柜足迹深度（Z 方向，单位：world）= CAB_DEPTH/10 */
export const ROOM_CABINET_DEPTH = 40 / 10
/** 每 U 高度（单位：world）= U_HEIGHT/10 */
export const ROOM_U_HEIGHT = 4 / 10
/** 同排相邻柜列间距（X 方向） */
export const ROOM_CABINET_GAP = 2
/** 排间通道间距（Z 方向，冷/热通道） */
export const ROOM_AISLE_SPACING = 8

/** 3D 平面坐标（X 列向、Z 行向；Y 高度由柜高单独决定） */
export interface RoomWorldPos {
  x: number
  z: number
}

/**
 * 将矩阵格子的行/列索引映射为 3D XZ 世界中心坐标。
 * 整张网格以原点为中心；列沿 X 展开（柜宽 + 柜间距），行沿 Z 展开（柜深 + 通道间距），
 * 从而在排与排之间自然形成冷/热通道。
 */
export function roomToWorld(
  rowIndex: number,
  colIndex: number,
  rowCount: number,
  colCount: number,
): RoomWorldPos {
  const totalX = (colCount - 1) * (ROOM_CABINET_WIDTH + ROOM_CABINET_GAP) + ROOM_CABINET_WIDTH
  const totalZ = (rowCount - 1) * (ROOM_CABINET_DEPTH + ROOM_AISLE_SPACING) + ROOM_CABINET_DEPTH
  const left = -totalX / 2
  const top = -totalZ / 2
  const x = left + colIndex * (ROOM_CABINET_WIDTH + ROOM_CABINET_GAP) + ROOM_CABINET_WIDTH / 2
  const z = top + rowIndex * (ROOM_CABINET_DEPTH + ROOM_AISLE_SPACING) + ROOM_CABINET_DEPTH / 2
  return { x, z }
}

/**
 * 功率占比（%）→ 3D 热力材质色。复用 getPowerColor 阈值保证与 2D 热力一致：
 *   <60% 绿 / 60-79% 黄 / ≥80% 红；percent 为 undefined（无功率数据）时返回中性灰。
 */
export function powerToHeatColor(percent: number | undefined): string {
  if (percent == null) return '#9ca3af'
  return getPowerColor(percent).stroke
}