/**
 * 5.2.2-522-f：网络合分模式纯逻辑
 * - 四网独立 / 管理&业务 2合1（业务网承载带内管理，关闭带外）/ 管理&业务&存储 3合1（eth_combined，OOB 独立）/ 推理 4合1（+ 推理加速平面）
 * - combineModeOf：由配置推导模式（4合1 > 3合1 > 2合1 > 独立）
 * - applyCombine：模式选择 → 配置字段补丁
 */
import type { DesignConfig } from '@/stores/design.store'

export type NetworkCombineMode = 'independent' | 'biz_oob_2in1' | 'eth_3in1' | 'inference_4in1'

export interface NetworkCombineOption {
  value: NetworkCombineMode
  label: string
  hint: string
}

export const NETWORK_COMBINE_OPTIONS: NetworkCombineOption[] = [
  { value: 'independent', label: '四网独立', hint: '参数/存储/业务/带外各自独立' },
  { value: 'biz_oob_2in1', label: '管理&业务 2合1', hint: '业务网承载带内管理，关闭带外；存储独立' },
  { value: 'eth_3in1', label: '管理&业务&存储 3合1', hint: '存储+业务+带内管理合一，带外独立' },
  { value: 'inference_4in1', label: '推理 4合1', hint: '3合1 基础上增加推理加速平面（推理 GPU 建议）' },
]

export function combineModeOf(config: {
  eth_combined?: unknown
  inference_plane?: unknown
  oob_enabled?: unknown
  biz_enabled?: unknown
}): NetworkCombineMode {
  if (config.eth_combined === true) {
    return config.inference_plane === true ? 'inference_4in1' : 'eth_3in1'
  }
  if (config.oob_enabled === false && config.biz_enabled !== false) return 'biz_oob_2in1'
  return 'independent'
}

export function applyCombine(
  _config: Partial<DesignConfig>,
  mode: NetworkCombineMode,
): Partial<DesignConfig> {
  switch (mode) {
    case 'biz_oob_2in1':
      return { eth_combined: false, oob_enabled: false, biz_enabled: true, inference_plane: false }
    case 'eth_3in1':
      return { eth_combined: true, oob_enabled: true, inference_plane: false }
    case 'inference_4in1':
      return { eth_combined: true, oob_enabled: true, inference_plane: true }
    default:
      return { eth_combined: false, inference_plane: false }
  }
}
