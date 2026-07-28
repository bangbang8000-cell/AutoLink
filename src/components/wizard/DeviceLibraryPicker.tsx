import React, { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Search, Zap, HardDrive, Server, Package, Filter } from 'lucide-react'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import type { LibraryDevice } from '@/types/device-profile'
import clsx from 'clsx'

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (device: LibraryDevice) => void
  networkType?: string
  deviceLabel?: string
}

const CATEGORY_TABS = [
  { id: 'all', label: '全部' },
  { id: 'gpu_servers', label: 'GPU服务器' },
  { id: 'storage_servers', label: '存储服务器' },
  { id: 'compute_servers', label: '通算服务器' },
  { id: 'switches', label: '交换机' },
] as const

const VENDORS = ['全部', 'NVIDIA', '华为', 'H3C', '浪潮', '锐捷', '通用']

const DEVICE_TYPES = [
  { id: 'all', label: '全部' },
  { id: 'server', label: '服务器' },
  { id: 'switch', label: '交换机' },
] as const

export function DeviceLibraryPicker({ open, onClose, onSelect, networkType, deviceLabel }: Props) {
  const { t } = useTranslation('device')
  const {
    loading, allDevices, loadLibrary,
  } = useDeviceLibraryStore()

  const [category, setCategory] = useState<string>('all')
  const [vendor, setVendor] = useState('全部')
  const [deviceType, setDeviceType] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open) {
      loadLibrary()
      setCategory('all')
      setVendor('全部')
      setDeviceType('all')
      setSearch('')
    }
  }, [open])

  const filteredDevices = useMemo(() => {
    let devices = allDevices

    // Category filter
    if (category !== 'all') {
      devices = devices.filter((d) => {
        const cat = d.category
        if (category === 'switches') {
          return cat.startsWith('switches')
        }
        if (category === 'storage_servers') {
          return cat.startsWith('storage_servers')
        }
        return cat === category
      })
    }

    // Vendor filter
    if (vendor !== '全部') {
      devices = devices.filter((d) => d.vendor === vendor)
    }

    // Device type filter
    if (deviceType === 'server') {
      devices = devices.filter((d) => !!d.interface_models && d.interface_models.length > 0)
    } else if (deviceType === 'switch') {
      devices = devices.filter((d) => !d.interface_models || d.interface_models.length === 0)
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      devices = devices.filter((d) =>
        d.vendor.toLowerCase().includes(q) ||
        d.model.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.tags?.some((tag) => tag.toLowerCase().includes(q))
      )
    }

    return devices
  }, [allDevices, category, vendor, deviceType, search])

  const handleSelect = (device: LibraryDevice) => {
    onSelect(device)
    onClose()
  }

  const getCategoryIcon = (cat: string) => {
    if (cat.startsWith('gpu_servers')) return <Zap size={14} className="text-purple-500" />
    if (cat.startsWith('storage_servers')) return <HardDrive size={14} className="text-green-500" />
    if (cat.startsWith('compute_servers')) return <Server size={14} className="text-blue-500" />
    return <Package size={14} className="text-gray-500" />
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[640px] max-h-[85vh] flex flex-col border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {deviceLabel ? `选择设备 - ${deviceLabel}` : '选择设备'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filter bar */}
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
          {/* Category tabs */}
          <div className="flex gap-1 overflow-x-auto">
            {CATEGORY_TABS.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={clsx(
                  'px-2.5 py-1 text-xs rounded whitespace-nowrap transition-colors',
                  category === cat.id
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Vendor/Type/Search row */}
          <div className="flex items-center gap-2">
            {/* Vendor dropdown */}
            <select
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
            >
              {VENDORS.map((v) => (
                <option key={v} value={v}>{v === '全部' ? '厂商: 全部' : v}</option>
              ))}
            </select>

            {/* Type dropdown */}
            <select
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
            >
              {DEVICE_TYPES.map((dt) => (
                <option key={dt.id} value={dt.id}>{dt.id === 'all' ? '类型: 全部' : dt.label}</option>
              ))}
            </select>

            {/* Search */}
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('search')}
                className="w-full pl-8 pr-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
            </div>
          </div>
        </div>

        {/* Device list */}
        <div className="flex-1 overflow-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-400">
              加载中...
            </div>
          ) : filteredDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-xs text-gray-400">
              <Filter size={24} className="text-gray-300 dark:text-gray-600 mb-2" />
              <p>无匹配设备</p>
              <p className="text-[10px] mt-1">尝试调整筛选条件</p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="px-1 py-1 text-[10px] text-gray-400">
                共 {filteredDevices.length} 款设备
              </div>
              {filteredDevices.map((device) => (
                <button
                  key={device.id}
                  onClick={() => handleSelect(device)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-gray-50 dark:hover:bg-gray-750 text-left transition-colors"
                >
                  <div className="w-8 h-8 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
                    {getCategoryIcon(device.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                        {device.vendor} {device.model}
                      </span>
                      {device.verified && (
                        <span className="px-1 py-0.5 text-[9px] rounded bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                          已验证
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate mt-0.5">
                      {device.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-gray-400">
                    <span>{device.u_height}U</span>
                    <span>{device.power_watts}W</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
