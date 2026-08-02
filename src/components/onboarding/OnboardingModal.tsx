/**
 * V2.9.2-T7: 首次启动引导 Modal
 * 3 步快速引导(创建项目 → 配置设计 → 可视化交付), 看过一次后不再弹出
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { FolderPlus, Settings2, Network, Rocket } from 'lucide-react'
import clsx from 'clsx'

const ONBOARDED_KEY = 'autolink-onboarded-v1'

const STEP_ICONS = [FolderPlus, Settings2, Network]

export function OnboardingModal() {
  const { t } = useTranslation('common')
  // V2.9.2-T7: 首启检测在 useState 惰性初始化中完成, 避免 effect 内 setState
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return !localStorage.getItem(ONBOARDED_KEY)
    } catch {
      return false
    }
  })
  const [step, setStep] = useState(0)

  const finish = () => {
    localStorage.setItem(ONBOARDED_KEY, '1')
    setOpen(false)
  }

  const stepTitle = (i: number) =>
    i === 0 ? t('onboarding.step1Title', '创建项目')
      : i === 1 ? t('onboarding.step2Title', '配置设计')
        : t('onboarding.step3Title', '可视化与交付')

  const stepDesc = (i: number) =>
    i === 0 ? t('onboarding.step1Desc', '从左侧「+」新建项目，或基于模板快速开始')
      : i === 1 ? t('onboarding.step2Desc', '在设计页调整服务器、交换机参数，点击生成拓扑')
        : t('onboarding.step3Desc', '查看拓扑与机柜规划，导出报告与设备清单')

  return (
    <Modal
      open={open}
      onClose={finish}
      title={t('onboarding.title', '欢迎使用 AutoLink')}
      width={460}
      closeOnEsc
      showCloseButton={false}
      footer={(
        <div className="flex items-center justify-between">
          <button
            onClick={finish}
            className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            {t('onboarding.skip', '跳过')}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
              >
                {t('onboarding.prev', '上一步')}
              </button>
            )}
            {step < 2 ? (
              <button
                onClick={() => setStep(step + 1)}
                className="px-4 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
              >
                {t('onboarding.next', '下一步')}
              </button>
            ) : (
              <button
                onClick={finish}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
              >
                <Rocket size={12} />
                {t('onboarding.start', '开始使用')}
              </button>
            )}
          </div>
        </div>
      )}
    >
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1.5 mb-6">
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            onClick={() => setStep(i)}
            aria-label={stepTitle(i)}
            aria-current={step === i ? 'step' : undefined}
            className={clsx(
              'h-1.5 rounded-full transition-all',
              step === i ? 'w-6 bg-primary-500' : 'w-3 bg-gray-300 dark:bg-gray-600',
            )}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="text-center py-2">
        {(() => {
          const Icon = STEP_ICONS[step]
          return (
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
                <Icon size={28} className="text-primary-500" />
              </div>
              <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-2">
                {stepTitle(step)}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {stepDesc(step)}
              </p>
            </>
          )
        })()}
      </div>
    </Modal>
  )
}
