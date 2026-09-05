/**
 * M1（AL-D1a/b）：机房设计独立子视图——封装 DataCenterLayout（矩阵平面 + 机柜类型 + 定稿/撤销）
 *
 * 复用：
 *   - DataCenterLayout.tsx：矩阵视图（RoomMatrixView）/ 无矩阵时创建面板，均内部处理
 *   - room.store.ts：loadMatrix / setFinalized / composeDefaults / applyMatrixRackLayout / saveMatrix
 *   - rack.store.ts：cabinets / saveRackLayout
 *   - design.store.ts：config.num_servers（自动布点用）/ topology（按矩阵落位用）
 *
 * 工具栏：定稿/撤销定稿、矩阵摘要、自动布点默认配比、按矩阵自动落位、保存
 *          （M4/AL-N3：导出机房设计 Excel 按钮已移除，统一到「本项目输出」导出）
 */
import { Suspense, lazy, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileCheck2, Lock, Unlock, ArrowRight, Undo2, Redo2, Camera, History, Trash2, Box, Grid3x3 } from 'lucide-react'
// 5.0.6（Lazy 加载，避免 2D 默认路径/测试图 eager 拉入 three·r3f·drei，防止 WebGL 依赖拖慢矩阵流程与 jsdom 超时）
const Room3DView = lazy(() => import('@/components/workspace/room/Room3DView'))
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { useDesignStore } from '@/stores/design.store'
import { useToastStore } from '@/stores/toast.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'
import { useSnapshotStore, defaultSnapshotName } from '@/stores/snapshot.store'
import { DataCenterLayout } from '@/components/datacenter/DataCenterLayout'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'

export function RoomDesignTab({ projectName }: { projectName: string }) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const matrix = useRoomStore((s) => s.matrix)
  const loadMatrix = useRoomStore((s) => s.loadMatrix)
  const composeDefaults = useRoomStore((s) => s.composeDefaults)
  const setFinalized = useRoomStore((s) => s.setFinalized)
  const selectedPosition = useRoomStore((s) => s.selectedPosition)
  const cabinets = useRackStore((s) => s.cabinets)
  const selectedCabinetId = useRackStore((s) => s.selectedCabinetId)
  const selectCabinet = useRackStore((s) => s.selectCabinet)
  const gpuCount = useDesignStore((s) => s.config.num_servers)
  const topology = useDesignStore((s) => s.topology)
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)

  // M2（AL-UR1/UR2）：撤销/重做——room 与 rack 独立栈，快捷键/按钮统一触发两者
  const roomCanUndo = useRoomStore((s) => s.canUndo)
  const roomCanRedo = useRoomStore((s) => s.canRedo)
  const rackCanUndo = useRackStore((s) => s.canUndo)
  const rackCanRedo = useRackStore((s) => s.canRedo)
  const canUndo = roomCanUndo || rackCanUndo
  const canRedo = roomCanRedo || rackCanRedo
  const undoAll = () => {
    useRoomStore.getState().undo()
    useRackStore.getState().undo()
  }
  const redoAll = () => {
    useRoomStore.getState().redo()
    useRackStore.getState().redo()
  }

  // M2（AL-UR1）：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 快捷键（聚焦输入框时跳过，不与系统输入冲突）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      if (key === 'z' && !e.shiftKey) {
        undoAll()
      } else {
        redoAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    loadMatrix(projectName).catch(() => {})
  }, [projectName, loadMatrix])

  // M3（AL-D3b 联动 A）：矩阵选中格（有已上架机柜）→ 打开/切到「机柜设计」子视图并选中该柜
  // （等值守卫防死循环：cabinetId 未变不重复 selectCabinet；setWorkbenchSubview 幂等）
  // AL-N4c：联动前校验 cabinetId 在 rack store 存在，不存在则仅切子视图不设置选中（避免显示错柜）
  useEffect(() => {
    if (!selectedPosition) return
    const cell = matrix?.cells.find((c) => `${c.row}${c.col}` === selectedPosition)
    if (cell?.cabinetId != null) {
      if (cabinets.some((c) => c.id === cell.cabinetId) && cell.cabinetId !== selectedCabinetId) {
        selectCabinet(cell.cabinetId)
      }
      setWorkbenchSubview('rackdesign' as WorkbenchSubview)
    }
  }, [selectedPosition, matrix, cabinets, selectedCabinetId, selectCabinet, setWorkbenchSubview])

  // 默认列配比自动布点（从 RackWorkbenchView 迁移：每列 1 电源 + 空调占位 + GPU(1柜1台) + 网络）
  const autoCompose = () => {
    if (!matrix) {
      addToast('warning', t('rack:needMatrixFirst', '请先定义机柜矩阵（排/列）'), 4000)
      return
    }
    const net = Math.max(4, cabinets.filter((c) => c.type === 'network').length)
    composeDefaults({ gpuCount: gpuCount || 64, networkCount: net })
    addToast('success', t('rack:autoComposed', '已按默认配比布点（每列 1 电源 + 空调 + GPU(1柜1台) + 网络），可微调'), 5000)
  }

  // 按矩阵自动落位（用设计拓扑节点；AIDC 应用到设计亦自动触发）
  const applyMatrix = async () => {
    const nodes = topology?.nodes
    if (!nodes || nodes.length === 0) {
      addToast('warning', t('rack:needTopologyFirst', '请先生成拓扑（「设计」子视图生成，或 AIDC 规划「应用到设计」）'), 4000)
      return
    }
    await useRoomStore.getState().applyMatrixRackLayout(projectName, nodes)
  }

  const saveAll = async () => {
    await useRoomStore.getState().saveMatrix(projectName)
    await useRackStore.getState().saveRackLayout(projectName)
    addToast('success', t('rack:savedAll', '机房矩阵与机柜布局已保存'), 3000)
  }

  // ===== M2（AL-SNAP1/3）：设计快照——保存/列表/恢复/删除 =====
  const snapshots = useSnapshotStore((s) => s.snapshots)
  const [saveOpen, setSaveOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [snapName, setSnapName] = useState('')
  // v5.0.6：「3D 可视化」视图切换（默认 2D 平面，不破坏既有流程）
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d')
  const openSaveModal = () => {
    setSnapName(defaultSnapshotName())
    setSaveOpen(true)
  }
  const doSaveSnapshot = () => {
    const name = snapName.trim() || defaultSnapshotName()
    const r = useSnapshotStore.getState().saveSnapshot(name)
    if (r.ok) {
      addToast('success', t('rack:snapshot.saved', '设计快照已保存：{{name}}', { name }), 4000)
      setSaveOpen(false)
    }
  }
  const doRestoreSnapshot = (id: string) => {
    useSnapshotStore.getState().restoreSnapshot(id)
    setListOpen(false)
  }
  const doDeleteSnapshot = (id: string) => {
    const item = useSnapshotStore.getState().list().find((it) => it.id === id)
    useSnapshotStore.getState().deleteSnapshot(id)
    if (item) addToast('success', t('rack:snapshot.deleted', '已删除快照：{{name}}', { name: item.name }), 3000)
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {t('workbench:subview.roomdesign', '机房设计')}
        </span>
        {/* M2（AL-UR1）：撤销/重做（room+rack 独立栈统一触发；Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y） */}
        <button type="button" onClick={undoAll} disabled={!canUndo}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
          title="撤销 (Ctrl+Z)">
          <Undo2 size={11} /> {t('common:menu.edit.undo', '撤销')}
        </button>
        <button type="button" onClick={redoAll} disabled={!canRedo}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
          title="重做 (Ctrl+Shift+Z / Ctrl+Y)">
          <Redo2 size={11} /> {t('common:menu.edit.redo', '重做')}
        </button>
        {/* v5.0.6：「3D 可视化」2D/3D 视图切换（默认 2D 平面，不破坏既有流程） */}
        {matrix && (
          <div className="flex items-center bg-white dark:bg-app border border-gray-200 dark:border-gray-600 rounded overflow-hidden" role="group" aria-label="视图切换">
            <button type="button" onClick={() => setViewMode('2d')}
              className={`flex items-center gap-1 px-2 py-1 text-2xs ${viewMode === '2d' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
              title={t('rack:view2d', '2D 平面')}>
              <Grid3x3 size={11} /> 2D
            </button>
            <button type="button" onClick={() => setViewMode('3d')}
              className={`flex items-center gap-1 px-2 py-1 text-2xs ${viewMode === '3d' ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
              title={t('rack:view3d', '3D 视图')}>
              <Box size={11} /> 3D
            </button>
          </div>
        )}
        {/* 定稿 / 撤销定稿 */}
        {matrix && !matrix.finalized && (
          <button type="button" onClick={() => setFinalized(true)}
            className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-success-300 dark:border-success-600 text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20">
            <Lock size={11} /> {t('rack:finalizeLayout', '定稿布局')}
          </button>
        )}
        {matrix?.finalized && (
          <>
            <button type="button" onClick={() => setWorkbenchSubview('rackdesign' as WorkbenchSubview)}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-primary-300 dark:border-primary-600 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20">
              <ArrowRight size={11} /> {t('rack:gotoRackDesign', '前往机柜设计')}
            </button>
            <button type="button" onClick={() => setFinalized(false)}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
              <Unlock size={11} /> {t('rack:undoFinalize', '撤销定稿')}
            </button>
          </>
        )}
        {matrix && (
          <>
            <span className="text-2xs text-gray-400">{t('rack:matrixSummary', { rows: matrix.rows.length, cols: matrix.cols.length, defaultValue: '矩阵 {{rows}}排×{{cols}}列' })}</span>
            <button type="button" onClick={autoCompose}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover">
              <Download size={11} /> {t('rack:autoCompose')}
            </button>
            <button type="button" onClick={applyMatrix}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-primary-300 dark:border-primary-600 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20">
              <Download size={11} /> {t('rack:applyMatrix')}
            </button>
            {/* M2（AL-SNAP1/3）：设计快照——保存/列表（会话内持久化） */}
            <button type="button" onClick={openSaveModal}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-violet-300 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20">
              <Camera size={11} /> {t('rack:snapshot.save', '保存快照')}
            </button>
            <button type="button" onClick={() => setListOpen(true)}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
              <History size={11} /> {t('rack:snapshot.list', '快照列表')}
            </button>
            <button type="button" onClick={saveAll}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-green-600 hover:bg-green-700 text-white">
              <FileCheck2 size={11} /> {t('common:save', '保存')}
            </button>
          </>
        )}
      </div>

      {/* 主体：2D 平面（DataCenterLayout）或 3D 视图（v5.0.6「3D 可视化」） */}
      <div className="flex-1 min-h-0 rounded border overflow-hidden bg-white dark:bg-app">
        {viewMode === '3d' ? (
          <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-gray-500">加载 3D 视图…</div>}>
            <Room3DView />
          </Suspense>
        ) : (
          <DataCenterLayout />
        )}
      </div>

      {/* M2（AL-SNAP1/3）：保存快照命名弹窗 */}
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title={t('rack:snapshot.saveTitle', '保存设计快照')}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSaveOpen(false)}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
              {t('common:cancel', '取消')}
            </button>
            <button type="button" onClick={doSaveSnapshot}
              className="px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white">
              {t('common:confirm', '确认')}
            </button>
          </div>
        }>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
          {t('rack:snapshot.name', '快照名称')}
        </label>
        <Input value={snapName} onChange={(e) => setSnapName(e.target.value)} placeholder={t('rack:snapshot.name', '快照名称')} />
      </Modal>

      {/* M2（AL-SNAP1/3）：快照列表（恢复/删除） */}
      <Modal
        open={listOpen}
        onClose={() => setListOpen(false)}
        title={t('rack:snapshot.listTitle', '设计快照列表')}>
        <div className="space-y-1 max-h-[50vh] overflow-auto">
          {snapshots.length === 0 && (
            <div className="text-xs text-gray-400 text-center py-6">{t('rack:snapshot.empty', '暂无设计快照')}</div>
          )}
          {snapshots.map((it) => (
            <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-app-hover">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{it.name}</div>
                <div className="text-2xs text-gray-400">
                  {t('rack:snapshot.createdAt', '创建时间')}: {new Date(it.createdAt).toLocaleString()}
                </div>
              </div>
              <button type="button" onClick={() => doRestoreSnapshot(it.id)}
                className="px-2 py-1 text-2xs rounded border border-primary-300 dark:border-primary-600 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20">
                {t('rack:snapshot.restore', '恢复')}
              </button>
              <button type="button" onClick={() => doDeleteSnapshot(it.id)}
                className="p-1 rounded hover:bg-error-50 text-gray-400 hover:text-error-500"
                title={t('rack:snapshot.delete', '删除')}>
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
