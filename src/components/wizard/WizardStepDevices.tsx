import React, { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard.store'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import { DEVICE_REF_KEYS } from '@/types/project-config'
import type { ProjectNetworks, ParamProtocol } from '@/types/project-config'
import type { LibraryDevice, DeviceRef } from '@/types/device-profile'
import { DeviceLibraryPicker } from './DeviceLibraryPicker'
import { Plus, X, Zap, HardDrive, Network, Monitor } from 'lucide-react'

/* ---------- IB/RoCE default switch IDs ---------- */

/** IB protocol defaults by GPU generation */
const IB_DEFAULTS_BY_GPU: Record<string, Record<string, string>> = {
  // H100 and below (400G NDR era): three-tier all MQM9700
  h100_and_below: {
    param_leaf_switch: 'nvidia_mqm9700_64_400g_ib',
    param_spine_switch: 'nvidia_mqm9700_64_400g_ib',
    param_core_switch: 'nvidia_mqm9700_64_400g_ib',
  },
  // B200/B300 (800G NDR era): Q3200 Leaf, Q3400 Spine/Core
  b300: {
    param_leaf_switch: 'nvidia_q3200_72_800g_ib',
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

/** RoCE protocol default: H3C switches */
const ROCE_DEFAULTS: Record<string, string> = {
  param_leaf_switch: 'h3c_s9850_64h',
  param_spine_switch: 'h3c_s9820_64h',
  param_core_switch: 'h3c_s9820_8c',
}

/** Fallback IB defaults (used when GPU type is unknown) */
const IB_DEFAULTS_FALLBACK: Record<string, string> = {
  param_leaf_switch: 'nvidia_mqm9700_64_400g_ib',
  param_spine_switch: 'nvidia_mqm9700_64_400g_ib',
  param_core_switch: 'nvidia_mqm9700_64_400g_ib',
}

/** Defaults for storage and other networks */
const STORAGE_DEFAULTS: Record<string, string> = {
  storage_leaf_switch: 'h3c_s6850_56hf',
  storage_spine_switch: 'h3c_s6850_56hf',
}

const BIZ_DEFAULTS: Record<string, string> = {
  biz_access_switch: 'h3c_s5560x_54s_ei',
  biz_agg_switch: 'h3c_s6520x_54qc_ei',
}

const OOB_DEFAULTS: Record<string, string> = {
  oob_access_switch: 'h3c_s5130s_52p_ei',
  oob_agg_switch: 'h3c_s5120v3_52p_ei',
}

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

/* ---------- helper: resolve IB defaults for GPU ---------- */

function resolveIBDefaults(gpuLibraryId: string | undefined): Record<string, string> {
  if (!gpuLibraryId) return IB_DEFAULTS_FALLBACK
  const id = gpuLibraryId.toLowerCase()
  if (id.includes('gb300') || id.includes('nvl72')) return IB_DEFAULTS_BY_GPU.gb300
  if (id.includes('b200') || id.includes('b300')) return IB_DEFAULTS_BY_GPU.b300
  return IB_DEFAULTS_BY_GPU.h100_and_below
}

/* ---------- helper: get default device refs ---------- */

function getDefaultRefs(protocol: ParamProtocol, gpuLibraryId?: string): Record<string, DeviceRef> {
  const refs: Record<string, DeviceRef> = {}

  // Param switches based on protocol and GPU type
  const paramDefaults = protocol === 'IB' ? resolveIBDefaults(gpuLibraryId) : ROCE_DEFAULTS
  for (const [key, deviceId] of Object.entries(paramDefaults)) {
    refs[key] = { library_id: deviceId }
  }

  // Storage defaults
  for (const [key, deviceId] of Object.entries(STORAGE_DEFAULTS)) {
    refs[key] = { library_id: deviceId }
  }

  // Biz defaults
  for (const [key, deviceId] of Object.entries(BIZ_DEFAULTS)) {
    refs[key] = { library_id: deviceId }
  }

  // OOB defaults
  for (const [key, deviceId] of Object.entries(OOB_DEFAULTS)) {
    refs[key] = { library_id: deviceId }
  }

  return refs
}

/* ---------- component ---------- */

export function WizardStepDevices() {
  const { t } = useTranslation('device')
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

  // Re-apply defaults if protocol changes (and user hasn't manually picked devices)
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

    if ((isIBDefault || isRoCEDefault) && currentLeaf !== expectedLeaf) {
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

      {DEVICE_GROUPS.map((group) => {
        const enabled = config.networks[group.networkKey]
        if (!enabled) return null

        return (
          <div
            key={group.networkKey}
            className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            {/* Section header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <span className={group.accentColor}>{group.icon}</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                {group.label}
              </span>
              <span className="text-[10px] text-gray-400">{group.description}</span>
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
                        <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 min-w-0">
                          <Zap size={12} className={group.accentColor} />
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                            {device.vendor} {device.model}
                          </span>
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {device.port_count}口·{device.port_speed}
                          </span>
                        </div>
                        <button
                          onClick={() => handleClear(refKey)}
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 shrink-0"
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
                <div className="border-t border-gray-100 dark:border-gray-700/50 pt-2 mt-1 space-y-2">
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
                            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 min-w-0">
                              <Zap size={12} className={group.accentColor} />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                                {device.vendor} {device.model}
                              </span>
                              <span className="text-[10px] text-gray-400 shrink-0">
                                {device.u_height}U·{device.power_watts}W
                              </span>
                            </div>
                            <button
                              onClick={() => handleClear(server.refKey)}
                              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 shrink-0"
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
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-gray-400">数量</span>
                            <input
                              type="number"
                              min={0}
                              value={count}
                              onChange={(e) =>
                                updateTopology({ [countKey]: Math.max(0, parseInt(e.target.value) || 0) } as any)
                              }
                              className="w-20 px-2 py-1 text-xs text-center rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
                            />
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
