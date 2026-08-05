/**
 * V3.1.3-T7-6: 共享设备选型规则（向导与 AI 共用）
 *
 * 从 WizardStepDevices 移出的默认选型规则：按协议（IB/RoCE/UEC）与 GPU 世代
 * 推荐参数网/存储网/业务网/带外网交换机默认设备。
 *
 * ⚠️ 与 backend/device_defaults.py 保持同一套映射（修改需双端同步）：
 *   - 参数网 IB 按 GPU 世代：h100_and_below → MQM9700(400G) / b300、gb300 → Q3400(800G)
 *   - 参数网 RoCE → H3C 系列
 *   - 存储网按协议：IB → Quantum HDR(200G) / RoCE、UEC → 华为 CE6881
 *   - 业务网/带外网固定默认
 */
import type { DeviceRef } from '@/types/device-profile'
import type { ParamProtocol } from '@/types/project-config'

/** IB 协议默认交换机（按 GPU 世代） */
export const IB_DEFAULTS_BY_GPU: Record<string, Record<string, string>> = {
  // H100 and below (400G NDR era): three-tier all MQM9700
  h100_and_below: {
    param_leaf_switch: 'nvidia_mqm9700_64_400g_ib',
    param_spine_switch: 'nvidia_mqm9700_64_400g_ib',
    param_core_switch: 'nvidia_mqm9700_64_400g_ib',
  },
  // B200/B300 (800G NDR era): Leaf/Spine/Core 全系 Q3400(144口,支持 72 Leaf 下行 3-tier)
  b300: {
    param_leaf_switch: 'nvidia_q3400_144_800g_ib',
    param_spine_switch: 'nvidia_q3400_144_800g_ib',
    param_core_switch: 'nvidia_q3400_144_800g_ib',
  },
  // GB300 NVL72 (800G NDR, large scale): all Q3400
  gb300: {
    param_leaf_switch: 'nvidia_q3400_144_800g_ib',
    param_spine_switch: 'nvidia_q3400_144_800g_ib',
    param_core_switch: 'nvidia_q3400_144_800g_ib',
  },
}

/** RoCE 协议默认交换机：H3C 系列 */
export const ROCE_DEFAULTS: Record<string, string> = {
  param_leaf_switch: 'h3c_s9850_64h',
  param_spine_switch: 'h3c_s9820_64h',
  param_core_switch: 'h3c_s9820_8c',
}

/** 兜底 IB 默认（GPU 类型未知时） */
export const IB_DEFAULTS_FALLBACK: Record<string, string> = {
  param_leaf_switch: 'nvidia_mqm9700_64_400g_ib',
  param_spine_switch: 'nvidia_mqm9700_64_400g_ib',
  param_core_switch: 'nvidia_mqm9700_64_400g_ib',
}

/** 存储交换机按协议分流 */
export const STORAGE_DEFAULTS_BY_PROTOCOL: Record<ParamProtocol, Record<string, string>> = {
  // IB: 复用 Quantum HDR 交换机(IB 存储与参数面共用 Quantum 系列)
  IB: {
    storage_leaf_switch: 'nvidia_mqm8700_40_200g_ib',
    storage_spine_switch: 'nvidia_mqm8700_40_200g_ib',
  },
  // RoCE: 专用存储接入交换机(ce6881,支持 RoCEv2/FC-NVMe)
  RoCE: {
    storage_leaf_switch: 'huawei_ce6881_48s6cq',
    storage_spine_switch: 'huawei_ce6881_48s6cq',
  },
  // UEC: 基于以太网,存储接入与 RoCE 一致
  UEC: {
    storage_leaf_switch: 'huawei_ce6881_48s6cq',
    storage_spine_switch: 'huawei_ce6881_48s6cq',
  },
}

/** 已知的存储默认设备 ID（用于判断用户是否手动改过） */
export const STORAGE_DEFAULT_IDS = new Set<string>([
  ...Object.values(STORAGE_DEFAULTS_BY_PROTOCOL.IB),
  ...Object.values(STORAGE_DEFAULTS_BY_PROTOCOL.RoCE),
])

/** 业务网默认交换机（biz_port_speed=25G 对齐） */
export const BIZ_DEFAULTS: Record<string, string> = {
  biz_access_switch: 'h3c_s6850_56hf',
  biz_agg_switch: 'h3c_s6520x_54qc_ei',
}

/** 带外管理网默认交换机 */
export const OOB_DEFAULTS: Record<string, string> = {
  oob_access_switch: 'h3c_s5130s_52p_ei',
  oob_agg_switch: 'h3c_s5120v3_52p_ei',
}

/** 按 GPU 设备库 id 解析 IB 默认交换机（gb300/nvl72 → 800G；b200/b300 → 800G；其余 → 400G） */
export function resolveIBDefaults(gpuLibraryId: string | undefined): Record<string, string> {
  if (!gpuLibraryId) return IB_DEFAULTS_FALLBACK
  const id = gpuLibraryId.toLowerCase()
  if (id.includes('gb300') || id.includes('nvl72')) return IB_DEFAULTS_BY_GPU.gb300
  if (id.includes('b200') || id.includes('b300')) return IB_DEFAULTS_BY_GPU.b300
  return IB_DEFAULTS_BY_GPU.h100_and_below
}

/** 生成完整默认设备引用（协议 + GPU 世代 → 全部交换机默认） */
export function getDefaultRefs(protocol: ParamProtocol, gpuLibraryId?: string): Record<string, DeviceRef> {
  const refs: Record<string, DeviceRef> = {}

  // 参数网交换机（IB 按 GPU 世代 / RoCE 固定 H3C）
  const paramDefaults = protocol === 'IB' ? resolveIBDefaults(gpuLibraryId) : ROCE_DEFAULTS
  for (const [key, deviceId] of Object.entries(paramDefaults)) {
    refs[key] = { library_id: deviceId }
  }

  // 存储网按协议
  const storageDefaults = STORAGE_DEFAULTS_BY_PROTOCOL[protocol]
  for (const [key, deviceId] of Object.entries(storageDefaults)) {
    refs[key] = { library_id: deviceId }
  }

  // 业务网 / 带外网固定默认
  for (const [key, deviceId] of Object.entries(BIZ_DEFAULTS)) {
    refs[key] = { library_id: deviceId }
  }
  for (const [key, deviceId] of Object.entries(OOB_DEFAULTS)) {
    refs[key] = { library_id: deviceId }
  }

  return refs
}
