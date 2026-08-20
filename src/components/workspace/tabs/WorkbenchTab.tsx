import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, FolderOpen, Settings, Plus, Download, FileCheck2, X } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { useDesignStore } from '@/stores/design.store'
import { WorkbenchScopeCard } from '@/components/workbench/WorkbenchScopeCard'
import { WorkbenchReadinessCard } from '@/components/workbench/WorkbenchReadinessCard'
import { WorkbenchOutputCard } from '@/components/workbench/WorkbenchOutputCard'
import { WorkbenchActionCard } from '@/components/workbench/WorkbenchActionCard'
import { WorkbenchResultCard } from '@/components/workbench/WorkbenchResultCard'
import { AidcPlannerPanel } from '@/components/aidc/AidcPlannerPanel'
import { DesignTab } from '@/components/workspace/tabs/DesignTab'
import { TopologyTab } from '@/components/workspace/tabs/TopologyTab'
import { RackTab } from '@/components/workspace/tabs/RackTab'
import { DataCenterLayout } from '@/components/datacenter/DataCenterLayout'
import { OutputResultsView } from '@/components/workbench/OutputResultsView'
import { useToastStore } from '@/stores/toast.store'

/** 打磨轮（v1.6 收尾）：工作台步骤分组标签（5 卡→三步） */
function StepLabel({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="px-1.5 py-0.5 text-2xs rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-semibold">{n}</span>
      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{text}</span>
    </div>
  )
}

/** 打磨轮（v1.6 / AL-T1b）：工作台二级页签标签（对齐 v1.6 命名） */
const SUBVIEW_LABELS: Record<string, string> = {
  aidc: 'AIDC 规划',
  design: '组网设计',
  rack: '机柜设计',
  main: '组网渲染',
  visualization: '拓扑',
  results: '本项目输出',
  export: '导出',
}

/** 打磨轮（v1.4）：机柜子视图——平面矩阵一览（DataCenterLayout）+ 逐柜微调（RackTab），双向联动 */
function RackWorkbenchView({ projectName }: { projectName: string }) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const matrix = useRoomStore((s) => s.matrix)
  const loadMatrix = useRoomStore((s) => s.loadMatrix)
  const createMatrix = useRoomStore((s) => s.createMatrix)
  const composeDefaults = useRoomStore((s) => s.composeDefaults)
  const selectedPosition = useRoomStore((s) => s.selectedPosition)
  const selectPosition = useRoomStore((s) => s.selectPosition)
  const syncCabinetToCell = useRoomStore((s) => s.syncCabinetToCell)
  const cabinets = useRackStore((s) => s.cabinets)
  const selectedCabinetId = useRackStore((s) => s.selectedCabinetId)
  const selectCabinet = useRackStore((s) => s.selectCabinet)
  const optimizeRacks = useRackStore((s) => s.optimizeRacks)
  const gpuCount = useDesignStore((s) => s.config.num_servers)
  const topology = useDesignStore((s) => s.topology)
  const [rowsInput, setRowsInput] = useState('10')
  const [colsInput, setColsInput] = useState('15')
  // 打磨轮（v1.5 / AL-R1a）：两段式——①机房-机柜布局 ②柜内设备布放
  const [segment, setSegment] = useState<'layout' | 'racks'>('layout')

  useEffect(() => {
    loadMatrix(projectName).catch(() => {})
  }, [projectName, loadMatrix])

  // 打磨轮（v1.4 / AL-R2b 联动 A，v1.5 增强）：矩阵选中格（有已上架机柜）→ RackTab 选中对应机柜
  // 并自动切到「②柜内设备布放」段呈现（等值守卫防死循环）
  useEffect(() => {
    if (!selectedPosition) return
    const cell = matrix?.cells.find((c) => `${c.row}${c.col}` === selectedPosition)
    if (cell?.cabinetId != null) {
      if (cell.cabinetId !== selectedCabinetId) selectCabinet(cell.cabinetId)
      setSegment('racks')
    }
  }, [selectedPosition, matrix, selectedCabinetId, selectCabinet])

  // 打磨轮（v1.4 / AL-R2b 联动 B）：RackTab 选中机柜 → 矩阵高亮对应格
  useEffect(() => {
    if (selectedCabinetId == null) return
    const cell = matrix?.cells.find((c) => c.cabinetId === selectedCabinetId)
    if (cell) {
      const pos = `${cell.row}${cell.col}`
      if (pos !== selectedPosition) selectPosition(pos)
    }
  }, [selectedCabinetId, matrix, selectedPosition, selectPosition])

  // 打磨轮（v1.4 / AL-R2b 联动 C）：RackTab 改柜类型 → 回写矩阵格类型（syncCabinetToCell 内等值守卫收敛）
  useEffect(() => {
    if (!matrix) return
    for (const cab of cabinets) syncCabinetToCell(cab.id)
  }, [cabinets, matrix, syncCabinetToCell])

  const createMtx = async () => {
    const rows: string[] = []
    const n = Math.max(1, Number(rowsInput) || 1)
    for (let i = 0; i < n; i++) rows.push(String.fromCharCode(65 + i)) // A, B, C…
    const cols = Array.from({ length: Math.max(1, Number(colsInput) || 1) }, (_, i) => i + 1)
    const ok = await createMatrix(projectName, rows, cols)
    if (ok) {
      addToast('success', t('rack:matrixCreated', '机柜矩阵已创建，可「自动布点默认配比」'), 5000)
      await loadMatrix(projectName)
    } else {
      addToast('error', t('rack:matrixCreateFailed', '矩阵创建失败'), 5000)
    }
  }

  const autoCompose = () => {
    if (!matrix) {
      addToast('warning', t('rack:needMatrixFirst', '请先定义机柜矩阵（排/列）'), 4000)
      return
    }
    const net = Math.max(4, cabinets.filter((c) => c.type === 'network').length)
    composeDefaults({ gpuCount: gpuCount || 64, networkCount: net })
    addToast('success', t('rack:autoComposed', '已按默认配比布点（每列 1 电源 + 空调 + GPU(1柜1台) + 网络），可微调'), 5000)
  }

  // 打磨轮（v1.4 / AL-R2c）：按矩阵自动落位（通用入口，用设计拓扑节点；AIDC 应用到设计亦自动触发）
  const applyMatrix = async () => {
    const nodes = topology?.nodes
    if (!nodes || nodes.length === 0) {
      addToast('warning', t('rack:needTopologyFirst', '请先生成拓扑（「设计」子视图生成，或 AIDC 规划「应用到设计」）'), 4000)
      return
    }
    await useRoomStore.getState().applyMatrixRackLayout(projectName, nodes)
  }

  const saveAll = async () => {
    await useRoomStore.getState().saveMatrix(projectName)
    await useRackStore.getState().saveRackLayout(projectName)
    addToast('success', t('rack:savedAll', '机房矩阵与机柜布局已保存'), 3000)
  }

  // 打磨轮（v1.5 / AL-R1b）：柜内智能落位（待上架池 → 现有柜 U 位）
  const runRackOptimize = async () => {
    const res = await optimizeRacks(1)
    if (res && (res.stats?.placed ?? 0) > 0) {
      await useRackStore.getState().saveRackLayout(projectName)
    }
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* 工具行 */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('rack:rackDesign')}</span>
        {/* 两段式切换（v1.5 / AL-R1a） */}
        <div className="flex items-center bg-white dark:bg-app border border-gray-200 dark:border-gray-600 rounded overflow-hidden">
          <button type="button" onClick={() => setSegment('layout')}
            className={`px-2.5 py-1 text-xs transition-colors ${segment === 'layout' ? 'bg-primary-500 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'}`}>
            {t('rack:segmentLayout')}
          </button>
          <button type="button" onClick={() => setSegment('racks')}
            className={`px-2.5 py-1 text-xs transition-colors ${segment === 'racks' ? 'bg-primary-500 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'}`}>
            {t('rack:segmentRacks')}
          </button>
        </div>
        {matrix ? (
          <>
            <span className="text-2xs text-gray-400">矩阵 {matrix.rows.length}排×{matrix.cols.length}列</span>
            <button type="button" onClick={autoCompose}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover">
              <Download size={11} /> {t('rack:autoCompose')}
            </button>
            <button type="button" onClick={applyMatrix}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-primary-300 dark:border-primary-600 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20">
              <Download size={11} /> {t('rack:applyMatrix')}
            </button>
            <button type="button" onClick={runRackOptimize}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-violet-300 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20">
              <Download size={11} /> {t('rack:rackOptimize')}
            </button>
            <button type="button" onClick={saveAll}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-green-600 hover:bg-green-700 text-white">
              <FileCheck2 size={11} /> {t('common:save', '保存')}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <label className="text-2xs text-gray-400">{t('rack:room.rows', '排数')}
              <input className="w-12 ml-1 px-1 py-0.5 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app"
                value={rowsInput} onChange={(e) => setRowsInput(e.target.value)} />
            </label>
            <label className="text-2xs text-gray-400">{t('rack:room.cols', '列数')}
              <input className="w-12 ml-1 px-1 py-0.5 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app"
                value={colsInput} onChange={(e) => setColsInput(e.target.value)} />
            </label>
            <button type="button" onClick={createMtx}
              className="px-2 py-1 text-2xs rounded bg-primary-500 hover:bg-primary-600 text-white">{t('rack:room.create', '创建矩阵')}</button>
          </div>
        )}
      </div>

      {/* 段一：机房-机柜布局设计（平面矩阵） */}
      {segment === 'layout' && (
        <div className="flex-1 min-h-0 rounded border overflow-hidden bg-white dark:bg-app">
          {matrix ? (
            <DataCenterLayout />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-gray-400 p-6">
              请先在上方定义机柜矩阵（排/列）→「自动布点默认配比」→ 布局/标记/拖拽上架
            </div>
          )}
        </div>
      )}

      {/* 段二：柜内设备布放设计（RackTab 逐柜微调 + 智能落位） */}
      {segment === 'racks' && (
        <div className="flex-1 min-h-0 rounded border overflow-hidden bg-white dark:bg-app">
          <RackTab cabinetId={null} />
        </div>
      )}
    </div>
  )
}

/** 打磨轮（v1.3）：归档/导出子视图（导出给 MC + 渲染结果） */
function ExportView({ projectName }: { projectName: string }) {
  const addToast = useToastStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)
  const exportBatch = async (batch?: string) => {
    setBusy(true)
    try {
      const res = await window.electron.render.exportOutput(projectName, batch)
      if (res?.canceled) return
      if (res?.ok) addToast('success', `已导出 → ${res.path}`)
    } catch (e) {
      addToast('error', `导出失败: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Download size={14} className="text-success-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">归档 / 导出 — {projectName}</span>
      </div>
      <div className="border rounded p-3 space-y-1.5">
        <p className="text-2xs text-gray-500">导出给 MagicCommander（AIDC 交付包）</p>
        <p className="text-2xs text-gray-400">请在「AIDC 规划」视图导出 plan.json / 交付包 ZIP / 规划 Excel / 拓扑 PNG（含项目编号与版本）。</p>
      </div>
      <div className="border rounded p-3 space-y-2">
        <p className="text-2xs text-gray-500">导出渲染结果（output 批次）</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => exportBatch(undefined)} disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-40">
            <Download size={12} /> 导出全部渲染结果（ZIP）
          </button>
        </div>
        <p className="text-2xs text-gray-400">在「渲染结果」视图可单独导出某个批次。</p>
      </div>
    </div>
  )
}

export function WorkbenchTab() {
  const { t } = useTranslation()
  const projects = useProjectStore((s) => s.projects)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const selectProject = useProjectStore((s) => s.selectProject)
  const addToast = useToastStore((s) => s.addToast)
  const subview = useUIStore((s) => s.workbenchSubview)
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)

  const [aidcProjects, setAidcProjects] = useState<string[]>([])
  const [newAidcName, setNewAidcName] = useState('')
  const [creating, setCreating] = useState(false)
  // 打磨轮（v1.6 / AL-T1a）：工作台二级页签——访问过的子视图保留（keep-alive 保留状态）
  const [openedSubviews, setOpenedSubviews] = useState<WorkbenchSubview[]>(['main'])

  // 打开新子视图 → 记入二级页签
  useEffect(() => {
    setOpenedSubviews((prev) => (prev.includes(subview) ? prev : [...prev, subview]))
  }, [subview])

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
  useEffect(() => {
    if (selectedProjectName) setWorkbenchSubview('main')
  }, [selectedProjectName, setWorkbenchSubview])

  // AL-A5：工作台内新建 AIDC 项目（默认 64 台参数，后续向导版见 P-B）
  const createAidcProject = useCallback(async () => {
    const name = newAidcName.trim()
    if (!name) { addToast('warning', '请输入项目名'); return }
    setCreating(true)
    try {
      const res = await window.electron.aidc.project.create(name, {
        gpu_count: 64, site: 'BJ01', pfc_queue: 3, cnp_queue: 6,
      })
      if (res?.error) { addToast('error', `新建失败: ${res.error}`); return }
      addToast('success', `已新建 AIDC 项目 ${name}（v1）`)
      setNewAidcName('')
      await window.electron.project.list().then((list) => {
        const item = (list as Array<{ id: number; name: string; index: number }>)?.find((p) => p.name === name)
        if (item) selectProject(item)
      })
      setAidcProjects((prev) => (prev.includes(name) ? prev : [...prev, name]))
    } catch (e) {
      addToast('error', `新建失败: ${String(e)}`)
    } finally {
      setCreating(false)
    }
  }, [newAidcName, addToast, selectProject])

  if (!selectedProjectName) {
    // 打磨轮（v1.6 / AL-N1a）：无项目 → 项目引导面板（选择默认项目 / 引导到项目面板新建导入）
    return (
      <div className="h-full overflow-auto p-6">
        <div className="max-w-md mx-auto mt-10">
          <div className="flex flex-col items-center text-center mb-6">
            <Zap size={40} className="text-primary-400 mb-2" />
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">欢迎使用 AutoLink</p>
            <p className="text-xs text-gray-400 mt-1">选择一个项目开始组网设计；或到「项目」面板新建/导入模板。</p>
          </div>
          {projects.length > 0 && (
            <div className="mb-4">
              <p className="text-2xs font-medium text-gray-500 dark:text-gray-400 mb-2">选择一个项目作为当前项目：</p>
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
              onClick={() => setActiveActivity('project')}
              className="px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
            >
              前往项目面板（新建 / 导入）
            </button>
          </div>
          {projects.length === 0 && (
            <p className="text-center text-2xs text-gray-400 mt-3">暂无项目，请在「项目」面板新建或从模板导入。</p>
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
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {selectedProjectName}
        </span>
      </div>

      {/* 打磨轮（v1.6 / AL-T1b）：工作台二级页签栏（访问过的子视图保留，快速切换/关闭） */}
      <div className="flex items-center gap-0.5 px-3 py-1 border-b border-gray-200 dark:border-edge-subtle bg-gray-50/60 dark:bg-app/40 overflow-x-auto shrink-0">
        {openedSubviews.map((sv) => {
          const active = sv === subview
          return (
            <div
              key={sv}
              className={`flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-2xs rounded-t border-t border-x transition-colors shrink-0 ${active ? 'bg-white dark:bg-app border-gray-200 dark:border-edge-subtle text-primary-600 dark:text-primary-400 font-medium' : 'border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover'}`}
            >
              <button type="button" onClick={() => setWorkbenchSubview(sv)} className="shrink-0">
                {SUBVIEW_LABELS[sv] ?? sv}
              </button>
              {openedSubviews.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const next = openedSubviews.filter((x) => x !== sv)
                    setOpenedSubviews(next)
                    if (active) setWorkbenchSubview(next[next.length - 1] ?? 'main')
                  }}
                  className="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title="关闭"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* 内容区（keep-alive：隐藏非激活页签，保留各子视图状态） */}
      <div className="flex-1 overflow-auto p-4">
        {openedSubviews.map((sv) => (
          <div key={sv} className={sv === subview ? '' : 'hidden'}>
            {renderSubview(sv)}
          </div>
        ))}
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
            <div className="grid grid-cols-2 gap-4 mb-4">
              <WorkbenchScopeCard />
              <WorkbenchReadinessCard />
            </div>
            <StepLabel n="②" text={t('workbench:stepRender', '渲染材料与操作')} />
            <div className="grid grid-cols-2 gap-4 mb-4">
              <WorkbenchOutputCard />
              <WorkbenchActionCard />
            </div>
            <StepLabel n="③" text={t('workbench:stepResult', '渲染结果')} />
            <div>
              <WorkbenchResultCard />
            </div>
          </>
        )
      case 'aidc':
        return (
          <div>
            {!isAidc && (
              <div className="mb-3 p-3 border rounded bg-warning-50/60 dark:bg-warning-900/20 text-xs text-gray-600 dark:text-gray-300">
                当前项目不是 AIDC 规划类项目。可在下方新建，或在「项目浏览器」新建项目时选择「包含 AIDC 规划参数」。
              </div>
            )}
            <div className="flex items-center gap-2 mb-3">
              <input
                value={newAidcName}
                onChange={(e) => setNewAidcName(e.target.value)}
                placeholder="新 AIDC 项目名（默认 64 台·BJ01）"
                className="text-xs rounded border bg-white dark:bg-app px-2 py-1 flex-1 max-w-[280px]"
              />
              <button type="button" onClick={createAidcProject} disabled={creating}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50">
                <Plus size={12} /> 新建 AIDC 项目
              </button>
            </div>
            <AidcPlannerPanel boundProjectName={project} />
          </div>
        )
      case 'results':
        return <OutputResultsView projectName={project} />
      case 'design':
        return <DesignTab />
      case 'visualization':
        return <TopologyTab />
      case 'rack':
        return <RackWorkbenchView projectName={project} />
      case 'export':
        return <ExportView projectName={project} />
    }
  }
}
