import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard.store'
import { useProjectStore } from '@/stores/project.store'
import { Info } from 'lucide-react'
import clsx from 'clsx'

export function WizardStepBasic() {
  const { t } = useTranslation('project')
  const { config, templateName, updateMeta } = useWizardStore()
  const projects = useProjectStore((s) => s.projects)

  // V2.9.2-T6: 名称校验(空值不打断输入, 由底部按钮禁用提示)
  const name = config.meta.name
  const nameError = (() => {
    if (!name.trim()) return null
    if (name.length > 50) return t('wizard.nameTooLong', '项目名称不能超过 50 个字符')
    if (projects.some((p) => p.name === name.trim())) return t('wizard.nameExists', '项目名称已存在')
    return null
  })()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
          基本信息
        </h3>
        <p className="text-xs text-gray-400">
          填写项目名称和描述
        </p>
      </div>

      {/* Template info banner */}
      {templateName && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-info-200 dark:border-info-800 bg-info-50 dark:bg-info-900/20">
          <Info size={14} className="text-gray-400 shrink-0" />
          <span className="text-xs text-info-600 dark:text-info-400">
            基于模板: {templateName}
          </span>
        </div>
      )}

      {/* Project name */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
          项目名称 <span className="text-error-400">*</span>
        </label>
        <input
          type="text"
          value={config.meta.name}
          maxLength={50}
          onChange={(e) => updateMeta(e.target.value, config.meta.description)}
          placeholder="请输入项目名称"
          aria-invalid={nameError ? true : undefined}
          className={clsx(
            'w-full px-3 py-2 text-sm rounded border bg-white dark:bg-app text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1',
            nameError
              ? 'border-error-400 dark:border-error-500 focus:ring-error-400 focus:border-error-400'
              : 'border-gray-300 dark:border-gray-600 focus:ring-primary-400 focus:border-primary-400',
          )}
        />
        {nameError && (
          <p className="mt-1 text-2xs text-error-500 dark:text-error-400" role="alert">
            {nameError}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
          项目描述
        </label>
        <textarea
          value={config.meta.description}
          onChange={(e) => updateMeta(config.meta.name, e.target.value)}
          placeholder="请输入项目描述（可选）"
          rows={4}
          className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 resize-none"
        />
      </div>
    </div>
  )
}