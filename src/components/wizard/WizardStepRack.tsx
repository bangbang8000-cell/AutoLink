import { useWizardStore } from '@/stores/wizard.store'
import { Layers } from 'lucide-react'
import clsx from 'clsx'

const RACK_TYPE_OPTIONS = [
  { value: 42 as const, label: '42U' },
  { value: 49 as const, label: '49U' },
]

export function WizardStepRack() {
  const { config, updateRackConfig } = useWizardStore()
  const rack = config.rack_config

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
          机柜配置
        </h3>
        <p className="text-xs text-gray-400">
          配置机柜基本参数
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
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500',
              )}
            >
              <Layers size={16} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Power limit */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
          单机柜功率上限 (W)
        </label>
        <input
          type="number"
          min={0}
          step={100}
          value={rack.power_limit_per_rack}
          onChange={(e) =>
            updateRackConfig({ power_limit_per_rack: Math.max(0, parseInt(e.target.value) || 0) })
          }
          className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
        />
        <p className="text-[10px] text-gray-400 mt-1">
          默认 6000W，用于机柜电力容量规划
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
          className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
        />
        <p className="text-[10px] text-gray-400 mt-1">
          生成机柜名称时将使用此前缀，例如 "机柜-A01"
        </p>
      </div>
    </div>
  )
}