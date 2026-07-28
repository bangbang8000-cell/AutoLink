import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Plus, Trash2 } from 'lucide-react'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import type { LibraryDevice, InterfaceModel, NetworkType } from '@/types/device-profile'
import { createDefaultInterfaceModel } from '@/types/device-profile'
import clsx from 'clsx'

const SERVER_TYPES = [
  { value: 'gpu_servers', label: 'GPU服务器' },
  { value: 'storage_servers_all_flash', label: '全闪存储服务器' },
  { value: 'storage_servers_hybrid_flash', label: '混闪存储服务器' },
  { value: 'compute_servers', label: '通算服务器' },
]

const NETWORK_TYPES: { value: NetworkType; label: string }[] = [
  { value: 'param', label: '参数网络' },
  { value: 'storage', label: '存储网络' },
  { value: 'biz', label: '业务/带内管理' },
  { value: 'oob', label: '带外管理' },
]

function createEmptyDevice(category: string): LibraryDevice {
  return {
    id: '',
    vendor: '',
    model: '',
    category,
    description: '',
    power_watts: 0,
    weight_kg: 0,
    u_height: 1,
    depth_mm: 800,
    cooling: 'air',
    name_prefix: '',
    interface_models: [],
    tags: [],
    applicable_networks: [],
    source: 'custom',
    verified: false,
    added_at: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString().slice(0, 10),
  }
}

function InterfaceModelRow({
  model,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  model: InterfaceModel
  index: number
  onChange: (index: number, field: keyof InterfaceModel, value: string | number) => void
  onRemove: (index: number) => void
  canRemove: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs bg-gray-50 dark:bg-gray-800 rounded p-2">
      <select
        value={model.network_type}
        onChange={(e) => onChange(index, 'network_type', e.target.value)}
        className="w-20 px-1.5 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs"
      >
        {NETWORK_TYPES.map((nt) => (
          <option key={nt.value} value={nt.value}>{nt.label}</option>
        ))}
      </select>
      <input
        type="number"
        value={model.port_count}
        onChange={(e) => onChange(index, 'port_count', parseInt(e.target.value) || 0)}
        className="w-12 px-1 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-center"
        title="端口数"
      />
      <input
        type="text"
        value={model.port_speed}
        onChange={(e) => onChange(index, 'port_speed', e.target.value)}
        className="w-14 px-1 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs"
        placeholder="速率"
      />
      <input
        type="text"
        value={model.port_type}
        onChange={(e) => onChange(index, 'port_type', e.target.value)}
        className="w-16 px-1 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs"
        placeholder="端口类型"
      />
      <input
        type="text"
        value={model.cable_type}
        onChange={(e) => onChange(index, 'cable_type', e.target.value)}
        className="w-14 px-1 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs"
        placeholder="线缆"
      />
      <input
        type="text"
        value={model.downlink_prefix}
        onChange={(e) => onChange(index, 'downlink_prefix', e.target.value)}
        className="w-14 px-1 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs"
        placeholder="下行前缀"
      />
      {canRemove && (
        <button onClick={() => onRemove(index)} className="p-1 text-red-400 hover:text-red-600">
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}

export function ServerProfileForm() {
  const { t } = useTranslation('device')
  const { editingDevice, showServerForm, closeForm, saveDevice } = useDeviceLibraryStore()

  const [device, setDevice] = useState<LibraryDevice>(() => {
    if (editingDevice) return { ...editingDevice }
    return createEmptyDevice('gpu_servers')
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateField = useCallback(
    <K extends keyof LibraryDevice>(field: K, value: LibraryDevice[K]) => {
      setDevice((prev) => ({ ...prev, [field]: value }))
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    },
    [],
  )

  const updateInterfaceModel = useCallback(
    (index: number, field: keyof InterfaceModel, value: string | number) => {
      setDevice((prev) => {
        const models = [...(prev.interface_models ?? [])]
        if (models[index]) {
          models[index] = { ...models[index], [field]: value }
        }
        return { ...prev, interface_models: models }
      })
    },
    [],
  )

  const addInterfaceModel = useCallback(
    (networkType: NetworkType) => {
      setDevice((prev) => ({
        ...prev,
        interface_models: [...(prev.interface_models ?? []), createDefaultInterfaceModel(networkType)],
      }))
    },
    [],
  )

  const removeInterfaceModel = useCallback((index: number) => {
    setDevice((prev) => ({
      ...prev,
      interface_models: (prev.interface_models ?? []).filter((_, i) => i !== index),
    }))
  }, [])

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!device.vendor.trim()) e.vendor = '请输入厂商'
    if (!device.model.trim()) e.model = '请输入型号'
    if (device.power_watts <= 0) e.power_watts = '请输入功率'
    if (device.u_height <= 0) e.u_height = '请输入U高'
    if (!device.name_prefix.trim()) e.name_prefix = '请输入名称前缀'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    const id = device.id || `${device.vendor.toLowerCase()}_${device.model.toLowerCase()}`.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    await saveDevice({ ...device, id, updated_at: new Date().toISOString().slice(0, 10) })
  }

  if (!showServerForm) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeForm}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[640px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold">
            {editingDevice ? `编辑: ${editingDevice.vendor} ${editingDevice.model}` : t('actions.addServer')}
          </h3>
          <button onClick={closeForm} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Server type */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">设备类型</label>
            <div className="flex gap-1.5">
              {SERVER_TYPES.map((st) => (
                <button
                  key={st.value}
                  onClick={() => updateField('category', st.value)}
                  className={clsx(
                    'px-2 py-1 text-xs rounded transition-colors',
                    device.category === st.value
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600',
                  )}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.vendor')} *</label>
              <input
                type="text"
                value={device.vendor}
                onChange={(e) => updateField('vendor', e.target.value)}
                className={clsx(
                  'w-full px-2 py-1.5 text-xs rounded border bg-white dark:bg-gray-700',
                  errors.vendor ? 'border-red-400' : 'border-gray-200 dark:border-gray-600',
                )}
                placeholder="厂商"
              />
              {errors.vendor && <div className="text-[10px] text-red-500 mt-0.5">{errors.vendor}</div>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.model')} *</label>
              <input
                type="text"
                value={device.model}
                onChange={(e) => updateField('model', e.target.value)}
                className={clsx(
                  'w-full px-2 py-1.5 text-xs rounded border bg-white dark:bg-gray-700',
                  errors.model ? 'border-red-400' : 'border-gray-200 dark:border-gray-600',
                )}
                placeholder="型号"
              />
              {errors.model && <div className="text-[10px] text-red-500 mt-0.5">{errors.model}</div>}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">描述</label>
            <input
              type="text"
              value={device.description}
              onChange={(e) => updateField('description', e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
              placeholder="设备描述"
            />
          </div>

          {/* Physical params */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.power')} (W) *</label>
              <input
                type="number"
                value={device.power_watts || ''}
                onChange={(e) => updateField('power_watts', parseInt(e.target.value) || 0)}
                className={clsx(
                  'w-full px-2 py-1.5 text-xs rounded border bg-white dark:bg-gray-700',
                  errors.power_watts ? 'border-red-400' : 'border-gray-200 dark:border-gray-600',
                )}
              />
              {errors.power_watts && <div className="text-[10px] text-red-500 mt-0.5">{errors.power_watts}</div>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.uHeight')} *</label>
              <input
                type="number"
                value={device.u_height || ''}
                onChange={(e) => updateField('u_height', parseInt(e.target.value) || 0)}
                className={clsx(
                  'w-full px-2 py-1.5 text-xs rounded border bg-white dark:bg-gray-700',
                  errors.u_height ? 'border-red-400' : 'border-gray-200 dark:border-gray-600',
                )}
              />
              {errors.u_height && <div className="text-[10px] text-red-500 mt-0.5">{errors.u_height}</div>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.depth')} (mm)</label>
              <input
                type="number"
                value={device.depth_mm || ''}
                onChange={(e) => updateField('depth_mm', parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.weight')} (kg)</label>
              <input
                type="number"
                value={device.weight_kg || ''}
                onChange={(e) => updateField('weight_kg', parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.cooling')}</label>
              <select
                value={device.cooling}
                onChange={(e) => updateField('cooling', e.target.value as 'air' | 'liquid')}
                className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
              >
                <option value="air">风冷</option>
                <option value="liquid">液冷</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.namePrefix')} *</label>
              <input
                type="text"
                value={device.name_prefix}
                onChange={(e) => updateField('name_prefix', e.target.value)}
                className={clsx(
                  'w-full px-2 py-1.5 text-xs rounded border bg-white dark:bg-gray-700',
                  errors.name_prefix ? 'border-red-400' : 'border-gray-200 dark:border-gray-600',
                )}
                placeholder="前缀"
              />
              {errors.name_prefix && <div className="text-[10px] text-red-500 mt-0.5">{errors.name_prefix}</div>}
            </div>
          </div>

          {/* Interface models */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('device.interfaceModels')}
              </label>
              <div className="flex gap-1">
                {NETWORK_TYPES.map((nt) => {
                  const exists = device.interface_models?.some((m) => m.network_type === nt.value)
                  if (exists) return null
                  return (
                    <button
                      key={nt.value}
                      onClick={() => addInterfaceModel(nt.value)}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      <Plus size={10} /> {nt.label}
                    </button>
                  )
                })}
              </div>
            </div>
            {device.interface_models && device.interface_models.length > 0 ? (
              <div className="space-y-1.5">
                {device.interface_models.map((model, idx) => (
                  <InterfaceModelRow
                    key={idx}
                    model={model}
                    index={idx}
                    onChange={updateInterfaceModel}
                    onRemove={removeInterfaceModel}
                    canRemove={true}
                  />
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-400 py-2 text-center border border-dashed border-gray-200 dark:border-gray-600 rounded">
                点击上方按钮添加接口模型
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">标签</label>
            <input
              type="text"
              value={device.tags.join(', ')}
              onChange={(e) => updateField('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
              placeholder="逗号分隔，如: 400G, RoCEv2"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={closeForm}
            className="px-3 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs rounded bg-primary-600 text-white hover:bg-primary-700"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}