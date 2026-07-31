import { useEffect, useMemo } from 'react'
import clsx from 'clsx'
import {
  Search, Zap, X, Award, Globe, Hash, Thermometer, Weight,
  Ruler, Cable, History, Tags, Network, Package, Layers,
  Loader2, AlertTriangle, BookOpen, Server,
} from 'lucide-react'
import { useDeviceLibraryStore, type DeviceCategoryFilter } from '@/stores/device-library.store'
import type { LibraryDevice } from '@/types/device-profile'
import { isServerDevice } from '@/types/device-profile'
import { DEVICE_CATEGORY_LABELS, NETWORK_TYPE_LABELS } from '@/constants/labels'

/* -------------------------------------------------- */
/*  DeviceLibraryTab                                  */
/* -------------------------------------------------- */

/** Map category key → { category, subCategory } for the store filter */
const CATEGORY_FILTER_MAP: Record<string, { category: DeviceCategoryFilter; subCategory: string }> = {
  gpu_servers: { category: 'gpu_servers', subCategory: '' },
  storage_servers: { category: 'storage_servers', subCategory: '' },
  storage_servers_all_flash: { category: 'storage_servers', subCategory: 'storage_servers_all_flash' },
  storage_servers_hybrid_flash: { category: 'storage_servers', subCategory: 'storage_servers_hybrid_flash' },
  compute_servers: { category: 'compute_servers', subCategory: '' },
  switches: { category: 'switches', subCategory: '' },
  switches_param: { category: 'switches', subCategory: 'switches_param' },
  switches_storage: { category: 'switches', subCategory: 'switches_storage' },
  switches_biz: { category: 'switches', subCategory: 'switches_biz' },
  switches_oob: { category: 'switches', subCategory: 'switches_oob' },
  custom: { category: 'custom', subCategory: '' },
}

interface Props {
  /** Category key passed from sidebar, e.g. 'gpu_servers', 'switches_param' */
  initialCategory?: string
}

export function DeviceLibraryTab({ initialCategory }: Props) {
  const {
    allDevices, loading, error,
    selectedDevice, filteredDevices,
    filter, setFilter, resetFilter,
    loadLibrary, selectDevice,
  } = useDeviceLibraryStore()

  useEffect(() => {
    loadLibrary()
  }, [])

  // Apply initialCategory from sidebar
  useEffect(() => {
    if (!initialCategory || allDevices.length === 0) return
    const mapping = CATEGORY_FILTER_MAP[initialCategory]
    if (mapping) {
      setFilter(mapping)
    }
  }, [initialCategory, allDevices.length, setFilter])

  const handleSearch = (q: string) => {
    setFilter({ search: q })
  }

  const handleVendorFilter = (vendor: string) => {
    setFilter({ vendor })
  }

  // Unique vendors
  const vendors = useMemo(() => {
    const set = new Set<string>()
    allDevices.forEach((d) => { if (d.vendor) set.add(d.vendor) })
    return Array.from(set).sort()
  }, [allDevices])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2">
          <BookOpen size={15} className="text-primary-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            设备库 ({allDevices.length})
          </span>
        </div>
        <button
          onClick={() => { resetFilter(); selectDevice(null) }}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
        >
          重置筛选
        </button>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      )}
      {error && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="flex items-start gap-2 p-3 rounded text-sm bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-300 max-w-md">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Two-panel layout: device list | device detail */}
      {!loading && !error && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Search + vendor filter + device list */}
          <div className="w-64 shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
            {/* Search + vendor filter */}
            <div className="p-2 space-y-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={filter.search}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="搜索设备型号/厂商..."
                  className="w-full pl-7 pr-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                {filter.search && (
                  <button
                    onClick={() => handleSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {vendors.length > 0 && (
                <select
                  value={filter.vendor}
                  onChange={(e) => handleVendorFilter(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">全部厂商</option>
                  {vendors.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Device list */}
            <div className="flex-1 overflow-auto">
              {filteredDevices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Package size={28} className="text-gray-300 dark:text-gray-600 mb-2" />
                  <p className="text-xs text-gray-400 dark:text-gray-500">暂无匹配设备</p>
                </div>
              ) : (
                filteredDevices.map((device) => (
                  <DeviceListItem
                    key={device.id}
                    device={device}
                    isSelected={selectedDevice?.id === device.id}
                    onClick={() => selectDevice(device)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: Device detail */}
          <div className="flex-1 overflow-auto">
            {selectedDevice ? (
              <DeviceDetailCard device={selectedDevice} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <BookOpen size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">选择设备查看详情</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  从左侧列表选择设备以查看参数和规格信息
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------- */
/*  DeviceListItem                                    */
/* -------------------------------------------------- */
function DeviceListItem({ device, isSelected, onClick }: {
  device: LibraryDevice; isSelected: boolean; onClick: () => void
}) {
  const isServer = isServerDevice(device)

  return (
    <div
      onClick={onClick}
      className={clsx(
        'flex items-start gap-2 px-3 py-2 cursor-pointer border-b border-gray-100 dark:border-gray-700/50 transition-colors',
        isSelected
          ? 'bg-primary-50 dark:bg-primary-900/20 border-l-2 border-l-primary-500'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border-l-2 border-l-transparent',
      )}
    >
      <div className="shrink-0 mt-0.5">
        {isServer
          ? <Server size={14} className="text-info-500" />
          : <Network size={14} className="text-warning-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{device.model}</div>
        <div className="text-2xs text-gray-400 dark:text-gray-500 flex items-center gap-1 mt-0.5">
          <span>{device.vendor}</span>
          {device.verified && <Award size={10} className="text-success-500" />}
        </div>
        {isServer && (
          <div className="flex gap-1 mt-0.5">
            {device.interface_models?.map((m) => (
              <span key={m.network_type} className="text-3xs px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                {m.port_count}×{m.port_speed}
              </span>
            ))}
          </div>
        )}
        {!isServer && (
          <div className="text-2xs text-gray-500 dark:text-gray-400 mt-0.5">
            {device.port_count}口 · {device.port_speed}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------- */
/*  DeviceDetailCard                                  */
/* -------------------------------------------------- */
function DeviceDetailCard({ device }: { device: LibraryDevice }) {
  const isServer = isServerDevice(device)

  return (
    <div className="p-6 max-w-2xl">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{device.model}</h2>
          {device.verified && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300">
              <Award size={10} />
              已认证
            </span>
          )}
          {device.source === 'custom' && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300">
              自定义
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{device.vendor} · {device.description}</p>
      </div>

      {/* Tags */}
      {device.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {device.tags.map((tag) => (
            <span key={tag} className="text-2xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
              <Tags size={10} className="inline mr-0.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Physical params */}
      <Section title="物理参数" icon={<Ruler size={13} />}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <DetailRow label="功耗" value={`${device.power_watts}W`} icon={<Zap size={12} />} />
          <DetailRow label="重量" value={`${device.weight_kg}kg`} icon={<Weight size={12} />} />
          <DetailRow label="U位高度" value={`${device.u_height}U`} icon={<Layers size={12} />} />
          <DetailRow label="深度" value={`${device.depth_mm}mm`} icon={<Ruler size={12} />} />
          <DetailRow label="散热方式" value={device.cooling === 'liquid' ? '液冷' : '风冷'} icon={<Thermometer size={12} />} />
          <DetailRow label="命名前缀" value={device.name_prefix} icon={<Hash size={12} />} />
        </div>
      </Section>

      {/* Server: Interface models */}
      {isServer && device.interface_models && (
        <Section title="接口模型" icon={<Cable size={13} />}>
          {device.interface_models.map((m, idx) => (
            <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded p-3 mb-2 last:mb-0">
              <div className="flex items-center gap-2 mb-2">
                <span className={clsx(
                  'text-2xs font-medium px-2 py-0.5 rounded',
                  m.network_type === 'param' && 'bg-info-100 dark:bg-info-900/30 text-info-700 dark:text-info-300',
                  m.network_type === 'storage' && 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300',
                  m.network_type === 'biz' && 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
                  m.network_type === 'oob' && 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
                )}>
                  {m.network_type.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{m.network_type === 'param' ? '参数网' : m.network_type === 'storage' ? '存储网' : m.network_type === 'biz' ? '业务网' : 'OOB'}</span>
              </div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
                <DetailMini label="端口数" value={`${m.port_count}`} />
                <DetailMini label="速率" value={m.port_speed} />
                <DetailMini label="端口类型" value={m.port_type} />
                <DetailMini label="线缆类型" value={m.cable_type} />
                <DetailMini label="下行前缀" value={m.downlink_prefix} />
                <DetailMini label="上行前缀" value={m.uplink_prefix} />
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Switch: Port config */}
      {!isServer && (
        <Section title="端口配置" icon={<Network size={13} />}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <DetailRow label="端口数" value={`${device.port_count || '-'}`} icon={<Hash size={12} />} />
            <DetailRow label="端口速率" value={device.port_speed || '-'} icon={<Zap size={12} />} />
            <DetailRow label="端口类型" value={device.port_type || '-'} icon={<Cable size={12} />} />
            <DetailRow label="适用网络" value={device.applicable_networks?.map((n) => NETWORK_TYPE_LABELS[n] || n).join(', ') || '-'} icon={<Globe size={12} />} />
          </div>
        </Section>
      )}

      {/* Meta info */}
      <Section title="元数据" icon={<History size={13} />}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <DetailRow label="设备ID" value={device.id} />
          <DetailRow label="分类" value={DEVICE_CATEGORY_LABELS[device.category] || device.category} />
          <DetailRow label="添加日期" value={device.added_at} />
          <DetailRow label="更新日期" value={device.updated_at} />
        </div>
        {device.datasheet_url && (
          <div className="mt-2">
            <a
              href={device.datasheet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-500 hover:text-primary-600 underline flex items-center gap-1"
            >
              <Globe size={11} />
              查看数据手册
            </a>
          </div>
        )}
      </Section>
    </div>
  )
}

/* -------------------------------------------------- */
/*  Detail sub-components                             */
/* -------------------------------------------------- */
function Section({ title, icon, children }: {
  title: string; icon: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  )
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {icon && <span className="text-gray-400 dark:text-gray-500">{icon}</span>}
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="ml-auto font-medium text-gray-800 dark:text-gray-200">{value}</span>
    </div>
  )
}

function DetailMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-2xs text-gray-400 dark:text-gray-500">{label}</span>
      <span className="text-2xs font-medium text-gray-700 dark:text-gray-300">{value}</span>
    </div>
  )
}
