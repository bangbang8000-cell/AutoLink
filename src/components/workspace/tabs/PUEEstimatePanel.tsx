import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Thermometer, Activity, Gauge, RefreshCw, CheckCircle, Lightbulb } from 'lucide-react'
import type { EstimationResult, EstimateParams } from '@/stores/design.store'

interface Props {
  estimation: EstimationResult
  estimating: boolean
  onReEstimate: (params: EstimateParams) => void
}

const COOLING_METHODS: { value: 'air' | 'cold_plate' | 'immersion'; labelKey: string }[] = [
  { value: 'air', labelKey: 'design:coolingAir' },
  { value: 'cold_plate', labelKey: 'design:coolingColdPlate' },
  { value: 'immersion', labelKey: 'design:coolingImmersion' },
]

const NETWORK_LABEL: Record<string, string> = {
  param: 'design:paramNetwork',
  storage: 'design:storageNetwork',
  biz: 'design:bizNetwork',
}

export function PUEEstimatePanel({ estimation, estimating, onReEstimate }: Props) {
  const { t } = useTranslation()
  const { pue, convergence, cabinetDensity, inputs } = estimation

  // 本地表单状态（初始化为后端返回的 inputs）
  const [form, setForm] = useState({
    cooling_method: inputs.cooling_method as 'air' | 'cold_plate' | 'immersion',
    outdoor_temp_c: inputs.outdoor_temp_c,
    load_factor: inputs.load_factor,
    ups_efficiency: inputs.ups_efficiency,
    has_free_cooling: inputs.has_free_cooling,
  })

  // 当 estimation.inputs 变化时（重新估算后）同步本地表单
  useEffect(() => {
    setForm({
      cooling_method: inputs.cooling_method as 'air' | 'cold_plate' | 'immersion',
      outdoor_temp_c: inputs.outdoor_temp_c,
      load_factor: inputs.load_factor,
      ups_efficiency: inputs.ups_efficiency,
      has_free_cooling: inputs.has_free_cooling,
    })
  }, [inputs])

  const pueColor = pue.meetsTarget ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'
  const pueBg = pue.meetsTarget ? 'bg-success-50 dark:bg-success-900/20' : 'bg-error-50 dark:bg-error-900/20'

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 text-sm font-medium text-gray-600 dark:text-gray-300 flex items-center gap-2">
        <Thermometer size={14} className="text-orange-500" />
        {t('design:pueEstimate')}
      </div>

      <div className="p-4 space-y-4">
        {/* PUE 主指标 + 能耗分解 */}
        <div className="grid grid-cols-2 gap-3">
          {/* PUE 大数字 */}
          <div className={`rounded-lg p-4 ${pueBg}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('design:pueValue')}</span>
              <span className={`text-2xs px-1.5 py-0.5 rounded ${pue.meetsTarget ? 'bg-success-200 dark:bg-success-800 text-success-800 dark:text-success-200' : 'bg-error-200 dark:bg-error-800 text-error-800 dark:text-error-200'}`}>
                {pue.meetsTarget ? t('design:meetsTarget') : t('design:exceedsTarget')}
              </span>
            </div>
            <div className={`text-3xl font-bold mt-1 ${pueColor}`}>{pue.pue.toFixed(2)}</div>
            <div className="text-2xs text-gray-400 dark:text-gray-500 mt-0.5">{t('design:pueTarget')}</div>
          </div>

          {/* 能耗分解 */}
          <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-3 space-y-1.5">
            <EnergyRow label={t('design:itPower')} value={pue.itPowerKw} unit="kW" />
            <EnergyRow label={t('design:coolingPower')} value={pue.coolingPowerKw} unit="kW" />
            <EnergyRow label={t('design:upsLoss')} value={pue.upsLossKw} unit="kW" />
            <div className="border-t border-gray-100 dark:border-gray-700 pt-1.5">
              <EnergyRow label={t('design:totalPower')} value={pue.totalPowerKw} unit="kW" bold />
            </div>
          </div>
        </div>

        {/* 收敛比 */}
        <div>
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
            <Activity size={12} />
            {t('design:convergence')}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(convergence).map(([key, c]) => (
              <div key={key} className="border border-gray-100 dark:border-gray-700 rounded p-2">
                <div className="text-2xs text-gray-400 dark:text-gray-500 mb-1">{t(NETWORK_LABEL[key] || key)}</div>
                <div className={`text-sm font-bold ${c.meetsTarget ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'}`}>
                  {c.convergenceRatio.toFixed(1)} : 1
                </div>
                <div className="text-3xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {t('design:pueTarget').replace('< 1.25', `≤ ${c.targetRatio.toFixed(1)}`)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 机柜功率密度 */}
        <div className="border border-gray-100 dark:border-gray-700 rounded p-3">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
            <Gauge size={12} />
            {t('design:cabinetDensity')}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-2xs text-gray-400 dark:text-gray-500">{t('design:powerPerCabinet')}</div>
              <div className="font-medium text-gray-700 dark:text-gray-300">
                {(cabinetDensity.power_per_cabinet_w / 1000).toFixed(1)} kW
              </div>
            </div>
            <div>
              <div className="text-2xs text-gray-400 dark:text-gray-500">{t('design:densityLevel')}</div>
              <div className="font-medium text-gray-700 dark:text-gray-300">{cabinetDensity.density_level}</div>
            </div>
            <div>
              <div className="text-2xs text-gray-400 dark:text-gray-500">{t('design:coolingMethod')}</div>
              <div className="font-medium text-gray-700 dark:text-gray-300">
                {t(`design:cooling${cabinetDensity.recommended_cooling === 'air' ? 'Air' : cabinetDensity.recommended_cooling === 'cold_plate' ? 'ColdPlate' : 'Immersion'}`)}
              </div>
            </div>
          </div>
        </div>

        {/* 参数调整 */}
        <div className="border border-gray-100 dark:border-gray-700 rounded p-3">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('design:coolingMethod')}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-2xs">
              <span className="block text-gray-500 dark:text-gray-400 mb-1">{t('design:coolingMethod')}</span>
              <select
                value={form.cooling_method}
                onChange={(e) => setForm({ ...form, cooling_method: e.target.value as 'air' | 'cold_plate' | 'immersion' })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
              >
                {COOLING_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{t(m.labelKey)}</option>
                ))}
              </select>
            </label>
            <NumberField label={t('design:outdoorTemp')} value={form.outdoor_temp_c} step={1}
              onChange={(v) => setForm({ ...form, outdoor_temp_c: v })} />
            <NumberField label={t('design:loadFactor')} value={form.load_factor} step={0.05} min={0.1} max={1}
              onChange={(v) => setForm({ ...form, load_factor: v })} />
            <NumberField label={t('design:upsEfficiency')} value={form.ups_efficiency} step={0.01} min={0.8} max={1}
              onChange={(v) => setForm({ ...form, ups_efficiency: v })} />
          </div>
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.has_free_cooling}
              onChange={(e) => setForm({ ...form, has_free_cooling: e.target.checked })}
              className="text-primary-500"
            />
            <span className="text-2xs text-gray-600 dark:text-gray-400">{t('design:freeCooling')}</span>
          </label>

          <button
            onClick={() => onReEstimate(form)}
            disabled={estimating}
            className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {estimating ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t('design:reEstimate')}
          </button>
        </div>

        {/* 优化建议 */}
        {pue.recommendation && (
          <div className={`flex items-start gap-2 p-2.5 rounded text-xs ${pue.meetsTarget ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300' : 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-300'}`}>
            {pue.meetsTarget ? <CheckCircle size={13} className="shrink-0 mt-0.5" /> : <Lightbulb size={13} className="shrink-0 mt-0.5" />}
            <span className="flex-1">{pue.recommendation}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function EnergyRow({ label, value, unit, bold }: { label: string; value: number; unit: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold text-gray-800 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
        {value.toFixed(1)} <span className="text-2xs text-gray-400">{unit}</span>
      </span>
    </div>
  )
}

function NumberField({ label, value, onChange, step = 1, min, max }: {
  label: string; value: number; onChange: (v: number) => void
  step?: number; min?: number; max?: number
}) {
  return (
    <label className="text-2xs">
      <span className="block text-gray-500 dark:text-gray-400 mb-1">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(v)
        }}
        className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
      />
    </label>
  )
}

// 默认导出占位（避免未使用警告，实际由 DesignTab 命名导入）
export default PUEEstimatePanel
