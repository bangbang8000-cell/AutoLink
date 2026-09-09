/**
 * 523-d: 一键选厂商 —— 纯函数选型语义
 *
 * 修复历史问题：applyVendorPreset 对每个交换机 refKey 一律取"第一个同厂商交换机"，
 * 导致 param/storage/biz/oob 的 leaf/spine/core 全被填成同一台设备。
 * 本模块按 (网络类型, 角色档位, 厂商) 三元组做确定性选型。
 */
import type { LibraryDevice, NetworkType } from '@/types/device-profile'
import { matchesVendor } from '@/constants/labels'

/* ---------- refKey → 网络类型 ---------- */

const REFKEY_NETWORK_MAP: Record<string, NetworkType> = {
  param_leaf_switch: 'param',
  param_spine_switch: 'param',
  param_core_switch: 'param',
  storage_leaf_switch: 'storage',
  storage_spine_switch: 'storage',
  biz_access_switch: 'biz',
  biz_agg_switch: 'biz',
  oob_access_switch: 'oob',
  oob_agg_switch: 'oob',
}

export function refKeyNetwork(refKey: string): NetworkType | undefined {
  return REFKEY_NETWORK_MAP[refKey]
}

/* ---------- refKey → 角色档位 ---------- */

/** 角色档位：0=接入/TOR（低端口），1=汇聚/Spine（中位），2=核心/Core（高端口） */
type SwitchRole = 0 | 1 | 2

const REFKEY_ROLE_MAP: Record<string, SwitchRole> = {
  param_leaf_switch: 0,
  param_spine_switch: 1,
  param_core_switch: 2,
  storage_leaf_switch: 0,
  storage_spine_switch: 1,
  biz_access_switch: 0,
  biz_agg_switch: 1,
  oob_access_switch: 0,
  oob_agg_switch: 1,
}

/**
 * 按网络类型 + 厂商过滤候选交换机，并按角色档位取端口数：
 * - 接入/TOR → 端口数最少
 * - 汇聚/Spine → 端口数居中（无多档时回退最近一档）
 * - 核心/Core → 端口数最多
 * 无匹配返回 undefined（该 refKey 不预填，走"选择设备"搜索补齐）。
 */
export function selectSwitchForRefKey(
  refKey: string,
  vendor: string,
  allDevices: LibraryDevice[],
): LibraryDevice | undefined {
  const network = REFKEY_NETWORK_MAP[refKey]
  const role = REFKEY_ROLE_MAP[refKey]
  if (!network || role === undefined) return undefined

  const candidates = allDevices.filter(
    (d) =>
      Array.isArray(d.applicable_networks) &&
      d.applicable_networks.includes(network) &&
      typeof d.port_count === 'number' &&
      matchesVendor(d.vendor, vendor),
  )
  if (candidates.length === 0) return undefined

  const byPorts = [...candidates].sort((a, b) => (a.port_count ?? 0) - (b.port_count ?? 0))
  if (role === 0) return byPorts[0]
  if (role === 2) return byPorts[byPorts.length - 1]
  // 汇聚/Spine：取端口序列中位（约 2 档及以上时居中；仅 1 档时取唯一）
  const mid = Math.round((byPorts.length - 1) / 2)
  return byPorts[mid]
}

/**
 * 服务器按精确 category 匹配（杜绝 storage_servers 前缀把 all_flash/hybrid_flash 撞到同一台）。
 */
export function selectServerForCategory(
  category: string,
  vendor: string,
  allDevices: LibraryDevice[],
): LibraryDevice | undefined {
  const device = allDevices.find(
    (d) => d.category === category && matchesVendor(d.vendor, vendor),
  )
  return device
}
