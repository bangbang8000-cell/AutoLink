import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Server, HardDrive, Plus, AlertTriangle, Loader2, Maximize2, Building2 } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useRackStore } from '@/stores/rack.store'

export function RackPanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const topology = useDesignStore((s) => s.topology)
  const openTab = useWorkspaceStore((s) => s.openTab)

  const {
    cabinets, unplacedDevices, selectedCabinetId,
    loadRackLayout, addCabinet,
    initFromTopology, getPowerUsage,
    saveRackLayout,
  } = useRackStore()

  const [initialized, setInitialized] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    setInitialized(false)
    setInitError(null)
  }, [selectedProjectName])

  useEffect(() => {
    if (!selectedProjectName || initialized) return
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        await loadRackLayout(selectedProjectName)
      } catch (err) {
        console.error('loadRackLayout failed:', err)
      }

      // If loadRackLayout produced no cabinets (no existing layout file),
      // try to initialize from topology data first, then fallback to default
      const currentCabinets = useRackStore.getState().cabinets
      if (currentCabinets.length === 0) {
        if (topology && topology.nodes.length > 0) {
          initFromTopology(topology.nodes)
        } else {
          useRackStore.getState().initDefault(134)
        }
      }

      setInitialized(true)
      setLoading(false)
    }, 50)
    return () => clearTimeout(timer)
  }, [selectedProjectName, initialized, loadRackLayout])

  // Sync topology data when it becomes available after init
  useEffect(() => {
    if (!initialized) return
    const currentCabinets = useRackStore.getState().cabinets
    if (topology && topology.nodes.length > 0 && currentCabinets.length === 0) {
      initFromTopology(topology.nodes)
    }
  }, [initialized, topology, initFromTopology])

  // T6.3: cabinets 变化时自动保存到项目根 rack_layout.json(防抖 500ms)
  // 仅在初始化完成后触发,避免加载阶段触发回写
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!initialized || !selectedProjectName) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      saveRackLayout(selectedProjectName).catch((err) => {
        console.error('[RackPanel] auto-save failed:', err)
      })
    }, 500)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [initialized, selectedProjectName, cabinets, saveRackLayout])

  const handleOpenWorkspace = useCallback((cabinetId?: number) => {
    openTab({
      type: 'rack',
      title: cabinetId != null ? `机柜 - ${cabinets.find(c => c.id === cabinetId)?.name || `#${cabinetId}`}` : '机柜规划',
      closable: true,
      state: cabinetId != null ? { cabinetId } : undefined,
    })
  }, [openTab, cabinets])

  const handleOpenDataCenter = useCallback(() => {
    openTab({
      type: 'datacenter',
      title: `机房平面布局 - ${selectedProjectName}`,
      closable: true,
    })
  }, [openTab, selectedProjectName])

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Server size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-xs text-gray-400">{t('rack:noProject')}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (initError) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <AlertTriangle size={24} className="text-gray-400 mb-2" />
        <p className="text-xs text-error-500 mb-1">初始化失败</p>
        <button onClick={() => { setInitialized(false); setInitError(null) }}
          className="px-2 py-1 text-xs rounded bg-primary-500 text-white">
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('rack:title')}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => handleOpenDataCenter()}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
            title="机房平面布局">
            <Building2 size={13} />
          </button>
          <button onClick={() => handleOpenWorkspace()}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
            title="在工作区打开">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* Cabinet list */}
      <div className="flex-1 overflow-auto">
        {cabinets.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-xs text-gray-400 mb-2">暂无已添加的机柜</p>
            <button onClick={() => addCabinet()}
              className="flex items-center gap-1 mx-auto px-3 py-1.5 text-xs rounded bg-primary-500 text-white hover:bg-primary-600">
              <Plus size={12} />添加机柜
            </button>
          </div>
        ) : (
          cabinets.map((cab) => {
            const used = cab.devices.reduce((sum, d) => sum + (d.endU - d.startU + 1), 0)
            const pct = Math.round((used / cab.totalU) * 100)
            const pu = getPowerUsage(cab.id)
            return (
              <button
                key={cab.id}
                onClick={() => handleOpenWorkspace(cab.id)}
                className={`w-full px-3 py-2.5 text-left text-xs transition-colors border-b border-gray-100 dark:border-gray-700/50
                  ${selectedCabinetId === cab.id
                    ? 'bg-primary-50 dark:bg-primary-900/20 border-l-2 border-l-primary-500'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-l-transparent'
                  }`}
              >
                <div className="flex items-center gap-1.5">
                  <HardDrive size={12} className="text-gray-400" />
                  <span className="font-medium truncate">{cab.name}</span>
                  <span className="text-2xs text-gray-400 ml-auto">
                    {pct}%
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1 rounded-full bg-gray-200 dark:bg-gray-600">
                    <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="text-2xs text-gray-400 mt-1">
                  {cab.totalU}U · {cab.devices.length}台 · {pu.used}W/{pu.limit}W
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Unplaced devices summary */}
      {unplacedDevices.length > 0 && (
        <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-3 py-2">
          <div className="text-2xs font-medium text-gray-500 mb-1">
            待分配: {unplacedDevices.length} 台
          </div>
        </div>
      )}
    </div>
  )
}
