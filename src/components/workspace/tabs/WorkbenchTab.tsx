import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, FolderOpen, Settings, Plus, Download, X } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'
import { WorkbenchScopeCard } from '@/components/workbench/WorkbenchScopeCard'
import { WorkbenchReadinessCard } from '@/components/workbench/WorkbenchReadinessCard'
import { WorkbenchOutputCard } from '@/components/workbench/WorkbenchOutputCard'
import { WorkbenchActionCard } from '@/components/workbench/WorkbenchActionCard'
import { WorkbenchResultCard } from '@/components/workbench/WorkbenchResultCard'
import { AidcPlannerPanel } from '@/components/aidc/AidcPlannerPanel'
import { DesignTab } from '@/components/workspace/tabs/DesignTab'
import { TopologyTab } from '@/components/workspace/tabs/TopologyTab'
import { RoomDesignTab } from '@/components/workspace/tabs/RoomDesignTab'
import { RackDesignTab } from '@/components/workspace/tabs/RackDesignTab'
import { OutputResultsView } from '@/components/workbench/OutputResultsView'
import { useToastStore } from '@/stores/toast.store'
import { CreateProjectWizardModal } from '@/components/wizard/CreateProjectWizardModal'
import { exportDeliveryZip } from '@/utils/aidcDelivery'
// M8（AL-U2）：工作台 Header 项目切换器——复用 Dropdown 组件
import { Dropdown } from '@/components/ui/Dropdown'

/** 打磨轮（v1.6 收尾）：工作台步骤分组标签（5 卡→三步） */
/* AL-M4j：升级为水平步骤条——数字徽章 + 连接线延伸贯穿卡片分组宽度,串联三步视觉 */
function StepLabel({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary-500 text-white text-xs font-semibold shadow-sm shrink-0">
        {n}
      </span>
      <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{text}</span>
      <span className="flex-1 h-px bg-gradient-to-r from-primary-200 dark:from-primary-700 to-transparent" />
    </div>
  )
}

/** 打磨轮（v1.6 / AL-T1b）：工作台二级页签标签（对齐 v1.6 命名；M1/M2 增机房/机柜设计独立子视图） */
const SUBVIEW_KEYS: Record<string, string> = {
  aidc: 'workbench:subview.aidc',
  design: 'workbench:subview.design',
  roomdesign: 'workbench:subview.roomdesign',
  rackdesign: 'workbench:subview.rackdesign',
  main: 'workbench:subview.main',
  visualization: 'workbench:subview.visualization',
  results: 'workbench:subview.results',
  export: 'workbench:subview.export',
}

// AL-N1（PRD v3.2）：roomdesign/rackdesign 已并入 ui.store 的 WorkbenchSubview，移除本文件局部收敛类型与断言

/** 新子视图标签的中文兜底（AL-N1 后 i18n 已并入 workbench:subview.roomdesign/rackdesign；此处仅作 key 缺失时回退，防编程 ID） */
const SUBVIEW_LABEL_FALLBACK: Record<string, string> = {
  roomdesign: '机房设计',
  rackdesign: '机柜设计',
}

// AL-M4c: 工作台二级页签保活上限——最多同时保持 N 个非激活子视图挂载,超限卸载释放内存
const KEEP_ALIVE_LIMIT = 5

/** 打磨轮（v1.3）：归档/导出子视图（导出 MC 交付包 + 渲染结果） */
function ExportView({ projectName }: { projectName: string }) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)
  const [deliveryBusy, setDeliveryBusy] = useState(false)
  const exportBatch = async (batch?: string) => {
    setBusy(true)
    try {
      const res = await window.electron.render.exportOutput(projectName, batch)
      if (res?.canceled) return
      if (res?.ok) addToast('success', t('workbench:output.exported', { path: res.path }))
    } catch (e) {
      addToast('error', t('workbench:exportView.exportFailed', { err: (e as Error).message, defaultValue: '导出失败: {{err}}' }))
    } finally {
      setBusy(false)
    }
  }

  // 导出 MC 交付包：读项目已保存 plan.json → plan:aidc:export(zip)，无 plan 时引导去 AIDC 规划
  const exportDelivery = async () => {
    setDeliveryBusy(true)
    try {
      const res = await exportDeliveryZip(projectName)
      if (res?.canceled) return
      if (res?.noPlan) {
        addToast('warning', t('workbench:exportView.noPlan', '当前项目未生成 AIDC 规划，请先在「AIDC 规划」视图生成规划'), 5000)
        return
      }
      if (res?.error) {
        addToast('error', t('workbench:exportView.deliveryFailed', { err: res.error }), 5000)
      } else {
        addToast('success', t('workbench:exportView.deliveryExported', { path: res.path ?? '' }), 5000)
      }
    } catch (e) {
      addToast('error', t('workbench:exportView.deliveryFailed', { err: (e as Error).message }), 5000)
    } finally {
      setDeliveryBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Download size={14} className="text-success-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('workbench:exportView.title', { name: projectName })}</span>
      </div>
      {/* ① 导出 MC 交付包（读项目 plan.json，含 plan.json/README/拓扑图，供 MagicCommander 导入） */}
      <div className="border rounded p-3 space-y-2">
        <p className="text-2xs text-gray-500">{t('workbench:exportView.toMc')}</p>
        <p className="text-2xs text-gray-400">{t('workbench:exportView.toMcHint')}</p>
        <button type="button" onClick={exportDelivery} disabled={deliveryBusy}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded bg-success-500 hover:bg-success-600 text-white disabled:opacity-40 disabled:cursor-wait">
          <Download size={12} /> {deliveryBusy ? t('workbench:exportView.exporting', '导出中…') : t('workbench:exportView.exportDelivery')}
        </button>
      </div>
      {/* ② 导出渲染结果（output 批次） */}
      <div className="border rounded p-3 space-y-2">
        <p className="text-2xs text-gray-500">{t('workbench:exportView.renderResults')}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => exportBatch(undefined)} disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-40">
            <Download size={12} /> {t('workbench:exportView.exportAllZip')}
          </button>
        </div>
        <p className="text-2xs text-gray-400">{t('workbench:exportView.exportBatchHint')}</p>
      </div>
    </div>
  )
}

export function WorkbenchTab() {
  const { t } = useTranslation()
  const projects = useProjectStore((s) => s.projects)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const selectProject = useProjectStore((s) => s.selectProject)
  const subview = useUIStore((s) => s.workbenchSubview)
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)
  const setActivityHint = useUIStore((s) => s.setActivityHint)

  // AL-N1（PRD v3.2）：打开子视图（roomdesign/rackdesign 已并入 WorkbenchSubview，无需断言）
  const openSubview = useCallback((view: WorkbenchSubview) => {
    setWorkbenchSubview(view)
  }, [setWorkbenchSubview])

  const [aidcProjects, setAidcProjects] = useState<string[]>([])
  // AL-M5a：AIDC 新建并入 CreateProjectWizardModal（移除固定 64 台内联表单）
  const [showAidcWizard, setShowAidcWizard] = useState(false)
  // 打磨轮（v1.6 / AL-T1a）：工作台二级页签——访问过的子视图保留（keep-alive 保留状态）
  const [openedSubviews, setOpenedSubviews] = useState<WorkbenchSubview[]>(['main'])

  // 打开新子视图 → 记入二级页签
  useEffect(() => {
    setOpenedSubviews((prev) => (prev.includes(subview) ? prev : [...prev, subview]))
  }, [subview])

  // AL-M4h：二级页签右键菜单（关闭 / 关闭其他 / 关闭右侧 / 全部关闭）
  const [subviewCtx, setSubviewCtx] = useState<{ sv: WorkbenchSubview; x: number; y: number } | null>(null)
  // AL-M4c：保活集合 = 激活页签 + 最近 (N-1) 个非激活页签;超限非激活卸载释放内存
  const mountedSubviews = useMemo(() => {
    const activeIdx = openedSubviews.indexOf(subview)
    const kept: WorkbenchSubview[] = [subview]
    for (let i = openedSubviews.length - 1; i >= 0 && kept.length < KEEP_ALIVE_LIMIT; i--) {
      if (i !== activeIdx) kept.push(openedSubviews[i])
    }
    return new Set(kept)
  }, [openedSubviews, subview])

  // AL-M4h：批量关闭子视图
  const batchCloseSubviews = useCallback((mode: 'this' | 'others' | 'right' | 'all', sv: WorkbenchSubview) => {
    setOpenedSubviews((prev) => {
      const idx = prev.indexOf(sv)
      let next: WorkbenchSubview[]
      if (mode === 'all') next = ['main']
      else if (mode === 'this') next = prev.filter((x) => x !== sv)
      else if (mode === 'others') next = prev.filter((x) => x === sv)
      else next = idx === -1 ? prev : prev.slice(0, idx + 1) // 关闭右侧 → 保留到 sv（含 sv）
      if (sv === subview && next.length > 0 && !next.includes(subview)) {
        openSubview(next[next.length - 1] ?? 'main')
      } else if (sv === subview && next.length === 0) {
        openSubview('main')
      }
      return next
    })
  }, [subview, setOpenedSubviews, openSubview])

  // AL-M4h：点击/滚动关闭右键菜单
  useEffect(() => {
    if (!subviewCtx) return
    const closeMenu = () => setSubviewCtx(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSubviewCtx(null) }
    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', onKey)
    }
  }, [subviewCtx])

  // 加载 AIDC 项目名（判断当前项目类型）
  useEffect(() => {
    window.electron.aidc.project.list()
      .then((res) => {
        const projects = (res as { ok?: boolean; projects?: Array<{ name: string }> })?.projects ?? []
        setAidcProjects(projects.map((p) => p.name))
      })
      .catch(() => {})
  }, [selectedProjectName])

  // 打磨轮（v1.2 复核）：切换项目回到「常规渲染」——AIDC 按钮保持白色，点选才变蓝（避免"已选中"误解）
  // AL-M4i：切换项目同时清空二级页签历史，避免跨项目页签残留误导
  useEffect(() => {
    if (selectedProjectName) {
      openSubview('main')
      setOpenedSubviews(['main'])
    }
  }, [selectedProjectName, openSubview])

  // AL-M5a：AIDC 项目由 CreateProjectWizardModal 创建完成后刷新列表并选中
  const handleAidcWizardCreated = useCallback(() => {
    window.electron.aidc.project.list()
      .then((res) => {
        const list = (res as { ok?: boolean; projects?: Array<{ name: string }> })?.projects ?? []
        setAidcProjects(list.map((p) => p.name))
      })
      .catch(() => {})
  }, [])

  if (!selectedProjectName) {
    // 打磨轮（v1.6 / AL-N1a）：无项目 → 项目引导面板（选择默认项目 / 引导到项目面板新建导入）
    return (
      <div className="h-full overflow-auto p-6">
        <div className="max-w-md mx-auto mt-10">
          <div className="flex flex-col items-center text-center mb-6">
            <Zap size={40} className="text-primary-400 mb-2" />
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('workbench:empty.welcome')}</p>
            <p className="text-xs text-gray-400 mt-1">{t('workbench:empty.hint')}</p>
          </div>
          {projects.length > 0 && (
            <div className="mb-4">
              <p className="text-2xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('workbench:empty.selectProject')}</p>
              <div className="space-y-1">
                {projects.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => selectProject(p)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded border border-gray-200 dark:border-edge-subtle bg-white dark:bg-app hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 text-left transition-colors"
                  >
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{p.name}</span>
                    <span className="ml-auto text-2xs text-gray-400 shrink-0">{p.updatedAt ? p.updatedAt.slice(0, 10) : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={() => { setActiveActivity('project'); setActivityHint('project') }}
              className="px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
            >
              {t('workbench:empty.gotoProjects')}
            </button>
          </div>
          {projects.length === 0 && (
            <p className="text-center text-2xs text-gray-400 mt-3">{t('workbench:empty.noProjects')}</p>
          )}
        </div>
      </div>
    )
  }

  const isAidc = aidcProjects.includes(selectedProjectName)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-edge-subtle shrink-0 bg-gray-50 dark:bg-app/50">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t('workbench:title')}
        </span>
        {/* M8（AL-U2）：项目切换器——多项目显示下拉（当前项高亮，切换走 selectProject）；单项目降级为纯文本 */}
        {projects.length > 1 ? (
          <Dropdown
            items={projects.map((p) => ({ value: p.name, label: p.name }))}
            value={selectedProjectName ?? undefined}
            onChange={(name) => {
              const target = projects.find((p) => p.name === name)
              if (target) selectProject(target)
            }}
            className="w-56"
            menuClassName="w-56"
          />
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">{selectedProjectName}</span>
        )}
      </div>

      {/* 打磨轮（v1.6 / AL-T1b）：工作台二级页签栏（访问过的子视图保留，快速切换/关闭） */}
      <div className="flex items-center gap-0.5 px-3 py-1 border-b border-gray-200 dark:border-edge-subtle bg-gray-50/60 dark:bg-app/40 overflow-x-auto shrink-0">
        {openedSubviews.map((sv) => {
          const active = sv === subview
          return (
            <div
              key={sv}
              onContextMenu={(e) => {
                e.preventDefault()
                setSubviewCtx({ sv, x: e.clientX, y: e.clientY })
              }}
              className={`flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-2xs rounded-t border-t border-x transition-colors shrink-0 ${active ? 'bg-white dark:bg-app border-gray-200 dark:border-edge-subtle text-primary-600 dark:text-primary-400 font-medium' : 'border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover'}`}
            >
              <button type="button" onClick={() => openSubview(sv)} className="shrink-0">
                {t(SUBVIEW_KEYS[sv] ?? `workbench:subview.${sv}`, SUBVIEW_LABEL_FALLBACK[sv] ?? sv)}
              </button>
              {openedSubviews.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const next = openedSubviews.filter((x) => x !== sv)
                    setOpenedSubviews(next)
                    if (active) openSubview(next[next.length - 1] ?? 'main')
                  }}
                  className="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title={t('workbench:closeTab')}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* AL-M4h：二级页签右键菜单 */}
      {subviewCtx && (
        <div
          className="fixed z-[9999] bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{ left: subviewCtx.x, top: subviewCtx.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { batchCloseSubviews('this', subviewCtx.sv); setSubviewCtx(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300">
            {t('welcome.closeTab')}
          </button>
          <button onClick={() => { batchCloseSubviews('others', subviewCtx.sv); setSubviewCtx(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300">
            {t('welcome.closeOthers')}
          </button>
          <button onClick={() => { batchCloseSubviews('right', subviewCtx.sv); setSubviewCtx(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300">
            {t('welcome.closeRight')}
          </button>
          <div className="my-1 border-t border-gray-200 dark:border-edge-subtle" />
          <button onClick={() => { batchCloseSubviews('all', subviewCtx.sv); setSubviewCtx(null) }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300">
            {t('welcome.closeAll')}
          </button>
        </div>
      )}

      {/* 内容区（AL-M4c keep-alive：激活页签 + 最近 N 挂载,超限非激活卸载释放内存）
          M1 修复：激活子视图补 h-full，恢复 TopologyTab 高度链（否则画布高度坍缩为 0、fit 失效） */}
      <div className="flex-1 overflow-auto p-4">
        {openedSubviews.map((sv) => {
          const mounted = mountedSubviews.has(sv)
          if (!mounted) return null
          return (
            <div key={sv} className={sv === subview ? 'h-full' : 'hidden'}>
              {renderSubview(sv)}
            </div>
          )
        })}
      </div>
    </div>
  )

  function renderSubview(sv: WorkbenchSubview): React.ReactNode {
    // 闭包内 TS 不继承外层 early-return 的收窄；early-return 已保证非空
    const project = selectedProjectName!
    switch (sv) {
      case 'main':
        return (
          <>
            <div className="bg-white dark:bg-app-elevated border border-gray-200 dark:border-edge-subtle rounded-lg p-4 mb-4 flex items-center gap-4">
              <div className="p-2 rounded-lg bg-warning-100 dark:bg-warning-900/30">
                <FolderOpen size={20} className="text-warning-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{selectedProjectName}</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('workbench:name')}</div>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <Settings size={14} className="text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400">{t('workbench:status')}:</span>
                <span className="inline-block px-2 py-0.5 text-2xs rounded bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300 font-medium">Ready</span>
              </div>
            </div>
            {/* 打磨轮（v1.6 收尾）：5 卡→三步 步骤分组 */}
            <StepLabel n="①" text={t('workbench:stepConfig', '配置与就绪')} />
            <div className="rounded-lg bg-gray-50/70 dark:bg-app/40 border border-gray-100 dark:border-edge-subtle border-t-2 border-t-primary-200 dark:border-t-primary-700 p-3 grid grid-cols-2 gap-3 mb-4">
              <WorkbenchScopeCard />
              <WorkbenchReadinessCard />
            </div>
            <StepLabel n="②" text={t('workbench:stepRender', '渲染材料与操作')} />
            <div className="rounded-lg bg-gray-50/70 dark:bg-app/40 border border-gray-100 dark:border-edge-subtle border-t-2 border-t-primary-200 dark:border-t-primary-700 p-3 grid grid-cols-2 gap-3 mb-4">
              <WorkbenchOutputCard />
              <WorkbenchActionCard />
            </div>
            <StepLabel n="③" text={t('workbench:stepResult', '渲染结果')} />
            <div className="rounded-lg bg-gray-50/70 dark:bg-app/40 border border-gray-100 dark:border-edge-subtle border-t-2 border-t-primary-200 dark:border-t-primary-700 p-3">
              <WorkbenchResultCard />
            </div>
          </>
        )
      case 'aidc':
        return (
          <div>
            {!isAidc && (
              <div className="mb-3 p-3 border rounded bg-warning-50/60 dark:bg-warning-900/20 text-xs text-gray-600 dark:text-gray-300">
                {t('workbench:aidcCreate.notAidcProject')}
              </div>
            )}
            <div className="flex items-center gap-3 mb-3">
              <button type="button" onClick={() => setShowAidcWizard(true)}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white">
                <Plus size={12} /> {t('workbench:aidcCreate.create')}
              </button>
              <span className="text-2xs text-gray-500 dark:text-gray-400">{t('workbench:aidcCreate.hint')}</span>
            </div>
            {/* AL-M5a：AIDC 新建并入 CreateProjectWizardModal */}
            {showAidcWizard && (
              <CreateProjectWizardModal
                defaultAidc
                onClose={() => { setShowAidcWizard(false); handleAidcWizardCreated() }}
              />
            )}
            <AidcPlannerPanel boundProjectName={project} />
          </div>
        )
      case 'results':
        return <OutputResultsView projectName={project} />
      case 'design':
        return <DesignTab />
      case 'visualization':
        return <TopologyTab />
      case 'roomdesign':
        return <RoomDesignTab projectName={project} />
      case 'rackdesign':
        return <RackDesignTab projectName={project} />
      case 'export':
        return <ExportView projectName={project} />
    }
  }
}
