import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Server, HardDrive, Plus, Trash2, X, AlertTriangle,
  Layers, Loader2, Download,
} from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useRackStore, type UnplacedDevice, type RackDevice } from '@/stores/rack.store'

/* -------------------------------------------------- */
/*  42U Rack View                                     */
/* -------------------------------------------------- */
function RackView({ devices, totalU, selectedDeviceId, onSelectDevice, onRemoveDevice, onSlotClick }: {
  devices: RackDevice[]
  totalU: number
  selectedDeviceId: string | null
  onSelectDevice: (id: string | null) => void
  onRemoveDevice: (id: string) => void
  onSlotClick: (u: number) => void
}) {
  // Build a U-slot occupation map
  const slotMap: Record<number, RackDevice | null> = {}
  for (let u = 1; u <= totalU; u++) slotMap[u] = null
  for (const d of devices) {
    for (let u = d.startU; u <= d.endU; u++) {
      if (u <= totalU) slotMap[u] = d
    }
  }

  // Detect conflicts: slots occupied by more than one device
  const conflictSlots = new Set<number>()
  const slotDevices: Record<number, RackDevice[]> = {}
  for (let u = 1; u <= totalU; u++) slotDevices[u] = []
  for (const d of devices) {
    for (let u = d.startU; u <= d.endU; u++) {
      if (u <= totalU) slotDevices[u].push(d)
    }
  }
  for (let u = 1; u <= totalU; u++) {
    if (slotDevices[u].length > 1) conflictSlots.add(u)
  }

  // Compute merged device spans for rendering (merge consecutive slots of same device)
  const spans: { device: RackDevice; startU: number; endU: number }[] = []
  let current: { device: RackDevice; startU: number } | null = null

  for (let u = 1; u <= totalU; u++) {
    const d = slotMap[u]
    if (d) {
      if (!current) {
        current = { device: d, startU: u }
      } else if (current.device.id !== d.id) {
        spans.push({ device: current.device, startU: current.startU, endU: u - 1 })
        current = { device: d, startU: u }
      }
    } else {
      if (current) {
        spans.push({ device: current.device, startU: current.startU, endU: u - 1 })
        current = null
      }
    }
  }
  if (current) {
    spans.push({ device: current.device, startU: current.startU, endU: totalU })
  }

  const getColor = (type: string) => {
    if (type.includes('GPU') || type.includes('Server')) return 'bg-blue-500 dark:bg-blue-600 border-blue-400 dark:border-blue-500'
    if (type.includes('Storage') || type.includes('存储')) return 'bg-green-500 dark:bg-green-600 border-green-400 dark:border-green-500'
    return 'bg-purple-500 dark:bg-purple-600 border-purple-400 dark:border-purple-500'
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full max-w-[320px] mx-auto py-1">
        {/* U number labels + grid */}
        {Array.from({ length: totalU }, (_, i) => {
          const u = totalU - i // bottom to top
          const device = slotMap[u]
          const isFirst = device && (u === 1 || slotMap[u - 1]?.id !== device.id)
          const isConflict = conflictSlots.has(u)

          return (
            <div
              key={u}
              onClick={() => {
                if (device) onSelectDevice(device.id)
                else onSlotClick(u)
              }}
              className={`flex items-center h-6 border-b border-gray-100 dark:border-gray-700/50 cursor-pointer
                ${device
                  ? (isConflict
                      ? 'bg-red-500 dark:bg-red-600 border-red-400 dark:border-red-500 bg-opacity-80 dark:bg-opacity-70 border-l-2 text-white'
                      : getColor(device.type) + ' bg-opacity-80 dark:bg-opacity-70 border-l-2 text-white'
                    )
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700/30 border-l-2 border-transparent'
                }
                ${selectedDeviceId === device?.id ? 'ring-1 ring-inset ring-white/50' : ''}
              `}
            >
              <span className={`w-7 text-center text-[9px] shrink-0 ${device ? 'text-white/80 font-medium' : 'text-gray-400 dark:text-gray-600'}`}>
                {u}
              </span>
              {isFirst && device && (
                <div className="flex-1 flex items-center gap-1 px-1.5 min-w-0">
                  <Server size={10} className="shrink-0" />
                  <span className="text-[9px] font-medium truncate">{device.name}</span>
                  <span className="text-[8px] opacity-70 ml-auto shrink-0">{device.startU}-{device.endU}U</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveDevice(device.id) }}
                    className="p-0.5 hover:bg-white/20 rounded shrink-0"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
              {!device && <div className="flex-1" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------- */
/*  Add Device Form                                   */
/* -------------------------------------------------- */
function AddDeviceForm({ totalU, devices, unplacedDevices, onPlace, onCancel }: {
  totalU: number
  devices: RackDevice[]
  unplacedDevices: UnplacedDevice[]
  onPlace: (device: UnplacedDevice, startU: number) => void
  onCancel: () => void
}) {
  const [selectedDev, setSelectedDev] = useState<UnplacedDevice | null>(unplacedDevices[0] || null)
  const [startU, setStartU] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const checkConflict = useCallback((device: UnplacedDevice, u: number) => {
    const end = u + device.height - 1
    if (end > totalU) return `超出机柜范围 (42U)`
    const conflict = devices.some((d) => !(end < d.startU || u > d.endU))
    if (conflict) return `U位 ${u}-${end} 已被占用`
    return null
  }, [devices, totalU])

  const handlePlace = () => {
    if (!selectedDev) return
    const err = checkConflict(selectedDev, startU)
    if (err) { setError(err); return }
    onPlace(selectedDev, startU)
  }

  return (
    <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">添加设备到机柜</span>
        <button onClick={onCancel} className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
          <X size={14} className="text-gray-400" />
        </button>
      </div>

      {unplacedDevices.length === 0 ? (
        <p className="text-xs text-gray-400">所有设备已分配完毕</p>
      ) : (
        <>
          {/* Device select */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">选择设备</label>
            <div className="flex flex-wrap gap-1">
              {unplacedDevices.map((d) => (
                <button
                  key={d.id}
                  onClick={() => { setSelectedDev(d); setError(null) }}
                  className={`px-2 py-1 text-[10px] rounded border ${selectedDev?.id === d.id
                    ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                    }`}
                >
                  {d.name} ({d.height}U)
                </button>
              ))}
            </div>
          </div>

          {/* U position */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">起始U位 (1=底部)</label>
            <input
              type="number" min={1} max={totalU} value={startU}
              onChange={(e) => { setStartU(parseInt(e.target.value) || 1); setError(null) }}
              className="w-20 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
            {selectedDev && (
              <span className="text-[10px] text-gray-400 ml-2">
                占 U{startU}-{startU + selectedDev.height - 1} (共{selectedDev.height}U)
              </span>
            )}
          </div>

          {error && (
            <p className="text-[10px] text-red-500 flex items-center gap-1">
              <AlertTriangle size={10} />{error}
            </p>
          )}

          <button
            onClick={handlePlace}
            disabled={!selectedDev}
            className="w-full py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            确认放置
          </button>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------- */
/*  Device Detail                                     */
/* -------------------------------------------------- */
function DeviceDetail({ device, onClose, onRemove }: {
  device: RackDevice; onClose: () => void; onRemove: () => void
}) {
  return (
    <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">设备详情</span>
        <button onClick={onClose} className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
          <X size={14} className="text-gray-400" />
        </button>
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">名称</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{device.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">类型</span>
          <span className="text-gray-600 dark:text-gray-400">{device.type}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">机柜</span>
          <span className="text-gray-600 dark:text-gray-400">#{device.cabinetId}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">U位</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{device.startU} - {device.endU} ({device.endU - device.startU + 1}U)</span>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="mt-2 w-full py-1 text-xs rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        从机柜移除
      </button>
    </div>
  )
}

/* -------------------------------------------------- */
/*  RackPanel                                         */
/* -------------------------------------------------- */
export function RackPanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)

  const {
    cabinets, unplacedDevices, selectedCabinetId, selectedDevice,
    addDeviceMode, loadRackLayout, addCabinet, removeCabinet, selectCabinet,
    placeDevice, removeDevice, selectDevice, exportToExcel,
  } = useRackStore()

  const [initialized, setInitialized] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Reset init state when project changes
  useEffect(() => {
    setInitialized(false)
    setInitError(null)
  }, [selectedProjectName])

  // Initialize with saved layout or default (deferred to avoid blocking render)
  useEffect(() => {
    if (!selectedProjectName || initialized) return

    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        await loadRackLayout(selectedProjectName)
        setInitialized(true)
        setInitError(null)
      } catch (err) {
        setInitError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [selectedProjectName, initialized, loadRackLayout])

  const selectedCab = useMemo(
    () => cabinets.find((c) => c.id === selectedCabinetId) ?? null,
    [cabinets, selectedCabinetId],
  )

  const usagePercent = useMemo(() => {
    if (!selectedCab) return 0
    const used = selectedCab.devices.reduce((sum, d) => sum + (d.endU - d.startU + 1), 0)
    return Math.round((used / selectedCab.totalU) * 100)
  }, [selectedCab])

  const handleCloseAddMode = useCallback(() => {
    useRackStore.setState({ addDeviceMode: false })
  }, [])

  const handleOpenAddMode = useCallback(() => {
    useRackStore.setState({ addDeviceMode: true, selectedDevice: null })
  }, [])

  const handlePlace = useCallback((device: UnplacedDevice, startU: number) => {
    if (!selectedCabinetId) return
    placeDevice(selectedCabinetId, device, startU)
    useRackStore.setState({ addDeviceMode: false })
  }, [selectedCabinetId, placeDevice])

  const handleExport = useCallback(async () => {
    if (!selectedProjectName) return
    setExporting(true)
    try {
      const filePath = await exportToExcel(selectedProjectName)
      if (filePath) {
        window.electron?.shell?.showItemInFolder(filePath)
      }
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }, [selectedProjectName, exportToExcel])

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <Server size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">{t('rack:title')}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('rack:noProject')}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <Loader2 size={32} className="animate-spin text-primary-500 mb-3" />
        <p className="text-xs text-gray-400 dark:text-gray-500">初始化机柜布局...</p>
      </div>
    )
  }

  if (initError) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <AlertTriangle size={32} className="text-red-400 mb-3" />
        <p className="text-sm text-red-500 mb-1">初始化失败</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{initError}</p>
        <button
          onClick={() => { setInitialized(false); setInitError(null) }}
          className="px-3 py-1 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Title */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('rack:title')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExport}
            disabled={exporting || cabinets.length === 0}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-50"
          >
            <Download size={12} />
            {exporting ? '导出中...' : '导出上机表'}
          </button>
          <button
            onClick={addCabinet}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          >
            <Plus size={12} />添加机柜
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Cabinet list */}
        <div className="w-28 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-auto py-1">
          {cabinets.map((cab) => {
            const used = cab.devices.reduce((sum, d) => sum + (d.endU - d.startU + 1), 0)
            const pct = Math.round((used / cab.totalU) * 100)
            return (
              <button
                key={cab.id}
                onClick={() => selectCabinet(cab.id)}
                className={`w-full px-2 py-2 text-left text-xs transition-colors
                  ${selectedCabinetId === cab.id
                    ? 'bg-primary-50 dark:bg-primary-900/20 border-r-2 border-primary-500'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 border-r-2 border-transparent'
                  }`}
              >
                <div className="flex items-center gap-1">
                  <HardDrive size={11} className="text-gray-400" />
                  <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{cab.name}</span>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <div className="flex-1 h-1 rounded-full bg-gray-200 dark:bg-gray-600">
                    <div
                      className="h-full rounded-full bg-primary-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400">{pct}%</span>
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">{cab.devices.length}台设备</div>
              </button>
            )
          })}
        </div>

        {/* Rack view + controls */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedCab ? (
            <>
              {/* Info bar */}
              <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
                <span className="font-medium text-gray-700 dark:text-gray-300">{selectedCab.name}</span>
                <span>42U</span>
                <span>{selectedCab.devices.length}台</span>
                <span>使用率 {usagePercent}%</span>
                <button
                  onClick={handleOpenAddMode}
                  className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded bg-primary-500 text-white text-[10px] hover:bg-primary-600"
                >
                  <Plus size={10} />放置设备
                </button>
                {cabinets.length > 1 && (
                  <button
                    onClick={() => removeCabinet(selectedCab.id)}
                    className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-400"
                    title="删除机柜"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>

              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Rack view */}
                  <RackView
                    devices={selectedCab.devices}
                    totalU={selectedCab.totalU}
                    selectedDeviceId={selectedDevice?.id ?? null}
                    onSelectDevice={(id) => selectDevice(id)}
                    onRemoveDevice={(id) => removeDevice(selectedCab.id, id)}
                    onSlotClick={() => { if (unplacedDevices.length > 0) handleOpenAddMode() }}
                  />

                  {/* Add device form */}
                  {addDeviceMode && (
                    <AddDeviceForm
                      totalU={selectedCab.totalU}
                      devices={selectedCab.devices}
                      unplacedDevices={unplacedDevices}
                      onPlace={handlePlace}
                      onCancel={handleCloseAddMode}
                    />
                  )}
                </div>

                {/* Device detail panel */}
                {selectedDevice && (
                  <div className="w-52 shrink-0 border-l border-gray-200 dark:border-gray-700 p-2 overflow-auto">
                    <DeviceDetail
                      device={selectedDevice}
                      onClose={() => selectDevice(null)}
                      onRemove={() => {
                        removeDevice(selectedDevice.cabinetId, selectedDevice.id)
                        selectDevice(null)
                      }}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
              {cabinets.length === 0 ? '点击 + 添加机柜' : '选择左侧机柜开始规划'}
            </div>
          )}
        </div>
      </div>

      {/* Unplaced devices */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-3 py-1.5">
        <div className="flex items-center gap-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">
          <Layers size={11} />
          待分配设备 ({unplacedDevices.length})
        </div>
        <div className="flex flex-wrap gap-1 max-h-20 overflow-auto">
          {unplacedDevices.slice(0, 30).map((d) => (
            <span
              key={d.id}
              className="px-1.5 py-0.5 text-[9px] rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
            >
              {d.name} ({d.height}U)
            </span>
          ))}
          {unplacedDevices.length > 30 && (
            <span className="text-[9px] text-gray-400">...还有 {unplacedDevices.length - 30} 台</span>
          )}
        </div>
      </div>
    </div>
  )
}


