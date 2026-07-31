import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import type { LibraryDevice, NetworkType } from '@/types/device-profile'
import clsx from 'clsx'

const SWITCH_TYPES = [
  { value: 'switches_param', label: '参数网络交换机' },
  { value: 'switches_storage', label: '存储网络交换机' },
  { value: 'switches_biz', label: '业务网络交换机' },
  { value: 'switches_oob', label: '带外管理交换机' },
]

const NETWORK_TYPE_MAP: Record<string, NetworkType[]> = {
  switches_param: ['param'],
  switches_storage: ['storage'],
  switches_biz: ['biz'],
  switches_oob: ['oob'],
}

function createEmptySwitch(category: string): LibraryDevice {
  return {
    id: '',
    vendor: '',
    model: '',
    category,
    description: '',
    power_watts: 0,
    weight_kg: 0,
    u_height: 1,
    depth_mm: 460,
    cooling: 'air',
    name_prefix: '',
    port_count: 48,
    port_speed: '',
    port_type: '',
    downlink_prefix: 'Eth1/0/',
    uplink_prefix: 'Eth1/0/',
    tags: [],
    applicable_networks: NETWORK_TYPE_MAP[category] ?? [],
    source: 'custom',
    verified: false,
    added_at: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString().slice(0, 10),
  }
}

export function SwitchProfileForm() {
  const { t } = useTranslation('device')
  const { editingDevice, showSwitchForm, closeForm, saveDevice } = useDeviceLibraryStore()

  const [device, setDevice] = useState<LibraryDevice>(() => {
    if (editingDevice) return { ...editingDevice }
    return createEmptySwitch('switches_param')
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateField = useCallback(
    <K extends keyof LibraryDevice>(field: K, value: LibraryDevice[K]) => {
      setDevice((prev) => {
        const next = { ...prev, [field]: value }
        // Auto-update applicable_networks when category changes
        if (field === 'category') {
          next.applicable_networks = NETWORK_TYPE_MAP[value as string] ?? []
        }
        return next
      })
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    },
    [],
  )

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!device.vendor.trim()) e.vendor = '请输入厂商'
    if (!device.model.trim()) e.model = '请输入型号'
    if (device.power_watts <= 0) e.power_watts = '请输入功率'
    if (device.u_height <= 0) e.u_height = '请输入U高'
    if (!device.name_prefix.trim()) e.name_prefix = '请输入名称前缀'
    if (!device.port_speed?.trim()) e.port_speed = '请输入端口速率'
    if (!device.port_type?.trim()) e.port_type = '请输入端口类型'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    const id = device.id || `${device.vendor.toLowerCase()}_${device.model.toLowerCase()}`.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    await saveDevice({ ...device, id, updated_at: new Date().toISOString().slice(0, 10) })
  }

  if (!showSwitchForm) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeForm}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[560px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold">
            {editingDevice ? `编辑: ${editingDevice.vendor} ${editingDevice.model}` : t('actions.addSwitch')}
          </h3>
          <button onClick={closeForm} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Switch type */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">交换机类型</label>
            <div className="flex flex-wrap gap-1.5">
              {SWITCH_TYPES.map((st) => (
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
                  errors.vendor ? 'border-error-400' : 'border-gray-200 dark:border-gray-600',
                )}
                placeholder="厂商"
              />
              {errors.vendor && <div className="text-2xs text-error-500 mt-0.5">{errors.vendor}</div>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.model')} *</label>
              <input
                type="text"
                value={device.model}
                onChange={(e) => updateField('model', e.target.value)}
                className={clsx(
                  'w-full px-2 py-1.5 text-xs rounded border bg-white dark:bg-gray-700',
                  errors.model ? 'border-error-400' : 'border-gray-200 dark:border-gray-600',
                )}
                placeholder="型号"
              />
              {errors.model && <div className="text-2xs text-error-500 mt-0.5">{errors.model}</div>}
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
                  errors.power_watts ? 'border-error-400' : 'border-gray-200 dark:border-gray-600',
                )}
              />
              {errors.power_watts && <div className="text-2xs text-error-500 mt-0.5">{errors.power_watts}</div>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('device.uHeight')} *</label>
              <input
                type="number"
                value={device.u_height || ''}
                onChange={(e) => updateField('u_height', parseInt(e.target.value) || 0)}
                className={clsx(
                  'w-full px-2 py-1.5 text-xs rounded border bg-white dark:bg-gray-700',
                  errors.u_height ? 'border-error-400' : 'border-gray-200 dark:border-gray-600',
                )}
              />
              {errors.u_height && <div className="text-2xs text-error-500 mt-0.5">{errors.u_height}</div>}
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
                  errors.name_prefix ? 'border-error-400' : 'border-gray-200 dark:border-gray-600',
                )}
                placeholder="前缀"
              />
              {errors.name_prefix && <div className="text-2xs text-error-500 mt-0.5">{errors.name_prefix}</div>}
            </div>
          </div>

          {/* Port config */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">端口配置</label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-2xs text-gray-400 mb-1 block">{t('device.ports')}</label>
                <input
                  type="number"
                  value={device.port_count || ''}
                  onChange={(e) => updateField('port_count', parseInt(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
                />
              </div>
              <div>
                <label className="text-2xs text-gray-400 mb-1 block">{t('device.portSpeed')} *</label>
                <input
                  type="text"
                  value={device.port_speed || ''}
                  onChange={(e) => updateField('port_speed', e.target.value)}
                  className={clsx(
                    'w-full px-2 py-1.5 text-xs rounded border bg-white dark:bg-gray-700',
                    errors.port_speed ? 'border-error-400' : 'border-gray-200 dark:border-gray-600',
                  )}
                  placeholder="如 400G"
                />
                {errors.port_speed && <div className="text-2xs text-error-500 mt-0.5">{errors.port_speed}</div>}
              </div>
              <div>
                <label className="text-2xs text-gray-400 mb-1 block">{t('device.portType')} *</label>
                <input
                  type="text"
                  value={device.port_type || ''}
                  onChange={(e) => updateField('port_type', e.target.value)}
                  className={clsx(
                    'w-full px-2 py-1.5 text-xs rounded border bg-white dark:bg-gray-700',
                    errors.port_type ? 'border-error-400' : 'border-gray-200 dark:border-gray-600',
                  )}
                  placeholder="如 QSFP56"
                />
                {errors.port_type && <div className="text-2xs text-error-500 mt-0.5">{errors.port_type}</div>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-2xs text-gray-400 mb-1 block">{t('device.downlinkPrefix')}</label>
                <input
                  type="text"
                  value={device.downlink_prefix || ''}
                  onChange={(e) => updateField('downlink_prefix', e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
                />
              </div>
              <div>
                <label className="text-2xs text-gray-400 mb-1 block">{t('device.uplinkPrefix')}</label>
                <input
                  type="text"
                  value={device.uplink_prefix || ''}
                  onChange={(e) => updateField('uplink_prefix', e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
                />
              </div>
            </div>
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