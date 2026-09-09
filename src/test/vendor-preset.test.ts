/**
 * 523-d: 一键选厂商（vendorPreset.ts）选型语义测试
 *
 * 守护点：
 * 1. 交换机 refKey 按 网络类型(applicable_networks) 隔离，不再"第一个同厂商交换机"通吃全部 refKey
 * 2. 角色分级：leaf/access → 低端口，spine/agg → 中位，core → 高端口
 * 3. 存储服务器按精确 category（all_flash / hybrid_flash）区分
 * 4. 无匹配厂商 → 跳过（undefined），留给"选择设备"补齐
 */
import { describe, it, expect } from 'vitest'
import type { LibraryDevice } from '@/types/device-profile'
import {
  selectSwitchForRefKey,
  selectServerForCategory,
  refKeyNetwork,
} from '@/utils/vendorPreset'

function makeDevice(id: string, vendor: string, category: string, portCount?: number, networks: string[] = []): LibraryDevice {
  return {
    id,
    vendor,
    model: `Model-${id}`,
    category,
    description: '',
    power_watts: 300,
    weight_kg: 10,
    u_height: 1,
    depth_mm: 500,
    cooling: 'air',
    name_prefix: `P-${id}`,
    tags: [],
    applicable_networks: networks as LibraryDevice['applicable_networks'],
    source: 'builtin',
    verified: true,
    added_at: '2026-08-01',
    updated_at: '2026-08-01',
    ...(portCount !== undefined ? { port_count: portCount } : {}),
  }
}

const library: LibraryDevice[] = [
  // 参数网 H3C 三档角色
  makeDevice('h3c_param_32', 'H3C', 'switches_param', 32, ['param']),
  makeDevice('h3c_param_64', 'H3C', 'switches_param', 64, ['param']),
  makeDevice('h3c_param_128', 'H3C', 'switches_param', 128, ['param']),
  // 存储/业务/带外 H3C —— 用于网络类型隔离断言
  makeDevice('h3c_storage_48', 'H3C', 'switches_storage', 48, ['storage']),
  makeDevice('h3c_biz_48', 'H3C', 'switches_biz', 48, ['biz']),
  makeDevice('h3c_oob_24', 'H3C', 'switches_oob', 24, ['oob']),
  // 其他厂商
  makeDevice('huawei_param_64', '华为', 'switches_param', 64, ['param']),
  makeDevice('nv_param_64', 'NVIDIA', 'switches_param', 64, ['param']),
]

describe('refKeyNetwork 网络类型推导', () => {
  it('已知 refKey → 网络类型', () => {
    expect(refKeyNetwork('param_leaf_switch')).toBe('param')
    expect(refKeyNetwork('param_core_switch')).toBe('param')
    expect(refKeyNetwork('storage_spine_switch')).toBe('storage')
    expect(refKeyNetwork('biz_access_switch')).toBe('biz')
    expect(refKeyNetwork('oob_agg_switch')).toBe('oob')
  })

  it('未知 refKey → undefined', () => {
    expect(refKeyNetwork('gpu_server')).toBeUndefined()
  })
})

describe('selectSwitchForRefKey 角色分级选型', () => {
  it('param_leaf_switch 选最小端口（TOR）', () => {
    expect(selectSwitchForRefKey('param_leaf_switch', 'H3C', library)?.id).toBe('h3c_param_32')
  })

  it('param_spine_switch 选中位端口', () => {
    expect(selectSwitchForRefKey('param_spine_switch', 'H3C', library)?.id).toBe('h3c_param_64')
  })

  it('param_core_switch 选最大端口', () => {
    expect(selectSwitchForRefKey('param_core_switch', 'H3C', library)?.id).toBe('h3c_param_128')
  })

  it('存储/业务/带外 refKey 只在对应网络内选型（网络隔离）', () => {
    expect(selectSwitchForRefKey('storage_leaf_switch', 'H3C', library)?.id).toBe('h3c_storage_48')
    expect(selectSwitchForRefKey('biz_agg_switch', 'H3C', library)?.id).toBe('h3c_biz_48')
    expect(selectSwitchForRefKey('oob_access_switch', 'H3C', library)?.id).toBe('h3c_oob_24')
  })

  it('设备 vendor 拼写变体仍匹配预设厂商：Huawei → 华为', () => {
    const withAlias = [
      ...library,
      makeDevice('huawei_alias_param_64', 'Huawei', 'switches_param', 64, ['param']),
    ]
    expect(selectSwitchForRefKey('param_spine_switch', '华为', withAlias)?.id).toBe('huawei_alias_param_64')
  })

  it('无该厂商设备 → undefined（跳过，走"选择设备"补齐）', () => {
    expect(selectSwitchForRefKey('param_leaf_switch', '锐捷', library)).toBeUndefined()
  })

  it('未知 refKey → undefined', () => {
    expect(selectSwitchForRefKey('gpu_server', 'H3C', library)).toBeUndefined()
  })
})

describe('selectServerForCategory 服务器分类选型', () => {
  const servers: LibraryDevice[] = [
    makeDevice('h3c_all_flash', 'H3C', 'storage_servers_all_flash'),
    makeDevice('h3c_hybrid', 'H3C', 'storage_servers_hybrid_flash'),
    makeDevice('huawei_all_flash', '华为', 'storage_servers_all_flash'),
  ]

  it('all_flash refKey → storage_servers_all_flash 设备', () => {
    expect(selectServerForCategory('storage_servers_all_flash', 'H3C', servers)?.id).toBe('h3c_all_flash')
  })

  it('hybrid_flash refKey → storage_servers_hybrid_flash 设备（不再与 all_flash 撞车）', () => {
    expect(selectServerForCategory('storage_servers_hybrid_flash', 'H3C', servers)?.id).toBe('h3c_hybrid')
  })

  it('category 前缀截断不再生效：storage_servers 不匹配 storage_servers_all_flash 之外的语义', () => {
    expect(selectServerForCategory('storage_servers', 'H3C', servers)).toBeUndefined()
  })

  it('无该厂商 → undefined', () => {
    expect(selectServerForCategory('storage_servers_all_flash', '锐捷', servers)).toBeUndefined()
  })
})
