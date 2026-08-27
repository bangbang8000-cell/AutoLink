/**
 * AL-P4/AL-R3 纯函数测试：
 * - AL-P4：plan → 设计配置映射（端口数/网络开关/收敛比/速率/协议/规模/多轨）
 * - AL-R3：项目 project_config.json 机柜配置 → 矩阵落位 opts（gpu_per_cabinet 生效）
 */
import { describe, it, expect } from 'vitest'
import {
  buildPlanDesignPatch,
  inferSwitchPorts,
  inferNetworkSwitches,
  inferConvergenceDownlink,
  rackMatrixOptsFromProjectConfig,
} from '@/utils/planToDesign'
import type { PlanSummary } from '@/components/aidc/aidcTypes'

/** 带网络（参数网 + 业务 + 带外）的 plan fixture：64 GPU × 8 rails / 8 leaf，1:1 收敛 */
const netPlan = (overrides: Partial<PlanSummary> = {}): PlanSummary => ({
  meta: { project: 'aidc_64', site: 'BJ01' },
  macro: {
    site: 'BJ01', gpuCount: 64, convergence: 1, rails: 8,
    deviceModels: { SPINE: 'H3C S9827', LEAF: 'H3C S9827' },
  },
  topology: { layers: 2, spines: 2, leaves: 8, scale: { gpuCount: 64, spine: 2, leaf: 8 } },
  deviceList: [
    { role: 'SPINE', model: 'H3C S9827', name: 'sp-1' },
    { role: 'LEAF', model: 'H3C S9827', name: 'lf-1' },
    { role: 'BIZ_AGG', model: 'H3C S6800', name: 'biz-1' },
    { role: 'OOB_ACCESS', model: 'H3C S5130', name: 'oob-1' },
  ],
  connections: [],
  terminals: [],
  convergence: { compute: 1, storage: 1, biz: 1 },
  ...overrides,
})

describe('inferSwitchPorts (AL-P4 ①端口数)', () => {
  it('由 scale+rails 推导 1:1 收敛交换机口数（64 GPU×8 rails/8 leaf → 128 口）', () => {
    expect(inferSwitchPorts(netPlan())).toBe(128)
  })

  it('显式 macro.paramSwitchPorts / param_switch_ports 优先', () => {
    const p = netPlan({ macro: { ...netPlan().macro, paramSwitchPorts: 144 } })
    expect(inferSwitchPorts(p)).toBe(144)
    const p2 = netPlan({ macro: { ...netPlan().macro, param_switch_ports: 256 } })
    expect(inferSwitchPorts(p2)).toBe(256)
  })

  it('无拓扑/规模信息 → undefined（不破坏现有映射）', () => {
    const p = netPlan({ topology: undefined })
    expect(inferSwitchPorts(p)).toBeUndefined()
  })
})

describe('inferNetworkSwitches (AL-P4 ②网络开关)', () => {
  it('plan 含业务/带外设备 → 开启 oob/biz 网络', () => {
    expect(inferNetworkSwitches(netPlan())).toEqual({ oob_enabled: true, biz_enabled: true })
  })

  it('plan 仅参数网设备 → 不改网络开关（返回空）', () => {
    const p = netPlan({
      deviceList: [
        { role: 'SPINE', model: 'x', name: 's' },
        { role: 'LEAF', model: 'x', name: 'l' },
      ],
    })
    expect(inferNetworkSwitches(p)).toEqual({})
  })
})

describe('inferConvergenceDownlink (AL-P4 ③收敛比)', () => {
  it('1:1 → 下联口 = 交换机口/2（128 → 64）', () => {
    expect(inferConvergenceDownlink(netPlan(), 128)).toBe(64)
  })

  it('4:1 → 下联口 ≈ 4/5 交换机口（128 → 102）', () => {
    const p = netPlan({ macro: { ...netPlan().macro, convergence: 4 } })
    expect(inferConvergenceDownlink(p, 128)).toBe(102)
  })

  it('无交换机口数 → undefined（不写收敛比）', () => {
    expect(inferConvergenceDownlink(netPlan(), undefined)).toBeUndefined()
  })
})

describe('buildPlanDesignPatch (AL-P4 映射进 DesignConfig)', () => {
  it('带网络 fixture → 含端口数/网络开关/收敛比 + 基础字段', () => {
    const patch = buildPlanDesignPatch(netPlan())
    expect(patch.param_switch_ports).toBe(128)
    expect(patch.param_downlink_limit).toBe(64)
    expect(patch.oob_enabled).toBe(true)
    expect(patch.biz_enabled).toBe(true)
    expect(patch.num_servers).toBe(64)
    expect(patch.rail_count).toBe(8)
    expect(patch.param_protocol).toBe('RoCE')
    expect(patch.param_speed).toBe('400G')
  })

  it('plan 缺网络/规模字段 → 仅基础映射，不写端口/收敛/开关（向后兼容）', () => {
    const patch = buildPlanDesignPatch({
      meta: { project: 'x', site: 'BJ01' },
      macro: { site: 'BJ01', gpuCount: 32, rails: 4 },
      deviceList: [],
      connections: [],
      terminals: [],
    } as PlanSummary)
    expect(patch.param_switch_ports).toBeUndefined()
    expect(patch.param_downlink_limit).toBeUndefined()
    expect(patch.oob_enabled).toBeUndefined()
    expect(patch.biz_enabled).toBeUndefined()
    expect(patch.num_servers).toBe(32)
    expect(patch.rail_count).toBe(4)
  })
})

describe('rackMatrixOptsFromProjectConfig (AL-R3 项目 gpu_per_cabinet 生效)', () => {
  it('解析 project_config.json → gpuPerCabinet/topReservedU/rackType/powerLimit', () => {
    const raw = JSON.stringify({
      rack_config: { gpu_per_cabinet: 2, top_reserved_u: 4, rack_type: 42, power_limit_per_rack: 9000 },
    })
    expect(rackMatrixOptsFromProjectConfig(raw)).toEqual({
      gpuPerCabinet: 2, topReservedU: 4, rackType: 42, powerLimit: 9000,
    })
  })

  it('null / 非法 JSON / 缺机柜配置 → 空 opts（默认 gpuPerCabinet=1 兼容）', () => {
    expect(rackMatrixOptsFromProjectConfig(null)).toEqual({})
    expect(rackMatrixOptsFromProjectConfig('not-json')).toEqual({})
    expect(rackMatrixOptsFromProjectConfig(JSON.stringify({}))).toEqual({})
  })
})