/**
 * 5.2.2-522-a：参数网拓扑三模式（轨道优化/双平面/Zcube）纯逻辑单测
 * - topologyModeOf：由配置推导当前模式（zcube > dual_plane > rail）
 * - applyTopologyMode：模式选择 → 配置字段补丁
 * - defaultDualPlanes：启用双平面时的默认 A/B 平面结构（每平面 8 Leaf）
 */
import { describe, it, expect } from 'vitest'
import {
  applyTopologyMode,
  defaultDualPlanes,
  topologyModeOf,
  TOPOLOGY_MODE_OPTIONS,
} from '@/utils/topologyMode'

describe('TOPOLOGY_MODE_OPTIONS 三模式（522-a）', () => {
  it('提供 轨道优化/双平面/Zcube 三个选项', () => {
    expect(TOPOLOGY_MODE_OPTIONS.map((o) => o.value)).toEqual(['rail', 'dual_plane', 'zcube'])
  })
})

describe('topologyModeOf 模式推导', () => {
  it('缺省/标准 → 轨道优化', () => {
    expect(topologyModeOf({})).toBe('rail')
    expect(topologyModeOf({ param_network_mode: 'standard' })).toBe('rail')
  })

  it('param_network_mode=zcube → Zcube', () => {
    expect(topologyModeOf({ param_network_mode: 'zcube' })).toBe('zcube')
  })

  it('param_planes 非空 或 dual_plane_enabled → 双平面', () => {
    expect(topologyModeOf({ param_planes: [{ leaf_count: 8 }] })).toBe('dual_plane')
    expect(topologyModeOf({ dual_plane_enabled: true })).toBe('dual_plane')
  })

  it('zcube 优先于双平面标记', () => {
    expect(topologyModeOf({ param_network_mode: 'zcube', dual_plane_enabled: true })).toBe('zcube')
  })
})

describe('applyTopologyMode 模式应用', () => {
  it('轨道优化 → param_network_mode=standard + 关闭双平面', () => {
    expect(applyTopologyMode({}, 'rail')).toEqual({ param_network_mode: 'standard', dual_plane_enabled: false })
  })

  it('双平面 → standard + 双平面开关（默认开，可传 false 关闭）', () => {
    expect(applyTopologyMode({}, 'dual_plane')).toEqual({ param_network_mode: 'standard', dual_plane_enabled: true })
    expect(applyTopologyMode({}, 'dual_plane', false)).toEqual({ param_network_mode: 'standard', dual_plane_enabled: false })
  })

  it('Zcube → param_network_mode=zcube + 关闭双平面', () => {
    expect(applyTopologyMode({}, 'zcube')).toEqual({ param_network_mode: 'zcube', dual_plane_enabled: false })
  })
})

describe('defaultDualPlanes 默认平面结构（522-a/c）', () => {
  it('800G 物理 → 两平面各 400G（800G→2×400G），8 Leaf', () => {
    const planes = defaultDualPlanes({ param_speed: '800G', param_switch_ports: 128, param_protocol: 'RoCE' })
    expect(planes).toHaveLength(2)
    for (const p of planes) {
      expect(p.leaf_count).toBe(8)
      expect(p.switch_ports).toBe(128)
      expect(p.speed).toBe('400G')
      expect(p.protocol).toBe('RoCE')
    }
  })

  it('400G 物理 → 两平面各 200G（400G→2×200G）', () => {
    const planes = defaultDualPlanes({ param_speed: '400G', param_switch_ports: 64, param_protocol: 'RoCE' })
    expect(planes[0].speed).toBe('200G')
  })

  it('缺省字段给兜底（物理 400G → 平面 200G / 128 / RoCE）', () => {
    const planes = defaultDualPlanes({})
    expect(planes[0]).toEqual({ leaf_count: 8, switch_ports: 128, speed: '200G', protocol: 'RoCE', uplink: 0 })
  })
})
