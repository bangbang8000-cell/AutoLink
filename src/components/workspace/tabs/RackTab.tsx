import { useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { useRackStore, CABINET_TYPE_LABELS, findFirstAvailableU, validateCabinetPatch, checkDeviceMove, type CabinetPatch, type CabinetType, type DevicePatch, type RackDevice, type UnplacedDevice, type TemplateConflict } from '@/stores/rack.store'
import { useRoomStore } from '@/stores/room.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useToastStore } from '@/stores/toast.store'
import { RackPowerBar } from '@/components/rack/RackPowerBar'
import { RackPowerHeatView } from '@/components/rack/RackPowerHeatView'
import { RackMultiCompareView } from '@/components/rack/RackMultiCompareView'
import { RackIsometricView } from '@/components/rack/RackIsometricView'
import { EmptyState } from '@/components/ui/EmptyState'
import { GripVertical, X, ArrowRight, ChevronDown, Plus, Flame, Columns, Box, LayoutGrid, Settings, ListChecks, Copy, ClipboardPaste } from 'lucide-react'

type ViewMode = 'basic' | 'power-heat' | 'multi-compare' | 'isometric'

interface Props {
  cabinetId?: number | null
}

// AL-N4：导出给测试；type 为空/undefined 时兜底 'gpu'（旧数据缺 device.type 不再 TypeError）
export const getTypeColorClass = (type?: string) => {
  const t = (type ?? 'gpu').toLowerCase()
  if (t.includes('gpu')) return 'bg-info-500 dark:bg-info-600'
  if (t.includes('存储') || t.includes('storage')) return 'bg-success-500 dark:bg-success-600'
  if (t.includes('switch') || t.includes('交换机') || t.includes('leaf') || t.includes('spine') || t.includes('core')) return 'bg-warning-500 dark:bg-warning-600'
  if (t.includes('通算') || t.includes('compute')) return 'bg-purple-500 dark:bg-purple-600'
  if (t.includes('安全') || t.includes('security')) return 'bg-error-500 dark:bg-error-600'
  return 'bg-gray-400 dark:bg-gray-500'
}

export const getTypeLabel = (type?: string) => {
  const t = (type ?? 'gpu').toLowerCase()
  if (t.includes('gpu')) return 'GPU'
  if (t.includes('存储') || t.includes('storage')) return '存储'
  if (t.includes('switch') || t.includes('交换机')) return '交换机'
  if (t.includes('通算') || t.includes('compute')) return '通算'
  if (t.includes('安全') || t.includes('security')) return '安全'
  return type && type.trim() ? type : 'GPU'
}

const CONFLICT_REASON_LABELS: Record<TemplateConflict['reason'], string> = {
  occupied: 'U位被占',
  overflow: 'U位溢出柜高',
  top_reserved: '柜顶预留区',
  power: '功率超限',
  // M-F2（F2-1）：跨项目兼容校验原因
  type_mismatch: '机柜类型不兼容',
  totalU_mismatch: '机柜高度不一致',
  device_type_mismatch: '设备类型与机柜不兼容',
}

// M3（AL-CP2）：设备粘贴失败原因文案
const PASTE_REASON_LABELS: Record<string, string> = {
  no_clipboard: '剪贴板无设备',
  overflow: 'U 位越界',
  top_reserved: '柜顶预留区',
  occupied: 'U 位被占',
  power: '功率超限',
  no_space: '无可用 U 位',
  // M-F2（F2-1）：跨项目设备类型域不兼容
  type_mismatch: '设备类型与目标机柜不兼容',
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
  const moveDevice = useRackStore((s) => s.moveDevice)
  const updateCabinet = useRackStore((s) => s.updateCabinet)
  const applyCabinetTemplate = useRackStore((s) => s.applyCabinetTemplate)
  const selectCabinet = useRackStore((s) => s.selectCabinet)
  const selectedCabinetId = useRackStore((s) => s.selectedCabinetId)
  const getPowerUsage = useRackStore((s) => s.getPowerUsage)
  const addToast = useToastStore((s) => s.addToast)
  // M5（AL-ED4/ED5/ED6）：柜内编辑能力——单柜信息调整/设备批量/U位偏移/顶部预留/联动
  const topReservedU = useRackStore((s) => s.topReservedU)
  const updateCabinetSafe = useRackStore((s) => s.updateCabinetSafe)
  const updateDevicesBulk = useRackStore((s) => s.updateDevicesBulk)
  const shiftDevicesU = useRackStore((s) => s.shiftDevicesU)
  const setRackConfig = useRackStore((s) => s.setRackConfig)
  const syncCabinetToCell = useRoomStore((s) => s.syncCabinetToCell)
  // M3（AL-CP1/CP2）：机柜/设备 复制粘贴（应用内剪贴板）
  const copyCabinet = useRackStore((s) => s.copyCabinet)
  const copyDevice = useRackStore((s) => s.copyDevice)
  const pasteDevice = useRackStore((s) => s.pasteDevice)
  const pasteDeviceAuto = useRackStore((s) => s.pasteDeviceAuto)
  const clipboard = useRackStore((s) => s.clipboard)

  const [selectedUnplaced, setSelectedUnplaced] = useState<string | null>(null)
  const [showUnplaced, setShowUnplaced] = useState(true)
  const [cabinetDropdownOpen, setCabinetDropdownOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('basic')
  // AL-M5b：项目 Modal 确认体系（替代 window.confirm）；M6（AL-ED7）批量属性/U偏移二次确认复用
  const [confirmState, setConfirmState] = useState<{ message: string; fn: () => void; danger?: boolean } | null>(null)
  // PRD AL-R6：整柜模板应用冲突明细（无冲突时置 null 显示成功 toast）
  const [templateResult, setTemplateResult] = useState<{ applied: number; conflicts: TemplateConflict[] } | null>(null)
  // M5（AL-ED4）：机柜信息调整 Modal + 右键菜单
  const [cabinetEditOpen, setCabinetEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<{ name: string; totalU: string; type: CabinetType; powerLimit: string; topReservedU: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // M3（AL-CP1/CP2）：柜内右键菜单上下文（header=机柜级 / device=设备级 / slot=U 位级）
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; kind: 'header' | 'device' | 'slot'; deviceId?: string; uNum?: number } | null>(null)
  // M5（AL-ED6）：同柜批量编辑（多选态 + 批量操作条）
  const [batchMode, setBatchMode] = useState(false)
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set())
  const [batchName, setBatchName] = useState('')
  const [batchPower, setBatchPower] = useState('')
  const [batchType, setBatchType] = useState<CabinetType | ''>('')
  const [shiftOffset, setShiftOffset] = useState('')
  // M6（AL-ED7）：同柜批量冲突明细（逐条原因，不静默跳过）
  const [batchIssue, setBatchIssue] = useState<string | null>(null)

  // V2.9.2-T4: 上架/移除设备标记 dirty(关闭需确认)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const updateTab = useWorkspaceStore((s) => s.updateTab)
  const markDirty = useCallback(() => {
    if (activeTabId) updateTab(activeTabId, { dirty: true })
  }, [activeTabId, updateTab])

  // Find the target cabinet
  const cabinet = cabinetId != null ? cabinets.find((c) => c.id === cabinetId) : cabinets.find((c) => c.id === selectedCabinetId) || cabinets[0]

  // M5（AL-ED5）：跨柜拖拽目标柜列表（除当前柜外）
  const otherCabinets = useMemo(() => cabinets.filter((c) => c.id !== cabinet?.id), [cabinets, cabinet])

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

  // M6：柜内拖拽状态（已上架设备 → 拖到目标 U 位）
  const [dragDevice, setDragDevice] = useState<RackDevice | null>(null)
  const [dragOverU, setDragOverU] = useState<number | null>(null)

  // M5（AL-ED5）：拖拽落点冲突预判——复用 checkDeviceMove 与落库校验同源（顶部预留用全局配置）
  const dragConflict = useCallback((startU: number, device: RackDevice): boolean => {
    if (!cabinet) return true
    return !checkDeviceMove(cabinet, device, startU, topReservedU).ok
  }, [cabinet, topReservedU])

  // M6：放下 → 同柜移动到新 U 位（复用 moveDevice 校验）
  const handleDrop = useCallback((targetU: number) => {
    if (!dragDevice || !cabinet) return
    const ok = moveDevice(dragDevice.id, cabinet.id, cabinet.id, targetU)
    if (ok) {
      addToast('success', `已移动到 U${targetU}`, 3000)
      markDirty()
    } else {
      addToast('error', '无法放置：U 位冲突 / 越界 / 功率超限 / 顶部预留', 4000)
    }
    setDragDevice(null)
    setDragOverU(null)
  }, [dragDevice, cabinet, moveDevice, addToast, markDirty])

  // M5（AL-ED5）：跨柜拖拽 → 目标柜找首个可用落点（findFirstAvailableU 预判，落库走 moveDevice）
  const handleCrossDrop = useCallback((targetId: number) => {
    if (!dragDevice) { setDragDevice(null); setDragOverU(null); return }
    const target = cabinets.find((c) => c.id === targetId)
    if (!target || !cabinet) {
      addToast('error', '无法放置：目标机柜不存在', 4000)
      setDragDevice(null); setDragOverU(null); return
    }
    const height = dragDevice.endU - dragDevice.startU + 1
    const startU = findFirstAvailableU(target, height, { topReservedU, power_watts: dragDevice.power_watts })
    if (startU == null) {
      addToast('error', `无法移动到 ${target.name}：无可用 U 位 / 功率不足`, 4000)
    } else {
      const ok = moveDevice(dragDevice.id, cabinet.id, target.id, startU)
      if (ok) {
        addToast('success', `已移动到 ${target.name} U${startU}`, 3000)
        markDirty()
      } else {
        addToast('error', '无法放置：U 位冲突 / 越界 / 功率超限 / 顶部预留', 4000)
      }
    }
    setDragDevice(null)
    setDragOverU(null)
  }, [dragDevice, cabinet, cabinets, topReservedU, moveDevice, addToast, markDirty])

  // M5（AL-ED4）：打开机柜信息调整 Modal（以当前机柜值初始化表单）
  const openCabinetEdit = useCallback(() => {
    if (!cabinet) return
    setEditError(null)
    setEditForm({
      name: cabinet.name,
      totalU: String(cabinet.totalU),
      type: cabinet.type,
      powerLimit: String(cabinet.power_limit),
      topReservedU: String(topReservedU),
    })
    setCabinetEditOpen(true)
  }, [cabinet, topReservedU])

  // M5（AL-ED4）：保存——冲突（改矮/功率改小）校验阻塞不落库（复用 validateCabinetPatch）
  const saveCabinetEdit = useCallback(() => {
    if (!cabinet || !editForm) return
    const totalU = Math.max(1, parseInt(editForm.totalU) || 1)
    const powerLimit = Math.max(0, parseInt(editForm.powerLimit) || 0)
    const reserved = Math.max(0, parseInt(editForm.topReservedU) || 0)
    const patch: CabinetPatch = {
      name: editForm.name.trim() || cabinet.name,
      totalU,
      type: editForm.type,
      power_limit: powerLimit,
    }
    const r = updateCabinetSafe(cabinet.id, patch)
    if (r.issues.length > 0) {
      setEditError(r.issues[0].message)
      addToast('error', r.issues[0].message, 5000)
      return
    }
    setRackConfig({ topReservedU: reserved })
    syncCabinetToCell(cabinet.id)
    markDirty()
    setCabinetEditOpen(false)
    setEditForm(null)
    addToast('success', '机柜信息已更新（顶部预留为全局配置）', 3000)
  }, [cabinet, editForm, updateCabinetSafe, setRackConfig, syncCabinetToCell, markDirty, addToast])

  // M5（AL-ED6）：设备块点击 → 批量模式多选
  const toggleDeviceSelect = useCallback((id: string) => {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // M5（AL-ED6）：批量应用属性（名称/类型/功率；功率超限整批拒绝）——M6（AL-ED7）先二次确认
  const doApplyBatchAttrs = useCallback((patch: DevicePatch) => {
    if (!cabinet) return
    const r = updateDevicesBulk(cabinet.id, Array.from(selectedDeviceIds), patch)
    if (r.issues.length > 0) {
      setBatchIssue(r.issues[0].message)
      addToast('error', r.issues[0].message, 5000)
    } else {
      setBatchIssue(null)
      addToast('success', `已批量更新 ${r.applied} 台设备`, 3000)
      markDirty()
      setSelectedDeviceIds(new Set())
    }
    setBatchName('')
    setBatchPower('')
    setBatchType('')
  }, [cabinet, selectedDeviceIds, updateDevicesBulk, addToast, markDirty])

  const requestBatchAttrs = useCallback(() => {
    if (!cabinet || selectedDeviceIds.size === 0) return
    const patch: DevicePatch = {}
    if (batchName.trim()) patch.name = batchName.trim()
    if (batchType) patch.type = batchType
    if (batchPower !== '' && !Number.isNaN(parseInt(batchPower))) patch.power_watts = Math.max(0, parseInt(batchPower))
    if (Object.keys(patch).length === 0) {
      addToast('warning', '请至少填写一项属性（名称/类型/功率）', 3000)
      return
    }
    setConfirmState({
      message: `确认对 ${selectedDeviceIds.size} 台设备批量修改属性？`,
      danger: false,
      fn: () => doApplyBatchAttrs(patch),
    })
  }, [cabinet, selectedDeviceIds, batchName, batchType, batchPower, addToast, doApplyBatchAttrs])

  // M5（AL-ED6）：批量 U 位偏移（整批原子，越界/冲突拒绝）——M6（AL-ED7）先二次确认
  const doShift = useCallback((offset: number) => {
    if (!cabinet) return
    const r = shiftDevicesU(cabinet.id, Array.from(selectedDeviceIds), offset)
    if (r.issues.length > 0) {
      setBatchIssue(r.issues[0].message)
      addToast('error', r.issues[0].message, 5000)
    } else {
      setBatchIssue(null)
      addToast('success', `已${offset > 0 ? '上移' : '下移'} ${r.applied} 台设备 ${Math.abs(offset)}U`, 3000)
      markDirty()
    }
  }, [cabinet, selectedDeviceIds, shiftDevicesU, addToast, markDirty])

  const requestShift = useCallback((offset: number) => {
    if (!cabinet || selectedDeviceIds.size === 0) return
    if (offset === 0) {
      addToast('warning', '请输入非 0 偏移量', 3000)
      return
    }
    setConfirmState({
      message: `确认对 ${selectedDeviceIds.size} 台设备执行 U 位偏移（${offset > 0 ? '上移' : '下移'} ${Math.abs(offset)}U）？`,
      danger: false,
      fn: () => doShift(offset),
    })
  }, [cabinet, selectedDeviceIds, addToast, doShift])

  const clearSelection = useCallback(() => {
    setSelectedDeviceIds(new Set())
    setBatchName('')
    setBatchPower('')
    setBatchType('')
    setShiftOffset('')
    setBatchIssue(null)
  }, [])

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

  // M3（AL-CP1/CP2）：机柜/设备 复制粘贴
  const handleCopyCabinet = useCallback(() => {
    if (!cabinet) return
    if (copyCabinet(cabinet.id)) addToast('success', `已复制机柜「${cabinet.name}」到剪贴板`, 3000)
  }, [cabinet, copyCabinet, addToast])

  const handleCopyDevice = useCallback((deviceId: string) => {
    if (!cabinet) return
    if (copyDevice(cabinet.id, deviceId)) addToast('success', '已复制设备到剪贴板', 3000)
  }, [cabinet, copyDevice, addToast])

  const handlePasteDeviceAt = useCallback((uNum: number) => {
    if (!cabinet) return
    const r = pasteDevice(cabinet.id, uNum)
    if (r.ok) {
      // M-F2（F2-1）：跨项目粘贴成功 → toast 提示来源项目
      const src = r.crossProject && r.sourceProjectName ? `（来自项目「${r.sourceProjectName}」）` : ''
      addToast('success', `已粘贴设备「${r.deviceName}」到 U${r.startU}-U${r.endU}${src}`, 3000)
      markDirty()
    } else {
      addToast('error', `粘贴失败：${PASTE_REASON_LABELS[r.reason ?? 'no_clipboard']}`, 4000)
    }
  }, [cabinet, pasteDevice, addToast, markDirty])

  const handlePasteDeviceAuto = useCallback(() => {
    if (!cabinet) return
    const r = pasteDeviceAuto(cabinet.id)
    if (r.ok) {
      // M-F2（F2-1）：跨项目粘贴成功 → toast 提示来源项目
      const src = r.crossProject && r.sourceProjectName ? `（来自项目「${r.sourceProjectName}」）` : ''
      addToast('success', `已粘贴设备「${r.deviceName}」到 U${r.startU}-U${r.endU}${src}`, 3000)
      markDirty()
    } else {
      addToast('error', `粘贴失败：${PASTE_REASON_LABELS[r.reason ?? 'no_clipboard']}`, 4000)
    }
  }, [cabinet, pasteDeviceAuto, addToast, markDirty])

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
    <>
    <div className="h-full flex flex-col">
      {/* Header（M5：右键 → 机柜信息调整/批量编辑菜单） */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-edge-subtle shrink-0 bg-gray-50 dark:bg-app/50"
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY, kind: 'header' })
        }}
        title={t('rack:cabinetHeaderCtx', '右键：机柜信息调整 / 批量编辑设备 / 复制粘贴')}
      >
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
          {/* 打磨轮（v1.4 / AL-R2b）：柜类型微调 → 由工作台机柜子视图联动 C 回写矩阵格类型（M6：RackTab 独立渲染也直接回写） */}
          <select
            value={cabinet.type}
            onChange={(e) => {
              updateCabinet(cabinet.id, { type: e.target.value as CabinetType })
              // M6（AL-ED8）：类型变更 → 矩阵格类型 + 配色同步（等值守卫由 syncCabinetToCell 内收敛）
              syncCabinetToCell(cabinet.id)
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
          {/* M4: 逐柜功率编辑（M5：改小超限校验阻塞不落库） */}
          <label className="flex items-center gap-1 text-2xs text-gray-500 dark:text-gray-400" title="单柜功率上限(W)">
            功率
            <input
              type="number"
              min={0}
              step={100}
              value={cabinet.power_limit}
              onChange={(e) => {
                const next = Math.max(0, parseInt(e.target.value) || 0)
                if (validateCabinetPatch(cabinet, { power_limit: next }).length > 0) {
                  addToast('error', `功率 ${next}W 低于当前柜内已用功率，已阻止修改`, 4000)
                  return
                }
                updateCabinet(cabinet.id, { power_limit: next })
                markDirty()
              }}
              className="w-20 px-1 py-0.5 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app-surface text-gray-700 dark:text-gray-200"
            />
          </label>
          {/* M5（AL-ED4）：机柜信息调整入口（Modal：名称/总U/类型/功率/顶部预留） */}
          <button
            type="button"
            onClick={openCabinetEdit}
            className="flex items-center gap-1 px-1.5 py-1 text-2xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 shrink-0"
            title="机柜信息调整（名称/总U/类型/功率/顶部预留）"
          >
            <Settings size={11} /> {t('rack:editCabinetInfo', '机柜信息')}
          </button>
          {/* 打磨轮（v1.5 / AL-R1d）：把当前柜 U 位布局/功率应用到所有同类柜 */}
          <button
            type="button"
            onClick={() => {
              const sameType = cabinets.filter((c) => c.type === cabinet.type && c.id !== cabinet.id).length
              if (sameType === 0) {
                addToast('warning', '无同类机柜可应用', 4000)
                return
              }
              // AL-M5b：window.confirm → 项目 Modal 确认体系
              setConfirmState({
                message: `将当前柜的 U 位布局/设备/功率上限应用到 ${sameType} 个同类柜？`,
                fn: () => {
                  const r = applyCabinetTemplate(cabinet.id)
                  markDirty()
                  if (r.conflicts.length > 0) {
                    addToast('warning', `整柜模板已应用：复制 ${r.applied} 处，${r.conflicts.length} 处冲突已跳过`, 5000)
                    setTemplateResult({ applied: r.applied, conflicts: r.conflicts })
                  } else {
                    addToast('success', `已应用到同类柜：复制 ${r.applied} 处设备，无冲突`, 4000)
                    setTemplateResult(null)
                  }
                },
              })
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

          {/* M5（AL-ED6）：批量编辑设备（多选态切换，仅基础视图） */}
          {viewMode === 'basic' && (
            <button
              type="button"
              onClick={() => {
                setBatchMode((b) => !b)
                if (batchMode) setSelectedDeviceIds(new Set())
              }}
              className={`flex items-center gap-1 px-2 py-1 text-2xs rounded border transition-colors ${
                batchMode
                  ? 'bg-primary-500 text-white border-primary-500'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
              title="批量编辑：多选设备后批量改属性/U位偏移"
            >
              <ListChecks size={11} /> {batchMode ? t('rack:batchExit', '退出批量') : t('rack:batchEdit', '批量编辑')}
            </button>
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

      {/* PRD AL-R6：整柜模板应用冲突明细 */}
      {templateResult && (
        <div className="mx-3 mt-2 px-3 py-2 rounded border border-warning-300 dark:border-warning-600 bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-300 text-2xs flex items-start gap-2">
          <div className="flex-1">
            <div className="font-medium mb-1">整柜模板应用：成功复制 {templateResult.applied} 处，{templateResult.conflicts.length} 处冲突已跳过</div>
            {templateResult.conflicts.length > 0 && (
              <ul className="space-y-0.5">
                {templateResult.conflicts.map((conf, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <span className="font-medium">{cabinets.find((c) => c.id === conf.cabinetId)?.name ?? conf.cabinetId}</span>
                    <span>{conf.deviceName}</span>
                    <span>{conf.startU}U</span>
                    <span className="text-warning-600 dark:text-warning-400">[{CONFLICT_REASON_LABELS[conf.reason]}]</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={() => setTemplateResult(null)} className="p-0.5 rounded hover:bg-warning-100 dark:hover:bg-warning-800 text-warning-500 shrink-0" aria-label="关闭">
            <X size={12} />
          </button>
        </div>
      )}

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

            {/* M5（AL-ED6）：同柜批量操作条（批量模式多选后应用） */}
            {batchMode && (
              <div className="mb-2 px-3 py-2 rounded border border-primary-200 dark:border-primary-900/40 bg-primary-50/40 dark:bg-primary-900/10 flex flex-wrap items-center gap-2 text-2xs">
                <span className="font-medium text-primary-700 dark:text-primary-300">已选 {selectedDeviceIds.size} 台设备</span>
                <Input
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder="批量名称"
                  className="!w-28 !py-0.5 !text-2xs"
                  aria-label="批量名称"
                />
                <Input
                  type="number"
                  min={0}
                  step={100}
                  value={batchPower}
                  onChange={(e) => setBatchPower(e.target.value)}
                  placeholder="批量功率(W)"
                  className="!w-24 !py-0.5 !text-2xs"
                  aria-label="批量功率"
                />
                <Select
                  value={batchType}
                  onChange={(e) => setBatchType(e.target.value as CabinetType | '')}
                  options={[{ value: '', label: '批量类型' }, ...Object.entries(CABINET_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))]}
                  className="!w-28 !py-0.5 !text-2xs"
                  aria-label="批量类型"
                />
                <button type="button" onClick={requestBatchAttrs} className="px-2 py-1 rounded bg-primary-500 hover:bg-primary-600 text-white" title="批量操作需二次确认">
                  应用属性
                </button>
                <span className="mx-1 h-4 w-px bg-gray-300 dark:bg-gray-600" />
                <span className="text-gray-500 dark:text-gray-400">U位偏移</span>
                <button type="button" onClick={() => requestShift(1)} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600" title="批量操作需二次确认">
                  上移1U
                </button>
                <button type="button" onClick={() => requestShift(-1)} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600" title="批量操作需二次确认">
                  下移1U
                </button>
                <Input
                  type="number"
                  value={shiftOffset}
                  onChange={(e) => setShiftOffset(e.target.value)}
                  placeholder="偏移U"
                  className="!w-16 !py-0.5 !text-2xs"
                  aria-label="批量偏移量"
                />
                <button type="button" onClick={() => requestShift(parseInt(shiftOffset) || 0)} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600" title="批量操作需二次确认">
                  应用偏移
                </button>
                <button type="button" onClick={clearSelection} className="px-2 py-1 rounded text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20">
                  清除选择
                </button>
                {/* M6（AL-ED7）：批量冲突明细（逐条原因，不静默跳过） */}
                {batchIssue && (
                  <div className="w-full px-2 py-1.5 rounded bg-error-50 dark:bg-error-900/20 text-error-600 dark:text-error-400 text-2xs flex items-start gap-1.5">
                    <Flame size={11} className="shrink-0 mt-0.5" />
                    <span>{batchIssue}</span>
                  </div>
                )}
              </div>
            )}

            {/* M5（AL-ED5）：跨柜拖拽目标 chips（拖到其它柜，预判可落点/无效落点红提示） */}
            {dragDevice && otherCabinets.length > 0 && (
              <div className="mb-2 px-2 py-1.5 rounded border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-app/50 flex flex-wrap items-center gap-1.5 text-2xs">
                <span className="text-gray-400">{t('rack:cabinetDragTo', '拖到其它机柜：')}</span>
                {otherCabinets.map((oc) => {
                  const height = dragDevice.endU - dragDevice.startU + 1
                  const startU = findFirstAvailableU(oc, height, { topReservedU, power_watts: dragDevice.power_watts })
                  const canDrop = startU != null
                  return (
                    <button
                      key={oc.id}
                      onDragOver={(e) => { if (dragDevice) e.preventDefault() }}
                      onDrop={(e) => { e.preventDefault(); handleCrossDrop(oc.id) }}
                      className={`px-2 py-0.5 rounded border text-2xs transition-colors ${
                        canDrop
                          ? 'border-success-300 dark:border-success-600 text-success-600 dark:text-success-400 bg-success-50 dark:bg-success-900/20'
                          : 'border-error-300 dark:border-error-600 text-error-500 dark:text-error-400 bg-error-50 dark:bg-error-900/20'
                      }`}
                      title={canDrop ? `${oc.name} 可落位 U${startU}` : `${oc.name} 无可用位置`}
                    >
                      {oc.name}
                    </button>
                  )
                })}
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
                      onDragOver={(e) => { if (dragDevice) { e.preventDefault(); setDragOverU(uNum) } }}
                      onDrop={(e) => { e.preventDefault(); handleDrop(uNum) }}
                      className={`h-7 flex items-center justify-end pr-1.5 text-2xs border-b border-gray-200 dark:border-edge-subtle/50 last:border-b-0 w-full transition-colors ${
                        isConflictArea
                          ? 'text-error-300 dark:text-error-700 cursor-not-allowed'
                          : selectedUnplaced
                            ? 'text-primary-500 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 cursor-pointer'
                            : 'text-gray-400 dark:text-gray-500'
                      }`}
                      disabled={isConflictArea && !dragDevice}
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
                    const isDropTarget = dragDevice != null && !dragConflict(uNum, dragDevice)
                    const isDragOver = dragOverU === uNum
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (batchMode) { clearSelection(); return }
                          handleSlotClick(uNum)
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setContextMenu({ x: e.clientX, y: e.clientY, kind: 'slot', uNum })
                        }}
                        onDragOver={(e) => { if (dragDevice) { e.preventDefault(); setDragOverU(uNum) } }}
                        onDrop={(e) => { e.preventDefault(); handleDrop(uNum) }}
                        className={`h-7 border-b border-gray-200 dark:border-edge-subtle last:border-b-0 w-full transition-colors block ${
                          isDragOver
                            ? isDropTarget
                              ? 'bg-success-200 dark:bg-success-900/40'
                              : 'bg-error-200 dark:bg-error-900/40'
                            : isConflictArea
                              ? 'bg-error-50 dark:bg-error-900/10 cursor-not-allowed'
                              : selectedUnplaced && isPendingSlot
                                ? 'bg-primary-50 dark:bg-primary-900/10 hover:bg-primary-100 dark:hover:bg-primary-900/20 cursor-pointer'
                                : selectedUnplaced
                                  ? 'bg-white dark:bg-app-elevated hover:bg-primary-50 dark:hover:bg-primary-900/10 cursor-pointer'
                                  : 'bg-white dark:bg-app-elevated'
                        }`}
                        disabled={isConflictArea && !dragDevice}
                      />
                    )
                  }

                  const { device, isFirst } = entry
                  const colorClass = getTypeColorClass(device.type)
                  const isDragging = dragDevice?.id === device.id
                  const isSelected = batchMode && selectedDeviceIds.has(device.id)

                  return (
                    <div
                      key={i}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', device.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDragDevice(device)
                      }}
                      onDragEnd={() => { setDragDevice(null); setDragOverU(null) }}
                      onClick={(e) => {
                        if (!batchMode) return
                        e.stopPropagation()
                        toggleDeviceSelect(device.id)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setContextMenu({ x: e.clientX, y: e.clientY, kind: 'device', deviceId: device.id })
                      }}
                      className={`h-7 border-b border-gray-200 dark:border-edge-subtle last:border-b-0 flex items-center px-2 ${colorClass} text-white transition-colors group ${isDragging ? 'opacity-50 cursor-grabbing' : batchMode ? 'cursor-pointer' : 'cursor-grab'} ${isSelected ? 'ring-2 ring-primary-300 dark:ring-primary-400' : ''}`}
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

    {/* AL-M5b：项目 Modal 确认体系（替代 window.confirm）；M6：批量操作二次确认（danger 由动作类型决定） */}
    <ConfirmDialog
      open={!!confirmState}
      message={confirmState?.message ?? ''}
      danger={confirmState?.danger ?? true}
      confirmText="确认"
      cancelText="取消"
      onConfirm={() => { confirmState?.fn(); setConfirmState(null) }}
      onCancel={() => setConfirmState(null)}
    />

    {/* M5（AL-ED4）：机柜信息调整 Modal（名称/总U/类型/功率/顶部预留，冲突校验阻塞不落库） */}
    <Modal
      open={cabinetEditOpen}
      onClose={() => setCabinetEditOpen(false)}
      title="机柜信息调整"
      width={440}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setCabinetEditOpen(false)} className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
            取消
          </button>
          <button type="button" onClick={saveCabinetEdit} aria-label="保存机柜信息" className="px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white">
            保存
          </button>
        </div>
      )}
    >
      {editForm && (
        <div className="space-y-3">
          <label className="block text-xs text-gray-600 dark:text-gray-300">机柜名称
            <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="mt-1" aria-label="机柜名称" />
          </label>
          <label className="block text-xs text-gray-600 dark:text-gray-300">总U高度（改矮将校验设备溢出）
            <Input type="number" min={1} value={editForm.totalU} onChange={(e) => setEditForm({ ...editForm, totalU: e.target.value })} className="mt-1" aria-label="总U高度" />
          </label>
          <label className="block text-xs text-gray-600 dark:text-gray-300">机柜类型（变更同步到矩阵格）
            <Select
              value={editForm.type}
              onChange={(e) => setEditForm({ ...editForm, type: e.target.value as CabinetType })}
              options={Object.entries(CABINET_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              className="mt-1"
              aria-label="机柜类型"
            />
          </label>
          <label className="block text-xs text-gray-600 dark:text-gray-300">功率上限(W)（改小将校验超限）
            <Input type="number" min={0} step={100} value={editForm.powerLimit} onChange={(e) => setEditForm({ ...editForm, powerLimit: e.target.value })} className="mt-1" aria-label="功率上限" />
          </label>
          <label className="block text-xs text-gray-600 dark:text-gray-300">顶部预留U（全局配置，作用于所有柜）
            <Input type="number" min={0} value={editForm.topReservedU} onChange={(e) => setEditForm({ ...editForm, topReservedU: e.target.value })} className="mt-1" aria-label="顶部预留U" />
          </label>
          {editError && <p className="text-xs text-error-500 dark:text-error-400">{editError}</p>}
        </div>
      )}
    </Modal>

    {/* M5（AL-ED4）+ M3（AL-CP1/CP2）：柜内右键菜单（Header 机柜级 / 设备行 / U 位槽） */}
    {contextMenu && (
      <ContextMenu
        items={(() => {
          if (contextMenu.kind === 'device') {
            return [
              { label: '复制设备', icon: Copy, action: () => handleCopyDevice(contextMenu.deviceId!) },
              { separator: true },
              { label: '粘贴设备（自动找位）', icon: ClipboardPaste, disabled: clipboard?.type !== 'device', action: handlePasteDeviceAuto },
            ]
          }
          if (contextMenu.kind === 'slot') {
            return [
              { label: `粘贴设备到 U${contextMenu.uNum}`, icon: ClipboardPaste, disabled: clipboard?.type !== 'device', action: () => handlePasteDeviceAt(contextMenu.uNum!) },
            ]
          }
          return [
            { label: '复制机柜', icon: Copy, action: handleCopyCabinet },
            { label: '机柜信息调整', icon: Settings, action: openCabinetEdit },
            { separator: true },
            { label: '批量编辑设备', icon: ListChecks, action: () => setBatchMode(true) },
            { separator: true },
            { label: '粘贴设备（自动找位）', icon: ClipboardPaste, disabled: clipboard?.type !== 'device', action: handlePasteDeviceAuto },
          ]
        })()}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(null)}
      />
    )}
    </>
  )
}
