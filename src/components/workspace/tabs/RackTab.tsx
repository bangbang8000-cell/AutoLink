import { useMemo, useState, useCallback } from 'react'
import { useRackStore, type RackDevice, type UnplacedDevice } from '@/stores/rack.store'
import { RackPowerBar } from '@/components/rack/RackPowerBar'
import { GripVertical, X, ArrowRight, ChevronDown, Plus } from 'lucide-react'

interface Props {
  cabinetId?: number | null
}

const getTypeColorClass = (type: string) => {
  const t = type.toLowerCase()
  if (t.includes('gpu')) return 'bg-blue-500 dark:bg-blue-600'
  if (t.includes('存储') || t.includes('storage')) return 'bg-green-500 dark:bg-green-600'
  if (t.includes('switch') || t.includes('交换机') || t.includes('leaf') || t.includes('spine') || t.includes('core')) return 'bg-amber-500 dark:bg-amber-600'
  if (t.includes('通算') || t.includes('compute')) return 'bg-purple-500 dark:bg-purple-600'
  if (t.includes('安全') || t.includes('security')) return 'bg-red-500 dark:bg-red-600'
  return 'bg-gray-400 dark:bg-gray-500'
}

const getTypeLabel = (type: string) => {
  const t = type.toLowerCase()
  if (t.includes('gpu')) return 'GPU'
  if (t.includes('存储') || t.includes('storage')) return '存储'
  if (t.includes('switch') || t.includes('交换机')) return '交换机'
  if (t.includes('通算') || t.includes('compute')) return '通算'
  if (t.includes('安全') || t.includes('security')) return '安全'
  return type
}

export function RackTab({ cabinetId }: Props) {
  const cabinets = useRackStore((s) => s.cabinets)
  const unplacedDevices = useRackStore((s) => s.unplacedDevices)
  const placeDevice = useRackStore((s) => s.placeDevice)
  const removeDevice = useRackStore((s) => s.removeDevice)
  const selectCabinet = useRackStore((s) => s.selectCabinet)
  const selectedCabinetId = useRackStore((s) => s.selectedCabinetId)
  const getPowerUsage = useRackStore((s) => s.getPowerUsage)

  const [selectedUnplaced, setSelectedUnplaced] = useState<string | null>(null)
  const [showUnplaced, setShowUnplaced] = useState(true)
  const [cabinetDropdownOpen, setCabinetDropdownOpen] = useState(false)

  // Find the target cabinet
  const cabinet = cabinetId != null ? cabinets.find((c) => c.id === cabinetId) : cabinets.find((c) => c.id === selectedCabinetId) || cabinets[0]

  // Build a U-position map with device info per slot
  const uSlots = useMemo(() => {
    if (!cabinet) return { slots: [], entries: [] as ({ device: RackDevice; isFirst: boolean } | null)[] }
    const slots: (string | null)[] = Array(cabinet.totalU).fill(null)
    const deviceMap = new Map<string, RackDevice>()

    for (const device of cabinet.devices) {
      for (let u = device.startU; u <= device.endU; u++) {
        slots[u - 1] = device.id
      }
      deviceMap.set(device.id, device)
    }

    type SlotEntry = { device: RackDevice; isFirst: boolean }
    const entries: (SlotEntry | null)[] = slots.map((deviceId, idx) => {
      if (!deviceId) return null
      const device = deviceMap.get(deviceId)!
      return { device, isFirst: device.startU === idx + 1 }
    })

    return { slots, entries }
  }, [cabinet])

  // Check conflicts for a placement
  const getSlotConflicts = useCallback((startU: number, unplaced: UnplacedDevice): boolean => {
    if (!cabinet) return true
    const endU = startU + unplaced.height - 1
    if (endU > cabinet.totalU) return true

    // Power check
    const currentPower = cabinet.devices.reduce((sum, d) => sum + d.power_watts, 0)
    if (currentPower + unplaced.power_watts > cabinet.power_limit) return true

    // Space conflict
    return cabinet.devices.some((d) => !(endU < d.startU || startU > d.endU))
  }, [cabinet])

  const handleSlotClick = useCallback((uNumber: number) => {
    if (!selectedUnplaced || !cabinet) return
    const unplaced = unplacedDevices.find((d) => d.id === selectedUnplaced)
    if (!unplaced) return
    if (getSlotConflicts(uNumber, unplaced)) return
    const success = placeDevice(cabinet.id, unplaced, uNumber)
    if (success) setSelectedUnplaced(null)
  }, [selectedUnplaced, cabinet, unplacedDevices, getSlotConflicts, placeDevice])

  const handleRemoveDevice = useCallback((deviceId: string) => {
    if (!cabinet) return
    removeDevice(cabinet.id, deviceId)
  }, [cabinet, removeDevice])

  const handleSelectCabinet = useCallback((id: number) => {
    selectCabinet(id)
    setCabinetDropdownOpen(false)
  }, [selectCabinet])

  const power = cabinet ? getPowerUsage(cabinet.id) : { used: 0, limit: 0, percent: 0, exceeded: false }

  // Type counts for legend
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    if (!cabinet) return counts
    for (const d of cabinet.devices) {
      const label = getTypeLabel(d.type)
      counts[label] = (counts[label] || 0) + 1
    }
    return counts
  }, [cabinet])

  // Group unplaced devices by type
  const unplacedByType = useMemo(() => {
    const groups: Record<string, UnplacedDevice[]> = {}
    for (const d of unplacedDevices) {
      const label = getTypeLabel(d.type)
      if (!groups[label]) groups[label] = []
      groups[label].push(d)
    }
    return groups
  }, [unplacedDevices])

  if (!cabinet) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
        请先选择一个机柜
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2">
          {/* Cabinet selector */}
          <div className="relative">
            <button
              onClick={() => setCabinetDropdownOpen(!cabinetDropdownOpen)}
              className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              机柜 {cabinet.name}
              <ChevronDown size={12} />
            </button>
            {cabinetDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCabinetDropdownOpen(false)} />
                <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg py-1 min-w-[160px] max-h-[200px] overflow-y-auto">
                  {cabinets.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelectCabinet(c.id)}
                      className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        c.id === cabinet.id ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {c.name} ({c.devices.length}台 · {c.totalU}U)
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            {cabinet.totalU}U · {cabinet.devices.length}台设备
          </span>
        </div>
        {/* Type legend */}
        <div className="flex items-center gap-3 text-[10px]">
          {Object.entries(typeCounts).map(([label, count]) => {
            const colors: Record<string, string> = {
              GPU: 'bg-blue-500', 存储: 'bg-green-500', 交换机: 'bg-amber-500', 通算: 'bg-purple-500',
            }
            const colorClass = colors[label] || 'bg-gray-400'
            return (
              <span key={label} className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                <span className={`w-2.5 h-2.5 rounded ${colorClass}`} />
                {label}×{count}
              </span>
            )
          })}
        </div>
      </div>

      {/* Power bar */}
      <div className="shrink-0 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <RackPowerBar used={power.used} limit={power.limit} compact />
      </div>

      {/* Main content: unplaced list + rack view */}
      <div className="flex-1 flex overflow-hidden">
        {/* Unplaced devices panel */}
        <div className={`border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col transition-all ${showUnplaced ? 'w-[220px] shrink-0' : 'w-0 overflow-hidden'}`}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
              待分配 ({unplacedDevices.length})
            </span>
            <button
              onClick={() => setShowUnplaced(false)}
              className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
            >
              <X size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {unplacedDevices.length === 0 ? (
              <div className="text-[11px] text-gray-400 text-center py-4">所有设备已分配</div>
            ) : (
              Object.entries(unplacedByType).map(([typeLabel, devices]) => (
                <div key={typeLabel}>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 px-1 mb-1 font-medium">{typeLabel} · {devices.length}</div>
                  {devices.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setSelectedUnplaced(selectedUnplaced === d.id ? null : d.id)}
                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded mb-0.5 transition-colors text-left ${
                        selectedUnplaced === d.id
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-1 ring-primary-300'
                          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <GripVertical size={11} className="shrink-0 text-gray-400" />
                      <span className="truncate flex-1" title={d.name}>{d.name}</span>
                      <span className="text-[9px] text-gray-400 shrink-0">{d.height}U</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Toggle unplaced panel button (when hidden) */}
        {!showUnplaced && (
          <button
            onClick={() => setShowUnplaced(true)}
            className="shrink-0 px-1 bg-gray-100 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
            title="显示待分配设备"
          >
            <ArrowRight size={14} />
          </button>
        )}

        {/* Rack visualization */}
        <div className="flex-1 overflow-auto p-3">
          {/* Placement hint */}
          {selectedUnplaced && (
            <div className="mb-2 px-3 py-1.5 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 text-[11px] rounded flex items-center gap-2">
              <Plus size={13} />
              <span>点击下方U位放置设备: <strong>{unplacedDevices.find(d => d.id === selectedUnplaced)?.name}</strong></span>
              <button onClick={() => setSelectedUnplaced(null)} className="ml-auto p-0.5 rounded hover:bg-primary-200 dark:hover:bg-primary-800">
                <X size={12} />
              </button>
            </div>
          )}

          <div className="flex gap-1 min-w-[320px] max-w-xl mx-auto">
            {/* U number ruler */}
            <div className="w-12 shrink-0 bg-gray-100 dark:bg-gray-700/50 rounded-l">
              {Array.from({ length: cabinet.totalU }, (_, i) => {
                const uNum = cabinet.totalU - i
                const isConflictArea = selectedUnplaced
                  ? getSlotConflicts(uNum, unplacedDevices.find(d => d.id === selectedUnplaced)!)
                  : false
                return (
                  <button
                    key={i}
                    onClick={() => handleSlotClick(uNum)}
                    className={`h-7 flex items-center justify-end pr-1.5 text-[10px] border-b border-gray-200 dark:border-gray-700/50 last:border-b-0 w-full transition-colors ${
                      isConflictArea
                        ? 'text-red-300 dark:text-red-700 cursor-not-allowed'
                        : selectedUnplaced
                          ? 'text-primary-500 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 cursor-pointer'
                          : 'text-gray-400 dark:text-gray-500'
                    }`}
                    disabled={isConflictArea}
                    title={isConflictArea ? '空间或功率不足' : selectedUnplaced ? `放置设备到 U${uNum}` : undefined}
                  >
                    {uNum}
                  </button>
                )
              })}
            </div>

            {/* Device slots */}
            <div className="flex-1 border border-gray-300 dark:border-gray-600 rounded-r overflow-hidden">
              {uSlots.entries.map((entry, i) => {
                const uNum = cabinet.totalU - i
                const isConflictArea = selectedUnplaced
                  ? getSlotConflicts(uNum, unplacedDevices.find(d => d.id === selectedUnplaced)!)
                  : false

                // Highlight zones where the pending device would be placed
                const pendingDevice = selectedUnplaced ? unplacedDevices.find(d => d.id === selectedUnplaced) : undefined
                const isPendingSlot = pendingDevice && !isConflictArea &&
                  pendingDevice.height >= uNum

                if (!entry) {
                  return (
                    <button
                      key={i}
                      onClick={() => handleSlotClick(uNum)}
                      className={`h-7 border-b border-gray-200 dark:border-gray-700 last:border-b-0 w-full transition-colors block ${
                        isConflictArea
                          ? 'bg-red-50 dark:bg-red-900/10 cursor-not-allowed'
                          : selectedUnplaced && isPendingSlot
                            ? 'bg-primary-50 dark:bg-primary-900/10 hover:bg-primary-100 dark:hover:bg-primary-900/20 cursor-pointer'
                            : selectedUnplaced
                              ? 'bg-white dark:bg-gray-850 hover:bg-primary-50 dark:hover:bg-primary-900/10 cursor-pointer'
                              : 'bg-white dark:bg-gray-850'
                      }`}
                      disabled={isConflictArea}
                    />
                  )
                }

                const { device, isFirst } = entry
                const colorClass = getTypeColorClass(device.type)

                return (
                  <div
                    key={i}
                    className={`h-7 border-b border-gray-200 dark:border-gray-700 last:border-b-0 flex items-center px-2 ${colorClass} text-white transition-colors group`}
                    title={`${device.name} (U${device.startU}-U${device.endU} · ${device.power_watts}W)`}
                  >
                    {isFirst && (
                      <>
                        <span className="text-[10px] font-medium truncate leading-none flex-1">
                          {device.name}
                          <span className="ml-1 opacity-70 font-normal">
                            U{device.startU}-U{device.endU}
                          </span>
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveDevice(device.id) }}
                          className="shrink-0 p-0.5 rounded hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="移除设备"
                        >
                          <X size={11} />
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
