import { useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useRackStore, CABINET_TYPE_LABELS, type CabinetType, type RackDevice, type UnplacedDevice } from '@/stores/rack.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useToastStore } from '@/stores/toast.store'
import { RackPowerBar } from '@/components/rack/RackPowerBar'
import { RackPowerHeatView } from '@/components/rack/RackPowerHeatView'
import { RackMultiCompareView } from '@/components/rack/RackMultiCompareView'
import { RackIsometricView } from '@/components/rack/RackIsometricView'
import { EmptyState } from '@/components/ui/EmptyState'
import { GripVertical, X, ArrowRight, ChevronDown, Plus, Flame, Columns, Box, LayoutGrid } from 'lucide-react'

type ViewMode = 'basic' | 'power-heat' | 'multi-compare' | 'isometric'

interface Props {
  cabinetId?: number | null
}

const getTypeColorClass = (type: string) => {
  const t = type.toLowerCase()
  if (t.includes('gpu')) return 'bg-info-500 dark:bg-info-600'
  if (t.includes('存储') || t.includes('storage')) return 'bg-success-500 dark:bg-success-600'
  if (t.includes('switch') || t.includes('交换机') || t.includes('leaf') || t.includes('spine') || t.includes('core')) return 'bg-warning-500 dark:bg-warning-600'
  if (t.includes('通算') || t.includes('compute')) return 'bg-purple-500 dark:bg-purple-600'
  if (t.includes('安全') || t.includes('security')) return 'bg-error-500 dark:bg-error-600'
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
  const { t } = useTranslation()
  // 视图模式（i18n：label 在组件内用 t() 解析，避免模块级常量残留中文）
  const VIEW_MODES: { id: ViewMode; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'basic', label: t('rackTab.viewBasic'), icon: LayoutGrid },
    { id: 'power-heat', label: t('rackTab.viewPowerHeat'), icon: Flame },
    { id: 'multi-compare', label: t('rackTab.viewMultiCompare'), icon: Columns },
    { id: 'isometric', label: t('rackTab.viewIsometric'), icon: Box },
  ]
  const cabinets = useRackStore((s) => s.cabinets)
  const unplacedDevices = useRackStore((s) => s.unplacedDevices)
  const placeDevice = useRackStore((s) => s.placeDevice)
  const removeDevice = useRackStore((s) => s.removeDevice)
  const updateCabinet = useRackStore((s) => s.updateCabinet)
  const applyCabinetTemplate = useRackStore((s) => s.applyCabinetTemplate)
  const selectCabinet = useRackStore((s) => s.selectCabinet)
  const selectedCabinetId = useRackStore((s) => s.selectedCabinetId)
  const getPowerUsage = useRackStore((s) => s.getPowerUsage)
  const addToast = useToastStore((s) => s.addToast)

  const [selectedUnplaced, setSelectedUnplaced] = useState<string | null>(null)
  const [showUnplaced, setShowUnplaced] = useState(true)
  const [cabinetDropdownOpen, setCabinetDropdownOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('basic')

  // V2.9.2-T4: 上架/移除设备标记 dirty(关闭需确认)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const updateTab = useWorkspaceStore((s) => s.updateTab)
  const markDirty = useCallback(() => {
    if (activeTabId) updateTab(activeTabId, { dirty: true })
  }, [activeTabId, updateTab])

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
    if (success) {
      setSelectedUnplaced(null)
      markDirty()
    }
  }, [selectedUnplaced, cabinet, unplacedDevices, getSlotConflicts, placeDevice, markDirty])

  const handleRemoveDevice = useCallback((deviceId: string) => {
    if (!cabinet) return
    removeDevice(cabinet.id, deviceId)
    markDirty()
  }, [cabinet, removeDevice, markDirty])

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
      <div className="h-full">
        <EmptyState
          icon={LayoutGrid}
          title={t('rackTab.noCabinetData')}
          description={t('rackTab.noCabinetDataDesc')}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-edge-subtle shrink-0 bg-gray-50 dark:bg-app/50">
        <div className="flex items-center gap-2">
          {/* Cabinet selector */}
          <div className="relative">
            <button
              onClick={() => setCabinetDropdownOpen(!cabinetDropdownOpen)}
              className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-app-surface border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              {t('rackTab.cabinet')} {cabinet.name}
              <ChevronDown size={12} />
            </button>
            {cabinetDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCabinetDropdownOpen(false)} />
                <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded shadow-lg py-1 min-w-[160px] max-h-[200px] overflow-y-auto">
                  {cabinets.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelectCabinet(c.id)}
                      className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-app-hover ${
                        c.id === cabinet.id ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {c.name} ({c.devices.length} · {c.totalU}U)
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* 打磨轮（v1.4 / AL-R2b）：柜类型微调 → 由工作台机柜子视图联动 C 回写矩阵格类型 */}
          <select
            value={cabinet.type}
            onChange={(e) => {
              updateCabinet(cabinet.id, { type: e.target.value as CabinetType })
              markDirty()
            }}
            className="px-1.5 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app-surface text-gray-700 dark:text-gray-200"
            aria-label="机柜类型"
            title="机柜类型（变更将同步到矩阵格）"
          >
            {Object.entries(CABINET_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <span className="text-2xs text-gray-400 dark:text-gray-500">
            {cabinet.totalU}U · {t('rackTab.devices', { count: cabinet.devices.length })}
          </span>
          {/* 打磨轮（v1.5 / AL-R1d）：把当前柜 U 位布局/功率应用到所有同类柜 */}
          <button
            type="button"
            onClick={() => {
              const sameType = cabinets.filter((c) => c.type === cabinet.type && c.id !== cabinet.id).length
              if (sameType === 0) {
                addToast('warning', '无同类机柜可应用', 4000)
                return
              }
              if (!window.confirm(`将当前柜的 U 位布局/功率上限应用到 ${sameType} 个同类柜？`)) return
              const r = applyCabinetTemplate(cabinet.id)
              markDirty()
              addToast('success', `已应用到同类柜：对齐 ${r.applied} 处，跳过 ${r.skipped} 处`, 4000)
            }}
            className="px-1.5 py-1 text-2xs rounded border border-violet-300 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 shrink-0"
            title={t('rack:applyToSameType', '应用到所有同类柜（U 位布局/功率上限）')}
          >
            {t('rack:applyToSameType', '应用到同类柜')}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Type legend (仅在基础模式显示) */}
          {viewMode === 'basic' && (
            <div className="flex items-center gap-3 text-2xs">
              {Object.entries(typeCounts).map(([label, count]) => {
                const colors: Record<string, string> = {
                  GPU: 'bg-info-500', 存储: 'bg-success-500', 交换机: 'bg-warning-500', 通算: 'bg-purple-500',
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
          )}

          {/* 视图模式切换器 */}
          <div className="flex items-center bg-white dark:bg-app-elevated border border-gray-200 dark:border-gray-600 rounded overflow-hidden">
            {VIEW_MODES.map((mode) => {
              const Icon = mode.icon
              const isActive = viewMode === mode.id
              return (
                <button
                  key={mode.id}
                  onClick={() => setViewMode(mode.id)}
                  title={mode.label}
                  className={`flex items-center gap-1 px-2 py-1 text-2xs transition-colors ${
                    isActive
                      ? 'bg-primary-500 text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  <Icon size={11} />
                  <span className="hidden sm:inline">{mode.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Power bar (仅在基础模式显示，避免与其他视图的功率信息重复) */}
      {viewMode === 'basic' && (
        <div className="shrink-0 px-3 py-2 border-b border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-surface">
          <RackPowerBar used={power.used} limit={power.limit} compact />
        </div>
      )}

      {/* Main content: unplaced list + rack view */}
      <div className="flex-1 flex overflow-hidden">
        {/* Unplaced devices panel (仅基础模式显示) */}
        {viewMode === 'basic' && (
          <>
            <div className={`border-r border-gray-200 dark:border-edge-subtle bg-gray-50 dark:bg-app/50 flex flex-col transition-all ${showUnplaced ? 'w-[220px] shrink-0' : 'w-0 overflow-hidden'}`}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-edge-subtle shrink-0">
                <span className="text-2xs font-semibold text-gray-600 dark:text-gray-300">
                  {t('rackTab.pending', { count: unplacedDevices.length })}
                </span>
                <button
                  onClick={() => setShowUnplaced(false)}
                  className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-400"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {unplacedDevices.length === 0 ? (
                  <div className="text-2xs text-gray-400 text-center py-4">{t('rackTab.allAssigned')}</div>
                ) : (
                  Object.entries(unplacedByType).map(([typeLabel, devices]) => (
                    <div key={typeLabel}>
                      <div className="text-2xs text-gray-400 dark:text-gray-500 px-1 mb-1 font-medium">{typeLabel} · {devices.length}</div>
                      {devices.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setSelectedUnplaced(selectedUnplaced === d.id ? null : d.id)}
                          className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-2xs rounded mb-0.5 transition-colors text-left ${
                            selectedUnplaced === d.id
                              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-1 ring-primary-300'
                              : 'bg-white dark:bg-app-elevated text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover border border-gray-200 dark:border-edge-subtle'
                          }`}
                        >
                          <GripVertical size={11} className="shrink-0 text-gray-400" />
                          <span className="truncate flex-1" title={d.name}>{d.name}</span>
                          <span className="text-3xs text-gray-400 shrink-0">{d.height}U</span>
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
                className="shrink-0 px-1 bg-gray-100 dark:bg-app-surface border-r border-gray-200 dark:border-edge-subtle hover:bg-gray-200 dark:hover:bg-app-hover text-gray-400"
                title={t('rackTab.showPending')}
              >
                <ArrowRight size={14} />
              </button>
            )}
          </>
        )}

        {/* Rack visualization (基础模式) */}
        {viewMode === 'basic' && (
          <div className="flex-1 overflow-auto p-3">
            {/* Placement hint */}
            {selectedUnplaced && (
              <div className="mb-2 px-3 py-1.5 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 text-2xs rounded flex items-center gap-2">
                <Plus size={13} />
                <span>{t('rackTab.placeDevice', { name: unplacedDevices.find(d => d.id === selectedUnplaced)?.name ?? '' })}</span>
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
                      className={`h-7 flex items-center justify-end pr-1.5 text-2xs border-b border-gray-200 dark:border-edge-subtle/50 last:border-b-0 w-full transition-colors ${
                        isConflictArea
                          ? 'text-error-300 dark:text-error-700 cursor-not-allowed'
                          : selectedUnplaced
                            ? 'text-primary-500 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 cursor-pointer'
                            : 'text-gray-400 dark:text-gray-500'
                      }`}
                      disabled={isConflictArea}
                      title={isConflictArea ? t('rackTab.shortage') : selectedUnplaced ? t('rackTab.placeToU', { u: uNum }) : undefined}
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
                        className={`h-7 border-b border-gray-200 dark:border-edge-subtle last:border-b-0 w-full transition-colors block ${
                          isConflictArea
                            ? 'bg-error-50 dark:bg-error-900/10 cursor-not-allowed'
                            : selectedUnplaced && isPendingSlot
                              ? 'bg-primary-50 dark:bg-primary-900/10 hover:bg-primary-100 dark:hover:bg-primary-900/20 cursor-pointer'
                              : selectedUnplaced
                                ? 'bg-white dark:bg-app-elevated hover:bg-primary-50 dark:hover:bg-primary-900/10 cursor-pointer'
                                : 'bg-white dark:bg-app-elevated'
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
                      className={`h-7 border-b border-gray-200 dark:border-edge-subtle last:border-b-0 flex items-center px-2 ${colorClass} text-white transition-colors group`}
                      title={`${device.name} (U${device.startU}-U${device.endU} · ${device.power_watts}W)`}
                    >
                      {isFirst && (
                        <>
                          <span className="text-2xs font-medium truncate leading-none flex-1">
                            {device.name}
                            <span className="ml-1 opacity-70 font-normal">
                              U{device.startU}-U{device.endU}
                            </span>
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveDevice(device.id) }}
                            className="shrink-0 p-0.5 rounded hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t('rackTab.removeDevice')}
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
        )}

        {/* 功率热力视图 */}
        {viewMode === 'power-heat' && (
          <div className="flex-1 overflow-hidden">
            <RackPowerHeatView cabinet={cabinet} />
          </div>
        )}

        {/* 多柜对比视图 */}
        {viewMode === 'multi-compare' && (
          <div className="flex-1 overflow-hidden">
            <RackMultiCompareView
              cabinets={cabinets}
              activeCabinetId={cabinet.id}
              onSelectCabinet={handleSelectCabinet}
            />
          </div>
        )}

        {/* 3D 等距视图 */}
        {viewMode === 'isometric' && (
          <div className="flex-1 overflow-hidden">
            <RackIsometricView cabinet={cabinet} />
          </div>
        )}
      </div>
    </div>
  )
}
