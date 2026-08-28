/**
 * AutoLink V2.4.7 — 机房平面布局组件（V3.0.4-T3-2 扩展机房矩阵视图）
 *
 * 模式一（机房矩阵，V3.0.4-T3-2）：基于 room.store 的 RoomMatrix 渲染矩阵网格：
 *   - 行×列命名规则自定义（如 A15~O15=225 柜）
 *   - 占位标记（空调/柱子）+ 机柜类型标记（GPU/网络/存储/通算/组合）点击即标
 *   - 上架机柜显示（cell.cabinetId → rack.store 机柜名）
 * 模式二（原有平面图）：无矩阵数据时保留冷热通道机柜平面图。
 */
import { useMemo, useEffect, useState, useRef, useCallback } from 'react'
import {
  Eye, Pencil, Info, Trash2, Eraser, Copy, Grid3x3, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { useDataCenterStore, getPowerColor } from '@/stores/datacenter.store'
import { useRackStore, CABINET_TYPE_LABELS, RACK_TYPE_COLORS, type CabinetType, type BulkUpdateIssue } from '@/stores/rack.store'
import { useRoomStore, ROOM_TOOL_LABEL_KEYS, type RoomMatrixData, type RoomMarkTool } from '@/stores/room.store'
import { RoomOptimizeModal } from '@/components/datacenter/RoomOptimizeModal'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToastStore } from '@/stores/toast.store'
import { useProjectContext } from '@/stores/ProjectContext'
import { useTranslation } from 'react-i18next'

// 机房矩阵机柜类型配色（RACK_TYPE_COLORS 扩展 combined/empty）
const ROOM_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  gpu: RACK_TYPE_COLORS.gpu,
  network: RACK_TYPE_COLORS.network,
  storage: RACK_TYPE_COLORS.storage,
  compute: RACK_TYPE_COLORS.compute,
  combined: { bg: '#f3e8ff', text: '#7e22ce', border: '#c084fc' }, // 紫：组合
  // v1.4: 电源柜（橙色，与空调/柱子区分）
  power: RACK_TYPE_COLORS.power,
  empty: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },    // 浅灰：未标记
}

const CELL_W = 64
const CELL_H = 48
const CELL_GAP = 3
const LABEL_W = 34
const LABEL_H = 24

const MARK_TOOLS: RoomMarkTool[] = [
  'select', 'ac', 'pillar', 'gpu', 'network', 'storage', 'compute', 'combined', 'power', 'clear',
]

// ================================================================
// M4（AL-ED1/ED2/ED3）：机房编辑能力——右键信息/编辑 + 同类批量 + 框选批量 UI
// ================================================================

/** 机柜类型下拉选项（编辑/批量共用） */
const CABINET_TYPE_OPTIONS = (Object.keys(CABINET_TYPE_LABELS) as CabinetType[]).map((v) => ({
  value: v,
  label: CABINET_TYPE_LABELS[v],
}))

/** 格子类型下拉选项（对齐 ROOM_MARK_TYPES + empty） */
const ROOM_TYPE_OPTIONS = [
  { value: 'empty', label: '空（未标记）' },
  { value: 'gpu', label: 'GPU柜' },
  { value: 'network', label: '网络柜' },
  { value: 'storage', label: '存储柜' },
  { value: 'compute', label: '通算柜' },
  { value: 'combined', label: '组合柜' },
  { value: 'power', label: '电源柜' },
]

/** 占位选项（''=非占位） */
const PLACEHOLDER_OPTIONS = [
  { value: '', label: '无（非占位）' },
  { value: 'ac', label: '空调' },
  { value: 'pillar', label: '立柱' },
]

/** 字段标签行（只读信息用） */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-800 text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-800 dark:text-gray-100">{value}</span>
    </div>
  )
}

/** AL-ED1：查看机柜信息（只读弹窗） */
function CabinetInfoModal({ cabinetId, onClose }: { cabinetId: number | null; onClose: () => void }) {
  const cabinets = useRackStore((s) => s.cabinets)
  const topReservedU = useRackStore((s) => s.topReservedU)
  const cabinet = cabinets.find((c) => c.id === cabinetId)
  const usage = useMemo(() => {
    if (!cabinet) return { used: 0, limit: 0, percent: 0 }
    const used = cabinet.devices.reduce((s, d) => s + d.power_watts, 0)
    return { used, limit: cabinet.power_limit, percent: cabinet.power_limit > 0 ? Math.round((used / cabinet.power_limit) * 100) : 0 }
  }, [cabinet])
  const usedU = useMemo(() => {
    if (!cabinet) return 0
    return cabinet.devices.reduce((s, d) => s + (d.endU - d.startU + 1), 0)
  }, [cabinet])
  return (
    <Modal open={cabinetId != null} onClose={onClose} title="机柜信息" width={420}>
      {cabinet ? (
        <div>
          <InfoRow label="名称" value={cabinet.name} />
          <InfoRow label="类型" value={CABINET_TYPE_LABELS[cabinet.type] || cabinet.type} />
          <InfoRow label="总 U 高度" value={`${cabinet.totalU}U`} />
          <InfoRow label="功率上限" value={`${cabinet.power_limit}W`} />
          <InfoRow label="顶部预留" value={`${topReservedU}U`} />
          <InfoRow label="设备数" value={`${cabinet.devices.length} 台`} />
          <InfoRow label="占用 U 位" value={`${usedU}/${cabinet.totalU}U`} />
          <InfoRow
            label="实际功率"
            value={
              <span className={usage.percent > 100 ? 'text-red-600' : ''}>
                {usage.used}W / {usage.limit}W（{usage.percent}%）
              </span>
            }
          />
        </div>
      ) : (
        <p className="text-xs text-gray-500">机柜不存在或已被删除</p>
      )}
    </Modal>
  )
}

/** AL-ED1：查看机房信息（只读弹窗：规模/类型分布/占位/功率汇总） */
function RoomInfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const matrix = useRoomStore((s) => s.matrix)
  const cabinets = useRackStore((s) => s.cabinets)
  const mountedIds = new Set((matrix?.cells ?? []).filter((c) => c.cabinetId != null).map((c) => c.cabinetId))
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of matrix?.cells ?? []) {
      const key = c.cabinetId != null
        ? `柜:${cabinets.find((k) => k.id === c.cabinetId)?.type ?? c.type}`
        : c.placeholder
          ? `占位:${c.placeholder}`
          : `格:${c.type}`
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  }, [matrix, cabinets])
  const totalPower = cabinets.filter((c) => mountedIds.has(c.id)).reduce((s, c) => s + c.devices.reduce((x, d) => x + d.power_watts, 0), 0)
  return (
    <Modal open={open} onClose={onClose} title="机房信息" width={440}>
      <div className="space-y-2">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{matrix?.name || '机房'}</div>
        <InfoRow label="矩阵规模" value={matrix ? `${matrix.rows.length}排 × ${matrix.cols.length}列 = ${matrix.cells.length} 格` : '—'} />
        <InfoRow label="已上架机柜" value={`${mountedIds.size} 台`} />
        <InfoRow label="上架机柜功率" value={`${totalPower}W`} />
        <InfoRow label="状态" value={matrix?.finalized ? '已定稿' : '未定稿'} />
        <div className="pt-1 text-xs text-gray-500 dark:text-gray-400">格子分布</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(typeCounts).map(([k, n]) => (
            <span key={k} className="px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[11px] text-gray-600 dark:text-gray-300">
              {k.replace(/^(柜|占位|格):/, '')} {n}
            </span>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/** AL-ED1：编辑机柜（名称/类型/总U/功率上限/顶部预留）；保存校验冲突 + 联动矩阵格类型（M6 统一走 updateCabinetSafe） */
function CabinetEditModal({ cabinetId, onClose }: { cabinetId: number | null; onClose: () => void }) {
  const cabinets = useRackStore((s) => s.cabinets)
  const updateCabinetSafe = useRackStore((s) => s.updateCabinetSafe)
  const topReservedU = useRackStore((s) => s.topReservedU)
  const setRackConfig = useRackStore((s) => s.setRackConfig)
  const syncCabinetToCell = useRoomStore((s) => s.syncCabinetToCell)
  const addToast = useToastStore((s) => s.addToast)
  const cabinet = cabinets.find((c) => c.id === cabinetId)
  const [name, setName] = useState(cabinet?.name ?? '')
  const [type, setType] = useState<CabinetType>(cabinet?.type ?? 'gpu')
  const [totalU, setTotalU] = useState(cabinet?.totalU ?? 42)
  const [powerLimit, setPowerLimit] = useState(cabinet?.power_limit ?? 6000)
  const [topReserved, setTopReserved] = useState(topReservedU)
  const [error, setError] = useState('')

  const save = () => {
    if (!cabinet) return
    if (!name.trim()) {
      setError('机柜名称不能为空')
      return
    }
    const tU = Math.max(1, Math.round(Number(totalU) || 0))
    const pL = Math.max(1, Math.round(Number(powerLimit) || 0))
    const tR = Math.max(0, Math.round(Number(topReserved) || 0))
    // M6（AL-ED7）：统一走 updateCabinetSafe——改矮/改功率冲突直接阻塞不落库
    const r = updateCabinetSafe(cabinet.id, { name: name.trim(), type, totalU: tU, power_limit: pL })
    if (r.issues.length > 0) {
      setError(r.issues.map((i) => i.message).join('；'))
      return
    }
    if (tR !== topReservedU) setRackConfig({ topReservedU: tR })
    // 联动：机柜类型 → 矩阵格类型回写
    syncCabinetToCell(cabinet.id)
    addToast('success', `已更新机柜「${name.trim()}」`, 3000)
    onClose()
  }

  return (
    <Modal
      open={cabinetId != null}
      onClose={onClose}
      title="编辑机柜"
      width={440}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-edge-default text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover">
            取消
          </button>
          <button type="button" onClick={save}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors">
            <CheckCircle2 size={13} /> 保存
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <div className="flex items-start gap-1.5 px-2.5 py-2 rounded border border-error-300 dark:border-error-700 bg-error-50 dark:bg-error-900/20 text-xs text-error-600 dark:text-error-400">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}
        <label className="block">
          <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">名称</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="机柜名称" />
        </label>
        <label className="block">
          <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">类型</span>
          <Select value={type} options={CABINET_TYPE_OPTIONS} onChange={(e) => setType(e.target.value as CabinetType)} />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">总 U 高度</span>
            <Input type="number" min={1} value={totalU} onChange={(e) => setTotalU(Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">功率上限(W)</span>
            <Input type="number" min={1} value={powerLimit} onChange={(e) => setPowerLimit(Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">顶部预留(U)</span>
            <Input type="number" min={0} value={topReserved} onChange={(e) => setTopReserved(Number(e.target.value))} />
          </label>
        </div>
      </div>
    </Modal>
  )
}

/** AL-ED1：编辑格子（类型/占位） */
function CellEditModal({ position, onClose }: { position: string | null; onClose: () => void }) {
  const matrix = useRoomStore((s) => s.matrix)
  const updateCellsBulk = useRoomStore((s) => s.updateCellsBulk)
  const addToast = useToastStore((s) => s.addToast)
  const cell = position ? matrix?.cells.find((c) => `${c.row}${c.col}` === position) : undefined
  const [type, setType] = useState(cell?.type ?? 'empty')
  const [placeholder, setPlaceholder] = useState(cell?.placeholder ?? '')
  const save = () => {
    if (!position) return
    updateCellsBulk([position], { type, placeholder: placeholder || null })
    addToast('success', `已更新格子 ${position}`, 3000)
    onClose()
  }
  return (
    <Modal
      open={position != null}
      onClose={onClose}
      title={position ? `编辑格子 ${position}` : '编辑格子'}
      width={420}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-edge-default text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover">
            取消
          </button>
          <button type="button" onClick={save}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors">
            <CheckCircle2 size={13} /> 保存
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">格子类型</span>
          <Select value={type} options={ROOM_TYPE_OPTIONS} onChange={(e) => setType(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">占位</span>
          <Select value={placeholder} options={PLACEHOLDER_OPTIONS} onChange={(e) => setPlaceholder(e.target.value)} />
        </label>
        {cell?.cabinetId != null && (
          <p className="text-2xs text-gray-400">该格已上架机柜：改占位会卸载机柜（机柜保留未上架）</p>
        )}
      </div>
    </Modal>
  )
}

/** AL-ED2/ED3：批量编辑（同类机柜批量 / 框选多格批量）——含二次确认删除 */
function BulkEditModal({ open, mode, onClose }: { open: boolean; mode: 'cabinets' | 'cells'; onClose: () => void }) {
  const matrix = useRoomStore((s) => s.matrix)
  const multiSelected = useRoomStore((s) => s.multiSelected)
  const updateCellsBulk = useRoomStore((s) => s.updateCellsBulk)
  const clearCellsBulk = useRoomStore((s) => s.clearCellsBulk)
  const deleteCellsBulk = useRoomStore((s) => s.deleteCellsBulk)
  const clearMultiSelect = useRoomStore((s) => s.clearMultiSelect)
  const updateCabinetsBulk = useRackStore((s) => s.updateCabinetsBulk)
  const setRackConfig = useRackStore((s) => s.setRackConfig)
  const syncCabinetToCell = useRoomStore((s) => s.syncCabinetToCell)
  const topReservedU = useRackStore((s) => s.topReservedU)
  const cabinets = useRackStore((s) => s.cabinets)
  const addToast = useToastStore((s) => s.addToast)

  // 多选格对应的机柜 id（批量改机柜用）
  const cabinetIds = useMemo(() => {
    const ids: number[] = []
    const seen = new Set<number>()
    for (const pos of multiSelected) {
      const cell = matrix?.cells.find((c) => `${c.row}${c.col}` === pos)
      if (cell?.cabinetId != null && !seen.has(cell.cabinetId)) {
        seen.add(cell.cabinetId)
        ids.push(cell.cabinetId)
      }
    }
    return ids
  }, [matrix, multiSelected])

  const [type, setType] = useState('')
  const [totalU, setTotalU] = useState('')
  const [powerLimit, setPowerLimit] = useState('')
  const [topReserved, setTopReserved] = useState(topReservedU)
  const [cellType, setCellType] = useState('')
  const [placeholder, setPlaceholder] = useState('')
  const [error, setError] = useState('')
  // M6（AL-ED7）：批量机柜冲突明细（逐条原因，不静默跳过）
  const [issues, setIssues] = useState<BulkUpdateIssue[]>([])
  const [lastApplied, setLastApplied] = useState<number | null>(null)
  // M6（AL-ED7）：批量清空/删除二次确认（统一「再次点击确认」文案）
  const [pendingAction, setPendingAction] = useState<'clear' | 'delete' | null>(null)

  const close = () => {
    setPendingAction(null)
    setIssues([])
    setLastApplied(null)
    onClose()
  }

  const saveCabinets = () => {
    if (cabinetIds.length === 0) return
    const patch: Record<string, unknown> = {}
    if (type) patch.type = type
    if (totalU !== '') patch.totalU = Math.max(1, Math.round(Number(totalU) || 0))
    if (powerLimit !== '') patch.power_limit = Math.max(1, Math.round(Number(powerLimit) || 0))
    if (Object.keys(patch).length === 0 && Number(topReserved) === topReservedU) {
      setError('请至少修改一项属性')
      return
    }
    const r = updateCabinetsBulk(cabinetIds, patch as Parameters<typeof updateCabinetsBulk>[1])
    if (Number(topReserved) !== topReservedU) setRackConfig({ topReservedU: Math.max(0, Math.round(Number(topReserved) || 0)) })
    // M2（AL-UR1）：批量机柜类型 → 回写矩阵格类型只压一次 room 快照（撤销后矩阵↔柜内一致，AL-UR2）
    if (patch.type && cabinetIds.length > 0) {
      useRoomStore.getState().pushHistory()
      cabinetIds.forEach((id) => syncCabinetToCell(id, false))
    } else {
      cabinetIds.forEach((id) => syncCabinetToCell(id))
    }
    // M6（AL-ED7）：冲突逐条展示（弹窗保持打开），合规柜照常落库、冲突柜不落库
    if (r.issues.length > 0) {
      setLastApplied(r.applied)
      setIssues(r.issues)
      return
    }
    if (r.applied > 0) addToast('success', `已批量更新 ${r.applied} 个同类机柜`, 4000)
    clearMultiSelect()
    close()
  }

  const saveCells = () => {
    const patch: Record<string, unknown> = {}
    if (cellType) patch.type = cellType
    if (placeholder !== '') patch.placeholder = placeholder === 'none' ? null : placeholder
    if (Object.keys(patch).length === 0) {
      setError('请至少修改一项属性')
      return
    }
    const r = updateCellsBulk(multiSelected, patch as Parameters<typeof updateCellsBulk>[1])
    addToast('success', `已批量更新 ${r.applied} 个格子`, 3000)
    if (r.skipped.length > 0) addToast('warning', `${r.skipped.length} 个格子因设置占位卸载了机柜`, 5000)
    clearMultiSelect()
    close()
  }

  const doClear = () => {
    const r = clearCellsBulk(multiSelected)
    addToast('success', `已清空 ${r.applied} 个格子（机柜保留未上架）`, 3000)
    clearMultiSelect()
    close()
  }

  const doDelete = () => {
    const r = deleteCellsBulk(multiSelected)
    addToast('success', `已删除 ${r.applied} 个格子及其机柜`, 3000)
    clearMultiSelect()
    close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={mode === 'cabinets' ? `批量更新机柜（${cabinetIds.length} 台）` : `批量更新格子（${multiSelected.length} 格）`}
      width={460}
      footer={
        mode === 'cabinets' ? (
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={close}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-edge-default text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover">
              取消
            </button>
            <button type="button" onClick={saveCabinets}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors">
              <CheckCircle2 size={13} /> 确认批量更新
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (pendingAction === 'clear' ? doClear() : setPendingAction('clear'))}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                  pendingAction === 'clear'
                    ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover'
                }`}
              >
                <Eraser size={12} /> {pendingAction === 'clear' ? '再次点击确认清空' : '清空'}
              </button>
              <button
                type="button"
                onClick={() => (pendingAction === 'delete' ? doDelete() : setPendingAction('delete'))}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded text-white transition-colors ${
                  pendingAction === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-error-400/90 hover:bg-error-500'
                }`}
              >
                <Trash2 size={12} /> {pendingAction === 'delete' ? '再次点击确认删除' : '删除'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={close}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-edge-default text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover">
                取消
              </button>
              <button type="button" onClick={saveCells}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors">
                <CheckCircle2 size={13} /> 确认批量更新
              </button>
            </div>
          </div>
        )
      }
    >
      {error && (
        <div className="flex items-start gap-1.5 px-2.5 py-2 mb-2 rounded border border-error-300 dark:border-error-700 bg-error-50 dark:bg-error-900/20 text-xs text-error-600 dark:text-error-400">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      {/* M6（AL-ED7）：批量机柜冲突明细（逐条原因，不静默跳过） */}
      {mode === 'cabinets' && issues.length > 0 && (
        <div className="mb-2 px-3 py-2 rounded border border-warning-300 dark:border-warning-600 bg-warning-50 dark:bg-warning-900/20">
          <div className="text-xs font-medium text-warning-700 dark:text-warning-300 mb-1">
            已更新 {lastApplied ?? 0} 台，{issues.length} 台因冲突跳过（不落库）
          </div>
          <ul className="space-y-0.5 text-2xs text-warning-700 dark:text-warning-300">
            {issues.map((issue, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'cabinets' ? (
        <div className="space-y-3">
          {cabinetIds.length === 0 ? (
            <p className="text-xs text-gray-500">多选中没有已上架机柜，无法批量改机柜属性</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {cabinetIds.slice(0, 12).map((id) => {
                  const cab = cabinets.find((c) => c.id === id)
                  return (
                    <span key={id} className="px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[11px] text-gray-600 dark:text-gray-300">
                      {cab?.name ?? `#${id}`}
                    </span>
                  )
                })}
                {cabinetIds.length > 12 && <span className="text-[11px] text-gray-400">…等 {cabinetIds.length} 台</span>}
              </div>
              <label className="block">
                <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">类型（留空=不改）</span>
                <Select value={type} options={[{ value: '', label: '（不修改类型）' }, ...CABINET_TYPE_OPTIONS]} onChange={(e) => setType(e.target.value)} />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">总 U 高度（留空=不改）</span>
                  <Input type="number" min={1} value={totalU} onChange={(e) => setTotalU(e.target.value)} placeholder="42" />
                </label>
                <label className="block">
                  <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">功率上限(W)（留空=不改）</span>
                  <Input type="number" min={1} value={powerLimit} onChange={(e) => setPowerLimit(e.target.value)} placeholder="6000" />
                </label>
                <label className="block">
                  <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">顶部预留(U)</span>
                  <Input type="number" min={0} value={topReserved} onChange={(e) => setTopReserved(Number(e.target.value))} />
                </label>
              </div>
              <p className="text-2xs text-gray-400">
                冲突校验：改矮高度超出设备占用 / 功率改小超现有设备功率的机柜将被跳过，不落库
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">格子类型（留空=不改）</span>
            <Select value={cellType} options={[{ value: '', label: '（不修改类型）' }, ...ROOM_TYPE_OPTIONS]} onChange={(e) => setCellType(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-2xs text-gray-500 dark:text-gray-400 block mb-1">占位（留空=不改）</span>
            <Select value={placeholder} options={[{ value: '', label: '（不修改占位）' }, { value: 'none', label: '无（非占位）' }, ...PLACEHOLDER_OPTIONS.slice(1)]} onChange={(e) => setPlaceholder(e.target.value)} />
          </label>
          <p className="text-2xs text-gray-400">
            「清空」清除所选格子的类型/占位/机柜（机柜保留未上架）；「删除」额外删除对应机柜。两者均为批量操作，需「再次点击」二次确认
          </p>
        </div>
      )}
    </Modal>
  )
}

/** 机房矩阵视图：工具栏 + 机柜面板 + 网格（V3.0.4-T3-3 拖拽上架/移动/卸载） */
function RoomMatrixView({ matrix }: { matrix: RoomMatrixData }) {
  const { t } = useTranslation()
  const cabinets = useRackStore((s) => s.cabinets)
  const markTool = useRoomStore((s) => s.markTool)
  const selectedPosition = useRoomStore((s) => s.selectedPosition)
  const setMarkTool = useRoomStore((s) => s.setMarkTool)
  const markCell = useRoomStore((s) => s.markCell)
  const mountCabinet = useRoomStore((s) => s.mountCabinet)
  const unmountCabinet = useRoomStore((s) => s.unmountCabinet)
  const { currentProject } = useProjectContext()
  const saveMatrix = useRoomStore((s) => s.saveMatrix)

  // M4（AL-ED2/ED3）：多选态
  const multiSelected = useRoomStore((s) => s.multiSelected)
  const toggleMultiSelect = useRoomStore((s) => s.toggleMultiSelect)
  const setMultiSelect = useRoomStore((s) => s.setMultiSelect)
  const clearMultiSelect = useRoomStore((s) => s.clearMultiSelect)
  const selectSameType = useRoomStore((s) => s.selectSameType)

  // V3.1.4-T8-2: 智能落位向导开关
  const [showOptimize, setShowOptimize] = useState(false)

  // M4（AL-ED1/ED2/ED3）：右键菜单 / 编辑弹窗 / 框选状态
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; position: string | null } | null>(null)
  const [editCabinetId, setEditCabinetId] = useState<number | null>(null)
  const [editCellPos, setEditCellPos] = useState<string | null>(null)
  const [infoTarget, setInfoTarget] = useState<{ kind: 'cabinet'; cabinetId: number } | { kind: 'room' } | null>(null)
  const [bulkMode, setBulkMode] = useState<'cabinets' | 'cells' | null>(null)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const cellMap = useMemo(() => {
    const map = new Map<string, RoomMatrixData['cells'][number]>()
    for (const c of matrix.cells) map.set(`${c.row}${c.col}`, c)
    return map
  }, [matrix])

  const cabinetNameMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of cabinets) map.set(c.id, c.name)
    return map
  }, [cabinets])

  // V3.2.1-T10-3: 机柜功率表（落位热力条用）
  const cabinetPowerMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const c of cabinets) map.set(c.id, c.power_limit)
    return map
  }, [cabinets])

  // T3-3: 机柜 → 已上架位置映射，面板按已/未上架分组
  const cabinetPosMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of matrix.cells) if (c.cabinetId != null) map.set(c.cabinetId, `${c.row}${c.col}`)
    return map
  }, [matrix])
  const mountedCabs = cabinets.filter((c) => cabinetPosMap.has(c.id))
  const unmountedCabs = cabinets.filter((c) => !cabinetPosMap.has(c.id))
  const selectedCell = selectedPosition ? cellMap.get(selectedPosition) : undefined
  const selectedHasCabinet = selectedCell?.cabinetId != null

  // AL-M5c：拖拽预览——记录正在拖拽的机柜与当前悬停落点，无效落点红高亮
  const [dragCabinetId, setDragCabinetId] = useState<number | null>(null)
  const [dropPos, setDropPos] = useState<string | null>(null)
  const clearDragState = () => { setDragCabinetId(null); setDropPos(null) }
  const isDropValid = (pos: string) => {
    const cell = cellMap.get(pos)
    if (!cell) return false
    // 占位（空调/立柱）与已上架机柜的格子不可放置
    return cell.placeholder == null && cell.cabinetId == null
  }

  const startDrag = (e: React.DragEvent, cabinetId: number) => {
    e.dataTransfer.setData('text/plain', String(cabinetId))
    e.dataTransfer.effectAllowed = 'move'
    setDragCabinetId(cabinetId)
  }
  const dropCabinet = (e: React.DragEvent, pos: string) => {
    e.preventDefault()
    clearDragState()
    const id = Number(e.dataTransfer.getData('text/plain'))
    if (id && isDropValid(pos)) mountCabinet(pos, id)
  }

  // ---- M4（AL-ED1）：右键菜单 ----
  const openContextMenu = useCallback((e: React.MouseEvent, position: string | null) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, position })
  }, [])

  // 由 SVG 逻辑坐标反查格子位置（右键在网格容器上统一处理，兼容 jsdom 无 SVG contextmenu 事件）
  const cellAtPoint = useCallback((x: number, y: number): string | null => {
    for (const cell of matrix.cells) {
      const ri = matrix.rows.indexOf(cell.row)
      const ci = matrix.cols.indexOf(cell.col)
      const cx = LABEL_W + ci * (CELL_W + CELL_GAP)
      const cy = LABEL_H + ri * (CELL_H + CELL_GAP)
      if (x >= cx && x <= cx + CELL_W && y >= cy && y <= cy + CELL_H) return `${cell.row}${cell.col}`
    }
    return null
  }, [matrix])

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!ctxMenu) return []
    const pos = ctxMenu.position
    const cell = pos ? cellMap.get(pos) : undefined
    const items: ContextMenuItem[] = []
    if (cell?.cabinetId != null) {
      const cabinetId = cell.cabinetId
      items.push(
        { label: '查看机柜信息', icon: Eye, action: () => setInfoTarget({ kind: 'cabinet', cabinetId }) },
        { label: '编辑机柜属性', icon: Pencil, action: () => setEditCabinetId(cabinetId) },
        { label: '编辑格子', icon: Grid3x3, action: () => setEditCellPos(pos) },
        { separator: true },
        { label: '全选同类机柜', icon: Copy, action: () => { selectSameType(pos!); setBulkMode('cabinets') } },
      )
    } else if (cell) {
      items.push(
        { label: '编辑格子', icon: Grid3x3, action: () => setEditCellPos(pos) },
      )
    }
    items.push(
      { separator: true },
      { label: '查看机房信息', icon: Info, action: () => setInfoTarget({ kind: 'room' }) },
    )
    return items
  }, [ctxMenu, cellMap, selectSameType])

  // ---- M4（AL-ED3）：拖拽框选（仅 select 工具） ----
  const svgPoint = useCallback((e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  // 网格容器右键 → 坐标反查格子（HTML 容器上监听，兼容 jsdom 无 SVG contextmenu 事件）
  const handleGridContextMenu = useCallback((e: React.MouseEvent) => {
    const p = svgPoint(e)
    openContextMenu(e, cellAtPoint(p.x, p.y))
  }, [svgPoint, openContextMenu, cellAtPoint])

  const handleMarqueeDown = (e: React.MouseEvent) => {
    if (markTool !== 'select' || e.button !== 0) return
    const p = svgPoint(e)
    setMarqueeStart(p)
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const handleMarqueeMove = (e: React.MouseEvent) => {
    if (!marqueeStart) return
    const p = svgPoint(e)
    setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m))
  }
  const handleMarqueeUp = () => {
    if (!marquee || !marqueeStart) return
    const x0 = Math.min(marquee.x0, marquee.x1)
    const y0 = Math.min(marquee.y0, marquee.y1)
    const x1 = Math.max(marquee.x0, marquee.x1)
    const y1 = Math.max(marquee.y0, marquee.y1)
    // 极小矩形视为点击，不做框选
    if (x1 - x0 > 4 && y1 - y0 > 4) {
      const positions = matrix.cells
        .filter((cell) => {
          const ri = matrix.rows.indexOf(cell.row)
          const ci = matrix.cols.indexOf(cell.col)
          const cx = LABEL_W + ci * (CELL_W + CELL_GAP)
          const cy = LABEL_H + ri * (CELL_H + CELL_GAP)
          return !(cx + CELL_W < x0 || cx > x1 || cy + CELL_H < y0 || cy > y1)
        })
        .map((c) => `${c.row}${c.col}`)
      if (positions.length > 0) setMultiSelect(positions)
    }
    setMarqueeStart(null)
    setMarquee(null)
  }

  // 多选中是否含已上架机柜（批量改机柜可用性）
  const hasMountedInSelection = useMemo(
    () => multiSelected.some((p) => cellMap.get(p)?.cabinetId != null),
    [multiSelected, cellMap],
  )

  const canvas = {
    width: LABEL_W + matrix.cols.length * (CELL_W + CELL_GAP) + CELL_GAP,
    height: LABEL_H + matrix.rows.length * (CELL_H + CELL_GAP) + CELL_GAP,
  }

  const placeholderCount = matrix.cells.filter((c) => c.placeholder).length
  const markedCount = matrix.cells.filter((c) => c.type !== 'empty').length
  const mountedCount = matrix.cells.filter((c) => c.cabinetId != null).length

  return (
    <div className="w-full h-full flex flex-col" onDragEnd={clearDragState}>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-app">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 mr-1">
          {matrix.name || t('rack:room.title')}
        </span>
        <span className="text-xs text-gray-500">
          {matrix.rows.length}×{matrix.cols.length} = {matrix.cells.length} 柜
          · {t('rack:room.placeholder')} {placeholderCount} · {t('rack:room.type')} {markedCount}
          · {t('rack:room.mounted')} {mountedCount}
        </span>
        <div className="h-5 w-px bg-gray-300 dark:bg-gray-600 mx-1" />
        {MARK_TOOLS.map((tool) => {
          const active = markTool === tool
          return (
            <button
              key={tool}
              onClick={() => setMarkTool(tool)}
              className={`px-2 py-1 rounded text-xs border transition-colors ${
                active
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-app text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              title={t(`rack:${ROOM_TOOL_LABEL_KEYS[tool]}`)}
            >
              {t(`rack:${ROOM_TOOL_LABEL_KEYS[tool]}`)}
            </button>
          )
        })}
        <div className="flex-1" />
        {selectedHasCabinet && (
          <button
            onClick={() => selectedPosition && unmountCabinet(selectedPosition)}
            className="px-3 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            {t('rack:room.unmount')}
          </button>
        )}
        {/* V3.1.4-T8-2: 智能落位入口 */}
        <button
          onClick={() => setShowOptimize(true)}
          className="px-3 py-1 rounded text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors"
        >
          ✨ 智能落位
        </button>
        <button
          onClick={() => currentProject && saveMatrix(currentProject)}
          className="px-3 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
        >
          {t('rack:room.save')}
        </button>
      </div>

      {/* V3.1.4-T8-2: 智能落位向导 */}
      <RoomOptimizeModal open={showOptimize} onClose={() => setShowOptimize(false)} />

      {/* 主体：机柜面板 + 矩阵网格 */}
      <div className="flex-1 min-h-0 flex">
        {/* 机柜面板（拖拽源） */}
        <div className="w-60 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-app flex flex-col overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800">
            {t('rack:room.cabinets')}
          </div>
          <div className="px-3 py-1.5 text-[11px] text-gray-400 border-b border-gray-100 dark:border-gray-800">
            {t('rack:room.dragHint')}
          </div>
          {cabinets.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">{t('rack:room.noCabinets')}</div>
          )}
          {mountedCabs.length > 0 && (
            <div className="px-3 pt-2 text-[11px] font-medium text-gray-400">
              {t('rack:room.mounted')}（{mountedCabs.length}）
            </div>
          )}
          {mountedCabs.map((cab) => (
            <div
              key={`m-${cab.id}`}
              draggable
              onDragStart={(e) => startDrag(e, cab.id)}
              className="mx-2 my-0.5 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 cursor-grab hover:bg-blue-50 dark:hover:bg-gray-700 text-xs"
              title={CABINET_TYPE_LABELS[cab.type] || cab.type}
            >
              <div className="flex justify-between items-center gap-1">
                <span className="font-medium text-gray-700 dark:text-gray-200 truncate">{cab.name}</span>
                <span className="text-[10px] text-primary-600 dark:text-primary-400 shrink-0">{cabinetPosMap.get(cab.id)}</span>
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>{CABINET_TYPE_LABELS[cab.type] || cab.type}</span>
                <span>{cab.power_limit}W</span>
              </div>
            </div>
          ))}
          {unmountedCabs.length > 0 && (
            <div className="px-3 pt-2 text-[11px] font-medium text-gray-400">
              {t('rack:room.unmounted')}（{unmountedCabs.length}）
            </div>
          )}
          {unmountedCabs.map((cab) => (
            <div
              key={`u-${cab.id}`}
              draggable
              onDragStart={(e) => startDrag(e, cab.id)}
              className="mx-2 my-0.5 px-2 py-1.5 rounded border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 cursor-grab hover:bg-blue-50 dark:hover:bg-gray-700 text-xs"
              title={CABINET_TYPE_LABELS[cab.type] || cab.type}
            >
              <div className="flex justify-between items-center gap-1">
                <span className="font-medium text-gray-700 dark:text-gray-200 truncate">{cab.name}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{CABINET_TYPE_LABELS[cab.type] || cab.type}</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">{cab.totalU}U · {cab.power_limit}W</div>
            </div>
          ))}
        </div>

        {/* 矩阵网格 */}
        <div className="flex-1 overflow-auto p-3 bg-gray-50 dark:bg-app" onContextMenu={handleGridContextMenu}>
        {/* M4（AL-ED2/ED3）：多选工具条 */}
        {multiSelected.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 text-xs">
            <span className="font-medium text-primary-700 dark:text-primary-300">
              已选 {multiSelected.length} 格
            </span>
            <button
              type="button"
              onClick={() => setBulkMode('cells')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary-300 dark:border-primary-600 text-primary-600 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/30"
            >
              <Grid3x3 size={11} /> 批量改格子
            </button>
            <button
              type="button"
              onClick={() => setBulkMode('cabinets')}
              disabled={!hasMountedInSelection}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary-300 dark:border-primary-600 text-primary-600 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
              title={hasMountedInSelection ? undefined : '多选中没有已上架机柜'}
            >
              <Copy size={11} /> 批量改机柜
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={clearMultiSelect}
              className="px-2 py-1 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              取消选择
            </button>
          </div>
        )}
        <svg
          ref={svgRef}
          width={canvas.width}
          height={canvas.height}
          className="block select-none"
          style={{ minWidth: '100%' }}
          onMouseDown={handleMarqueeDown}
          onMouseMove={handleMarqueeMove}
          onMouseUp={handleMarqueeUp}
          onMouseLeave={handleMarqueeUp}
        >
          {/* 列标签 */}
          {matrix.cols.map((c, ci) => (
            <text
              key={`col-${c}`}
              x={LABEL_W + ci * (CELL_W + CELL_GAP) + CELL_W / 2}
              y={LABEL_H - 7}
              textAnchor="middle"
              fontSize={11}
              fontWeight="bold"
              fill="#6b7280"
            >
              {c}
            </text>
          ))}
          {/* 行标签 */}
          {matrix.rows.map((r, ri) => (
            <text
              key={`row-${r}`}
              x={LABEL_W - 6}
              y={LABEL_H + ri * (CELL_H + CELL_GAP) + CELL_H / 2 + 4}
              textAnchor="end"
              fontSize={11}
              fontWeight="bold"
              fill="#6b7280"
            >
              {r}
            </text>
          ))}
          {/* 格子 */}
          {matrix.rows.map((r, ri) =>
            matrix.cols.map((c, ci) => {
              const pos = `${r}${c}`
              const cell = cellMap.get(pos)
              if (!cell) return null
              const isSelected = selectedPosition === pos
              const isMulti = multiSelected.includes(pos)
              const isPlaceholder = cell.placeholder != null
              const typeColor = ROOM_TYPE_COLORS[cell.type] || ROOM_TYPE_COLORS.empty
              const fill = isPlaceholder ? '#e5e7eb' : typeColor.bg
              const stroke = isSelected || isMulti ? '#2563eb' : isPlaceholder ? '#9ca3af' : typeColor.border
              const cabName = cell.cabinetId != null ? cabinetNameMap.get(cell.cabinetId) : undefined
              const mainLabel = isPlaceholder
                ? cell.placeholder === 'ac'
                  ? t('rack:room.ac')
                  : t('rack:room.pillar')
                : cabName
                  ? cabName.length > 5
                    ? cabName.slice(0, 4) + '…'
                    : cabName
                  : cell.type === 'empty'
                    ? t('rack:room.empty')
                    : t(`rack:${ROOM_TOOL_LABEL_KEYS[cell.type as RoomMarkTool] || 'room.typeGpu'}`)
              return (
                <g
                  key={pos}
                  data-pos={pos}
                  transform={`translate(${LABEL_W + ci * (CELL_W + CELL_GAP)}, ${LABEL_H + ri * (CELL_H + CELL_GAP)})`}
                  className="cursor-pointer"
                  onClick={(e) => {
                    // M4（AL-ED2）：Ctrl/Shift/Cmd 点击 → 切换多选；否则走原标记/选择逻辑
                    if (e.ctrlKey || e.metaKey || e.shiftKey) {
                      e.stopPropagation()
                      toggleMultiSelect(pos)
                      return
                    }
                    markCell(pos)
                  }}
                  // AL-M5c：悬停落点预览（仅拖拽机柜时生效）
                  onMouseEnter={() => { if (dragCabinetId != null) setDropPos(pos) }}
                  onDragOver={(e) => { e.preventDefault(); if (dragCabinetId != null) setDropPos(pos) }}
                  onDrop={(e) => dropCabinet(e, pos)}
                >
                  <rect
                    width={CELL_W}
                    height={CELL_H}
                    rx={3}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isSelected || isMulti ? 2 : 1}
                  />
                  {/* AL-M5c：拖拽落点预览高亮（绿=有效可放置 / 红=无效） */}
                  {dragCabinetId != null && dropPos === pos && (
                    <rect
                      width={CELL_W}
                      height={CELL_H}
                      rx={3}
                      fill={isDropValid(pos) ? 'rgba(34,197,94,0.30)' : 'rgba(239,68,68,0.30)'}
                      stroke={isDropValid(pos) ? '#16a34a' : '#dc2626'}
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      pointerEvents="none"
                    />
                  )}
                  {/* 占位斜纹 */}
                  {isPlaceholder && (
                    <>
                      <line x1={0} y1={CELL_H} x2={CELL_W} y2={0} stroke="#9ca3af" strokeWidth={1} opacity={0.4} />
                      <line x1={CELL_W / 2} y1={CELL_H} x2={CELL_W} y2={CELL_H / 2} stroke="#9ca3af" strokeWidth={1} opacity={0.4} />
                    </>
                  )}
                  {/* 位置名 */}
                  <text x={4} y={10} fontSize={8} fill="#6b7280">
                    {pos}
                  </text>
                  {/* 主内容（占位/类型/机柜） */}
                  <text
                    x={CELL_W / 2}
                    y={CELL_H / 2 + 4}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight="bold"
                    fill={isPlaceholder ? '#4b5563' : typeColor.text}
                  >
                    {mainLabel}
                  </text>
                  {/* V3.2.1-T10-3: 落位功率热力条（以 20kW 为基准归一，绿→黄→红） */}
                  {cell.cabinetId != null && (() => {
                    const pw = cabinetPowerMap.get(cell.cabinetId) || 0
                    const pct = Math.min(100, Math.round((pw / 20000) * 100))
                    return (
                      <rect
                        x={2}
                        y={CELL_H - 5}
                        width={CELL_W - 4}
                        height={3}
                        rx={1.5}
                        fill={getPowerColor(pct).stroke}
                        opacity={0.9}
                      />
                    )
                  })()}
                </g>
              )
            }),
          )}
          {/* M4（AL-ED3）：框选矩形 overlay */}
          {marquee && (
            <rect
              x={Math.min(marquee.x0, marquee.x1)}
              y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)}
              height={Math.abs(marquee.y1 - marquee.y0)}
              fill="rgba(37,99,235,0.12)"
              stroke="#2563eb"
              strokeWidth={1}
              strokeDasharray="4 2"
              pointerEvents="none"
            />
          )}
        </svg>
        </div>
      </div>

      {/* M4（AL-ED1/ED2/ED3）：右键菜单 + 信息/编辑/批量弹窗 */}
      {ctxMenu && (
        <ContextMenu
          items={menuItems}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <CabinetInfoModal
        cabinetId={infoTarget?.kind === 'cabinet' ? infoTarget.cabinetId : null}
        onClose={() => setInfoTarget(null)}
      />
      <RoomInfoModal
        open={infoTarget?.kind === 'room'}
        onClose={() => setInfoTarget(null)}
      />
      <CabinetEditModal
        key={editCabinetId ?? 'none'}
        cabinetId={editCabinetId}
        onClose={() => setEditCabinetId(null)}
      />
      <CellEditModal
        key={editCellPos ?? 'none'}
        position={editCellPos}
        onClose={() => setEditCellPos(null)}
      />
      <BulkEditModal
        key={bulkMode ?? 'none'}
        open={bulkMode != null}
        mode={bulkMode ?? 'cells'}
        onClose={() => setBulkMode(null)}
      />
    </div>
  )
}

export function DataCenterLayout() {
  const { t } = useTranslation()
  const cabinets = useRackStore((s) => s.cabinets)
  const placements = useDataCenterStore((s) => s.placements)
  const rows = useDataCenterStore((s) => s.rows)
  const params = useDataCenterStore((s) => s.params)
  const selectedId = useDataCenterStore((s) => s.selectedCabinetId)
  const computeLayout = useDataCenterStore((s) => s.computeLayout)
  const selectCabinet = useDataCenterStore((s) => s.selectCabinet)

  const matrix = useRoomStore((s) => s.matrix)
  const loadMatrix = useRoomStore((s) => s.loadMatrix)
  const createMatrix = useRoomStore((s) => s.createMatrix)
  const { currentProject } = useProjectContext()

  // 创建面板本地状态
  const [rowsInput, setRowsInput] = useState(15)
  const [colsInput, setColsInput] = useState(15)
  const [nameInput, setNameInput] = useState('机房')

  // 项目切换时加载矩阵
  useEffect(() => {
    if (currentProject) {
      loadMatrix(currentProject)
    } else {
      useRoomStore.getState().reset()
    }
  }, [currentProject, loadMatrix])

  // 机柜变化时重新计算（平面图模式）
  useEffect(() => {
    if (cabinets.length > 0) {
      computeLayout(cabinets)
    }
  }, [cabinets, computeLayout])

  const canvasSize = useMemo(() => {
    if (placements.length === 0) return { width: 800, height: 400 }
    const maxX = Math.max(...placements.map((p) => p.x + p.width))
    const maxY = Math.max(...placements.map((p) => p.y + p.height))
    return {
      width: maxX + params.sidePadding,
      height: maxY + params.topPadding,
    }
  }, [placements, params])

  const rowNames = useMemo(
    () => Array.from({ length: rowsInput }, (_, i) => String.fromCharCode(65 + i)),
    [rowsInput],
  )
  const colNums = useMemo(() => Array.from({ length: colsInput }, (_, i) => i + 1), [colsInput])

  // 机房矩阵优先
  if (matrix) {
    return <RoomMatrixView matrix={matrix} />
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* 创建矩阵面板 */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-app">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t('rack:room.title')}
        </span>
        <label className="text-xs text-gray-500 flex items-center gap-1">
          {t('rack:room.rows')}
          <input
            type="number"
            min={1}
            max={26}
            value={rowsInput}
            onChange={(e) => setRowsInput(Math.max(1, Math.min(26, Number(e.target.value) || 1)))}
            className="w-14 px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
          />
        </label>
        <label className="text-xs text-gray-500 flex items-center gap-1">
          {t('rack:room.cols')}
          <input
            type="number"
            min={1}
            max={100}
            value={colsInput}
            onChange={(e) => setColsInput(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="w-14 px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
          />
        </label>
        <label className="text-xs text-gray-500 flex items-center gap-1">
          {t('rack:room.name')}
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className="w-32 px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
          />
        </label>
        <button
          onClick={() => currentProject && createMatrix(currentProject, rowNames, colNums, nameInput)}
          disabled={!currentProject}
          className="px-3 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40"
        >
          {t('rack:room.create')}
        </button>
        <span className="text-xs text-gray-400">{t('rack:room.noMatrix')}</span>
      </div>

      {/* 原有平面图（无矩阵数据时） */}
      {placements.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          {t('datacenter:noCabinets', '暂无机柜数据，请先在工作台渲染拓扑或在机架 Tab 导入机柜')}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto bg-gray-50 dark:bg-app">
          <svg
            width={canvasSize.width}
            height={canvasSize.height}
            className="block"
            style={{ minWidth: '100%' }}
          >
            {rows.map((row) => {
              const aisleY = row.y + row.height
              const isCold = row.aisleType === 'cold'
              return (
                <g key={`aisle-${row.row}`}>
                  <rect
                    x={params.sidePadding}
                    y={aisleY}
                    width={params.cabinetsPerRow * params.cabinetWidth}
                    height={params.rowGap}
                    fill={isCold ? 'rgba(59,130,246,0.06)' : 'rgba(239,68,68,0.06)'}
                  />
                  <text
                    x={params.sidePadding + (params.cabinetsPerRow * params.cabinetWidth) / 2}
                    y={aisleY + params.rowGap / 2 + 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill={isCold ? 'rgba(59,130,246,0.5)' : 'rgba(239,68,68,0.5)'}
                  >
                    {isCold ? t('datacenter:coldAisle', '冷通道') : t('datacenter:hotAisle', '热通道')}
                  </text>
                </g>
              )
            })}
            {placements.map((p) => {
              const color = getPowerColor(p.powerUsage.percent)
              const isSelected = selectedId === p.id
              return (
                <g
                  key={p.id}
                  transform={`translate(${p.x}, ${p.y})`}
                  className="cursor-pointer"
                  onClick={() => selectCabinet(p.id)}
                >
                  <rect
                    width={p.width}
                    height={p.height}
                    fill={color.fill}
                    stroke={isSelected ? '#2563eb' : color.stroke}
                    strokeWidth={isSelected ? 2 : 1}
                    rx={2}
                  />
                  <text x={p.width / 2} y={14} textAnchor="middle" fontSize={9} fontWeight="bold" fill={color.text}>
                    {p.name.length > 8 ? p.name.slice(0, 7) + '…' : p.name}
                  </text>
                  <text x={p.width / 2} y={p.height / 2 + 4} textAnchor="middle" fontSize={14} fontWeight="bold" fill={color.text}>
                    {p.powerUsage.percent}%
                  </text>
                  <text x={p.width / 2} y={p.height - 6} textAnchor="middle" fontSize={8} fill={color.text} opacity={0.7}>
                    {p.deviceCount}{t('datacenter:devices', '台')}
                  </text>
                </g>
              )
            })}
            <g transform={`translate(${params.sidePadding}, ${canvasSize.height - 30})`}>
              <text x={0} y={10} fontSize={10} fill="#6b7280">{t('datacenter:powerUsage', '功率使用率')}:</text>
              <rect x={90} y={2} width={12} height={10} fill="#dcfce7" stroke="#16a34a" />
              <text x={106} y={10} fontSize={9} fill="#6b7280">&lt;60%</text>
              <rect x={150} y={2} width={12} height={10} fill="#fef3c7" stroke="#d97706" />
              <text x={166} y={10} fontSize={9} fill="#6b7280">60-80%</text>
              <rect x={220} y={2} width={12} height={10} fill="#fee2e2" stroke="#dc2626" />
              <text x={236} y={10} fontSize={9} fill="#6b7280">≥80%</text>
            </g>
          </svg>
        </div>
      )}
    </div>
  )
}
