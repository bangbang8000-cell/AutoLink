/**
 * 5.5.2 / A10-A12：工作台子视图统一动作区
 *
 * - 位置：由 WorkbenchTab 在内容区顶部统一渲染（跨 10 个子视图同一 y、右对齐）
 * - 注册表：每个子视图声明 { label, enabled, reason, done, invalidated, onRun, onUndo }
 * - 完成状态：唯一真值源为 workbench.store.stepDone（经 deriveWorkbenchState 同源推导）
 * - 禁用态：前置未满足时渲染禁用按钮，悬停显示原因
 */
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle, CircleDashed } from 'lucide-react'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRenderStore } from '@/stores/render.store'
import { useRoomStore } from '@/stores/room.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'

export interface SubviewAction {
  /** 未完成态按钮文案 */
  label: string
  /** 前置未满足的原因（禁用态 title） */
  reason?: string
  enabled: boolean
  done: boolean
  invalidated: boolean
  /** 本步无操作（docs / knowledge） */
  noop?: boolean
  onRun: () => void
  onUndo: () => void
}

/** 10 个子视图的动作注册表（reading 状态与完成态均来自同一 store） */
export function useSubviewActions(projectName: string): Record<WorkbenchSubview, SubviewAction> {
  const { t } = useTranslation('workbench')
  const designValid = useDesignStore((s) => s.valid)
  const hasMatrix = useRoomStore((s) => s.matrix != null)
  const matrixFinalized = useRoomStore((s) => s.matrix?.finalized === true)
  const cabinetCount = useRackStore((s) => s.cabinets.length)
  const hasRenderResults = useRenderStore((s) => s.results.length > 0)
  const hasOutputTypes = useRenderStore((s) => s.selectedOutputTypes.length > 0)
  const stepDone = useWorkbenchStore((s) => s.stepDone[projectName])
  const stale = useWorkbenchStore((s) => s.stale[projectName])
  const markStepDone = useWorkbenchStore((s) => s.markStepDone)
  const unmarkStepDone = useWorkbenchStore((s) => s.unmarkStepDone)
  const setFinalized = useRoomStore((s) => s.setFinalized)

  const make = (
    id: WorkbenchSubview,
    enabled: boolean,
    reason?: string,
    hooks: { run?: () => void; undo?: () => void } = {},
  ): SubviewAction => {
    const record = stepDone?.[id]
    const done = record?.done === true
    return {
      label: t('subviewAction.markDone'),
      reason: enabled ? undefined : reason,
      enabled,
      done,
      invalidated: stale?.includes(id) === true || record?.invalidatedBy !== undefined,
      onRun: () => {
        hooks.run?.()
        markStepDone(projectName, id)
      },
      onUndo: () => {
        hooks.undo?.()
        unmarkStepDone(projectName, id)
      },
    }
  }

  const reasonDesign = t('subviewAction.reasonDesign')
  const reasonRender = t('subviewAction.reasonRender')
  const noop: SubviewAction = {
    label: '',
    enabled: false,
    done: false,
    invalidated: false,
    noop: true,
    onRun: () => {},
    onUndo: () => {},
  }

  return {
    aidc: make('aidc', true),
    design: make('design', designValid === true, reasonDesign),
    roomdesign: make('roomdesign', hasMatrix, t('subviewAction.reasonRoomMatrix'), {
      run: () => setFinalized(true, projectName),
      undo: () => setFinalized(false, projectName),
    }),
    rackdesign: make(
      'rackdesign',
      matrixFinalized && cabinetCount > 0,
      matrixFinalized ? t('subviewAction.reasonRackCabinets') : t('subviewAction.reasonRackMatrix'),
    ),
    main: make(
      'main',
      designValid === true && hasOutputTypes,
      designValid === true ? t('subviewAction.reasonMainOutputs') : reasonDesign,
    ),
    visualization: make('visualization', designValid === true, reasonDesign),
    results: make('results', hasRenderResults, reasonRender),
    export: make('export', hasRenderResults, reasonRender),
    docs: noop,
    knowledge: noop,
  }
}

/** 右上角统一动作条（高度固定，保证跨视图 y 一致） */
export function SubviewActionBar({ projectName }: { projectName: string }) {
  const { t } = useTranslation('workbench')
  const subview = useUIStore((s) => s.workbenchSubview)
  const action = useSubviewActions(projectName)[subview]

  return (
    <div className="flex items-center justify-end gap-2 h-9 px-4 border-b border-gray-200 dark:border-edge-subtle shrink-0 whitespace-nowrap">
      {action.noop ? (
        <span className="text-2xs text-gray-400">{t('subviewAction.noop')}</span>
      ) : action.done && action.invalidated ? (
        <button
          type="button"
          onClick={action.onRun}
          title={t('subviewAction.invalidatedTip')}
          className="flex items-center gap-1 px-2 py-0.5 text-2xs rounded border border-warning-300 dark:border-warning-700 text-warning-700 dark:text-warning-300 hover:bg-warning-50 dark:hover:bg-warning-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!action.enabled}
        >
          <AlertTriangle size={12} /> {t('subviewAction.reconfirm')}
        </button>
      ) : action.done ? (
        <>
          <span className="flex items-center gap-1 text-2xs text-success-600 dark:text-success-400">
            <CheckCircle size={12} /> {t('subviewAction.done')}
          </span>
          <button
            type="button"
            onClick={action.onUndo}
            className="px-2 py-0.5 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
          >
            {t('subviewAction.undo')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={action.onRun}
          disabled={!action.enabled}
          title={action.reason}
          className="flex items-center gap-1 px-2 py-0.5 text-2xs rounded border border-primary-300 dark:border-primary-700 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CircleDashed size={12} /> {action.label}
        </button>
      )}
    </div>
  )
}
