import React, { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard.store'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import { DEVICE_REF_KEYS } from '@/types/project-config'
import type { ProjectNetworks } from '@/types/project-config'
import type { LibraryDevice, DeviceRef } from '@/types/device-profile'
import {
  getDefaultRefs,
  resolveIBDefaults,
  IB_DEFAULTS_BY_GPU,
  ROCE_DEFAULTS,
  STORAGE_DEFAULTS_BY_PROTOCOL,
  STORAGE_DEFAULT_IDS,
} from '@/utils/device-defaults'
import { DeviceLibraryPicker } from './DeviceLibraryPicker'
import { Plus, X, Zap, HardDrive, Network, Monitor } from 'lucide-react'

/* ---------- device ref key groups per network ---------- */

interface DeviceGroup {
  networkKey: keyof ProjectNetworks
  label: string
  description: string
  icon: React.ReactNode
  accentColor: string
  refKeys: string[]
  serverRefKeys: { refKey: string; countKey: string; label: string; category: string }[]
}

// 打磨轮（AL-B4）：一键选厂商预设（网络设备/服务器双维度）
const NETWORK_VENDORS = ['NVIDIA', '华为', 'H3C', '锐捷']
const SERVER_VENDORS = ['超微', '华为', 'H3C', '中兴', '浪潮', '曙光']

const VENDOR_ALIASES: Record<string, string[]> = {
  NVIDIA: ['nvidia', '英伟达'],
  '华为': ['huawei', '华为'],
  H3C: ['h3c', '华三'],
  '锐捷': ['ruijie', '锐捷'],
  '超微': ['supermicro', '超微'],
  '中兴': ['zte', '中兴'],
  '浪潮': ['inspur', '浪潮'],
  '曙光': ['sugon', '曙光'],
}

const matchesVendor = (deviceVendor: string, preset: string): boolean =>
  (VENDOR_ALIASES[preset] ?? [preset.toLowerCase()]).some((a) => deviceVendor.toLowerCase().includes(a))

const DEVICE_GROUPS: DeviceGroup[] = [
  {
    networkKey: 'param_network',
    label: '参数网络',
    description: '高速参数面网络',
    icon: <Zap size={16} />,
    accentColor: 'text-gray-500',
    refKeys: ['param_leaf_switch', 'param_spine_switch', 'param_core_switch'],
            serverRefKeys: [
              { refKey: 'gpu_server', countKey: 'num_gpu_servers', label: 'GPU服务器', category: 'gpu_servers' },
            ],
  },
  {
    networkKey: 'storage_network',
    label: '存储网络',
    description: '全闪存储(2U) + 混闪存储(4U)',
    icon: <HardDrive size={16} />,
    accentColor: 'text-gray-500',
    refKeys: ['storage_leaf_switch', 'storage_spine_switch'],
    serverRefKeys: [
      { refKey: 'all_flash_storage_server', countKey: 'num_all_flash_storage', label: '全闪存储(2U)', category: 'storage_servers' },
      { refKey: 'hybrid_flash_storage_server', countKey: 'num_hybrid_flash_storage', label: '混闪存储(4U)', category: 'storage_servers' },
    ],
  },
  {
    networkKey: 'biz_network',
    label: '业务/带内管理',
    description: '业务网接入与汇聚 + 通算服务器',
    icon: <Network size={16} />,
    accentColor: 'text-gray-500',
    refKeys: ['biz_access_switch', 'biz_agg_switch'],
    serverRefKeys: [
      { refKey: 'compute_server', countKey: 'num_compute_servers', label: '通算服务器', category: 'compute_servers' },
    ],
  },
  {
    networkKey: 'oob_network',
    label: '带外管理',
    description: '带外管理网络接入与汇聚',
    icon: <Monitor size={16} />,
    accentColor: 'text-gray-500',
    refKeys: ['oob_access_switch', 'oob_agg_switch'],
    serverRefKeys: [],
  },
]

/* ---------- component ---------- */

export function WizardStepDevices() {
  const { t } = useTranslation('project')
  const { config, updateDeviceRefs, updateTopology, removeDeviceRef } = useWizardStore()
  const { allDevices } = useDeviceLibraryStore()

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<string | null>(null)
  const [pickerLabel, setPickerLabel] = useState('')
  const [pickerCategory, setPickerCategory] = useState<string>('all')
  const [defaultsApplied, setDefaultsApplied] = useState(false)

  // Apply smart defaults on first render
  useEffect(() => {
    if (defaultsApplied) return
    const hasAnyRef = Object.keys(config.device_refs).length > 0
    if (hasAnyRef) {
      setDefaultsApplied(true)
      return
    }

    // Apply defaults based on protocol and GPU type
    const gpuId = config.device_refs.gpu_server?.library_id
    const defaults = getDefaultRefs(config.topology.param_protocol, gpuId)
    updateDeviceRefs(defaults)
    setDefaultsApplied(true)
  }, [])

  // T5: Re-apply defaults if protocol changes (and user hasn't manually picked devices)
  useEffect(() => {
    const protocol = config.topology.param_protocol
    const gpuId = config.device_refs.gpu_server?.library_id
    const expectedDefaults = resolveIBDefaults(gpuId)
    const expectedLeaf = protocol === 'IB' ? expectedDefaults.param_leaf_switch : ROCE_DEFAULTS.param_leaf_switch
    const currentLeaf = config.device_refs.param_leaf_switch?.library_id

    // Only auto-switch if the current leaf matches one of the known defaults (user hasn't overridden)
    const isIBDefault = Object.values(IB_DEFAULTS_BY_GPU.h100_and_below).includes(currentLeaf || '')
      || Object.values(IB_DEFAULTS_BY_GPU.b300).includes(currentLeaf || '')
      || Object.values(IB_DEFAULTS_BY_GPU.gb300).includes(currentLeaf || '')
    const isRoCEDefault = Object.values(ROCE_DEFAULTS).includes(currentLeaf || '')

    // T5: 也检查存储交换机是否需要联动切换
    const expectedStorageLeaf = STORAGE_DEFAULTS_BY_PROTOCOL[protocol].storage_leaf_switch
    const currentStorageLeaf = config.device_refs.storage_leaf_switch?.library_id
    const storageNeedsSwitch = STORAGE_DEFAULT_IDS.has(currentStorageLeaf || '')
      && currentStorageLeaf !== expectedStorageLeaf

    if (((isIBDefault || isRoCEDefault) && currentLeaf !== expectedLeaf) || storageNeedsSwitch) {
      const defaults = getDefaultRefs(protocol, gpuId)
      updateDeviceRefs(defaults)
    }
  }, [config.topology.param_protocol])

  /* ---------- picker callbacks ---------- */

  const openPicker = useCallback((refKey: string, label: string, category?: string) => {
    setPickerTarget(refKey)
    setPickerLabel(label)
    setPickerCategory(category || 'all')
    setPickerOpen(true)
  }, [])

  const handleDeviceSelect = useCallback(
    (device: LibraryDevice) => {
      if (!pickerTarget) return
      const ref: DeviceRef = { library_id: device.id }
      updateDeviceRefs({ [pickerTarget]: ref })
    },
    [pickerTarget, updateDeviceRefs],
  )

  const handleClear = useCallback(
    (refKey: string) => {
      removeDeviceRef(refKey)
    },
    [removeDeviceRef],
  )

  // 打磨轮（AL-B4）：一键选厂商 → 按厂商过滤设备库并预填设备类型（缺型号不预填，走"选择设备"搜索补齐）
  const applyVendorPreset = useCallback((vendor: string, kind: 'network' | 'server') => {
    const refs: Record<string, DeviceRef> = {}
    if (kind === 'network') {
      const enabledSwitchRefs = DEVICE_GROUPS
        .filter((g) => config.networks[g.networkKey])
        .flatMap((g) => g.refKeys)
      for (const refKey of enabledSwitchRefs) {
        const device = allDevices.find((d) =>
          d.category.startsWith('switches') && matchesVendor(d.vendor, vendor))
        if (device) refs[refKey] = { library_id: device.id }
      }
    } else {
      const enabledServerRefs = DEVICE_GROUPS
        .filter((g) => config.networks[g.networkKey])
        .flatMap((g) => g.serverRefKeys.map((s) => s.refKey))
      for (const refKey of enabledServerRefs) {
        const entry = DEVICE_GROUPS.flatMap((g) => g.serverRefKeys).find((s) => s.refKey === refKey)
        if (!entry) continue
        const device = allDevices.find((d) =>
          d.category.startsWith(entry.category) && matchesVendor(d.vendor, vendor))
        if (device) refs[refKey] = { library_id: device.id }
      }
    }
    if (Object.keys(refs).length > 0) updateDeviceRefs(refs)
  }, [allDevices, config.networks, updateDeviceRefs])

  /* ---------- find device in library ---------- */

  const findDevice = (refKey: string): LibraryDevice | undefined => {
    const ref = config.device_refs[refKey]
    if (!ref) return undefined
    return allDevices.find((d) => d.id === ref.library_id)
  }

  /* ---------- render ---------- */

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
          设备选择
        </h3>
        <p className="text-xs text-gray-400">
          协议 {config.topology.param_protocol === 'IB' ? 'IB' : 'RoCE'} — 已为您推荐默认交换机，可按需更换
        </p>
      </div>

      {/* 打磨轮（AL-B4/B5）：一键选厂商 → 预填同厂商设备；缺型号可"选择设备"搜索补齐、已填可校对 */}
      <div className="rounded-lg border border-gray-200 dark:border-edge-subtle p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-gray-500 w-16 shrink-0">网络设备厂商</span>
          {NETWORK_VENDORS.map((v) => (
            <button key={v} type="button" onClick={() => applyVendorPreset(v, 'network')}
              className="px-2.5 py-1 text-xs rounded border border-gray-200 dark:border-edge-subtle hover:border-primary-400 hover:text-primary-500 text-gray-600 dark:text-gray-300">
              {v}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-gray-500 w-16 shrink-0">服务器厂商</span>
          {SERVER_VENDORS.map((v) => (
            <button key={v} type="button" onClick={() => applyVendorPreset(v, 'server')}
              className="px-2.5 py-1 text-xs rounded border border-gray-200 dark:border-edge-subtle hover:border-primary-400 hover:text-primary-500 text-gray-600 dark:text-gray-300">
              {v}
            </button>
          ))}
        </div>
        <p className="text-2xs text-gray-400">点选厂商后自动预填该厂商设备类型（仅已启用网络）；厂商缺某型号时点「选择设备」搜索补齐，已填设备可逐项更换校对。</p>
      </div>

      {DEVICE_GROUPS.map((group) => {
        const enabled = config.networks[group.networkKey]
        if (!enabled) return null

        return (
          <div
            key={group.networkKey}
            className="rounded-lg border border-gray-200 dark:border-edge-subtle overflow-hidden"
          >
            {/* Section header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-app/50 border-b border-gray-200 dark:border-edge-subtle">
              <span className={group.accentColor}>{group.icon}</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                {group.label}
              </span>
              <span className="text-2xs text-gray-400">{group.description}</span>
            </div>

            <div className="p-3 space-y-2">
              {/* Switch device refs */}
              {group.refKeys.map((refKey) => {
                const device = findDevice(refKey)
                const label = DEVICE_REF_KEYS[refKey] || refKey

                return (
                  <div key={refKey} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-28 shrink-0">
                      {label}
                    </span>

                    {device ? (
                      <>
                        <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app min-w-0">
                          <Zap size={12} className={group.accentColor} />
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                            {device.vendor} {device.model}
                          </span>
                          <span className="text-2xs text-gray-400 shrink-0">
                            {device.port_count}口·{device.port_speed}
                          </span>
                        </div>
                        <button
                          onClick={() => handleClear(refKey)}
                          className="p-1.5 rounded hover:bg-error-50 dark:hover:bg-error-900/20 text-gray-400 hover:text-error-500 shrink-0"
                          title="更换设备"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => openPicker(refKey, label)}
                        className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 text-gray-400 hover:text-primary-500 text-xs transition-colors"
                      >
                        <Plus size={14} />
                        选择设备
                      </button>
                    )}
                  </div>
                )
              })}

              {/* Server refs with counts */}
              {group.serverRefKeys.length > 0 && (
                <div className="border-t border-gray-100 dark:border-edge-subtle/50 pt-2 mt-1 space-y-2">
                  {group.serverRefKeys.map((server) => {
                    const device = findDevice(server.refKey)
                    const label = server.label
                    const countKey = server.countKey as keyof typeof config.topology
                    const count = config.topology[countKey] as number

                    return (
                      <div key={server.refKey} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-28 shrink-0">
                          {label}
                        </span>

                        {device ? (
                          <>
                            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app min-w-0">
                              <Zap size={12} className={group.accentColor} />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                                {device.vendor} {device.model}
                              </span>
                              <span className="text-2xs text-gray-400 shrink-0">
                                {device.u_height}U·{device.power_watts}W
                              </span>
                            </div>
                            <button
                              onClick={() => handleClear(server.refKey)}
                              className="p-1.5 rounded hover:bg-error-50 dark:hover:bg-error-900/20 text-gray-400 hover:text-error-500 shrink-0"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => openPicker(server.refKey, label, server.category)}
                            className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 text-gray-400 hover:text-primary-500 text-xs transition-colors"
                          >
                            <Plus size={14} />
                            选择设备
                          </button>
                        )}

                        {/* Server count */}
                        {count !== undefined && (
                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                            <div className="flex items-center gap-1">
                              <span className="text-2xs text-gray-400">数量</span>
                              <input
                                type="number"
                                min={0}
                                max={2048}
                                value={count}
                                onChange={(e) =>
                                  updateTopology({ [countKey]: Math.max(0, parseInt(e.target.value) || 0) } as Partial<typeof config.topology>)
                                }
                                className={`w-20 px-2 py-1 text-xs text-center rounded border bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400 ${count > 2048 ? 'border-error-400 dark:border-error-500' : 'border-gray-300 dark:border-gray-600'}`}
                              />
                            </div>
                            {/* V2.9.2-T6: 数量上限提示 */}
                            {count > 2048 && (
                              <span className="text-2xs text-error-500 dark:text-error-400">
                                {t('wizard.countExceeds', '单类服务器数量上限 2048')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Device picker */}
      <DeviceLibraryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleDeviceSelect}
        deviceLabel={pickerLabel}
        initialCategory={pickerCategory}
      />
    </div>
  )
}
