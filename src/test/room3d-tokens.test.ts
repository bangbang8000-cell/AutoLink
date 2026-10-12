/**
 * 5.4.11-B-4：机房 3D 配色 token 契约测试
 * - 锁定 9 个语义化颜色值（防视觉基线漂移）
 * - 全部为合法 hex（6 位）
 */
import { describe, it, expect } from 'vitest'
import { ROOM_3D_TOKENS } from '@/utils/room3dTokens'

describe('room3dTokens', () => {
  it('包含全部 9 个场景 token 且取值稳定', () => {
    expect(ROOM_3D_TOKENS).toEqual({
      cabinetFallback: '#f1f5f9',
      serverBlock: '#0ea5e9',
      switchBlock: '#f59e0b',
      acBody: '#94a3b8',
      pillarBody: '#64748b',
      frontPanel: '#1f2937',
      selectionWireframe: '#ec4899',
      gridCell: '#d1d5db',
      gridSection: '#9ca3af',
    })
  })

  it('全部 token 为合法 6 位 hex', () => {
    for (const value of Object.values(ROOM_3D_TOKENS)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('服务端块与交换机块颜色对比可辨识（场景可读性基线）', () => {
    expect(ROOM_3D_TOKENS.serverBlock).not.toBe(ROOM_3D_TOKENS.switchBlock)
  })
})
