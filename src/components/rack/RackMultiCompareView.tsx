/**
 * AutoLink V2.4.7 — 多柜对比视图
 *
 * 并排展示 2-4 个机柜的紧凑视图，方便对比功率、U位利用率、设备分布。
 *   - 紧凑机柜渲染（宽度 100px 左右）
 *   - 顶部统计卡片：机柜名 / 总功率 / U位利用率 / 设备数
 *   - 底部图例
 */
import { useMemo, useState } from 'react'
import { type RackCabinet } from '@/stores/rack.store'
import { Columns, ChevronRight } from 'lucide-react'

interface Props {
  cabinets: RackCabinet[]
  activeCabinetId?: number | null
  onSelectCabinet?: (id: number) => void
}

const getTypeColor = (type: string): string => {
  const t = type.toLowerCase()
  if (t.includes('gpu')) return '#3b82f6'
  if (t.includes('存储') || t.includes('storage')) return '#22c55e'
  if (t.includes('switch') || t.includes('交换机')) return '#f59e0b'
  if (t.includes('通算') || t.includes('compute')) return '#a855f7'
  if (t.includes('安全') || t.includes('security')) return '#ef4444'
  return '#9ca3af'
}

export function RackMultiCompareView({ cabinets, activeCabinetId, onSelectCabinet }: Props) {
  const [selectedIds, setSelectedIds] = useState<number[]>(() => {
    // 默认选前 4 个机柜
    const initial = cabinets.slice(0, 4).map((c) => c.id)
    return initial
  })

  const [showPicker, setShowPicker] = useState(false)

  const selectedCabinets = useMemo(
    () => selectedIds.map((id) => cabinets.find((c) => c.id === id)).filter(Boolean) as RackCabinet[],
    [selectedIds, cabinets],
  )

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id)
      }
      if (prev.length >= 4) return prev  // 最多 4 个
      return [...prev, id]
    })
  }

  if (cabinets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        暂无机柜数据
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-gray-200 dark:border-edge-subtle bg-gray-50 dark:bg-app/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Columns size={13} className="text-info-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
              多柜对比视图
            </span>
            <span className="text-2xs text-gray-400">
              ({selectedCabinets.length}/4)
            </span>
          </div>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="flex items-center gap-1 px-2 py-1 text-2xs rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-600 dark:text-gray-300"
          >
            选择机柜
            <ChevronRight size={11} className={showPicker ? 'rotate-90' : ''} />
          </button>
        </div>

        {/* 机柜选择器 */}
        {showPicker && (
          <div className="mt-2 grid grid-cols-4 gap-1">
            {cabinets.map((c) => {
              const isSelected = selectedIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() => toggleSelect(c.id)}
                  className={`px-2 py-1 text-2xs rounded border transition-colors ${
                    isSelected
                      ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-400 text-primary-700 dark:text-primary-300'
                      : 'bg-white dark:bg-app-elevated border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                  }`}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 对比视图 */}
      <div className="flex-1 overflow-auto p-3">
        {selectedCabinets.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            请选择至少一个机柜进行对比
          </div>
        ) : (
          <div className="flex gap-3 justify-center min-w-fit">
            {selectedCabinets.map((cab) => (
              <CompactCabinet
                key={cab.id}
                cabinet={cab}
                isActive={cab.id === activeCabinetId}
                onClick={() => onSelectCabinet?.(cab.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 紧凑机柜视图 */
function CompactCabinet({
  cabinet,
  isActive,
  onClick,
}: {
  cabinet: RackCabinet
  isActive: boolean
  onClick?: () => void
}) {
  const uSlots = useMemo(() => {
    const slots: (string | null)[] = Array(cabinet.totalU).fill(null)
    const deviceMap = new Map<string, { id: string; name: string; type: string; startU: number; endU: number; power_watts: number }>()
    for (const d of cabinet.devices) {
      for (let u = d.startU; u <= d.endU; u++) {
        slots[u - 1] = d.id
      }
      deviceMap.set(d.id, d)
    }
    return slots.map((id, idx) => {
      if (!id) return null
      const device = deviceMap.get(id)!
      return { device, isFirst: device.startU === idx + 1 }
    })
  }, [cabinet])

  const totalPower = cabinet.devices.reduce((s, d) => s + d.power_watts, 0)
  const usedU = cabinet.devices.reduce((s, d) => s + (d.endU - d.startU + 1), 0)
  const uPercent = Math.round((usedU / cabinet.totalU) * 100)
  const powerPercent = Math.round((totalPower / cabinet.power_limit) * 100)
  const powerExceeded = powerPercent >= 100

  const slotHeight = 4  // 紧凑模式每 U 4px
  const cabinetHeight = cabinet.totalU * slotHeight

  return (
    <div
      onClick={onClick}
      className={`flex flex-col w-[160px] shrink-0 rounded-lg border-2 transition-all cursor-pointer ${
        isActive
          ? 'border-primary-500 shadow-md'
          : 'border-gray-200 dark:border-edge-subtle hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      {/* 头部统计 */}
      <div className="px-2 py-1.5 bg-gray-50 dark:bg-app/70 rounded-t-md border-b border-gray-200 dark:border-edge-subtle">
        <div className="text-2xs font-semibold text-gray-700 dark:text-gray-200 truncate">
          {cabinet.name}
        </div>
        <div className="flex items-center justify-between mt-0.5 text-3xs">
          <span className="text-gray-500 dark:text-gray-400">
            U: <span className={`font-medium ${uPercent >= 80 ? 'text-error-500' : uPercent >= 60 ? 'text-warning-500' : 'text-success-500'}`}>{uPercent}%</span>
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            P: <span className={`font-medium ${powerExceeded ? 'text-error-500' : powerPercent >= 80 ? 'text-warning-500' : 'text-success-500'}`}>{powerPercent}%</span>
          </span>
        </div>
      </div>

      {/* 紧凑机柜 SVG */}
      <div className="px-2 py-2 flex justify-center bg-white dark:bg-app-elevated">
        <svg width={40} height={cabinetHeight} className="border border-gray-300 dark:border-gray-600 rounded-sm">
          {uSlots.map((entry, i) => {
            const y = i * slotHeight
            if (!entry) {
              return (
                <rect
                  key={i}
                  x={0}
                  y={y}
                  width={40}
                  height={slotHeight}
                  fill="#f9fafb"
                  stroke="#e5e7eb"
                  strokeWidth={0.5}
                />
              )
            }
            if (!entry.isFirst) return null  // 后续 U 位由第一个 U 位的 rect 覆盖

            const { device } = entry
            const uCount = device.endU - device.startU + 1
            const color = getTypeColor(device.type)
            const height = uCount * slotHeight

            return (
              <rect
                key={i}
                x={0}
                y={y}
                width={40}
                height={height}
                fill={color}
                stroke="#fff"
                strokeWidth={0.5}
                opacity={0.85}
              >
                <title>{`${device.name}\nU${device.startU}-U${device.endU}\n${device.power_watts}W`}</title>
              </rect>
            )
          })}
        </svg>
      </div>

      {/* 底部信息 */}
      <div className="px-2 py-1.5 bg-gray-50 dark:bg-app/70 rounded-b-md border-t border-gray-200 dark:border-edge-subtle text-3xs">
        <div className="flex justify-between text-gray-500 dark:text-gray-400">
          <span>设备: <span className="font-medium text-gray-700 dark:text-gray-200">{cabinet.devices.length}</span></span>
          <span>{(totalPower / 1000).toFixed(1)}kW</span>
        </div>
      </div>
    </div>
  )
}
