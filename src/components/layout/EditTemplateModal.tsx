import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import { DeviceLibraryPicker } from '@/components/wizard/DeviceLibraryPicker'
import { DEVICE_REF_KEYS } from '@/types/project-config'
import type {
  ProjectConfig,
  ProjectNetworks,
  ProjectRackConfig,
  RackCoolingMethod,
  ParamProtocol,
} from '@/types/project-config'
import type { LibraryDevice } from '@/types/device-profile'
import {
  ChevronDown, ChevronRight, Plus, X,
  Zap, HardDrive, Network, Monitor, Snowflake, Cpu, Layers, FileJson,
} from 'lucide-react'
import clsx from 'clsx'

interface TemplateData {
  id: string
  name: string
  description: string
  scenario: string
  tags: string[]
}

interface Props {
  template: TemplateData
  onConfirm: (updates: {
    name: string
    description: string
    scenario: string
    tags: string[]
    projectConfig: string
  }) => Promise<void>
  onClose: () => void
}

/* ---------- 选型分组（与 WizardStepDevices 一致） ---------- */

interface DeviceGroup {
  networkKey: keyof ProjectNetworks
  label: string
  icon: React.ReactNode
  refKeys: string[]
}

const DEVICE_GROUPS: DeviceGroup[] = [
  {
    networkKey: 'param_network',
    label: '参数网络',
    icon: <Zap size={14} />,
    refKeys: ['gpu_server', 'param_leaf_switch', 'param_spine_switch', 'param_core_switch'],
  },
  {
    networkKey: 'storage_network',
    label: '存储网络',
    icon: <HardDrive size={14} />,
    refKeys: ['all_flash_storage_server', 'hybrid_flash_storage_server', 'storage_leaf_switch', 'storage_spine_switch'],
  },
  {
    networkKey: 'biz_network',
    label: '业务/带内管理',
    icon: <Network size={14} />,
    refKeys: ['compute_server', 'biz_access_switch', 'biz_agg_switch'],
  },
  {
    networkKey: 'oob_network',
    label: '带外管理',
    icon: <Monitor size={14} />,
    refKeys: ['oob_access_switch', 'oob_agg_switch'],
  },
]

const NETWORK_KEYS: { key: keyof ProjectNetworks; label: string }[] = [
  { key: 'param_network', label: '参数网络' },
  { key: 'storage_network', label: '存储网络' },
  { key: 'biz_network', label: '业务/带内管理' },
  { key: 'oob_network', label: '带外管理' },
]

const PROTOCOL_OPTIONS: ParamProtocol[] = ['IB', 'RoCE', 'UEC']

const RACK_TYPE_OPTIONS = [
  { value: 42 as const, label: '42U' },
  { value: 49 as const, label: '49U' },
]

const POWER_PRESETS = [
  { id: '6kw', label: '6KW', value: 6000 },
  { id: '12kw', label: '12KW', value: 12000 },
  { id: '16kw', label: '16KW', value: 16000 },
  { id: '30kw', label: '30KW', value: 30000 },
  { id: '60kw', label: '60KW', value: 60000 },
]

const COOLING_OPTIONS: { value: RackCoolingMethod; label: string; hint: string }[] = [
  { value: 'air', label: '风冷', hint: '≤15KW/柜' },
  { value: 'cold_plate', label: '冷板液冷', hint: '≤60KW/柜' },
  { value: 'immersion', label: '浸没式液冷', hint: '≤100KW/柜' },
]

/* ---------- 通用表单小控件 ---------- */

const inputCls =
  'w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{label}</label>
      {children}
      {hint && <p className="text-2xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
      {icon}
      {title}
    </div>
  )
}

/* ---------- 组件 ---------- */

export function EditTemplateModal({ template, onConfirm, onClose }: Props) {
  const { t } = useTranslation()
  const { allDevices } = useDeviceLibraryStore()

  // 元信息
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description || '')
  const [scenario, setScenario] = useState(template.scenario || '')
  const [tagsText, setTagsText] = useState((template.tags || []).join(', '))

  // 配置（表单唯一真相源）
  const [config, setConfig] = useState<ProjectConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configLoadFailed, setConfigLoadFailed] = useState(false)

  // JSON 原文面板
  const [jsonDirty, setJsonDirty] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonOpen, setJsonOpen] = useState(false)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 选型
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<string | null>(null)
  const [pickerLabel, setPickerLabel] = useState('')
  const [pickerCategory, setPickerCategory] = useState('all')

  // 加载模板 project_config.json
  useEffect(() => {
    window.electron?.template?.getConfig(template.id)
      .then((cfg) => {
        if (cfg) {
          setConfig(cfg)
        } else {
          setConfigLoadFailed(true)
        }
      })
      .catch(() => setConfigLoadFailed(true))
      .finally(() => setConfigLoading(false))
  }, [template.id])

  // 表单变更时同步 JSON 原文（用户未手动编辑过 JSON 才同步）
  useEffect(() => {
    if (!jsonDirty && config) {
      setJsonText(JSON.stringify(config, null, 2))
    }
  }, [config, jsonDirty])

  const updateConfig = useCallback((patch: Partial<ProjectConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const updateTopology = useCallback((patch: Partial<ProjectConfig['topology']>) => {
    setConfig((prev) => (prev ? { ...prev, topology: { ...prev.topology, ...patch } } : prev))
  }, [])

  const updateNetworks = useCallback((patch: Partial<ProjectNetworks>) => {
    setConfig((prev) => (prev ? { ...prev, networks: { ...prev.networks, ...patch } } : prev))
  }, [])

  const updateRackConfig = useCallback((patch: Partial<ProjectRackConfig>) => {
    setConfig((prev) => (prev ? { ...prev, rack_config: { ...prev.rack_config, ...patch } } : prev))
  }, [])

  const num = (v: string, fallback = 0) => Math.max(0, parseInt(v) || fallback)

  /* ---------- 选型 ---------- */

  const findDevice = (refKey: string): LibraryDevice | undefined => {
    const ref = config?.device_refs?.[refKey]
    if (!ref) return undefined
    return allDevices.find((d) => d.id === ref.library_id)
  }

  const openPicker = useCallback((refKey: string, label: string, category?: string) => {
    setPickerTarget(refKey)
    setPickerLabel(label)
    setPickerCategory(category || 'all')
    setPickerOpen(true)
  }, [])

  const handleDeviceSelect = useCallback((device: LibraryDevice) => {
    if (!pickerTarget) return
    updateConfig({ device_refs: { ...(config?.device_refs || {}), [pickerTarget]: { library_id: device.id } } })
  }, [pickerTarget, updateConfig, config])

  const handleClearRef = useCallback((refKey: string) => {
    if (!config) return
    const refs = { ...config.device_refs }
    delete refs[refKey]
    updateConfig({ device_refs: refs })
  }, [config, updateConfig])

  /* ---------- 保存 ---------- */

  const handleConfirm = useCallback(async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('common:project.nameRequired', '名称不能为空'))
      return
    }
    setLoading(true)
    setError('')
    try {
      let finalConfig: ProjectConfig
      if (jsonDirty) {
        try {
          finalConfig = JSON.parse(jsonText) as ProjectConfig
        } catch (e) {
          setError(`${t('common:template.editForm.jsonSyntaxError', 'JSON 语法错误')}: ${(e as Error).message}`)
          setLoading(false)
          return
        }
      } else if (config) {
        finalConfig = config
      } else {
        throw new Error(t('common:template.editForm.configUnavailable', '模板配置不可用，无法保存'))
      }
      const tags = tagsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      await onConfirm({
        name: trimmedName,
        description: description.trim(),
        scenario: scenario.trim(),
        tags,
        projectConfig: JSON.stringify(finalConfig, null, 2),
      })
      onClose()
    } catch (err) {
      // V2.9.6-T5: 保存失败（含后端校验失败）保持弹窗打开，展示具体错误
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [name, description, scenario, tagsText, jsonDirty, jsonText, config, onConfirm, onClose, t])

  const sectionCls = 'rounded-lg border border-gray-200 dark:border-edge-subtle p-3'
  const toggleCls = (on: boolean) =>
    clsx(
      'relative w-9 h-5 rounded-full transition-colors shrink-0',
      on ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600',
    )

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('common:template.edit', '编辑模板')} - ${template.id}`}
      width={680}
      maxHeight="85vh"
      closeOnEsc
      bodyClassName="p-4 space-y-3 overflow-y-auto"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
          >
            {t('common:cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !name.trim()}
            className="px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50"
          >
            {loading ? t('common:processing') : t('common:save')}
          </button>
        </div>
      }
    >
      {/* 元信息 */}
      <div className={sectionCls}>
        <SectionTitle icon={<FileJson size={14} />} title={t('common:template.editForm.metaInfo', '基本信息')} />
        <div className="space-y-3">
          <Field label={t('common:template.name', '模板名称')}>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError('') }}
              disabled={loading}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common:template.scenario', '场景')}>
              <input
                type="text"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                disabled={loading}
                className={inputCls}
              />
            </Field>
            <Field label={t('common:template.tags', '标签（逗号分隔）')}>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                disabled={loading}
                placeholder="H100, 128台"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label={t('common:template.description', '描述')}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              rows={2}
              className={clsx(inputCls, 'resize-none')}
            />
          </Field>
        </div>
      </div>

      {configLoading ? (
        <div className="h-24 flex items-center justify-center text-xs text-gray-400">
          {t('common:loading', '加载中...')}
        </div>
      ) : configLoadFailed || !config ? (
        <div className="px-3 py-4 text-xs text-warning-600 dark:text-warning-400 rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-900/20">
          {t('common:template.editForm.configLoadFailed', '模板配置加载失败，仅可编辑基本信息。请通过"JSON 原文"面板修复配置。')}
        </div>
      ) : (
        <>
          {/* 规模设置 */}
          <div className={sectionCls}>
            <SectionTitle icon={<Zap size={14} />} title={t('common:template.editForm.scale', '规模设置')} />
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('common:template.editForm.numGpuServers', 'GPU 服务器')}>
                <input
                  type="number" min={0} max={2048}
                  value={config.topology.num_gpu_servers}
                  onChange={(e) => updateTopology({ num_gpu_servers: num(e.target.value) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.numAllFlashStorage', '全闪存储')}>
                <input
                  type="number" min={0} max={2048}
                  value={config.topology.num_all_flash_storage}
                  onChange={(e) => updateTopology({ num_all_flash_storage: num(e.target.value) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.numHybridFlashStorage', '混闪存储')}>
                <input
                  type="number" min={0} max={2048}
                  value={config.topology.num_hybrid_flash_storage}
                  onChange={(e) => updateTopology({ num_hybrid_flash_storage: num(e.target.value) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.numComputeServers', '通算服务器')}>
                <input
                  type="number" min={0} max={2048}
                  value={config.topology.num_compute_servers}
                  onChange={(e) => updateTopology({ num_compute_servers: num(e.target.value) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.paramPortsPerServer', '参数网卡口数')}>
                <input
                  type="number" min={0}
                  value={config.topology.param_ports_per_server}
                  onChange={(e) => updateTopology({ param_ports_per_server: num(e.target.value, 8) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.storagePortsPerServer', '存储网卡口数')}>
                <input
                  type="number" min={0}
                  value={config.topology.storage_ports_per_server}
                  onChange={(e) => updateTopology({ storage_ports_per_server: num(e.target.value, 1) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.paramSwitchPorts', '参数交换机口数')}>
                <input
                  type="number" min={0}
                  value={config.topology.param_switch_ports}
                  onChange={(e) => updateTopology({ param_switch_ports: num(e.target.value, 64) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.storageSwitchPorts', '存储交换机口数')}>
                <input
                  type="number" min={0}
                  value={config.topology.storage_switch_ports}
                  onChange={(e) => updateTopology({ storage_switch_ports: num(e.target.value, 40) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.protocol', '协议类型')}>
                <select
                  value={config.topology.param_protocol}
                  onChange={(e) => updateTopology({ param_protocol: e.target.value as ParamProtocol })}
                  disabled={loading}
                  className={inputCls}
                >
                  {PROTOCOL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label={t('common:template.editForm.paramSpeed', '参数网速率')}>
                <input
                  type="text"
                  value={config.topology.param_speed}
                  onChange={(e) => updateTopology({ param_speed: e.target.value })}
                  disabled={loading}
                  placeholder="400G"
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.storageSpeed', '存储网速率')}>
                <input
                  type="text"
                  value={config.topology.storage_speed}
                  onChange={(e) => updateTopology({ storage_speed: e.target.value })}
                  disabled={loading}
                  placeholder="200G"
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.downlinkMode', '下行模式')}>
                <select
                  value={config.topology.downlink_mode}
                  onChange={(e) => updateTopology({ downlink_mode: e.target.value as 'full' | 'custom' })}
                  disabled={loading}
                  className={inputCls}
                >
                  <option value="custom">custom</option>
                  <option value="full">full</option>
                </select>
              </Field>
              <Field label={t('common:template.editForm.paramDownlinkLimit', '参数网下行数')}>
                <input
                  type="number" min={0}
                  value={config.topology.param_downlink_limit}
                  onChange={(e) => updateTopology({ param_downlink_limit: num(e.target.value) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.storageDownlinkLimit', '存储网下行数')}>
                <input
                  type="number" min={0}
                  value={config.topology.storage_downlink_limit}
                  onChange={(e) => updateTopology({ storage_downlink_limit: num(e.target.value) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.bizDownlinkLimit', '业务网下行数')}>
                <input
                  type="number" min={0}
                  value={config.topology.biz_downlink_limit}
                  onChange={(e) => updateTopology({ biz_downlink_limit: num(e.target.value) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.oobDownlinkLimit', 'OOB 下行数')}>
                <input
                  type="number" min={0}
                  value={config.topology.oob_downlink_limit}
                  onChange={(e) => updateTopology({ oob_downlink_limit: num(e.target.value) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          {/* 网络类型 */}
          <div className={sectionCls}>
            <SectionTitle icon={<Network size={14} />} title={t('common:template.editForm.network', '网络类型')} />
            <div className="grid grid-cols-2 gap-2">
              {NETWORK_KEYS.map((n) => (
                <div key={n.key} className="flex items-center gap-2">
                  <button
                    role="switch"
                    aria-checked={config.networks[n.key]}
                    onClick={() => updateNetworks({ [n.key]: !config.networks[n.key] })}
                    disabled={loading}
                    className={toggleCls(config.networks[n.key])}
                  >
                    <span
                      className={clsx(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                        config.networks[n.key] ? 'left-[18px]' : 'left-0.5',
                      )}
                    />
                  </button>
                  <span className="text-xs text-gray-700 dark:text-gray-200">{n.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 选型设置 */}
          <div className={sectionCls}>
            <SectionTitle icon={<Cpu size={14} />} title={t('common:template.editForm.devices', '选型设置')} />
            <div className="space-y-2">
              {DEVICE_GROUPS.map((group) => {
                if (!config.networks[group.networkKey]) return null
                return (
                  <div key={group.networkKey} className="rounded border border-gray-200 dark:border-edge-subtle overflow-hidden">
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 dark:bg-app/50 border-b border-gray-200 dark:border-edge-subtle text-gray-600 dark:text-gray-300 text-xs">
                      {group.icon}
                      {group.label}
                    </div>
                    <div className="p-2 space-y-1.5">
                      {group.refKeys.map((refKey) => {
                        const device = findDevice(refKey)
                        const label = DEVICE_REF_KEYS[refKey] || refKey
                        return (
                          <div key={refKey} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400 w-28 shrink-0 truncate">{label}</span>
                            {device ? (
                              <>
                                <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app min-w-0">
                                  <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                                    {device.vendor} {device.model}
                                  </span>
                                  <span className="text-2xs text-gray-400 shrink-0">
                                    {device.port_count ? `${device.port_count}口·${device.port_speed}` : `${device.u_height}U·${device.power_watts}W`}
                                  </span>
                                </div>
                                <button
                                  onClick={() => handleClearRef(refKey)}
                                  disabled={loading}
                                  className="p-1.5 rounded hover:bg-error-50 dark:hover:bg-error-900/20 text-gray-400 hover:text-error-500 shrink-0"
                                  title={t('common:template.editForm.chooseDevice', '更换设备')}
                                >
                                  <X size={14} />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => openPicker(refKey, label)}
                                disabled={loading}
                                className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 text-gray-400 hover:text-primary-500 text-xs transition-colors"
                              >
                                <Plus size={14} />
                                {t('common:template.editForm.chooseDevice', '选择设备')}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 机柜设置 */}
          <div className={sectionCls}>
            <SectionTitle icon={<Layers size={14} />} title={t('common:template.editForm.rack', '机柜设置')} />
            <div className="space-y-3">
              <Field label={t('common:template.editForm.rackType', '机柜类型')}>
                <div className="flex gap-2">
                  {RACK_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateRackConfig({ rack_type: opt.value })}
                      disabled={loading}
                      className={clsx(
                        'flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-colors',
                        config.rack_config.rack_type === opt.value
                          ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('common:template.editForm.powerLimit', '单机柜功率上限 (W)')}>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {POWER_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => updateRackConfig({ power_limit_per_rack: p.value })}
                      disabled={loading}
                      className={clsx(
                        'px-3 py-1.5 rounded-md border text-xs font-medium transition-colors',
                        config.rack_config.power_limit_per_rack === p.value
                          ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number" min={0} step={100}
                  value={config.rack_config.power_limit_per_rack}
                  onChange={(e) => updateRackConfig({ power_limit_per_rack: num(e.target.value, 6000) })}
                  disabled={loading}
                  className={inputCls}
                />
              </Field>
              <Field label={t('common:template.editForm.cooling', '散热方式')}>
                <div className="flex gap-2">
                  {COOLING_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateRackConfig({ cooling_method: opt.value })}
                      disabled={loading}
                      className={clsx(
                        'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 text-xs font-medium transition-colors',
                        (config.rack_config.cooling_method ?? 'air') === opt.value
                          ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500',
                      )}
                    >
                      <Snowflake size={14} />
                      {opt.label}
                      <span className="text-2xs text-gray-400">{opt.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <div className="flex items-center gap-2">
                <button
                  role="switch"
                  aria-checked={!!config.rack_config.gpu_dedicated}
                  onClick={() => updateRackConfig({ gpu_dedicated: !config.rack_config.gpu_dedicated })}
                  disabled={loading}
                  className={toggleCls(!!config.rack_config.gpu_dedicated)}
                >
                  <span
                    className={clsx(
                      'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                      config.rack_config.gpu_dedicated ? 'left-[18px]' : 'left-0.5',
                    )}
                  />
                </button>
                <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
                  <Cpu size={14} />
                  {t('common:template.editForm.gpuDedicated', 'GPU 服务器独占机柜（1 台/柜）')}
                </span>
              </div>
              <Field label={t('common:template.editForm.namingPrefix', '机柜命名前缀')}>
                <input
                  type="text"
                  value={config.rack_config.naming_prefix}
                  onChange={(e) => updateRackConfig({ naming_prefix: e.target.value })}
                  disabled={loading}
                  placeholder="机柜"
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
        </>
      )}

      {/* JSON 原文兜底面板 */}
      <div className="rounded-lg border border-gray-200 dark:border-edge-subtle">
        <button
          onClick={() => setJsonOpen(!jsonOpen)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-app-hover rounded-lg"
        >
          {jsonOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t('common:template.editForm.jsonRaw', 'JSON 原文（高级，可手动编辑）')}
          {jsonDirty && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (config) {
                  setJsonText(JSON.stringify(config, null, 2))
                  setJsonDirty(false)
                }
              }}
              className="ml-auto text-2xs text-gray-500 hover:text-primary-500 dark:text-gray-400 dark:hover:text-primary-400"
              title={t('common:template.editForm.regenerate', '从表单重新生成')}
            >
              {t('common:template.editForm.regenerate', '从表单重新生成')}
            </button>
          )}
        </button>
        {jsonOpen && (
          <div className="px-3 pb-3">
            <textarea
              value={jsonText}
              onChange={(e) => { setJsonText(e.target.value); setJsonDirty(true) }}
              disabled={loading}
              rows={12}
              spellCheck={false}
              className={clsx(inputCls, 'text-2xs font-mono resize-y')}
            />
            <p className="text-2xs text-gray-400 mt-1">
              {t('common:template.editForm.jsonHint', '保存时将校验 JSON 合法性，后端校验失败会提示具体错误。')}
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-error-500" role="alert">{error}</p>
      )}

      {/* 选型选择器 */}
      <DeviceLibraryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleDeviceSelect}
        deviceLabel={pickerLabel}
        initialCategory={pickerCategory}
      />
    </Modal>
  )
}
