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
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileCheck2, Lock, Unlock, ArrowRight } from 'lucide-react'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { useDesignStore } from '@/stores/design.store'
import { useToastStore } from '@/stores/toast.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'
import { DataCenterLayout } from '@/components/datacenter/DataCenterLayout'

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

  return (
    <div className="h-full flex flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {t('workbench:subview.roomdesign', '机房设计')}
        </span>
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
            <button type="button" onClick={saveAll}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-green-600 hover:bg-green-700 text-white">
              <FileCheck2 size={11} /> {t('common:save', '保存')}
            </button>
          </>
        )}
      </div>

      {/* 主体：DataCenterLayout（矩阵视图；无矩阵时其内部提供创建面板） */}
      <div className="flex-1 min-h-0 rounded border overflow-hidden bg-white dark:bg-app">
        <DataCenterLayout />
      </div>
    </div>
  )
}
