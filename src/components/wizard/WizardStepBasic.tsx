import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard.store'
import { useProjectStore } from '@/stores/project.store'
import { Info, Cpu } from 'lucide-react'
import clsx from 'clsx'

const GPU_SCALE_OPTIONS = [32, 64, 128, 256, 512, 1024]

export function WizardStepBasic() {
  const { t } = useTranslation('project')
  const { config, templateName, updateMeta, resetConfig, aidcEnabled, aidcMacro, setAidcEnabled, updateAidcMacro } = useWizardStore()
  const projects = useProjectStore((s) => s.projects)

  const vlan = aidcMacro.vlan_ranges as Record<string, [number, number]> | undefined
  const asRange = aidcMacro.as_range as [number, number] | undefined
  const setVlan = (plane: string, val: string) => {
    const [lo, hi] = val.split(',').map((s) => Number(s.trim()))
    const next = { ...(vlan || {}) } as Record<string, [number, number]>
    next[plane] = [Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0]
    updateAidcMacro({ vlan_ranges: next })
  }

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

      {/* Template info banner (V2.9.5-T5: 可重置为默认) */}
      {templateName && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-info-200 dark:border-info-800 bg-info-50 dark:bg-info-900/20">
          <Info size={14} className="text-gray-400 shrink-0" />
          <span className="text-xs text-info-600 dark:text-info-400 truncate">
            基于模板: {templateName}
          </span>
          <button
            type="button"
            onClick={resetConfig}
            className="ml-auto shrink-0 text-2xs text-gray-500 hover:text-primary-500 dark:text-gray-400 dark:hover:text-primary-400"
            title={t('wizard.resetToDefault', '放弃模板预填，从头创建')}
          >
            {t('wizard.resetToDefault', '重置为默认')}
          </button>
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

      {/* 打磨轮（AL-B1）：包含 AIDC 规划参数 */}
      <div className="pt-2 border-t border-gray-100 dark:border-edge-subtle">
        <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
          <input type="checkbox" checked={aidcEnabled} onChange={(e) => setAidcEnabled(e.target.checked)}
            className="accent-primary-500" />
          <Cpu size={14} className="text-emerald-500" />
          包含 AIDC 规划参数（智算数据中心规划类项目）
        </label>
        <p className="text-2xs text-gray-400 mt-1">开启后，项目创建为 AIDC 规划类项目（可生成 plan 并导出给 MC 导入渲染）</p>

        {aidcEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3 p-3 rounded-lg border border-gray-200 dark:border-edge-subtle bg-gray-50/50 dark:bg-app-surface">
            <div>
              <label className="block text-2xs text-gray-500 mb-1">GPU 规模档位</label>
              <select
                value={String(aidcMacro.gpu_count ?? 64)}
                onChange={(e) => updateAidcMacro({ gpu_count: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app">
                {GPU_SCALE_OPTIONS.map((g) => <option key={g} value={g}>{g} 台</option>)}
              </select>
            </div>
            <div>
              <label className="block text-2xs text-gray-500 mb-1">机房</label>
              <input value={String(aidcMacro.site ?? 'BJ01')}
                onChange={(e) => updateAidcMacro({ site: e.target.value })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app" />
            </div>
            <div>
              <label className="block text-2xs text-gray-500 mb-1">PFC 队列 (0-7)</label>
              <input type="number" min={0} max={7} value={String(aidcMacro.pfc_queue ?? 3)}
                onChange={(e) => updateAidcMacro({ pfc_queue: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app" />
            </div>
            <div>
              <label className="block text-2xs text-gray-500 mb-1">CNP 队列 (0-7)</label>
              <input type="number" min={0} max={7} value={String(aidcMacro.cnp_queue ?? 6)}
                onChange={(e) => updateAidcMacro({ cnp_queue: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app" />
            </div>
            <div>
              <label className="block text-2xs text-gray-500 mb-1">收敛比 (0,4]</label>
              <input type="number" min={0.5} max={4} step={0.5} value={String(aidcMacro.convergence ?? 1)}
                onChange={(e) => updateAidcMacro({ convergence: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app" />
            </div>
            <div>
              <label className="block text-2xs text-gray-500 mb-1">多轨数 (1-16)</label>
              <input type="number" min={1} max={16} value={String(aidcMacro.rails ?? 8)}
                onChange={(e) => updateAidcMacro({ rails: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app" />
            </div>
            <div>
              <label className="block text-2xs text-gray-500 mb-1">AS 起</label>
              <input type="number" value={String(asRange?.[0] ?? 65001)}
                onChange={(e) => updateAidcMacro({ as_range: [Number(e.target.value), asRange?.[1] ?? 65500] })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app" />
            </div>
            <div>
              <label className="block text-2xs text-gray-500 mb-1">AS 止</label>
              <input type="number" value={String(asRange?.[1] ?? 65500)}
                onChange={(e) => updateAidcMacro({ as_range: [asRange?.[0] ?? 65001, Number(e.target.value)] })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app" />
            </div>
            {(['compute', 'storage', 'biz', 'oob'] as const).map((p) => (
              <div key={p}>
                <label className="block text-2xs text-gray-500 mb-1">VLAN {p} (起,止)</label>
                <input value={vlan?.[p]?.join(',') ?? ''}
                  onChange={(e) => setVlan(p, e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}