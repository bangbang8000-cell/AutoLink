/**
 * PRD v3.4 / M2（AL-3D1/2/3）：等距视图 旋转 / 缩放 / 状态保持 Store
 *
 * - 旋转：角度态驱动（rotation，0-359 环绕），投影时绕 Y 轴旋转（不引入 Three.js）
 * - 缩放：scale clamp 0.5-2.0，变换原点居中（由组件 transform 处理）
 * - 状态保持：按机柜（cabinetId）独立存 {rotation, scale}，会话级（不持久化到磁盘）
 *   切柜时按柜保持（切回时视角保留），新柜回落默认值
 */
import { create } from 'zustand'

// ---- 常量 ----
export const ROTATE_STEP = 90   // 左右 90° 步进
export const NUDGE_STEP = 5     // 连续微调步长（°）
export const MIN_SCALE = 0.5    // 缩放下限
export const MAX_SCALE = 2.0    // 缩放上限
export const DEFAULT_ROTATION = 0
export const DEFAULT_SCALE = 1

// ---- 纯函数：旋转角度（0-359 环绕） ----
export function normalizeRotation(angle: number): number {
  if (!Number.isFinite(angle)) return DEFAULT_ROTATION
  const a = ((Math.round(angle) % 360) + 360) % 360
  return a
}

export function rotateBy(angle: number, delta: number): number {
  return normalizeRotation(angle + delta)
}

// ---- 纯函数：缩放 clamp ----
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function zoomBy(scale: number, delta: number): number {
  return clampScale(Math.round((scale + delta) * 100) / 100)
}

// ---- 纯函数：等距投影（含绕 Y 轴旋转） ----
export const ISO_COS30 = 0.866
export const ISO_SIN30 = 0.5

/**
 * 3D 坐标 → 屏幕 2D 坐标（等距 30° 投影）
 * 先绕 Y 轴旋转 rotationDeg，再投影：screenX=(xr-zr)*cos30, screenY=(xr+zr)*sin30-y
 * rotation=0 与旧公式（(x-z)*0.866, (x+z)*0.5-y）完全一致；180° 为中心对称翻转
 */
export function isoProject(x: number, y: number, z: number, rotationDeg: number): { sx: number; sy: number } {
  const rad = (rotationDeg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  // 绕 Y 轴旋转（XZ 平面）
  const xr = x * c + z * s
  const zr = -x * s + z * c
  return { sx: (xr - zr) * ISO_COS30, sy: (xr + zr) * ISO_SIN30 - y }
}

export interface IsometricViewEntry {
  rotation: number
  scale: number
}

interface IsometricViewState {
  /** 按机柜维度存视角（cabinetId -> view） */
  views: Record<number, IsometricViewEntry>
  getView: (cabinetId: number) => IsometricViewEntry
  setRotation: (cabinetId: number, rotation: number) => void
  setScale: (cabinetId: number, scale: number) => void
  resetView: (cabinetId: number) => void
}

export const useIsometricViewStore = create<IsometricViewState>()((set, get) => ({
  views: {},

  getView: (cabinetId) => {
    const v = get().views[cabinetId]
    if (!v) return { rotation: DEFAULT_ROTATION, scale: DEFAULT_SCALE }
    return { rotation: normalizeRotation(v.rotation), scale: clampScale(v.scale) }
  },

  setRotation: (cabinetId, rotation) =>
    set((s) => ({
      views: {
        ...s.views,
        [cabinetId]: {
          rotation: normalizeRotation(rotation),
          scale: s.views[cabinetId]?.scale ?? DEFAULT_SCALE,
        },
      },
    })),

  setScale: (cabinetId, scale) =>
    set((s) => ({
      views: {
        ...s.views,
        [cabinetId]: {
          scale: clampScale(scale),
          rotation: s.views[cabinetId]?.rotation ?? DEFAULT_ROTATION,
        },
      },
    })),

  resetView: (cabinetId) =>
    set((s) => {
      const next = { ...s.views }
      delete next[cabinetId]
      return { views: next }
    }),
}))
