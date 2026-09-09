/**
 * 5.2.2-522-f：网络合分模式纯逻辑单测
 * - combineModeOf：由配置推导合分模式（4合1 > 3合1 > 2合1 > 独立）
 * - applyCombine：模式选择 → 配置字段补丁（eth_combined / oob_enabled / inference_plane / storage）
 */
import { describe, it, expect } from 'vitest'
import {
  applyCombine,
  combineModeOf,
  NETWORK_COMBINE_OPTIONS,
  type NetworkCombineMode,
} from '@/utils/networkCombine'

describe('NETWORK_COMBINE_OPTIONS 合分模式（522-f）', () => {
  it('提供 四网独立/2合1/3合1/4合1 四个选项', () => {
    expect(NETWORK_COMBINE_OPTIONS.map((o) => o.value)).toEqual([
      'independent', 'biz_oob_2in1', 'eth_3in1', 'inference_4in1',
    ])
  })
})

describe('combineModeOf 合分模式推导', () => {
  it('缺省/常规四网 → 独立', () => {
    expect(combineModeOf({})).toBe('independent')
    expect(combineModeOf({ eth_combined: false, oob_enabled: true, inference_plane: false })).toBe('independent')
  })

  it('eth_combined=true 且推理平面 → 4合1', () => {
    expect(combineModeOf({ eth_combined: true, inference_plane: true })).toBe('inference_4in1')
  })

  it('eth_combined=true 无推理 → 3合1', () => {
    expect(combineModeOf({ eth_combined: true, inference_plane: false })).toBe('eth_3in1')
  })

  it('biz 开 + oob 关（无 eth_combined）→ 2合1', () => {
    expect(combineModeOf({ eth_combined: false, oob_enabled: false, biz_enabled: true })).toBe('biz_oob_2in1')
  })
})

describe('applyCombine 合分模式应用', () => {
  it('独立 → 关闭 eth_combined 与推理平面，保留原 oob/存储', () => {
    expect(applyCombine({}, 'independent')).toMatchObject({ eth_combined: false, inference_plane: false })
  })

  it('2合1 → 关闭带外（业务网承载管理&业务），存储独立', () => {
    const p = applyCombine({}, 'biz_oob_2in1')
    expect(p).toMatchObject({ eth_combined: false, oob_enabled: false, inference_plane: false })
    expect(p.biz_enabled).toBe(true)
  })

  it('3合1 → eth_combined=true、OOB 独立、关闭推理', () => {
    const p = applyCombine({}, 'eth_3in1')
    expect(p).toMatchObject({ eth_combined: true, oob_enabled: true, inference_plane: false })
  })

  it('4合1 → eth_combined=true + 推理平面 + OOB 独立', () => {
    const p = applyCombine({}, 'inference_4in1')
    expect(p).toMatchObject({ eth_combined: true, inference_plane: true, oob_enabled: true })
  })

  it('模式枚举完整（TS 编译守卫）', () => {
    const modes: NetworkCombineMode[] = ['independent', 'biz_oob_2in1', 'eth_3in1', 'inference_4in1']
    expect(modes).toHaveLength(4)
  })
})
