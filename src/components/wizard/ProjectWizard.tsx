import React from 'react'
import { useTranslation } from 'react-i18next'
import { useWizardStore, type WizardStep } from '@/stores/wizard.store'
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

interface Props {
  onComplete: () => void
  onCancel: () => void
}

export function ProjectWizard({ onComplete, onCancel }: Props) {
  const { t } = useTranslation()
  const { step, nextStep, prevStep, config } = useWizardStore()

  const canProceed = (): boolean => {
    switch (step) {
      case 1:
        return config.meta.name.trim().length > 0
      case 2:
        return Object.values(config.networks).some(Boolean)
      default:
        return true
    }
  }

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
              disabled={!canProceed()}
              className="flex items-center gap-1 px-4 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={onComplete}
              className="flex items-center gap-1 px-4 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
            >
              <Check size={14} />
              创建项目
            </button>
          )}
        </div>
      </div>
    </div>
  )
}