/**
 * AutoLink V2.4.7 — 机房平面布局组件（V3.0.4-T3-2 扩展机房矩阵视图）
 *
 * 模式一（机房矩阵，V3.0.4-T3-2）：基于 room.store 的 RoomMatrix 渲染矩阵网格：
 *   - 行×列命名规则自定义（如 A15~O15=225 柜）
 *   - 占位标记（空调/柱子）+ 机柜类型标记（GPU/网络/存储/通算/组合）点击即标
 *   - 上架机柜显示（cell.cabinetId → rack.store 机柜名）
 * 模式二（原有平面图）：无矩阵数据时保留冷热通道机柜平面图。
 */
import { useMemo, useEffect, useState } from 'react'
import { useDataCenterStore, getPowerColor } from '@/stores/datacenter.store'
import { useRackStore, CABINET_TYPE_LABELS, RACK_TYPE_COLORS } from '@/stores/rack.store'
import { useRoomStore, ROOM_TOOL_LABEL_KEYS, type RoomMatrixData, type RoomMarkTool } from '@/stores/room.store'
import { RoomOptimizeModal } from '@/components/datacenter/RoomOptimizeModal'
import { useProjectContext } from '@/stores/ProjectContext'
import { useTranslation } from 'react-i18next'

// 机房矩阵机柜类型配色（RACK_TYPE_COLORS 扩展 combined/empty）
const ROOM_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  gpu: RACK_TYPE_COLORS.gpu,
  network: RACK_TYPE_COLORS.network,
  storage: RACK_TYPE_COLORS.storage,
  compute: RACK_TYPE_COLORS.compute,
  combined: { bg: '#f3e8ff', text: '#7e22ce', border: '#c084fc' }, // 紫：组合
  empty: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },    // 浅灰：未标记
}

const CELL_W = 64
const CELL_H = 48
const CELL_GAP = 3
const LABEL_W = 34
const LABEL_H = 24

const MARK_TOOLS: RoomMarkTool[] = [
  'select', 'ac', 'pillar', 'gpu', 'network', 'storage', 'compute', 'combined', 'clear',
]

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

  // V3.1.4-T8-2: 智能落位向导开关
  const [showOptimize, setShowOptimize] = useState(false)

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

  const startDrag = (e: React.DragEvent, cabinetId: number) => {
    e.dataTransfer.setData('text/plain', String(cabinetId))
    e.dataTransfer.effectAllowed = 'move'
  }
  const dropCabinet = (e: React.DragEvent, pos: string) => {
    e.preventDefault()
    const id = Number(e.dataTransfer.getData('text/plain'))
    if (id) mountCabinet(pos, id)
  }

  const canvas = {
    width: LABEL_W + matrix.cols.length * (CELL_W + CELL_GAP) + CELL_GAP,
    height: LABEL_H + matrix.rows.length * (CELL_H + CELL_GAP) + CELL_GAP,
  }

  const placeholderCount = matrix.cells.filter((c) => c.placeholder).length
  const markedCount = matrix.cells.filter((c) => c.type !== 'empty').length
  const mountedCount = matrix.cells.filter((c) => c.cabinetId != null).length

  return (
    <div className="w-full h-full flex flex-col">
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
        <div className="flex-1 overflow-auto p-3 bg-gray-50 dark:bg-app">
        <svg
          width={canvas.width}
          height={canvas.height}
          className="block"
          style={{ minWidth: '100%' }}
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
              const isPlaceholder = cell.placeholder != null
              const typeColor = ROOM_TYPE_COLORS[cell.type] || ROOM_TYPE_COLORS.empty
              const fill = isPlaceholder ? '#e5e7eb' : typeColor.bg
              const stroke = isSelected ? '#2563eb' : isPlaceholder ? '#9ca3af' : typeColor.border
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
                  transform={`translate(${LABEL_W + ci * (CELL_W + CELL_GAP)}, ${LABEL_H + ri * (CELL_H + CELL_GAP)})`}
                  className="cursor-pointer"
                  onClick={() => markCell(pos)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => dropCabinet(e, pos)}
                >
                  <rect
                    width={CELL_W}
                    height={CELL_H}
                    rx={3}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isSelected ? 2 : 1}
                  />
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
        </svg>
        </div>
      </div>
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
