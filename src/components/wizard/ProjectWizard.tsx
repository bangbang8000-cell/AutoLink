import React from 'react'
import { useTranslation } from 'react-i18next'
import { useWizardStore, type WizardStep } from '@/stores/wizard.store'
import { useProjectStore } from '@/stores/project.store'
import { DEVICE_REF_KEYS, type ProjectNetworks } from '@/types/project-config'
import { WizardStepBasic } from './WizardStepBasic'
import { WizardStepNetworks } from './WizardStepNetworks'
import { WizardStepDevices } from './WizardStepDevices'
import { WizardStepRack } from './WizardStepRack'
import { WizardStepConfirm } from './WizardStepConfirm'
import { Check, ChevronRight, ChevronLeft } from 'lucide-react'
import clsx from 'clsx'

const STEPS: { step: WizardStep; label: string }[] = [
  { step: 1, label: '基本信息' },
  { step: 2, label: '网络类型' },
  { step: 3, label: '设备选型' },
  { step: 4, label: '机柜配置' },
  { step: 5, label: '确认' },
]

// V2.9.2-T6: 各网络启用的必需设备引用键
const REFS_BY_NETWORK: Record<string, string[]> = {
  param_network: ['param_leaf_switch', 'param_spine_switch', 'param_core_switch', 'gpu_server'],
  storage_network: ['storage_leaf_switch', 'storage_spine_switch', 'all_flash_storage_server', 'hybrid_flash_storage_server'],
  biz_network: ['biz_access_switch', 'biz_agg_switch', 'compute_server'],
  oob_network: ['oob_access_switch', 'oob_agg_switch'],
}

// V2.9.2-T6: 散热方式对应的单柜功率上限(W)
const POWER_MAX_BY_COOLING: Record<string, number> = {
  air: 15000,
  cold_plate: 60000,
  immersion: 100000,
}

interface Props {
  onComplete: () => void
  onCancel: () => void
}

export function ProjectWizard({ onComplete, onCancel }: Props) {
  const { t } = useTranslation()
  const { step, nextStep, prevStep, config } = useWizardStore()
  const projects = useProjectStore((s) => s.projects)

  // V2.9.2-T6: 分步校验, 返回当前步骤的阻塞错误文案(null 表示可继续)
  const getStepError = (): string | null => {
    switch (step) {
      case 1: {
        const name = config.meta.name.trim()
        if (!name) return t('project:wizard.nameRequired', '请输入项目名称')
        if (name.length > 50) return t('project:wizard.nameTooLong', '项目名称不能超过 50 个字符')
        if (projects.some((p) => p.name === name)) return t('project:wizard.nameExists', '项目名称已存在')
        return null
      }
      case 2:
        if (!Object.values(config.networks).some(Boolean)) return t('project:wizard.networkRequired', '请至少选择一种网络类型')
        return null
      case 3: {
        const missing = Object.entries(REFS_BY_NETWORK)
          .filter(([net]) => config.networks[net as keyof ProjectNetworks])
          .flatMap(([, refs]) => refs.filter((r) => !config.device_refs[r]))
        if (missing.length > 0) {
          const list = missing.map((r) => DEVICE_REF_KEYS[r] || r).join('、')
          return t('project:wizard.devicesMissing', '以下设备尚未选择：{{list}}', { list })
        }
        return null
      }
      case 4: {
        const limit = config.rack_config.power_limit_per_rack
        const cooling = config.rack_config.cooling_method ?? 'air'
        if (limit <= 0) return t('project:wizard.powerRequired', '请设置单机柜功率上限')
        const maxPower = POWER_MAX_BY_COOLING[cooling]
        if (limit > maxPower) {
          return t('project:wizard.powerExceeds', '当前散热方式下功率上限不能超过 {{max}}W', { max: maxPower })
        }
        return null
      }
      default:
        return null
    }
  }

  const stepError = getStepError()
  const canProceed = stepError === null

  const stepContent = () => {
    switch (step) {
      case 1:
        return <WizardStepBasic />
      case 2:
        return <WizardStepNetworks />
      case 3:
        return <WizardStepDevices />
      case 4:
        return <WizardStepRack />
      case 5:
        return <WizardStepConfirm />
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 px-6 py-4 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.step}>
            <div className="flex items-center gap-1.5">
              <div
                className={clsx(
                  'w-6 h-6 rounded-full flex items-center justify-center text-2xs font-medium transition-colors',
                  step === s.step
                    ? 'bg-primary-500 text-white'
                    : step > s.step
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500',
                )}
              >
                {step > s.step ? <Check size={12} /> : s.step}
              </div>
              <span
                className={clsx(
                  'text-2xs hidden sm:inline',
                  step >= s.step
                    ? 'text-gray-700 dark:text-gray-200 font-medium'
                    : 'text-gray-400',
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={clsx(
                  'w-6 h-px',
                  step > s.step
                    ? 'bg-primary-300 dark:bg-primary-600'
                    : 'bg-gray-200 dark:bg-gray-600',
                )}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        {stepContent()}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-edge-subtle shrink-0 sticky bottom-0 bg-white dark:bg-app-elevated">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
        >
          {t('project:cancel')}
        </button>

        <div className="flex flex-col items-end gap-1">
          {stepError && (
            <p className="text-2xs text-error-500 dark:text-error-400 max-w-[260px] text-right" role="alert">
              {stepError}
            </p>
          )}
          <div className="flex items-center gap-2">
            {step > 1 && step < 5 && (
              <button
                onClick={prevStep}
                className="flex items-center gap-1 px-4 py-1.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
              >
                <ChevronLeft size={14} />
                上一步
              </button>
            )}

            {step < 5 ? (
              <button
                onClick={nextStep}
                disabled={!canProceed}
                className="flex items-center gap-1 px-4 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一步
                <ChevronRight size={14} />
              </button>
            ) : (
              <button
                onClick={onComplete}
                disabled={!canProceed}
                className="flex items-center gap-1 px-4 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check size={14} />
                创建项目
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}