// ============================================================
// AutoLink V2.1 — 项目配置类型
// ============================================================

import type { DeviceRef } from './device-profile'

/** 项目元数据 */
export interface ProjectMeta {
  name: string
  description: string
  version: number
  /** V3.0.0-T0-2: 配置 schema 版本（缺失视为 1，兼容 2.9.9；3.0.0 起显式演进） */
  schema_version?: number
  created_at: string
  updated_at: string
}

/** 网络包含选择 */
export interface ProjectNetworks {
  param_network: boolean
  storage_network: boolean
  biz_network: boolean
  oob_network: boolean
  /** V3.0.2-T2-5: 三合一网卡开关（storage+biz+带内管理合并为融合以太网，OOB 独立；可选，默认 false） */
  eth_combined?: boolean
}

/** 参数面协议类型（V2.7.6-T2/V2.9.3-T8: 支持 UEC） */
export type ParamProtocol = 'IB' | 'RoCE' | 'UEC'

/** 拓扑计算参数 */
export interface ProjectTopology {
  downlink_mode: 'full' | 'custom'
  param_protocol: ParamProtocol
  num_gpu_servers: number
  /** 全闪存储服务器数量（一般为2U） */
  num_all_flash_storage: number
  /** 混闪存储服务器数量（一般为4U） */
  num_hybrid_flash_storage: number
  num_compute_servers: number
  param_ports_per_server: number
  storage_ports_per_server: number
  param_switch_ports: number
  storage_switch_ports: number
  param_speed: string
  storage_speed: string
  param_downlink_limit: number
  storage_downlink_limit: number
  biz_downlink_limit: number
  oob_downlink_limit: number
}

/** 机柜散热方式 */
export type RackCoolingMethod = 'air' | 'cold_plate' | 'immersion'

/** 机柜配置 */
export interface ProjectRackConfig {
  rack_type: 42 | 49
  power_limit_per_rack: number
  naming_prefix: string
  /** V2.9.1: 机柜散热方式 (air/cold_plate/immersion) */
  cooling_method?: RackCoolingMethod
  /** V2.9.1: GPU 服务器独占机柜开关 (默认 false = 按功率自然装箱) */
  gpu_dedicated?: boolean
  /** V2.9.1: 功率预设标识 (可选) */
  power_preset?: string
  cabinet_list?: string  // CSV file path or inline data
}

/** V2.9.3-T1: Scale-Up 配置段（UB/NVLink/UALink，可选） */
export interface ProjectScaleUp {
  protocol?: 'NVLink' | 'UALink' | 'UB'
  num_gpus?: number
  gpus_per_node?: number
  domain_size?: number
  bandwidth?: number
}

/** V3.0.0-T0-5: GPU 资源池（异构 GPU 池化，pool 内同构） */
export interface GpuPool {
  pool_id: string
  /** 该池 GPU 服务器数量（>0） */
  count: number
  /** 指向设备库 profile 的引用（可含 library_id 等，可选） */
  profile_ref?: Record<string, unknown>
  /** 该池 NIC/组网覆盖（可选，未提供则用顶层 topology） */
  nic_config?: Record<string, unknown>
  /** 机柜偏好（可选，如 '42U 高功率'） */
  rack_pref?: string
}

/** V3.0.0-T0-5: 集群角色（P=参数面/训练、D=数据面/推理；与组网形态正交） */
export type ClusterRole = 'P' | 'D'

/** V3.0.0-T0-5: 集群（独立选择组网方案的最小单元） */
export interface Cluster {
  cluster_id: string
  role: ClusterRole
  /** 可选：该集群独立组网参数（未提供则沿用顶层 topology） */
  network_mode?: Record<string, unknown>
  gpu_pools: GpuPool[]
}

/** 项目配置 (完整) */
export interface ProjectConfig {
  meta: ProjectMeta
  networks: ProjectNetworks
  topology: ProjectTopology
  device_refs: Record<string, DeviceRef>
  rack_config: ProjectRackConfig
  /** V2.9.3-T1: 可选 Scale-Up 配置段 */
  scale_up?: ProjectScaleUp
  /** V3.0.0-T0-5: 可选多集群段（GPU 池化 + P/D 正交集群模型） */
  clusters?: Cluster[]
}

/** 默认项目配置 */
export function createDefaultProjectConfig(name: string): ProjectConfig {
  return {
    meta: {
      name,
      description: '',
      version: 1,
      schema_version: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    networks: {
      param_network: true,
      storage_network: true,
      biz_network: true,
      oob_network: true,
    },
    topology: {
      downlink_mode: 'custom',
      param_protocol: 'RoCE',
      num_gpu_servers: 100,
      num_all_flash_storage: 8,
      num_hybrid_flash_storage: 6,
      num_compute_servers: 20,
      param_ports_per_server: 8,
      storage_ports_per_server: 1,
      param_switch_ports: 64,
      storage_switch_ports: 40,
      param_speed: '400G',
      storage_speed: '200G',
      param_downlink_limit: 25,
      storage_downlink_limit: 20,
      biz_downlink_limit: 25,
      oob_downlink_limit: 25,
    },
    device_refs: {},
    rack_config: {
      rack_type: 42,
      power_limit_per_rack: 6000,
      naming_prefix: '机柜',
      cooling_method: 'air',
      gpu_dedicated: false,
      power_preset: '',
    },
    scale_up: {},
  }
}

/** 设备引用 key 映射 */
export const DEVICE_REF_KEYS: Record<string, string> = {
  gpu_server: 'GPU服务器',
  all_flash_storage_server: '全闪存储服务器',
  hybrid_flash_storage_server: '混闪存储服务器',
  compute_server: '通算服务器',
  param_leaf_switch: '参数网 Leaf',
  param_spine_switch: '参数网 Spine',
  param_core_switch: '参数网 Core',
  storage_leaf_switch: '存储网 Leaf',
  storage_spine_switch: '存储网 Spine',
  oob_access_switch: 'OOB 接入',
  oob_agg_switch: 'OOB 汇聚',
  biz_access_switch: '业务网 接入',
  biz_agg_switch: '业务网 汇聚',
}