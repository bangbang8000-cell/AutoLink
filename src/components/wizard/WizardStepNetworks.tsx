import React from 'react'
import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard.store'
import { Zap, HardDrive, Network, Monitor, Layers } from 'lucide-react'
import clsx from 'clsx'
import type { ProjectNetworks, ParamProtocol } from '@/types/project-config'
import { NETWORK_COMBINE_OPTIONS, combineModeOf, applyCombine, type NetworkCombineMode } from '@/utils/networkCombine'
import { TOPOLOGY_MODE_OPTIONS, topologyModeOf, applyTopologyMode, type TopologyMode } from '@/utils/topologyMode'

/** 5.2.3-523-c: RoCE 各厂商参数网最佳设备推荐（下一步「设备选型」可调整） */
const ROCE_VENDOR_HINT: Record<string, string> = {
  'H3C': '已预选：Leaf S9827 400G / Spine S9855 800G',
  '华为': '已预选：Leaf CE8861 400G / Spine CE16800 800G',
  '锐捷': '已预选：Leaf RG-S6930 400G / Spine RG-S6980 800G',
}

/** 5.2.3-523-c: vendor 为字符串字段，不参与布尔开关 */
type NetworkBooleanKey = Exclude<keyof ProjectNetworks, 'vendor'>

interface NetworkCard {
  key: NetworkBooleanKey
  label: string
  description: string
  icon: React.ReactNode
  accentColor: string
  accentBorder: string
  accentBg: string
}

const NETWORK_CARDS: NetworkCard[] = [
  {
    key: 'param_network',
    label: '参数网络',
    description: '高速参数面网络，GPU训练通信',
    icon: <Zap size={18} />,
    accentColor: 'text-gray-500 dark:text-gray-300',
    accentBorder: 'border-gray-300 dark:border-gray-600',
    accentBg: 'bg-gray-200 dark:bg-gray-600',
  },
  {
    key: 'storage_network',
    label: '存储网络',
    description: '存储网络，连接全闪/混闪存储服务器',
    icon: <HardDrive size={18} />,
    accentColor: 'text-gray-500 dark:text-gray-300',
    accentBorder: 'border-gray-300 dark:border-gray-600',
    accentBg: 'bg-gray-200 dark:bg-gray-600',
  },
  {
    key: 'biz_network',
    label: '业务/带内管理',
    description: '业务网络与带内管理',
    icon: <Network size={18} />,
    accentColor: 'text-gray-500 dark:text-gray-300',
    accentBorder: 'border-gray-300 dark:border-gray-600',
    accentBg: 'bg-gray-200 dark:bg-gray-600',
  },
  {
    key: 'oob_network',
    label: '带外管理',
    description: '带外管理网络，IPMI/BMC',
    icon: <Monitor size={18} />,
    accentColor: 'text-gray-500 dark:text-gray-300',
    accentBorder: 'border-gray-300 dark:border-gray-600',
    accentBg: 'bg-gray-200 dark:bg-gray-600',
  },
]

export function WizardStepNetworks() {
  useTranslation('device')
  const { config, updateNetworks, updateTopology } = useWizardStore()

  const toggle = (key: NetworkBooleanKey) => {
    updateNetworks({ [key]: !config.networks[key] })
  }

  const setProtocol = (protocol: ParamProtocol) => {
    updateTopology({ param_protocol: protocol })
  }

  // 5.2.2-522-f: 网络合分模式（向导侧，映射到 ProjectNetworks/ProjectTopology）
  const combineMode = combineModeOf({
    eth_combined: config.networks.eth_combined,
    inference_plane: config.topology.inference_plane,
    oob_enabled: config.networks.oob_network,
    biz_enabled: config.networks.biz_network,
  })

  const setCombineMode = (mode: NetworkCombineMode) => {
    const patch = applyCombine({}, mode)
    updateNetworks({
      eth_combined: patch.eth_combined,
      oob_network: patch.oob_enabled !== false,
      biz_network: patch.biz_enabled !== false,
    })
    updateTopology({ inference_plane: patch.inference_plane })
  }

  // 5.2.2-522-a (F522-1): 参数网拓扑三模式（向导统一入口）
  const topologyMode = topologyModeOf({
    param_network_mode: config.topology.param_network_mode,
    dual_plane_enabled: config.topology.dual_plane_enabled,
  })

  const setTopologyMode = (mode: TopologyMode) => {
    const patch = applyTopologyMode({}, mode)
    updateTopology({
      param_network_mode: patch.param_network_mode,
      dual_plane_enabled: patch.dual_plane_enabled,
    })
  }

  const paramEnabled = config.networks.param_network

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
          网络类型选择
        </h3>
        <p className="text-xs text-gray-400">
          选择本项目需要包含的网络类型
        </p>
      </div>

      <div className="space-y-3">
        {NETWORK_CARDS.map((card) => {
          const active = config.networks[card.key]
          return (
            <div key={card.key}>
              <div
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-colors cursor-pointer',
                  active
                    ? card.accentBorder
                    : 'border-gray-200 dark:border-edge-subtle hover:border-gray-300 dark:hover:border-gray-600',
                  active ? card.accentBg : 'bg-white dark:bg-app-elevated',
                )}
                onClick={() => toggle(card.key)}
              >
                {/* Icon */}
                <div
                  className={clsx(
                    'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                    active ? card.accentBg : 'bg-gray-100 dark:bg-gray-700',
                  )}
                >
                  <span className={active ? card.accentColor : 'text-gray-400'}>
                    {card.icon}
                  </span>
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {card.label}
                  </div>
                  <div className="text-xs text-gray-400">
                    {card.description}
                  </div>
                </div>

                {/* Toggle switch */}
                <label className="relative inline-flex items-center cursor-pointer shrink-0" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggle(card.key)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                </label>
              </div>

              {/* IB/RoCE protocol selector (shown when param_network is enabled) */}
              {card.key === 'param_network' && paramEnabled && (
                <div className="mt-2 ml-14 flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    协议类型:
                  </span>
                  <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                    <button
                      onClick={() => setProtocol('IB')}
                      className={clsx(
                        'px-3 py-1 text-xs rounded-md transition-colors',
                        config.topology.param_protocol === 'IB'
                          ? 'bg-white dark:bg-app-hover text-primary-700 dark:text-primary-300 font-medium shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
                      )}
                    >
                      InfiniBand (IB)
                    </button>
                    <button
                      onClick={() => setProtocol('RoCE')}
                      className={clsx(
                        'px-3 py-1 text-xs rounded-md transition-colors',
                        config.topology.param_protocol === 'RoCE'
                          ? 'bg-white dark:bg-app-hover text-primary-700 dark:text-primary-300 font-medium shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
                      )}
                    >
                      RoCEv2
                    </button>
                  </div>
                  <span className="text-2xs text-gray-400">
                    {config.topology.param_protocol === 'IB'
                      ? 'IB 优先推荐 NVIDIA 交换机'
                      : 'RoCE 优先推荐 H3C 交换机'}
                  </span>
                  {config.topology.param_protocol === 'RoCE' && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">RoCE 厂商</span>
                      <select
                        value={config.networks.vendor || 'H3C'}
                        onChange={(e) => updateNetworks({ vendor: e.target.value })}
                        className="px-2 py-1 text-xs rounded-md border border-app-border bg-app-panel"
                      >
                        <option value="H3C">H3C（推荐）</option>
                        <option value="华为">华为</option>
                        <option value="锐捷">锐捷</option>
                      </select>
                      <span className="text-2xs text-gray-400">
                        {ROCE_VENDOR_HINT[config.networks.vendor || 'H3C']}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 5.2.2-522-a (F522-1): 参数网拓扑模式（轨道优化/双平面/Zcube） */}
              {card.key === 'param_network' && paramEnabled && (
                <div className="mt-2 ml-14 flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    拓扑模式:
                  </span>
                  <select
                    value={topologyMode}
                    onChange={(e) => setTopologyMode(e.target.value as TopologyMode)}
                    className="px-2 py-1 text-xs rounded-md border border-app-border bg-app-panel"
                  >
                    {TOPOLOGY_MODE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <span className="text-2xs text-gray-400">
                    {TOPOLOGY_MODE_OPTIONS.find((o) => o.value === topologyMode)?.hint}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 5.2.2-522-f: 网络合分模式（四网独立 / 管理&业务2合1 / 3合1 / 推理4合1） */}
      <div className="rounded-lg border border-gray-200 dark:border-edge-subtle p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">
          <Layers size={14} className="text-primary-500" />
          网络合分模式
        </div>
        <select
          value={combineMode}
          onChange={(e) => setCombineMode(e.target.value as NetworkCombineMode)}
          className="w-full px-2 py-1.5 text-xs rounded-md border border-app-border bg-app-panel text-gray-700 dark:text-gray-200"
        >
          {NETWORK_COMBINE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="text-2xs text-gray-400">
          {NETWORK_COMBINE_OPTIONS.find((o) => o.value === combineMode)?.hint}
        </p>
        {combineMode === 'inference_4in1' && (
          <p className="text-2xs text-primary-600 dark:text-primary-400">
            推理 4 合 1：3 合 1 基础上增加推理加速平面（独立精简参数面，收敛比 1:1~3:1）。推理 GPU 数量可在下一步设备选型后调整。
          </p>
        )}
      </div>
    </div>
  )
}
