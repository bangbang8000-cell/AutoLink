/**
 * AutoLink V2.4.7 — 机房平面布局组件
 *
 * 基于 datacenter.store 的 placements 渲染 SVG 机房平面图：
 *   - 机柜按排排列，冷热通道交替（蓝色冷通道 / 红色热通道）
 *   - 机柜按功率使用率着色（绿 <60% / 黄 <80% / 红 ≥80%）
 *   - 点击机柜选中并显示详情
 */
import { useMemo, useEffect } from 'react'
import { useDataCenterStore, getPowerColor } from '@/stores/datacenter.store'
import { useRackStore } from '@/stores/rack.store'
import { useTranslation } from 'react-i18next'

export function DataCenterLayout() {
  const { t } = useTranslation()
  const cabinets = useRackStore((s) => s.cabinets)
  const placements = useDataCenterStore((s) => s.placements)
  const rows = useDataCenterStore((s) => s.rows)
  const params = useDataCenterStore((s) => s.params)
  const selectedId = useDataCenterStore((s) => s.selectedCabinetId)
  const computeLayout = useDataCenterStore((s) => s.computeLayout)
  const selectCabinet = useDataCenterStore((s) => s.selectCabinet)

  // 机柜变化时重新计算
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

  if (placements.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        {t('datacenter:noCabinets', '暂无机柜数据，请先在工作台渲染拓扑或在机架 Tab 导入机柜')}
      </div>
    )
  }

  return (
    <div className="w-full h-full overflow-auto bg-gray-50 dark:bg-app">
      <svg
        width={canvasSize.width}
        height={canvasSize.height}
        className="block"
        style={{ minWidth: '100%' }}
      >
        {/* 冷热通道背景 */}
        {rows.map((row) => {
          const aisleY = row.y + row.height
          const isCold = row.aisleType === 'cold'
          return (
            <g key={`aisle-${row.row}`}>
              {/* 通道区域 */}
              <rect
                x={params.sidePadding}
                y={aisleY}
                width={params.cabinetsPerRow * params.cabinetWidth}
                height={params.rowGap}
                fill={isCold ? 'rgba(59,130,246,0.06)' : 'rgba(239,68,68,0.06)'}
              />
              {/* 通道标签 */}
              <text
                x={params.sidePadding + params.cabinetsPerRow * params.cabinetWidth / 2}
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

        {/* 机柜 */}
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
              {/* 机柜名称 */}
              <text
                x={p.width / 2}
                y={14}
                textAnchor="middle"
                fontSize={9}
                fontWeight="bold"
                fill={color.text}
              >
                {p.name.length > 8 ? p.name.slice(0, 7) + '…' : p.name}
              </text>
              {/* 功率百分比 */}
              <text
                x={p.width / 2}
                y={p.height / 2 + 4}
                textAnchor="middle"
                fontSize={14}
                fontWeight="bold"
                fill={color.text}
              >
                {p.powerUsage.percent}%
              </text>
              {/* 设备数 */}
              <text
                x={p.width / 2}
                y={p.height - 6}
                textAnchor="middle"
                fontSize={8}
                fill={color.text}
                opacity={0.7}
              >
                {p.deviceCount}{t('datacenter:devices', '台')}
              </text>
            </g>
          )
        })}

        {/* 图例 */}
        <g transform={`translate(${params.sidePadding}, ${canvasSize.height - 30})`}>
          <text x={0} y={10} fontSize={10} fill="#6b7280">
            {t('datacenter:powerUsage', '功率使用率')}:
          </text>
          <rect x={90} y={2} width={12} height={10} fill="#dcfce7" stroke="#16a34a" />
          <text x={106} y={10} fontSize={9} fill="#6b7280">&lt;60%</text>
          <rect x={150} y={2} width={12} height={10} fill="#fef3c7" stroke="#d97706" />
          <text x={166} y={10} fontSize={9} fill="#6b7280">60-80%</text>
          <rect x={220} y={2} width={12} height={10} fill="#fee2e2" stroke="#dc2626" />
          <text x={236} y={10} fontSize={9} fill="#6b7280">≥80%</text>
        </g>
      </svg>
    </div>
  )
}
