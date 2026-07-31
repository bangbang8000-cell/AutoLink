/**
 * AutoLink V2.4.7 — 机房统计面板
 */
import { useDataCenterStore } from '@/stores/datacenter.store'
import { useTranslation } from 'react-i18next'
import { Server, Zap, Thermometer, Maximize, AlertTriangle, Activity } from 'lucide-react'

function StatCard({ icon, label, value, unit, color }: {
  icon: React.ReactNode
  label: string
  value: string | number
  unit?: string
  color: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-2xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-lg font-bold text-gray-800 dark:text-gray-100">
        {value}
        {unit && <span className="text-xs font-normal text-gray-400 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

export function DataCenterStats() {
  const { t } = useTranslation()
  const stats = useDataCenterStore((s) => s.stats)

  if (!stats) return null

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3">
      <StatCard
        icon={<Server size={14} />}
        label={t('datacenter:totalCabinets', '机柜总数')}
        value={stats.totalCabinets}
        color="text-info-500"
      />
      <StatCard
        icon={<Activity size={14} />}
        label={t('datacenter:totalDevices', '设备总数')}
        value={stats.totalDevices}
        unit={t('datacenter:devices', '台')}
        color="text-success-500"
      />
      <StatCard
        icon={<Zap size={14} />}
        label={t('datacenter:totalPower', '总功率')}
        value={stats.totalPowerKW}
        unit="kW"
        color="text-warning-500"
      />
      <StatCard
        icon={<Thermometer size={14} />}
        label={t('datacenter:coolingLoad', '制冷负荷')}
        value={stats.coolingLoadKW}
        unit="kW"
        color="text-error-500"
      />
      <StatCard
        icon={<Maximize size={14} />}
        label={t('datacenter:area', '机房面积')}
        value={stats.totalAreaSqm}
        unit="m²"
        color="text-purple-500"
      />
      <StatCard
        icon={<Activity size={14} />}
        label={t('datacenter:powerDensity', '功率密度')}
        value={stats.powerDensity}
        unit="kW/m²"
        color="text-cyan-500"
      />
      <StatCard
        icon={<Zap size={14} />}
        label={t('datacenter:maxCabinet', '最高单柜')}
        value={stats.maxPowerCabinetKW}
        unit="kW"
        color="text-orange-500"
      />
      <StatCard
        icon={<AlertTriangle size={14} />}
        label={t('datacenter:exceededCabinets', '超功率柜')}
        value={stats.exceededCabinets}
        unit={t('datacenter:devices', '台')}
        color={stats.exceededCabinets > 0 ? 'text-error-500' : 'text-success-500'}
      />
    </div>
  )
}
