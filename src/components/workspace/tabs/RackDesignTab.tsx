/**
 * M2（AL-D2a/b + D3a）：机柜设计独立子视图——封装 RackTab，保留 isometric 等距立体，带定稿门槛
 *
 * 复用：
 *   - RackTab.tsx：柜内上架/移动/功率/批量模板 + 2D/3D（basic/power-heat/multi-compare/isometric）四视图
 *   - room.store.ts：loadMatrix（读取 matrix.finalized 门槛）
 *   - rack.store.ts：optimizeRacks / clearCabinets / saveRackLayout
 *
 * 定稿门槛（AL-D3a）：未定稿（含无矩阵）→ 显示引导「请先完成机房设计并定稿」，不进入机柜设计；
 * 工具栏：撤销定稿、柜内智能落位、清空柜内设计、保存、
 *         导出机柜设计 Excel / 归档（占位按钮，M7 接入真实导出与归档）。
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileCheck2, Lock, Unlock, X, Archive, ArrowLeft } from 'lucide-react'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'
import { RackTab } from '@/components/workspace/tabs/RackTab'

export function RackDesignTab({ projectName }: { projectName: string }) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const matrix = useRoomStore((s) => s.matrix)
  const loadMatrix = useRoomStore((s) => s.loadMatrix)
  const setFinalized = useRoomStore((s) => s.setFinalized)
  const selectedPosition = useRoomStore((s) => s.selectedPosition)
  const selectPosition = useRoomStore((s) => s.selectPosition)
  const syncCabinetToCell = useRoomStore((s) => s.syncCabinetToCell)
  const cabinets = useRackStore((s) => s.cabinets)
  const selectedCabinetId = useRackStore((s) => s.selectedCabinetId)
  const optimizeRacks = useRackStore((s) => s.optimizeRacks)
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)

  useEffect(() => {
    loadMatrix(projectName).catch(() => {})
  }, [projectName, loadMatrix])

  // M3（AL-D3b 联动 B）：机柜设计选中柜 → 机房设计矩阵格高亮（等值守卫防死循环）
  useEffect(() => {
    if (selectedCabinetId == null) return
    const cell = matrix?.cells.find((c) => c.cabinetId === selectedCabinetId)
    if (cell) {
      const pos = `${cell.row}${cell.col}`
      if (pos !== selectedPosition) selectPosition(pos)
    }
  }, [selectedCabinetId, matrix, selectedPosition, selectPosition])

  // M3（AL-D3b 联动 C）：改柜类型 → 回写矩阵格类型（syncCabinetToCell 内等值守卫收敛）
  useEffect(() => {
    if (!matrix) return
    for (const cab of cabinets) syncCabinetToCell(cab.id)
  }, [cabinets, matrix, syncCabinetToCell])

  // 读取项目机柜配置 → 注入 rack.store（topReservedU/gpuPerCabinet 生效）
  useEffect(() => {
    window.electron.project
      .getFile(projectName, 'project_config.json')
      .then((raw: string | null) => {
        if (!raw) return
        const cfg = JSON.parse(raw)
        const rack = cfg?.rack_config || {}
        if (rack.top_reserved_u != null || rack.gpu_per_cabinet != null) {
          useRackStore.getState().setRackConfig({
            topReservedU: rack.top_reserved_u,
            gpuPerCabinet: rack.gpu_per_cabinet,
          })
        }
      })
      .catch(() => {})
  }, [projectName])

  const finalized = !!matrix?.finalized

  // M2（AL-D3a）：定稿门槛——未定稿显示引导，不进入机柜设计
  if (!finalized) {
    return (
      <div className="h-full flex flex-col gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t('workbench:subview.rackdesign', '机柜设计')}
          </span>
        </div>
        <div className="flex-1 min-h-0 rounded border overflow-hidden bg-white dark:bg-app flex items-center justify-center">
          <div className="text-center px-6 py-8">
            <Lock size={28} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">
              {t('rack:needFinalizeFirst', '请先完成机房设计并定稿，再进入机柜设计')}
            </p>
            <p className="text-2xs text-gray-400 mb-4">
              {t('rack:finalizeHint', '在「机房设计」子视图完成矩阵布局并点「定稿布局」后，即可进入机柜内设备上架')}
            </p>
            <button type="button"
              onClick={() => setWorkbenchSubview('roomdesign' as WorkbenchSubview)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white">
              <ArrowLeft size={12} /> {t('workbench:subview.roomdesign', '前往机房设计')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // M2：柜内智能落位（待上架池 → 现有柜 U 位）
  const runRackOptimize = async () => {
    const res = await optimizeRacks(useRackStore.getState().gpuPerCabinet)
    if (res && (res.stats?.placed ?? 0) > 0) {
      await useRackStore.getState().saveRackLayout(projectName)
    }
  }

  const saveAll = async () => {
    await useRoomStore.getState().saveMatrix(projectName)
    await useRackStore.getState().saveRackLayout(projectName)
    addToast('success', t('rack:savedAll', '机房矩阵与机柜布局已保存'), 3000)
  }

  // M7 占位：导出机柜设计 Excel（两 sheet：每机柜设计 + 上机表）
  const exportRackDesign = () => {
    addToast('info', t('rack:exportRackDesign', '导出机柜设计 Excel（M7 接入）'), 4000)
  }

  // M7 占位：归档并清空（版本归档到 项目名-版本-时间 目录）
  const archiveAndClear = () => {
    addToast('info', t('rack:archiveAndClear', '归档并清空（M7 接入）'), 4000)
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {t('workbench:subview.rackdesign', '机柜设计')}
        </span>
        <span className="text-2xs text-gray-400">
          {t('rack:matrixSummary', { rows: matrix.rows.length, cols: matrix.cols.length, defaultValue: '矩阵 {{rows}}排×{{cols}}列' })}
          {' · '}{cabinets.length}{t('rack:room.cabinets', '机柜')}
        </span>
        {/* M3（AL-D3c）：返回机房设计 / 撤销定稿 → 回机房设计调整 */}
        <button type="button" onClick={() => setWorkbenchSubview('roomdesign' as WorkbenchSubview)}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
          <ArrowLeft size={11} /> {t('rack:backToRoomDesign', '返回机房设计')}
        </button>
        <button type="button" onClick={() => {
          setFinalized(false)
          setWorkbenchSubview('roomdesign' as WorkbenchSubview)
        }}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
          <Unlock size={11} /> {t('rack:undoFinalize', '撤销定稿')}
        </button>
        {/* M7：导出机柜设计 Excel（占位） */}
        <button type="button" onClick={exportRackDesign}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-success-300 dark:border-success-600 text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20">
          <Download size={11} /> {t('rack:exportRackDesign', '导出机柜设计 Excel')}
        </button>
        {/* M7：归档并清空（占位） */}
        <button type="button" onClick={archiveAndClear}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-violet-300 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20">
          <Archive size={11} /> {t('rack:archiveAndClear', '归档并清空')}
        </button>
        <button type="button" onClick={runRackOptimize}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-violet-300 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20">
          <Download size={11} /> {t('rack:rackOptimize')}
        </button>
        <button type="button" onClick={() => {
          useRackStore.getState().clearCabinets()
          addToast('warning', t('rack:cleared', '柜内设计已清空（设备回到待上架池），可重新规划'), 5000)
        }}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
          <X size={11} /> {t('rack:clearRacks', '清空柜内设计')}
        </button>
        <button type="button" onClick={saveAll}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-green-600 hover:bg-green-700 text-white">
          <FileCheck2 size={11} /> {t('common:save', '保存')}
        </button>
      </div>

      {/* 主体：RackTab（上架/移动/功率/批量模板 + isometric 等距立体） */}
      <div className="flex-1 min-h-0 rounded border overflow-hidden bg-white dark:bg-app">
        <RackTab cabinetId={null} />
      </div>
    </div>
  )
}
