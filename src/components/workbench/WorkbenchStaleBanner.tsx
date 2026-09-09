/**
 * 5.2.1-521-d：工作台"待调整"横幅（级联失效后的三操作入口）
 * - 重跑依赖链：清除全部 stale + 跳转到第一个待调整子视图（依赖顺序）
 * - 同步规划：跳转 AIDC 规划子视图（在该视图重新生成并「应用到设计」）
 * - 确认偏离：组网设计独立定稿（仅清除 design 链路，保留机房/机柜等）
 */
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw, GitBranch, ShieldCheck } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useToastStore } from '@/stores/toast.store'

/** 依赖顺序（用于"重跑依赖链"跳转：design 优先于 main 等下游） */
const DEP_ORDER: WorkbenchSubview[] = ['design', 'roomdesign', 'rackdesign', 'main', 'visualization', 'results', 'export']

/** 确认偏离：组网设计链路（design→visualization→main→results/export）独立定稿 */
const DESIGN_CHAIN: WorkbenchSubview[] = ['design', 'visualization', 'main', 'results', 'export']

export function WorkbenchStaleBanner() {
  const { t } = useTranslation('workbench')
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const stale = useWorkbenchStore((s) => (selectedProjectName ? s.stale[selectedProjectName] : undefined)) ?? []
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)
  const addToast = useToastStore((s) => s.addToast)

  if (!selectedProjectName || stale.length === 0) return null

  const sorted = [...stale].sort((a, b) => DEP_ORDER.indexOf(a) - DEP_ORDER.indexOf(b))
  const label = (id: WorkbenchSubview) => t(`subview.${id}`, { defaultValue: id })

  const rerunChain = () => {
    useWorkbenchStore.getState().resolveAllStale(selectedProjectName)
    addToast('success', t('staleBanner.rerunToast'))
    setWorkbenchSubview(sorted[0])
  }

  const syncPlan = () => {
    setWorkbenchSubview('aidc')
    addToast('info', t('staleBanner.syncToast'))
  }

  const confirmDeviation = () => {
    useWorkbenchStore.getState().resolveStale(selectedProjectName, DESIGN_CHAIN)
    addToast('info', t('staleBanner.deviationToast'))
  }

  const btn = 'flex items-center gap-1 px-2 py-1 text-2xs rounded border border-warning-300 dark:border-warning-700 text-warning-700 dark:text-warning-300 hover:bg-warning-100 dark:hover:bg-warning-900/30'

  return (
    <div className="flex items-center gap-2 flex-wrap px-3 py-2 mb-3 rounded border border-warning-200 dark:border-warning-800 bg-warning-50/60 dark:bg-warning-900/20 text-xs text-warning-700 dark:text-warning-300">
      <AlertTriangle size={13} className="shrink-0" />
      <span>{t('staleBanner.title', { count: stale.length })}{sorted.map(label).join('、')}</span>
      <span className="flex-1" />
      <button type="button" onClick={rerunChain} className={btn}>
        <RefreshCw size={11} /> {t('staleBanner.rerunChain')}
      </button>
      <button type="button" onClick={syncPlan} className={btn}>
        <GitBranch size={11} /> {t('staleBanner.syncPlan')}
      </button>
      <button type="button" onClick={confirmDeviation} className={btn}>
        <ShieldCheck size={11} /> {t('staleBanner.confirmDeviation')}
      </button>
    </div>
  )
}
