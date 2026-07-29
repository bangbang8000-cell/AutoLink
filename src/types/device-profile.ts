// ============================================================
// AutoLink V2.4 — 设备参数模型 & 设备库类型定义
// ============================================================

export type NetworkType = 'param' | 'storage' | 'biz' | 'oob'

export type CoolingType = 'air' | 'liquid'

// V2.4: 散热方式细化（用于液冷评估与 PUE 估算）
export type CoolingMethod = 'air' | 'cold_plate' | 'immersion'

// V2.4: RDMA 协议类型
export type RdmaType = 'IB' | 'RoCEv2' | 'both'

export type PortNumbering = 'sequential' | 'grouped'

export type DeviceSource = 'builtin' | 'custom'

/* ---------- 接口模型 (仅服务器) ---------- */

export interface InterfaceModel {
  network_type: NetworkType
  port_count: number
  port_speed: string
  port_type: string
  cable_type: string
  downlink_prefix: string
  uplink_prefix: string
  port_numbering: PortNumbering
}

/* ---------- 设备参数卡片 (DeviceProfile) ---------- */

export interface DeviceProfile {
  // 基础信息
  vendor: string
  model: string
  description: string

  // 物理参数
  power_watts: number
  weight_kg: number
  u_height: number
  depth_mm: number
  cooling: CoolingType

  // 命名规则
  name_prefix: string

  // 接口模型 (仅服务器)
  interface_models?: InterfaceModel[]

  // 端口配置 (仅交换机)
  port_count?: number
  port_speed?: string
  port_type?: string
  downlink_prefix?: string
  uplink_prefix?: string

  // V2.4 新增字段（可选，向后兼容）
  cooling_method?: CoolingMethod          // 散热方式（风冷/冷板液冷/浸没式）
  rail_compatible?: boolean               // 是否支持 Rail-Optimized 架构
  spectrum_x?: boolean                    // 是否 Spectrum-X 认证
  nvlink_domain?: number                  // NVLink 域大小（如 576）
  rdma_type?: RdmaType                    // RDMA 协议类型
  gpu_count?: number                      // GPU/NPU 卡数（服务器）
  gpu_memory_gb?: number                  // 单卡显存 GB
  gpu_model?: string                      // GPU/NPU 型号
  price_range?: string                    // 价格区间（用于 BOM 估算）
  eol_date?: string                       // 停产日期（选型提醒）
}

/* ---------- 设备库条目 ---------- */

export interface LibraryDevice extends DeviceProfile {
  id: string
  category: string
  tags: string[]
  applicable_networks: NetworkType[]
  source: DeviceSource
  verified: boolean
  datasheet_url?: string
  added_at: string
  updated_at: string
}

/* ---------- 设备库分类 ---------- */

export interface DeviceCategory {
  id: string
  name: string
  description: string
  devices: LibraryDevice[]
}

/* ---------- 设备库索引 ---------- */

export interface DeviceLibrary {
  version: string
  updated_at: string
  categories: DeviceCategory[]
}

/* ---------- 项目对库设备的引用 ---------- */

export interface DeviceRef {
  library_id: string
  overrides?: Partial<DeviceProfile>
  locked_version?: string
}

/* ---------- 设备库分类ID常量 ---------- */

export const DEVICE_CATEGORY_IDS = {
  gpu_servers: 'gpu_servers',
  storage_servers_all_flash: 'storage_servers_all_flash',
  storage_servers_hybrid_flash: 'storage_servers_hybrid_flash',
  storage_servers_parallel_fs: 'storage_servers_parallel_fs',
  compute_servers: 'compute_servers',
  switches_param: 'switches_param',
  switches_storage: 'switches_storage',
  switches_biz: 'switches_biz',
  switches_oob: 'switches_oob',
  optical_modules: 'optical_modules',
  custom: 'custom',
} as const

export type DeviceCategoryId = (typeof DEVICE_CATEGORY_IDS)[keyof typeof DEVICE_CATEGORY_IDS]

/* ---------- 设备类型判断辅助 ---------- */

export function isServerDevice(device: LibraryDevice | DeviceProfile): boolean {
  return !!device.interface_models && (device.interface_models?.length ?? 0) > 0
}

export function isSwitchDevice(device: LibraryDevice | DeviceProfile): boolean {
  return !isServerDevice(device)
}

/* ---------- 默认接口模型 ---------- */

export function createDefaultInterfaceModel(networkType: NetworkType): InterfaceModel {
  const defaults: Record<NetworkType, InterfaceModel> = {
    param: {
      network_type: 'param',
      port_count: 8,
      port_speed: '400G',
      port_type: 'QSFP56',
      cable_type: 'MPO-16',
      downlink_prefix: 'NIC',
      uplink_prefix: 'NIC',
      port_numbering: 'sequential',
    },
    storage: {
      network_type: 'storage',
      port_count: 2,
      port_speed: '200G',
      port_type: 'QSFP56',
      cable_type: 'AOC',
      downlink_prefix: 'NIC',
      uplink_prefix: 'NIC',
      port_numbering: 'sequential',
    },
    biz: {
      network_type: 'biz',
      port_count: 1,
      port_speed: '25G',
      port_type: 'SFP28',
      cable_type: '光纤',
      downlink_prefix: 'NIC',
      uplink_prefix: 'NIC',
      port_numbering: 'sequential',
    },
    oob: {
      network_type: 'oob',
      port_count: 1,
      port_speed: '1G',
      port_type: 'RJ45',
      cable_type: 'Cat6A网线',
      downlink_prefix: 'NIC',
      uplink_prefix: 'NIC',
      port_numbering: 'sequential',
    },
  }
  return { ...defaults[networkType] }
}

/* ---------- V2.4: 光模块类型定义 ---------- */

export type OpticalSpeed = '100G' | '200G' | '400G' | '800G' | '1.6T'

export type OpticalFormFactor =
  | 'QSFP28'
  | 'QSFP56'
  | 'QSFP-DD'
  | 'OSFP'
  | 'OSFP-XD'
  | 'SFP28'
  | 'SFP56'
  | 'SFP-DD'

export type OpticalSpec =
  | 'SR4' | 'SR8' | 'SR'
  | 'DR4' | 'DR8' | 'DR'
  | 'FR4' | '2xFR4' | 'FR'
  | 'LR4' | '2xLR4' | 'LR'
  | 'CWDM4'
  | 'DAC' | 'AOC'

export type FiberType = 'MMF' | 'SMF' | 'copper'

export interface OpticalModule {
  id: string
  speed: OpticalSpeed
  form_factor: OpticalFormFactor
  spec: OpticalSpec
  distance_m: number
  fiber_type: FiberType
  power_watts: number
  vendors: string[]
  price_range: string
  category: 'optical_modules'
  description: string
  tags: string[]
}

/* ---------- V2.4: 光模块自动选型辅助 ---------- */

export function selectOpticalModuleByDistance(
  distanceM: number,
  speed: OpticalSpeed,
  modules: OpticalModule[],
): OpticalModule | null {
  const candidates = modules
    .filter((m) => m.speed === speed && m.distance_m >= distanceM)
    .sort((a, b) => a.distance_m - b.distance_m) // 选最短距离够用的（成本最低）
  return candidates[0] ?? null
}