/**
 * 4.4 F4-3（测试计划 E-3）：一键管线面板
 *
 * 「规划(AIDC)→设计(机房/机柜)→渲染→导出」一键编排：
 *  - 步骤状态条（按序执行 + 状态徽章）
 *  - 可中断（停止）/ 可重试（重跑失败步骤起）
 *  - 模板批处理（多模板一键规划渲染导出，失败继续）
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Play,
  Square,
  RotateCcw,
  Cpu,
  Wrench,
  Zap,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  ListChecks,
  FilePlus2,
} from 'lucide-react'
import clsx from 'clsx'
import { usePipelineStore } from '@/stores/pipeline.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { PIPELINE_STEP_ORDER, type PipelineStepId } from '@/utils/pipeline'

const STEP_META: Record<PipelineStepId, { icon: React.ReactNode; key: string }> = {
  plan: { icon: <Cpu size={13} />, key: 'plan' },
  design: { icon: <Wrench size={13} />, key: 'design' },
  render: { icon: <Zap size={13} />, key: 'render' },
  export: { icon: <Download size={13} />, key: 'export' },
}

const STATUS_CLASS: Record<string, string> = {
  pending: 'border-gray-200 dark:border-edge-subtle text-gray-400',
  running:
    'border-primary-400 dark:border-primary-600 text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20',
  success:
    'border-success-300 dark:border-success-700 text-success-600 dark:text-success-400 bg-success-50 dark:bg-success-900/20',
  error:
    'border-error-300 dark:border-error-700 text-error-600 dark:text-error-400 bg-error-50 dark:bg-error-900/20',
  skipped: 'border-gray-200 dark:border-edge-subtle text-gray-400 opacity-50',
}

export function PipelinePanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const templates = useProjectStore((s) => s.templates)
  const {
    running,
    mode,
    steps,
    templateResults,
    runProjectPipeline,
    runTemplateBatch,
    stop,
    retry,
    reset,
  } = usePipelineStore()
  const addToast = useToastStore((s) => s.addToast)
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([])

  const hasError = useMemo(() => steps.some((s) => s.status === 'error'), [steps])
  const hasSkipped = useMemo(() => steps.some((s) => s.status === 'skipped'), [steps])
  const allDone = useMemo(
    () => steps.length > 0 && steps.every((s) => s.status === 'success'),
    [steps],
  )

  const handleRun = useCallback(() => {
    if (!selectedProjectName) {
      addToast('warning', t('workbench:pipeline.noProject', '请先选择一个项目'))
      return
    }
    void runProjectPipeline(selectedProjectName)
  }, [selectedProjectName, runProjectPipeline, addToast, t])

  const toggleTemplate = useCallback((name: string) => {
    setSelectedTemplates((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    )
  }, [])

  const handleBatch = useCallback(() => {
    if (selectedTemplates.length === 0) {
      addToast('warning', t('workbench:pipeline.selectTemplates', '请至少选择一个模板'))
      return
    }
    void runTemplateBatch(selectedTemplates)
  }, [selectedTemplates, runTemplateBatch, addToast, t])

  const busy = running

  return (
    <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-app/50 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
        <ListChecks size={13} className="text-primary-500" />
        {t('workbench:pipeline.title', '一键管线')}
        <span className="text-2xs text-gray-400 font-normal">
          {t('workbench:pipeline.subtitle', '规划(AIDC)→设计(机房/机柜)→渲染→导出')}
        </span>
      </div>

      <div className="p-3 space-y-3">
        {/* 步骤状态条 */}
        <div className="flex items-center gap-1">
          {PIPELINE_STEP_ORDER.map((id, i) => {
            const step = steps.find((s) => s.id === id)
            const status = step?.status ?? 'pending'
            const meta = STEP_META[id]
            return (
              <div key={id} className="flex items-center gap-1 flex-1">
                <div
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-1.5 rounded border text-2xs w-full justify-center transition-colors',
                    STATUS_CLASS[status],
                  )}
                >
                  <span className="shrink-0">
                    {status === 'running' ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : status === 'success' ? (
                      <CheckCircle2 size={12} />
                    ) : status === 'error' ? (
                      <XCircle size={12} />
                    ) : (
                      <Circle size={12} />
                    )}
                  </span>
                  <span className="truncate">
                    {meta.icon} {t(`workbench:pipeline.steps.${meta.key}`, meta.key)}
                  </span>
                </div>
                {i < PIPELINE_STEP_ORDER.length - 1 && (
                  <span className="text-gray-300 dark:text-gray-600 shrink-0">→</span>
                )}
              </div>
            )
          })}
        </div>

        {/* 步骤消息 / 汇总 */}
        {(busy || hasError || hasSkipped || allDone) && (
          <div className="flex flex-wrap items-center gap-2 text-2xs">
            {busy && (
              <span className="flex items-center gap-1 text-info-500">
                <Loader2 size={11} className="animate-spin" />
                {t('workbench:pipeline.running', '管线执行中…')}
              </span>
            )}
            {hasError && (
              <span className="text-error-600 dark:text-error-400">
                {t('workbench:pipeline.failed', '管线失败，可重试失败步骤')}
              </span>
            )}
            {hasSkipped && !hasError && (
              <span className="text-gray-500">
                {t('workbench:pipeline.interrupted', '已中断，未执行步骤已跳过')}
              </span>
            )}
            {allDone && (
              <span className="text-success-600 dark:text-success-400">
                {t('workbench:pipeline.done', '一键管线完成')}
              </span>
            )}
            {hasError && (
              <button
                type="button"
                onClick={retry}
                disabled={busy}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-warning-300 dark:border-warning-700 text-warning-700 dark:text-warning-300 hover:bg-warning-50 dark:hover:bg-warning-900/20 disabled:opacity-50"
              >
                <RotateCcw size={11} />
                {t('workbench:pipeline.retry', '重试')}
              </button>
            )}
            {!busy && (hasError || hasSkipped || allDone) && (
              <button
                type="button"
                onClick={reset}
                className="px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
              >
                {t('workbench:pipeline.reset', '重置')}
              </button>
            )}
          </div>
        )}

        {/* 单项目一键管线 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={busy || !selectedProjectName}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy && mode === 'project' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : busy && mode === 'template' ? (
              <Square size={13} />
            ) : (
              <Play size={13} />
            )}
            {t('workbench:pipeline.run', '一键管线')}
          </button>
          {busy && (
            <button
              type="button"
              onClick={stop}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border border-error-300 dark:border-error-700 text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20"
            >
              <Square size={12} />
              {t('workbench:pipeline.stop', '停止')}
            </button>
          )}
          <span className="text-2xs text-gray-400">
            {t('workbench:pipeline.runHint', '按序执行 规划→设计→渲染→导出，可随时中断/重试')}
          </span>
        </div>

        {/* 模板批处理 */}
        <div className="border-t border-gray-100 dark:border-edge-subtle pt-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-2xs font-medium text-gray-600 dark:text-gray-300">
              <FilePlus2 size={12} className="text-success-500" />
              {t('workbench:pipeline.templateBatch', '模板批处理（一键规划渲染导出，失败继续）')}
            </span>
            <button
              type="button"
              onClick={handleBatch}
              disabled={busy || selectedTemplates.length === 0}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-success-500 hover:bg-success-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy && mode === 'template' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              {t('workbench:pipeline.batchRun', '批量一键管线')}
              {selectedTemplates.length > 0 && ` (${selectedTemplates.length})`}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((tp) => {
              const checked = selectedTemplates.includes(tp.name)
              return (
                <label
                  key={tp.id}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-1 text-2xs rounded border cursor-pointer transition-colors',
                    checked
                      ? 'border-success-400 dark:border-success-600 bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300'
                      : 'border-gray-200 dark:border-edge-subtle text-gray-500 dark:text-gray-400 hover:border-success-300',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTemplate(tp.name)}
                    disabled={busy}
                    className="accent-success-500 w-3 h-3"
                  />
                  <span className="max-w-[140px] truncate">{tp.name}</span>
                </label>
              )
            })}
            {templates.length === 0 && (
              <span className="text-2xs text-gray-400">
                {t('workbench:pipeline.noTemplates', '暂无模板')}
              </span>
            )}
          </div>

          {/* 批处理结果列表 */}
          {templateResults.length > 0 && (
            <div className="rounded border border-gray-200 dark:border-edge-subtle divide-y divide-gray-100 dark:divide-edge-subtle max-h-40 overflow-auto">
              {templateResults.map((r, i) => (
                <div
                  key={`${r.template}-${i}`}
                  className="flex items-center gap-2 px-2 py-1.5 text-2xs"
                >
                  <span className="shrink-0">
                    {r.ok ? (
                      <CheckCircle2 size={12} className="text-success-500" />
                    ) : (
                      <XCircle size={12} className="text-error-500" />
                    )}
                  </span>
                  <span className="truncate font-medium text-gray-700 dark:text-gray-200">
                    {r.template}
                  </span>
                  <span className="truncate text-gray-400">{r.projectName || '-'}</span>
                  <span
                    className={clsx(
                      'ml-auto shrink-0',
                      r.ok
                        ? 'text-success-600 dark:text-success-400'
                        : 'text-error-600 dark:text-error-400',
                    )}
                  >
                    {r.ok
                      ? t('workbench:pipeline.templateOk', '成功')
                      : (r.error ?? t('workbench:pipeline.templateFailed', '失败'))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
