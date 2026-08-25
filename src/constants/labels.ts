/* ================================================================
 *  AutoLink — 中文标签映射（避免界面中显示编程 ID）
 * ================================================================ */

/** 拓扑节点类型 → 中文标签 */
export const NODE_TYPE_LABELS: Record<string, string> = {
  server: '服务器',
  param_leaf: '参数网 Leaf',
  param_spine: '参数网 Spine',
  param_core: '参数网 Core',
  storage_leaf: '存储网 Leaf',
  storage_spine: '存储网 Spine',
  storage_core: '存储网 Core',
  oob_access: '带外接入',
  oob_agg: '带外汇聚',
  biz_access: '业务接入',
  biz_agg: '业务汇聚',
}

/** 设备分类 key → 中文标签 */
export const DEVICE_CATEGORY_LABELS: Record<string, string> = {
  gpu_servers: 'GPU服务器',
  storage_servers: '存储服务器',
  storage_servers_all_flash: '全闪存储',
  storage_servers_hybrid_flash: '混闪存储',
  compute_servers: '通算服务器',
  switches: '交换机',
  switches_param: '参数面交换机',
  switches_storage: '存储交换机',
  switches_biz: '业务交换机',
  switches_oob: '带外交换机',
  custom: '自定义',
}

/** 网络类型 → 中文标签 */
export const NETWORK_TYPE_LABELS: Record<string, string> = {
  param: '参数网',
  storage: '存储网',
  biz: '业务网',
  oob: '带外网',
}

/* ================================================================
 *  厂商目录（单源） — 网络设备 / 服务器厂商预设及别名、匹配工具
 * ================================================================ */

/** 网络设备厂商预设（一键选厂商） */
export const NETWORK_VENDORS = ['NVIDIA', '华为', 'H3C', '锐捷']

/** 服务器厂商预设（一键选厂商） */
export const SERVER_VENDORS = ['超微', '华为', 'H3C', '中兴', '浪潮', '曙光']

/** 厂商别名表：统一厂商名 → 常见拼写/中文别名 */
export const VENDOR_ALIASES: Record<string, string[]> = {
  NVIDIA: ['nvidia', '英伟达'],
  '华为': ['huawei', '华为'],
  H3C: ['h3c', '华三'],
  '锐捷': ['ruijie', '锐捷'],
  '超微': ['supermicro', '超微'],
  '中兴': ['zte', '中兴'],
  '浪潮': ['inspur', '浪潮'],
  '曙光': ['sugon', '曙光'],
}

/** 全部厂商（按出现顺序去重，用于设备库筛选下拉） */
export const ALL_VENDORS = Array.from(new Set([...NETWORK_VENDORS, ...SERVER_VENDORS]))

/** 判定设备厂商是否属于某预设厂商（含别名匹配） */
export function matchesVendor(deviceVendor: string, preset: string): boolean {
  return (VENDOR_ALIASES[preset] ?? [preset.toLowerCase()])
    .some((a) => deviceVendor.toLowerCase().includes(a))
}
