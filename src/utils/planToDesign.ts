/**
 * AL-P4（plan → 设计配置常用字段映射）与 AL-R3（项目机柜配置）纯函数。
 *
 * AL-P4：applyToDesign 只映射 num_servers/rail_count/param_protocol/param_speed 的缺口——
 *   - ①端口数   → param_switch_ports（由 GPU 规模×rails÷Leaf 数推导下联需求，再按收敛比补上行 → 常用档位）
 *   - ②网络开关 → oob_enabled/biz_enabled（plan 含业务/带外设备即开启；缺角色不改）
 *   - ③收敛比   → param_downlink_limit（后端收敛比 = 下联/(交换机口-下联)，故下联 = S·C/(1+C)）
 * 向后兼容：plan 缺字段时不写对应配置项，不破坏现有映射。
 *
 * AL-R3：rackMatrixOptsFromProjectConfig 解析项目 project_config.json 的 rack_config，
 * 让 gpu_per_cabinet/top_reserved_u/rack_type/power_limit_per_rack 对矩阵落位生效（缺省回退默认 1）。
 */
import type { DesignConfig } from '@/stores/design.store'
import type { PlanSummary } from '@/components/aidc/aidcTypes'
import type { RackMatrixLayoutOptions } from '@/utils/rackMatrixLayout'

/** 正整数提取：非法/非正 → undefined */
const posInt = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

/** 常用交换机端口档位（与后端 optimization._round_switch_ports 一致，补充小档 64） */
const SWITCH_PORT_LADDER = [64, 128, 144, 256, 288, 512, 1024]

/** 上取整到常用交换机端口档位 */
export function roundUpSwitchPorts(n: number): number {
  for (const p of SWITCH_PORT_LADDER) if (n <= p) return p
  return Math.ceil(n / 128) * 128
}

/** M5: 从设备模型清单推断参数网速率（800G/400G/200G，默认 400G），使设计与规划一致 */
export function inferPlanSpeed(deviceModels: unknown): string {
  const s = JSON.stringify(deviceModels ?? '').toLowerCase()
  if (s.includes('800')) return '800G'
  if (s.includes('400')) return '400G'
  if (s.includes('200')) return '200G'
  return '400G'
}

/** plan 收敛比：macro.convergence（缺省取 plan.convergence.compute），默认 1，限 (0,4] */
export function planConvergence(plan: PlanSummary): number {
  const raw =
    plan.macro.convergence ?? (plan.convergence as Record<string, number> | undefined)?.compute
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(n, 4)
}

/** AL-P4 ①端口数：推断参数网交换机端口数（param_switch_ports） */
export function inferSwitchPorts(plan: PlanSummary): number | undefined {
  const explicit = posInt(plan.macro.paramSwitchPorts ?? plan.macro.param_switch_ports)
  if (explicit) return explicit
  const gpu = posInt(plan.macro.gpuCount)
  const rails = posInt(plan.macro.rails)
  const leaves = posInt(plan.topology?.scale?.leaf) ?? posInt(plan.topology?.leaves)
  if (!gpu || !rails || !leaves) return undefined
  // 每 Leaf 需承载下联 = GPU数×每机网口(rails)÷Leaf 数；收敛比 C 下交换机口 ≈ 下联×(1+1/C)
  const downlinks = Math.ceil((gpu * rails) / leaves)
  const c = planConvergence(plan)
  return roundUpSwitchPorts(Math.ceil(downlinks * (1 + 1 / c)))
}

/** AL-P4 ②网络开关：plan 含业务/带外设备 → 开启对应网络（缺角色不改，向后兼容） */
export function inferNetworkSwitches(plan: PlanSummary): Partial<DesignConfig> {
  const roles = new Set((plan.deviceList ?? []).map((d) => d.role))
  const patch: Partial<DesignConfig> = {}
  if (roles.has('OOB_AGG') || roles.has('OOB_ACCESS')) patch.oob_enabled = true
  if (roles.has('BIZ_AGG') || roles.has('BIZ_ACCESS')) patch.biz_enabled = true
  return patch
}

/** AL-P4 ③收敛比：由交换机口数 S 与收敛比 C 推导下联口数 param_downlink_limit = S·C/(1+C) */
export function inferConvergenceDownlink(plan: PlanSummary, switchPorts?: number): number | undefined {
  const S = posInt(switchPorts)
  if (!S) return undefined
  const c = planConvergence(plan)
  const dl = Math.round((S * c) / (1 + c))
  return Math.max(1, Math.min(dl, S - 1))
}

/** AL-P4：plan → DesignConfig 补丁（缺字段不写对应项，保持向后兼容） */
export function buildPlanDesignPatch(plan: PlanSummary): Partial<DesignConfig> {
  const patch: Partial<DesignConfig> = {
    num_servers: Number(plan.macro.gpuCount ?? 64),
    rail_count: Number(plan.macro.rails ?? 8),
    param_protocol: 'RoCE',
    param_speed: inferPlanSpeed(plan.macro.deviceModels),
  }
  const switchPorts = inferSwitchPorts(plan)
  if (switchPorts) patch.param_switch_ports = switchPorts
  Object.assign(patch, inferNetworkSwitches(plan))
  const dl = inferConvergenceDownlink(plan, switchPorts)
  if (dl) patch.param_downlink_limit = dl
  return patch
}

/** AL-R3：解析项目 project_config.json 机柜配置 → 矩阵落位 opts（缺省空对象，gpuPerCabinet 默认 1 兼容） */
export function rackMatrixOptsFromProjectConfig(raw: string | null): RackMatrixLayoutOptions {
  if (!raw) return {}
  try {
    const cfg = JSON.parse(raw) as { rack_config?: Record<string, unknown> }
    const rack = cfg?.rack_config ?? {}
    const opts: RackMatrixLayoutOptions = {}
    const gpuPerCabinet = posInt(rack.gpu_per_cabinet)
    if (gpuPerCabinet) opts.gpuPerCabinet = gpuPerCabinet
    const topReservedU = Number(rack.top_reserved_u)
    if (Number.isFinite(topReservedU)) opts.topReservedU = topReservedU
    const rackType = Number(rack.rack_type)
    if (Number.isFinite(rackType)) opts.rackType = rackType
    const powerLimit = Number(rack.power_limit_per_rack)
    if (Number.isFinite(powerLimit)) opts.powerLimit = powerLimit
    return opts
  } catch {
    return {}
  }
}