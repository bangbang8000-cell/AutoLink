/**
 * B1-02 / FR-A04：柜型判定改结构化 domain（T-B1-11 / T-B1-12）
 *
 * 判据：
 * - T-B1-11 设备 group 改为英文或空串后柜型分布不变（domain 优先）
 * - T-B1-12 正常设备库走结构化 domain，中文兜底告警计数 = 0
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCabinetTypeGroupFallbackCount,
  resetCabinetTypeGroupFallbackCount,
  toCabinetType,
} from '@/utils/rackCabinetTypes'

beforeEach(() => resetCabinetTypeGroupFallbackCount())

describe('toCabinetType（B1-02 / FR-A04）', () => {
  it('domain 优先于中文 group：group 改英文/空串后柜型分布不变', () => {
    const baseline = ['gpu', 'compute', 'storage', 'network'].map((d) =>
      toCabinetType({ type: 'server', domain: d, group: d }),
    )
    for (const group of ['', 'gpu-server', 'GPU 服务器', '未知分组']) {
      const actual = ['gpu', 'compute', 'storage', 'network'].map((d) =>
        toCabinetType({ type: 'server', domain: d, group }),
      )
      expect(actual).toEqual(baseline)
    }
    expect(baseline).toEqual(['gpu', 'compute', 'storage', 'network'])
  })

  it('正常设备库（全部带 domain）不触发中文兜底告警', () => {
    const nodes = Array.from({ length: 64 }, (_, i) => ({
      type: 'server',
      domain: ['gpu', 'compute', 'storage', 'network'][i % 4],
      group: 'GPU服务器',
    }))
    nodes.forEach((n) => toCabinetType(n))
    expect(getCabinetTypeGroupFallbackCount()).toBe(0)
  })

  it('缺 domain 的历史拓扑退回中文 group，并累计兜底告警', () => {
    expect(toCabinetType({ type: 'server', group: '通用存储服务器' })).toBe('storage')
    expect(toCabinetType({ type: 'server', group: '通算服务器' })).toBe('compute')
    expect(toCabinetType({ type: 'server', group: 'GPU服务器' })).toBe('gpu')
    expect(getCabinetTypeGroupFallbackCount()).toBe(3)
  })

  it('Scale-Up 节点与非服务器节点不受 domain 影响', () => {
    expect(toCabinetType({ type: 'scaleup_gpu', domain: 'gpu' })).toBe('scaleup')
    expect(toCabinetType({ type: 'switch', domain: 'gpu' })).toBe('network')
    expect(getCabinetTypeGroupFallbackCount()).toBe(0)
  })
})
