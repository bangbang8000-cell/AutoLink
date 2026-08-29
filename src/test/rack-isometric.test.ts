/**
 * PRD v3.4 / M2（AL-3D1/2/3）：等距视图旋转 / 缩放 / 状态保持 单测
 * - D-1 旋转角度映射（90° 步进 + 连续微调 0-359 环绕）
 * - D-2 缩放 clamp（0.5-2.0）
 * - D-3 状态保持（会话内，视图切换/重渲染/切柜）
 * - D-4 默认值（rotation=0 / scale=1）
 * - D-5 角度驱动投影映射（等距风格不引入 Three.js）
 * 纯函数 + store 单测（组件测试退化纯函数，符合开发计划风险预案）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_ROTATION,
  DEFAULT_SCALE,
  MIN_SCALE,
  MAX_SCALE,
  ROTATE_STEP,
  NUDGE_STEP,
  normalizeRotation,
  rotateBy,
  clampScale,
  zoomBy,
  isoProject,
  useIsometricViewStore,
} from '@/stores/isometricView.store'

describe('D-1 旋转角度映射（90° 步进 + 连续微调环绕）', () => {
  it('D-1a 90° 步进正转环绕：0→90→180→270→0', () => {
    expect(ROTATE_STEP).toBe(90)
    expect(rotateBy(0, ROTATE_STEP)).toBe(90)
    expect(rotateBy(90, ROTATE_STEP)).toBe(180)
    expect(rotateBy(180, ROTATE_STEP)).toBe(270)
    expect(rotateBy(270, ROTATE_STEP)).toBe(0)
  })

  it('D-1b 90° 步进反转环绕：0→270→180→90→0', () => {
    expect(rotateBy(0, -ROTATE_STEP)).toBe(270)
    expect(rotateBy(270, -ROTATE_STEP)).toBe(180)
    expect(rotateBy(180, -ROTATE_STEP)).toBe(90)
    expect(rotateBy(90, -ROTATE_STEP)).toBe(0)
  })

  it('D-1c 连续微调边界（0-359 环绕，NUDGE_STEP 生效）', () => {
    expect(NUDGE_STEP).toBeGreaterThan(0)
    expect(rotateBy(0, NUDGE_STEP)).toBe(NUDGE_STEP)
    expect(rotateBy(355, NUDGE_STEP * 2)).toBe(5)
    expect(rotateBy(0, -NUDGE_STEP)).toBe(360 - NUDGE_STEP)
    expect(normalizeRotation(360)).toBe(0)
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(720)).toBe(0)
    expect(normalizeRotation(359)).toBe(359)
  })

  it('D-1d 非整数/非法角度兜底归一（四舍五入 + 环绕）', () => {
    expect(normalizeRotation(90.5)).toBe(91)
    expect(normalizeRotation(-0.4)).toBe(0)
    expect(normalizeRotation(359.6)).toBe(0)
    expect(normalizeRotation(NaN)).toBe(0)
  })
})

describe('D-2 缩放 clamp（0.5-2.0）', () => {
  it('D-2a 上下限常量正确', () => {
    expect(MIN_SCALE).toBe(0.5)
    expect(MAX_SCALE).toBe(2.0)
    expect(DEFAULT_SCALE).toBe(1)
  })

  it('D-2b clamp 边界值', () => {
    expect(clampScale(0.3)).toBe(0.5)
    expect(clampScale(5)).toBe(2.0)
    expect(clampScale(1)).toBe(1)
    expect(clampScale(0.5)).toBe(0.5)
    expect(clampScale(2.0)).toBe(2.0)
  })

  it('D-2c 缩放增量 clamp（滚轮/按钮步长）', () => {
    expect(zoomBy(1.95, 0.1)).toBe(2.0)
    expect(zoomBy(0.55, -0.1)).toBe(0.5)
    expect(zoomBy(1, 0.25)).toBe(1.25)
    expect(zoomBy(1, -0.25)).toBe(0.75)
  })

  it('D-2d 非法缩放值兜底默认', () => {
    expect(clampScale(NaN)).toBe(DEFAULT_SCALE)
    expect(clampScale(Infinity)).toBe(DEFAULT_SCALE)
    expect(clampScale(-Infinity)).toBe(DEFAULT_SCALE)
  })
})

describe('D-5 角度驱动投影映射（等距风格，不引入 Three.js）', () => {
  it('D-5a rotation=0 与原等距投影公式一致（回归锁定）', () => {
    // 原公式：screenX=(x-z)*cos30, screenY=(x+z)*sin30-y
    const p = isoProject(10, 20, 30, 0)
    expect(p.sx).toBeCloseTo((10 - 30) * 0.866, 5)
    expect(p.sy).toBeCloseTo((10 + 30) * 0.5 - 20, 5)
  })

  it('D-5b 同一 3D 点随角度变化投影不同（机柜随视角变化）', () => {
    const a = isoProject(30, 10, 20, 0)
    const b = isoProject(30, 10, 20, 90)
    const c = isoProject(30, 10, 20, 180)
    expect(a).not.toEqual(b)
    expect(a).not.toEqual(c)
    expect(b).not.toEqual(c)
  })

  it('D-5c rotation=180 为原投影中心对称翻转（-X/-Y）', () => {
    const p = isoProject(10, 5, 20, 180)
    expect(p.sx).toBeCloseTo(-(10 - 20) * 0.866, 5)
    expect(p.sy).toBeCloseTo(-(10 + 20) * 0.5 - 5, 5)
  })

  it('D-5d 高度（Y 轴）分量不随旋转改变（深度偏移随角度映射）', () => {
    // y 只作用于投影的 -y 项：任意两点 y 差在任意角度下保持
    const d0 = isoProject(10, 40, 30, 0).sy - isoProject(10, 0, 30, 0).sy
    const d90 = isoProject(10, 40, 30, 90).sy - isoProject(10, 0, 30, 90).sy
    const d180 = isoProject(10, 40, 30, 180).sy - isoProject(10, 0, 30, 180).sy
    expect(d0).toBeCloseTo(-40, 5)
    expect(d90).toBeCloseTo(d0, 5)
    expect(d180).toBeCloseTo(d0, 5)
  })

  it('D-5e rotation=90 时可见面切换为原侧面（深度偏移随角度映射）', () => {
    // rotation=0：可见面为 front(z=0)，宽度 = CAB_WIDTH 的投影
    const f0 = isoProject(0, 0, 0, 0)
    const f1 = isoProject(60, 0, 0, 0)
    expect(f1.sx - f0.sx).toBeCloseTo(60 * 0.866, 5)
    // rotation=90：可见面为原 left(x=0)，宽度 = CAB_DEPTH 的投影
    const l0 = isoProject(0, 0, 0, 90)
    const l1 = isoProject(0, 0, 40, 90)
    expect(l1.sx - l0.sx).toBeCloseTo(40 * 0.866, 5)
  })
})

describe('D-3/D-4 会话级状态保持 store（isometricView.store）', () => {
  beforeEach(() => {
    useIsometricViewStore.setState({ views: {} })
  })

  it('D-4 默认值：未设置柜返回 {rotation:0, scale:1}', () => {
    const v = useIsometricViewStore.getState().getView(1)
    expect(v).toEqual({ rotation: DEFAULT_ROTATION, scale: DEFAULT_SCALE })
  })

  it('D-3a 设置旋转/缩放后会话内保持', () => {
    useIsometricViewStore.getState().setRotation(1, 90)
    useIsometricViewStore.getState().setScale(1, 1.5)
    expect(useIsometricViewStore.getState().getView(1)).toEqual({ rotation: 90, scale: 1.5 })
  })

  it('D-3b 视图切换/重渲染保持（store 内持久）', () => {
    useIsometricViewStore.getState().setRotation(1, 180)
    useIsometricViewStore.getState().setScale(1, 0.75)
    // 模拟重渲染：再次读取不丢
    useIsometricViewStore.setState({})
    expect(useIsometricViewStore.getState().getView(1)).toEqual({ rotation: 180, scale: 0.75 })
  })

  it('D-3c 切机柜按柜独立保持（互不污染）', () => {
    useIsometricViewStore.getState().setRotation(1, 90)
    useIsometricViewStore.getState().setScale(1, 1.5)
    expect(useIsometricViewStore.getState().getView(2)).toEqual({ rotation: DEFAULT_ROTATION, scale: DEFAULT_SCALE })
    useIsometricViewStore.getState().setScale(2, 0.6)
    expect(useIsometricViewStore.getState().getView(1)).toEqual({ rotation: 90, scale: 1.5 })
    expect(useIsometricViewStore.getState().getView(2)).toEqual({ rotation: DEFAULT_ROTATION, scale: 0.6 })
  })

  it('D-3d 重置恢复默认', () => {
    useIsometricViewStore.getState().setRotation(1, 270)
    useIsometricViewStore.getState().setScale(1, 1.8)
    useIsometricViewStore.getState().resetView(1)
    expect(useIsometricViewStore.getState().getView(1)).toEqual({ rotation: DEFAULT_ROTATION, scale: DEFAULT_SCALE })
  })

  it('D-3e 写入值经归一化（角度环绕 / 缩放 clamp）', () => {
    useIsometricViewStore.getState().setRotation(1, 400)
    useIsometricViewStore.getState().setScale(1, 99)
    expect(useIsometricViewStore.getState().getView(1)).toEqual({ rotation: 40, scale: 2.0 })
    useIsometricViewStore.getState().setRotation(1, -90)
    expect(useIsometricViewStore.getState().getView(1).rotation).toBe(270)
  })
})
