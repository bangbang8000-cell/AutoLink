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
