import { useWizardStore } from '@/stores/wizard.store'
import { useTranslation } from 'react-i18next'
import { Layers, Snowflake, Cpu } from 'lucide-react'
import clsx from 'clsx'
import type { RackCoolingMethod } from '@/types/project-config'

const RACK_TYPE_OPTIONS = [
  { value: 42 as const, label: '42U' },
  { value: 49 as const, label: '49U' },
]

// V2.9.1: 功率预设（快速设置单柜功率上限）
const POWER_PRESETS = [
  { id: '6kw', label: '6KW', value: 6000 },
  { id: '12kw', label: '12KW', value: 12000 },
  { id: '16kw', label: '16KW', value: 16000 },
  { id: '30kw', label: '30KW', value: 30000 },
  { id: '60kw', label: '60KW', value: 60000 },
]

// V2.9.1: 散热方式选项
const COOLING_OPTIONS: { value: RackCoolingMethod; label: string; hint: string }[] = [
  { value: 'air', label: '风冷', hint: '≤15KW/柜' },
  { value: 'cold_plate', label: '冷板液冷', hint: '≤60KW/柜' },
  { value: 'immersion', label: '浸没式液冷', hint: '≤100KW/柜' },
]

// V2.9.2-T6: 散热方式对应单柜功率上限(W), 与 ProjectWizard 校验一致
const POWER_MAX_BY_COOLING: Record<RackCoolingMethod, number> = {
  air: 15000,
  cold_plate: 60000,
  immersion: 100000,
}

export function WizardStepRack() {
  const { t } = useTranslation('project')
  const { config, updateRackConfig } = useWizardStore()
  const rack = config.rack_config

  const isPresetActive = (value: number) =>
    rack.power_limit_per_rack === value && !rack.power_preset

  const applyPreset = (id: string, value: number) =>
    updateRackConfig({ power_preset: id, power_limit_per_rack: value })

  // V2.9.2-T6: 切换散热方式时, 若功率超上限则自动收敛到该方式上限
  const selectCooling = (method: RackCoolingMethod) => {
    const maxPower = POWER_MAX_BY_COOLING[method]
    const nextLimit = rack.power_limit_per_rack > maxPower ? maxPower : rack.power_limit_per_rack
    updateRackConfig({
      cooling_method: method,
      power_preset: '',
      power_limit_per_rack: nextLimit,
    })
  }

  const cooling = rack.cooling_method ?? 'air'
  const coolingMax = POWER_MAX_BY_COOLING[cooling]
  const powerExceeds = rack.power_limit_per_rack > coolingMax

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
          机柜配置
        </h3>
        <p className="text-xs text-gray-400">
          配置机柜类型、功率上限与散热方式，机柜分配将按功率 + U 位双约束自动装箱
        </p>
      </div>

      {/* Rack type */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
          机柜类型
        </label>
        <div className="flex gap-2">
          {RACK_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateRackConfig({ rack_type: opt.value })}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-colors',
                rack.rack_type === opt.value
                  ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500',
              )}
            >
              <Layers size={16} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Power limit presets (V2.9.1) */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
          单机柜功率上限 (W)
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {POWER_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id, p.value)}
              className={clsx(
                'px-3 py-1.5 rounded-md border text-xs font-medium transition-colors',
                isPresetActive(p.value)
                  ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={0}
          step={100}
          value={rack.power_limit_per_rack}
          onChange={(e) =>
            updateRackConfig({
              power_preset: '',
              power_limit_per_rack: Math.max(0, parseInt(e.target.value) || 0),
            })
          }
          className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
        />
        <p className="text-2xs text-gray-400 mt-1">
          12KW/16KW 机柜下，DGX H100/H200（10~12KW）将自动独占机柜（1 台/柜）
        </p>
        {/* V2.9.2-T6: 功率超当前散热方式上限提示 */}
        {powerExceeds && (
          <p className="text-2xs text-error-500 dark:text-error-400 mt-1" role="alert">
            {t('wizard.powerExceeds', '当前散热方式下单柜功率上限不能超过 {{max}}W', { max: coolingMax })}
          </p>
        )}
      </div>

      {/* Cooling method (V2.9.1) */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
          散热方式
        </label>
        <div className="flex gap-2">
          {COOLING_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => selectCooling(opt.value)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 text-xs font-medium transition-colors',
                rack.cooling_method === opt.value
                  ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500',
              )}
            >
              <Snowflake size={14} />
              {opt.label}
              <span className="text-2xs text-gray-400">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* GPU dedicated (V2.9.1) */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <button
            role="switch"
            aria-checked={!!rack.gpu_dedicated}
            onClick={() => updateRackConfig({ gpu_dedicated: !rack.gpu_dedicated })}
            className={clsx(
              'relative w-9 h-5 rounded-full transition-colors',
              rack.gpu_dedicated ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600',
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                rack.gpu_dedicated ? 'left-[18px]' : 'left-0.5',
              )}
            />
          </button>
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">
            <Cpu size={14} />
            GPU 服务器独占机柜（1 台/柜）
          </span>
        </label>
        <p className="text-2xs text-gray-400 mt-1 ml-11">
          开启后所有 GPU 服务器均独占机柜；关闭时高功率 GPU（≥50% 上限）仍自动独占
        </p>
      </div>

      {/* Top reserved U (M5: 方向化上架) */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
          顶部预留 U 位
        </label>
        <input
          type="number"
          min={0}
          step={1}
          value={rack.top_reserved_u ?? 2}
          onChange={(e) =>
            updateRackConfig({ top_reserved_u: Math.max(0, parseInt(e.target.value) || 0) })
          }
          className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
        />
        <p className="text-2xs text-gray-400 mt-1">
          机柜顶部预留空位（默认 2U）：网络设备从顶部向下、GPU/存储/通算服务器从底部向上上架
        </p>
      </div>

      {/* Naming prefix */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
          机柜命名前缀
        </label>
        <input
          type="text"
          value={rack.naming_prefix}
          onChange={(e) => updateRackConfig({ naming_prefix: e.target.value })}
          placeholder="机柜"
          className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
        />
        <p className="text-2xs text-gray-400 mt-1">
          生成机柜名称时将使用此前缀，例如 &quot;机柜-A01&quot;
        </p>
      </div>
    </div>
  )
}
