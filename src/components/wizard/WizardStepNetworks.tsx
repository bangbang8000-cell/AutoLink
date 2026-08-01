import React from 'react'
import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard.store'
import { Zap, HardDrive, Network, Monitor } from 'lucide-react'
import clsx from 'clsx'
import type { ProjectNetworks, ParamProtocol } from '@/types/project-config'

interface NetworkCard {
  key: keyof ProjectNetworks
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

  const toggle = (key: keyof ProjectNetworks) => {
    updateNetworks({ [key]: !config.networks[key] })
  }

  const setProtocol = (protocol: ParamProtocol) => {
    updateTopology({ param_protocol: protocol })
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
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
