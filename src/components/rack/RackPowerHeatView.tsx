/**
 * AutoLink V2.4.7 — 机架功率热力视图
 *
 * 在 2D 机架视图基础上叠加功率密度热力图：
 *   - 设备块按 W/U 功率密度着色（绿 <50W/U · 黄 <150W/U · 红 ≥150W/U）
 *   - 显示设备名称、功率值、U位范围
 *   - 顶部显示机柜总功率与热力图例
 */
import { useMemo } from 'react'
import { useRackStore, type RackDevice, type RackCabinet } from '@/stores/rack.store'
import { Flame } from 'lucide-react'

interface Props {
  cabinet: RackCabinet
}

/** 按功率密度（W/U）返回热力颜色 */
function getHeatColor(powerWatts: number, uCount: number): {
  fill: string; stroke: string; text: string; label: string
} {
  const density = uCount > 0 ? powerWatts / uCount : 0
  if (density >= 150) {
    return { fill: '#fee2e2', stroke: '#dc2626', text: '#991b1b', label: '极高' }
  }
  if (density >= 100) {
    return { fill: '#fed7aa', stroke: '#ea580c', text: '#9a3412', label: '高' }
  }
  if (density >= 50) {
    return { fill: '#fef3c7', stroke: '#d97706', text: '#92400e', label: '中' }
  }
  return { fill: '#dcfce7', stroke: '#16a34a', text: '#166534', label: '低' }
}

export function RackPowerHeatView({ cabinet }: Props) {
  const removeDevice = useRackStore((s) => s.removeDevice)

  const uSlots = useMemo(() => {
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

    return entries
  }, [cabinet])

  const totalPower = useMemo(
    () => cabinet.devices.reduce((s, d) => s + d.power_watts, 0),
    [cabinet.devices],
  )

  const handleRemove = (deviceId: string) => {
    removeDevice(cabinet.id, deviceId)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header：机柜名称 + 总功率 + 热力图例 */}
      <div className="shrink-0 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Flame size={13} className="text-orange-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {cabinet.name} · 功率热力
            </span>
          </div>
          <span className="text-xs font-bold text-orange-600 dark:text-orange-400">
            {(totalPower / 1000).toFixed(2)} kW
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
          <span>功率密度:</span>
          <span className="flex items-center gap-0.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#dcfce7', border: '1px solid #16a34a' }} />
            &lt;50W/U
          </span>
          <span className="flex items-center gap-0.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#fef3c7', border: '1px solid #d97706' }} />
            50-100
          </span>
          <span className="flex items-center gap-0.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#fed7aa', border: '1px solid #ea580c' }} />
            100-150
          </span>
          <span className="flex items-center gap-0.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#fee2e2', border: '1px solid #dc2626' }} />
            ≥150W/U
          </span>
        </div>
      </div>

      {/* 机架视图 */}
      <div className="flex-1 overflow-auto p-3">
        <div className="flex gap-1 min-w-[320px] max-w-xl mx-auto">
          {/* U 位标尺 */}
          <div className="w-12 shrink-0 bg-gray-100 dark:bg-gray-700/50 rounded-l">
            {Array.from({ length: cabinet.totalU }, (_, i) => (
              <div
                key={i}
                className="h-7 flex items-center justify-end pr-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700/50 last:border-b-0"
              >
                {cabinet.totalU - i}
              </div>
            ))}
          </div>

          {/* 设备槽位 */}
          <div className="flex-1 border border-gray-300 dark:border-gray-600 rounded-r overflow-hidden">
            {uSlots.map((entry, i) => {
              if (!entry) {
                return (
                  <div
                    key={i}
                    className="h-7 border-b border-gray-200 dark:border-gray-700 last:border-b-0 bg-gray-50 dark:bg-gray-850"
                  />
                )
              }

              const { device, isFirst } = entry
              const uCount = device.endU - device.startU + 1
              const color = getHeatColor(device.power_watts, uCount)
              const density = uCount > 0 ? Math.round(device.power_watts / uCount) : 0

              // 只在设备的第一个 U 位渲染内容
              if (!isFirst) {
                return (
                  <div
                    key={i}
                    className="h-7 border-b border-gray-200 dark:border-gray-700 last:border-b-0"
                    style={{ background: color.fill }}
                  />
                )
              }

              // 多 U 设备：高度 = uCount * 28px
              const height = uCount * 28

              return (
                <div
                  key={i}
                  className="border-b border-gray-200 dark:border-gray-700 last:border-b-0 flex items-center px-2 group transition-colors"
                  style={{
                    height,
                    background: color.fill,
                    borderLeft: `3px solid ${color.stroke}`,
                  }}
                  title={`${device.name}\nU${device.startU}-U${device.endU} (${uCount}U)\n功率: ${device.power_watts}W\n密度: ${density}W/U`}
                >
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] font-medium truncate" style={{ color: color.text }}>
                        {device.name}
                      </span>
                      <span className="text-[9px] opacity-70" style={{ color: color.text }}>
                        U{device.startU}-U{device.endU} · {uCount}U
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className="text-[10px] font-bold tabular-nums"
                        style={{ color: color.text }}
                      >
                        {device.power_watts}W
                      </span>
                      <span
                        className="text-[9px] px-1 py-0.5 rounded"
                        style={{
                          background: color.stroke,
                          color: '#fff',
                        }}
                      >
                        {density}W/U
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemove(device.id) }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-red-500"
                        title="移除设备"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
