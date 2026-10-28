/**
 * B1-10（FR-A08）：规划阶段「机房容量建议」卡片。
 *
 * 口径：只读计算值来自 `useCabinetCapacity`（与差额条/预检同一次调用），
 * 人工可按实地工勘改「行数 / 每排柜数 / 余量系数」，改后标注偏离量并保留计算值；
 * 「采用建议」仅在矩阵为空或二次确认时写回，**任何情况下都不自动覆盖矩阵**。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDesignStore } from '@/stores/design.store'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { useCabinetCapacity } from '@/hooks/useCabinetCapacity'
import {
  DEFAULT_MARGIN_RATIO,
  MAX_CABINETS_PER_ROW,
  MIN_CABINETS_PER_ROW,
} from '@/utils/cabinetDemand'

export function WorkbenchCapacityCard({ projectName }: { projectName: string }) {
  const { t } = useTranslation(['workbench'])
  const nodes = useDesignStore((s) => s.topology?.nodes)
  const matrix = useRoomStore((s) => s.matrix)
  const topReservedU = useRackStore((s) => s.topReservedU)
  const gpuPerCabinet = useRackStore((s) => s.gpuPerCabinet)
  const powerLimit = useRackStore((s) => s.defaultPowerLimit)

  const [marginPct, setMarginPct] = useState(Math.round(DEFAULT_MARGIN_RATIO * 100))
  /** 人工调整（null = 未手改，跟随计算值） */
  const [perRowManual, setPerRowManual] = useState<number | null>(null)
  const [rowsManual, setRowsManual] = useState<number | null>(null)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  /** 需求基线：首次拿到计算值时锁定，用于发现「清单变化导致建议漂移」 */
  const [baseline, setBaseline] = useState<number | null>(null)

  const capacity = useCabinetCapacity({
    devices: nodes,
    matrix,
    topReservedU,
    gpuPerCabinet,
    powerLimit,
    marginRatio: marginPct / 100,
  })
  const estimate = capacity?.estimate ?? null
  const computedTotal = estimate?.totalWithMargin ?? null
  const suggested = estimate?.suggested[0]
  const computedPerRow = suggested?.perRow ?? 0
  const computedRows = suggested?.rows ?? 0

  useEffect(() => {
    if (baseline == null && computedTotal != null && computedTotal > 0) setBaseline(computedTotal)
  }, [baseline, computedTotal])

  const perRow = perRowManual ?? computedPerRow
  const rows = rowsManual ?? Math.max(1, Math.ceil((computedTotal ?? 0) / Math.max(1, perRow)))
  const manualCabinets = perRow * rows
  const deviation = computedTotal != null ? manualCabinets - computedTotal : 0

  const matrixOccupied = !!matrix
    && matrix.cells.some((c) => c.cabinetId != null || (c.type && c.type !== 'empty'))
  const matrixSlots = matrix ? matrix.rows.length * matrix.cols.length : 0
  const drift = computedTotal != null && baseline != null && computedTotal !== baseline

  const applySuggestion = async () => {
    const rowNames = Array.from({ length: rows }, (_, i) => `R${i + 1}`)
    const colNums = Array.from({ length: perRow }, (_, i) => i + 1)
    const ok = await useRoomStore.getState().createMatrix(projectName, rowNames, colNums, matrix?.name || '机房 A')
    // B5-05 / FR-A27：采用建议同时写回几何参数，使布局图换行数跟随建议值（不覆盖尺寸/通道）
    if (ok) {
      useRoomStore.getState().updateGeometry({ rowCount: rows, cabinetsPerRow: perRow }, projectName)
    }
    setConfirmOverwrite(false)
  }

  const onApplyClick = () => {
    if (!estimate) return
    if (matrixOccupied) {
      setConfirmOverwrite(true)
      return
    }
    void applySuggestion()
  }

  const recompute = () => {
    setBaseline(computedTotal)
    setPerRowManual(null)
    setRowsManual(null)
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-edge-subtle overflow-hidden mb-3">
      <div className="px-3 py-2 bg-gray-50 dark:bg-app/50 text-xs font-medium text-gray-600 dark:text-gray-300">
        {t('workbench:capacity.title', '机房容量建议')}
      </div>
      <div className="p-3 space-y-2">
        {!estimate ? (
          <div className="text-xs text-gray-400">
            {t('workbench:capacity.pending', '设备清单确认后给出容量建议')}
          </div>
        ) : (
          <>
            {/* ① 只读计算值（来自 A07，不可手改） */}
            <div className="text-xs text-gray-700 dark:text-gray-200" data-testid="capacity-computed">
              {t('workbench:capacity.demand', {
                defaultValue: '需 {{total}} 柜（GPU {{gpu}} / 网络 {{network}} / 存储 {{storage}} / 通算 {{compute}}）',
                total: estimate.totalCabinets,
                gpu: estimate.byType.gpu,
                network: estimate.byType.network,
                storage: estimate.byType.storage,
                compute: estimate.byType.compute,
              })}
              <span className="mx-2 text-gray-300">｜</span>
              {t('workbench:capacity.suggest', {
                defaultValue: '建议 {{rows}} 排 × {{perRow}} 列',
                rows: computedRows,
                perRow: computedPerRow,
              })}
              <span className="mx-2 text-gray-300">｜</span>
              {t('workbench:capacity.footprint', {
                defaultValue: '估算 面积 {{area}} m² · 总功率 {{power}} kW · 制冷 {{cooling}} kW',
                area: estimate.areaSqm,
                power: estimate.powerKw,
                cooling: estimate.coolingKw,
              })}
            </div>

            {/* ② 人工调整（按实地工勘）：改后标注偏离量，计算值保持可见 */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="text-gray-500 dark:text-gray-400">
                {t('workbench:capacity.rows', '行数')}
                <input
                  aria-label={t('workbench:capacity.rows', '行数')}
                  type="number"
                  min={1}
                  value={rows}
                  onChange={(e) => setRowsManual(Math.max(1, Number(e.target.value) || 1))}
                  className="ml-1 w-16 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-700 dark:text-gray-200"
                />
              </label>
              <label className="text-gray-500 dark:text-gray-400">
                {t('workbench:capacity.perRow', '每排柜数')}
                <input
                  aria-label={t('workbench:capacity.perRow', '每排柜数')}
                  type="number"
                  min={MIN_CABINETS_PER_ROW}
                  max={MAX_CABINETS_PER_ROW}
                  value={perRow}
                  onChange={(e) => setPerRowManual(Number(e.target.value) || MIN_CABINETS_PER_ROW)}
                  className="ml-1 w-16 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-700 dark:text-gray-200"
                />
              </label>
              <label className="text-gray-500 dark:text-gray-400">
                {t('workbench:capacity.margin', '余量 %')}
                <input
                  aria-label={t('workbench:capacity.margin', '余量 %')}
                  type="number"
                  min={0}
                  value={marginPct}
                  onChange={(e) => setMarginPct(Math.max(0, Number(e.target.value) || 0))}
                  className="ml-1 w-16 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-700 dark:text-gray-200"
                />
              </label>
              {(perRowManual != null || rowsManual != null) && deviation !== 0 && (
                <span className="text-warning-600 dark:text-warning-400 font-medium">
                  {t('workbench:capacity.manual', {
                    defaultValue: '人工调整（偏离计算值 {{dev}} 柜）',
                    dev: `${deviation > 0 ? '+' : ''}${deviation}`,
                  })}
                </span>
              )}
              <button
                type="button"
                onClick={onApplyClick}
                className="ml-auto px-2 py-0.5 rounded border border-primary-300 dark:border-primary-700 text-primary-600 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20"
              >
                {t('workbench:capacity.apply', '采用建议')}
              </button>
            </div>

            {/* ③ 采用建议（矩阵非空 → 二次确认；不自动覆盖） */}
            {confirmOverwrite && (
              <div className="p-2 rounded bg-warning-50/60 dark:bg-warning-900/20 text-xs text-gray-600 dark:text-gray-300">
                <div>
                  {t('workbench:capacity.confirm', {
                    defaultValue: '矩阵已有柜位，采用建议将重建为 {{rows}} 排 × {{perRow}} 列，现有布局会丢失。',
                    rows,
                    perRow,
                  })}
                </div>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => void applySuggestion()}
                    className="px-2 py-0.5 rounded bg-warning-500 text-white"
                  >
                    {t('workbench:capacity.confirmYes', '确认重建')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmOverwrite(false)}
                    className="px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600"
                  >
                    {t('workbench:capacity.confirmNo', '取消')}
                  </button>
                </div>
              </div>
            )}

            {/* ④ 不自动覆盖：清单变化只提示漂移，由用户决定是否重算 */}
            {drift && (
              <div className="flex items-center gap-2 text-xs text-warning-600 dark:text-warning-400">
                <span>
                  {t('workbench:capacity.drift', {
                    defaultValue: '需求已变（原 {{from}} 柜 → 现 {{to}} 柜），当前矩阵 {{slots}} 柜位。',
                    from: baseline,
                    to: computedTotal,
                    slots: matrixSlots,
                  })}
                </span>
                <button
                  type="button"
                  onClick={recompute}
                  className="px-2 py-0.5 rounded border border-warning-300 dark:border-warning-700"
                >
                  {t('workbench:capacity.recompute', '重算')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
