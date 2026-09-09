/**
 * 5.2.2-522-a：参数网拓扑三模式（轨道优化/双平面/Zcube）纯逻辑
 * - topologyModeOf：由配置推导当前模式（zcube > dual_plane > rail）
 * - applyTopologyMode：模式选择 → 配置字段补丁（param_network_mode / dual_plane_enabled）
 * - defaultDualPlanes：启用双平面时的默认 A/B 平面结构（每平面 8 Leaf；分光速率建模见 522-c）
 */
import type { DesignConfig } from '@/stores/design.store'

export type TopologyMode = 'rail' | 'dual_plane' | 'zcube'

export interface TopologyModeOption {
  value: TopologyMode
  label: string
  hint: string
}

export const TOPOLOGY_MODE_OPTIONS: TopologyModeOption[] = [
  { value: 'rail', label: '轨道优化', hint: '传统胖树 / 8-Rail，支持交换机 1 分 2 分光' },
  { value: 'dual_plane', label: '双平面', hint: 'A/B 两平面、每网卡双口（800G→2×400G / 400G→2×200G）' },
  { value: 'zcube', label: 'Zcube', hint: '无 Spine 扁平二部图' },
]

export interface TopologyPlane {
  leaf_count: number
  switch_ports: number
  speed: string
  protocol: string
  uplink: number
}

export function topologyModeOf(config: {
  param_network_mode?: unknown
  param_planes?: unknown
  dual_plane_enabled?: unknown
}): TopologyMode {
  if (config.param_network_mode === 'zcube') return 'zcube'
  const planes = Array.isArray(config.param_planes) ? config.param_planes : null
  if ((planes && planes.length > 0) || config.dual_plane_enabled === true) return 'dual_plane'
  return 'rail'
}

export function applyTopologyMode(
  _config: Partial<DesignConfig>,
  mode: TopologyMode,
  dualPlaneEnabled?: boolean,
): Partial<DesignConfig> {
  switch (mode) {
    case 'zcube':
      return { param_network_mode: 'zcube', dual_plane_enabled: false }
    case 'dual_plane':
      return { param_network_mode: 'standard', dual_plane_enabled: dualPlaneEnabled ?? true }
    default:
      return { param_network_mode: 'standard', dual_plane_enabled: false }
  }
}

/** 5.2.2-522-c: 双平面分光——平面逻辑速率 = 物理速率 / 2（800G→400G、400G→200G） */
function splitSpeed(speed: string): string {
  const n = parseInt(speed, 10)
  if (Number.isFinite(n) && n >= 200) return `${n / 2}G`
  return speed
}

export function defaultDualPlanes(config: {
  param_speed?: string
  param_switch_ports?: number
  param_protocol?: string
}): TopologyPlane[] {
  const speed = splitSpeed(config.param_speed ?? '400G')
  const switch_ports = config.param_switch_ports ?? 128
  const protocol = config.param_protocol ?? 'RoCE'
  const plane = { leaf_count: 8, switch_ports, speed, protocol, uplink: 0 }
  return [plane, { ...plane }]
}
