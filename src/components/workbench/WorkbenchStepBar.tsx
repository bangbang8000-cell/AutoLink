/**
 * F3（5.4.4 工作台可用性修复）：子视图常驻步骤条
 *
 * 挂在每个工作台子视图（设计/机房设计/机柜设计/渲染）顶部固定位置，呈现：
 *  - ①配置与就绪 → ②渲染材料与操作 → ③渲染结果 的三步进度
 *  - 每步当前状态（待开始/进行中/已定稿/需更新）——复用 deriveWorkbenchState 单一推导
 *  - 与本子视图相关的就地定稿动作（机房矩阵定稿 / AIDC 标记完成）
 *
 * 设计要点：纯展示 + 动作转发，状态推导全部复用 workbenchState.ts（单一事实源），
 * 不在组件内重复实现判定逻辑。
 */
import { useTranslation } from 'react-i18next'
import { CheckCircle, AlertTriangle, Loader2, Circle, Lock } from 'lucide-react'
import { useDesignStore } from '@/stores/design.store'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { useRenderStore } from '@/stores/render.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useUIStore } from '@/stores/ui.store'
import { deriveWorkbenchState, type WorkbenchStatus } from '@/utils/workbenchState'
import type { WorkbenchSubview as Sv } from '@/stores/ui.store'

const STEPS: { key: Sv; n: string; labelKey: string; fallback: string }[] = [
  { key: 'aidc', n: '①', labelKey: 'workbench:stepConfig', fallback: '配置与就绪' },
  { key: 'main', n: '②', labelKey: 'workbench:stepRender', fallback: '渲染材料与操作' },
  { key: 'results', n: '③', labelKey: 'workbench:stepResult', fallback: '渲染结果' },
]

/** 状态徽章配色与图标 */
function StatusBadge({ status }: { status: WorkbenchStatus }) {
  if (status === 'done') {
    return <CheckCircle size={12} className="text-success-500 shrink-0" />
  }
  if (status === 'in_progress') {
    return <Loader2 size={12} className="animate-spin text-primary-500 shrink-0" />
  }
  if (status === 'needs_update') {
    return <AlertTriangle size={12} className="text-warning-500 shrink-0" />
  }
  return <Circle size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />
}

const STATUS_TEXT: Record<WorkbenchStatus, { key: string; fallback: string; cls: string }> = {
  done: { key: 'workbench:statusDone', fallback: '已定稿', cls: 'text-success-600 dark:text-success-400' },
  in_progress: { key: 'workbench:statusInProgress', fallback: '进行中', cls: 'text-primary-600 dark:text-primary-400' },
  needs_update: { key: 'workbench:statusNeedsUpdate', fallback: '需更新', cls: 'text-warning-600 dark:text-warning-400' },
  pending: { key: 'workbench:statusPending', fallback: '待开始', cls: 'text-gray-400' },
}

export function WorkbenchStepBar({ projectName }: { projectName?: string }) {
  const { t } = useTranslation()
  const valid = useDesignStore((s) => s.valid)
  const summary = useDesignStore((s) => s.summary)
  const generating = useDesignStore((s) => s.generating)
  const matrix = useRoomStore((s) => s.matrix)
  const cabinets = useRackStore((s) => s.cabinets)
  const aidcDoneMap = useWorkbenchStore((s) => (projectName ? s.aidcDone[projectName] : undefined))
  const staleMap = useWorkbenchStore((s) => (projectName ? s.stale[projectName] : undefined))
  const activeSubview = useUIStore((s) => s.workbenchSubview)
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)
  const setFinalized = useRoomStore((s) => s.setFinalized)
  const markAidcDone = useWorkbenchStore((s) => s.markAidcDone)

  // ③ 结果步的产出判定：本会话渲染结果非空（与 ReadinessCard 的批次口径互补，同步可读）
  const hasRenderResults = useRenderStore((s) => s.results.length > 0)

  const deps = (subview: Sv) => ({
    designValid: valid,
    roomMatrixFinalized: matrix?.finalized === true,
    rackHasCabinets: cabinets.length > 0,
    hasOutputBatches: hasRenderResults,
    hasSelectedOutputTypes: true,
    activeSubview: activeSubview as Sv | null,
    reading: subview === 'design' ? generating : false,
    stale: staleMap,
    aidcDone: aidcDoneMap === true,
  })

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-200 dark:border-edge-subtle bg-gray-50/50 dark:bg-app/30 text-2xs overflow-x-auto">
      {STEPS.map((step, i) => {
        const status = deriveWorkbenchState(step.key, deps(step.key))
        const st = STATUS_TEXT[status]
        return (
          <div key={step.key} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <span className="text-gray-300 dark:text-gray-600 mx-0.5">→</span>}
            <StatusBadge status={status} />
            <button
              type="button"
              onClick={() => setWorkbenchSubview(step.key === 'aidc' ? 'aidc' : step.key === 'main' ? 'main' : 'results')}
              className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400"
              title={t(st.key, { defaultValue: st.fallback })}
            >
              {step.n} {t(step.labelKey, { defaultValue: step.fallback })}
            </button>
            <span className={st.cls}>{t(st.key, { defaultValue: st.fallback })}</span>
          </div>
        )
      })}

      {/* 就地定稿动作（按当前子视图上下文） */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {activeSubview === 'roomdesign' && matrix && !matrix.finalized && (
          <button
            type="button"
            onClick={() => setFinalized(true)}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-success-300 dark:border-success-600 text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20"
          >
            <Lock size={10} /> {t('rack:finalizeLayout', '定稿布局')}
          </button>
        )}
        {activeSubview === 'aidc' && projectName && aidcDoneMap !== true && (
          <button
            type="button"
            onClick={() => markAidcDone(projectName)}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-success-300 dark:border-success-600 text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20"
          >
            <CheckCircle size={10} /> {t('workbench:markDone', '标记完成')}
          </button>
        )}
        {summary && (
          <span className="text-gray-400">
            {t('workbench:totalServers', { defaultValue: `共 ${summary.totalServers} 台设备` })}
          </span>
        )}
      </div>
    </div>
  )
}
