/**
 * AIDC 规划 plan:table 契约 v1.2 类型（AL 侧前端，MC-AL/docs/plan_table_契约v1.2）
 */
export interface PlanMeta {
  project: string
  site: string
  version?: string
  schema?: string
  generatedAt?: string
  /** 桥接标识（G0）：来源系统 */
  source?: string
  /** 桥接标识：项目类型 */
  projectType?: string
  /** 桥接标识：契约能力版本 */
  bridgeVersion?: string
  /** 契约 v1.2：项目身份（机器匹配键，AL mint） */
  projectId?: string
  /** 契约 v1.2：人类可读项目名 */
  projectName?: string
  /** 契约 v1.2：AL 规划版本（自增） */
  planVersion?: number
  /** 契约 v1.2：planHash = sha256(canonical macro) */
  planHash?: string
}

export interface PlanDevice {
  role: string
  scenario?: string
  model: string
  name?: string
  rack?: number
  asn?: number
  gateways?: string[]
  mlag_pair?: number
  mlag_system_number?: number
  /** MC 生成端分组式 deviceList 兼容（devices 为设备名列表） */
  count?: number
  devices?: string[]
}

export interface PlanConnection {
  src: string
  src_port: string
  src_ip?: string
  dst: string
  dst_ip?: string
  rate?: string
  desc?: string
  trunk?: boolean
}

export interface PlanTerminal {
  src: string
  src_port: string
  vlan?: number | null
  desc?: string
}

export interface PlanMacro {
  site: string
  gpuCount?: number
  pfcQueue?: number
  cnpQueue?: number
  bgpMaxPaths?: number
  convergence?: number
  rails?: number
  naming?: { format?: string; abbr?: Record<string, string> }
  ipSegments?: Record<string, string>
  vlanRanges?: Record<string, [number, number]>
  asRange?: [number, number]
  ospf?: { process?: number; area?: string }
  deviceModels?: Record<string, string>
  /** 兼容 v1.0 snake_case 遗留字段 */
  [key: string]: unknown
}

export interface PlanSummary {
  meta: PlanMeta
  macro: PlanMacro
  topology?: {
    layers?: number
    spines?: number
    leaves?: number
    pods?: unknown
    scale?: Record<string, number>
  }
  deviceList: PlanDevice[]
  connections: PlanConnection[]
  terminals: PlanTerminal[]
  protocols?: {
    ospf?: { process?: number; area?: string }
    bgp?: { asRange?: [number, number]; ecmp?: number }
  }
  convergence?: Record<string, number>
  error?: string
}

export const ROLE_LABEL: Record<string, string> = {
  SPINE: '参数 Spine', LEAF: '参数 Leaf', STO_SPINE: '存储 Spine', STO_LEAF: '存储 Leaf',
  BIZ_AGG: '业务汇聚', BIZ_ACCESS: '业务接入', OOB_AGG: '带外汇聚', OOB_ACCESS: '带外接入',
}

export const ROLE_ABBR: Record<string, string> = {
  SPINE: 'P-Spine', LEAF: 'P-Leaf', STO_SPINE: 'S-Spine', STO_LEAF: 'S-Leaf',
  BIZ_AGG: 'BIZ-AGG', BIZ_ACCESS: 'BIZ-ACC', OOB_AGG: 'OOB-AGG', OOB_ACCESS: 'OOB-ACC',
}

/** 平面 → 聚合/接入 角色组（拓扑预览布局用） */
export const PLANE_ROLES: Array<{ plane: string; upper: string[]; lower: string[]; withGpu?: boolean }> = [
  { plane: '参数网', upper: ['SPINE'], lower: ['LEAF'], withGpu: true },
  { plane: '存储网', upper: ['STO_SPINE'], lower: ['STO_LEAF'] },
  { plane: '业务&管理网', upper: ['BIZ_AGG'], lower: ['BIZ_ACCESS'] },
  { plane: '带外网', upper: ['OOB_AGG'], lower: ['OOB_ACCESS'] },
]

/** 从 macro 读取数值（camelCase 优先、snake_case 兜底，契约 §3 兼容过渡） */
export function macroNum(macro: PlanMacro, camel: string, snake: string): number | undefined {
  const v = (macro[camel] as number | undefined) ?? (macro[snake] as number | undefined)
  return v === undefined ? undefined : Number(v)
}
