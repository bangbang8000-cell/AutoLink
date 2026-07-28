import React from 'react'
import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard.store'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import { DEVICE_REF_KEYS } from '@/types/project-config'
import type { ProjectNetworks } from '@/types/project-config'
import { Activity, HardDrive, Globe, Wifi, Check } from 'lucide-react'
import clsx from 'clsx'

/* ---------- network badge config ---------- */

interface NetworkBadge {
  key: keyof ProjectNetworks
  label: string
  icon: React.ReactNode
  color: string
}

const NETWORK_BADGES: NetworkBadge[] = [
  { key: 'param_network', label: '参数网络', icon: <Activity size={10} />, color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' },
  { key: 'storage_network', label: '存储网络', icon: <HardDrive size={10} />, color: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' },
  { key: 'biz_network', label: '业务/带内管理', icon: <Globe size={10} />, color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' },
  { key: 'oob_network', label: '带外管理', icon: <Wifi size={10} />, color: 'bg-gray-100 dark:bg-gray-900/30 text-gray-600 dark:text-gray-400' },
]

/* ---------- device ref groups per network ---------- */

const DEVICE_REF_GROUPS: Record<string, string[]> = {
  param_network: ['gpu_server', 'param_leaf_switch', 'param_spine_switch', 'param_core_switch'],
  storage_network: ['all_flash_storage_server', 'hybrid_flash_storage_server', 'storage_leaf_switch', 'storage_spine_switch'],
  biz_network: ['compute_server', 'biz_access_switch', 'biz_agg_switch'],
  oob_network: ['compute_server', 'oob_access_switch', 'oob_agg_switch'],
}

/* ---------- component ---------- */

export function WizardStepConfirm() {
  const { t } = useTranslation('device')
  const { config } = useWizardStore()
  const { allDevices } = useDeviceLibraryStore()

  const findDevice = (refKey: string) => {
    const ref = config.device_refs[refKey]
    if (!ref) return null
    return allDevices.find((d) => d.id === ref.library_id) ?? null
  }

  const enabledNetworks = NETWORK_BADGES.filter((n) => config.networks[n.key])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
          确认配置
        </h3>
        <p className="text-xs text-gray-400">
          请确认以下项目配置信息
        </p>
      </div>

      {/* Basic info */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          基本信息
        </h4>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-gray-400 w-16 shrink-0">名称</span>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {config.meta.name || '—'}
          </span>
        </div>
        {config.meta.description && (
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-gray-400 w-16 shrink-0">描述</span>
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {config.meta.description}
            </span>
          </div>
        )}
      </div>

      {/* Networks */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          网络类型
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {enabledNetworks.length === 0 ? (
            <span className="text-xs text-gray-400">未选择网络</span>
          ) : (
            enabledNetworks.map((net) => (
              <span
                key={net.key}
                className={clsx(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium',
                  net.color,
                )}
              >
                {net.icon}
                {net.label}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Devices per network */}
      {enabledNetworks.map((net) => {
        const refKeys = DEVICE_REF_GROUPS[net.key] || []
        return (
          <div
            key={net.key}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium', net.color)}>
                {net.icon}
                {net.label}
              </span>
              <span className="text-xs text-gray-400">设备</span>
            </div>

            <div className="space-y-1.5">
              {refKeys.map((refKey) => {
                const device = findDevice(refKey)
                const label = DEVICE_REF_KEYS[refKey] || refKey
                return (
                  <div key={refKey} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-24 shrink-0">{label}</span>
                    {device ? (
                      <span className="text-xs text-gray-700 dark:text-gray-200">
                        {device.vendor} {device.model}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 italic">未选择</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Server counts */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          服务器数量
        </h4>
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">
              {config.topology.num_gpu_servers}
            </div>
            <div className="text-[10px] text-gray-400">GPU服务器</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">
              {config.topology.num_all_flash_storage}
            </div>
            <div className="text-[10px] text-gray-400">全闪存储(2U)</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">
              {config.topology.num_hybrid_flash_storage}
            </div>
            <div className="text-[10px] text-gray-400">混闪存储(4U)</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">
              {config.topology.num_compute_servers}
            </div>
            <div className="text-[10px] text-gray-400">通算服务器</div>
          </div>
        </div>
      </div>

      {/* Rack config */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          机柜配置
        </h4>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-gray-400 w-20 shrink-0">机柜类型</span>
          <span className="text-sm text-gray-700 dark:text-gray-200">
            {config.rack_config.rack_type}U
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-gray-400 w-20 shrink-0">功率上限</span>
          <span className="text-sm text-gray-700 dark:text-gray-200">
            {config.rack_config.power_limit_per_rack}W
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-gray-400 w-20 shrink-0">命名前缀</span>
          <span className="text-sm text-gray-700 dark:text-gray-200">
            {config.rack_config.naming_prefix || '—'}
          </span>
        </div>
      </div>
    </div>
  )
}