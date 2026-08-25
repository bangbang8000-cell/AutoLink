import { useCallback, useEffect, useMemo, useState } from 'react'
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

/** 打磨轮（v1.6 / AL-T1b）：工作台二级页签标签（对齐 v1.6 命名） */
const SUBVIEW_KEYS: Record<string, string> = {
  aidc: 'workbench:subview.aidc',
  design: 'workbench:subview.design',
  rack: 'workbench:subview.rack',
  main: 'workbench:subview.main',
  visualization: 'workbench:subview.visualization',
  results: 'workbench:subview.results',
  export: 'workbench:subview.export',
}

// AL-M4c: 工作台二级页签保活上限——最多同时保持 N 个非激活子视图挂载,超限卸载释放内存
const KEEP_ALIVE_LIMIT = 5

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
            <span className="text-2xs text-gray-400">{t('rack:matrixSummary', { rows: matrix.rows.length, cols: matrix.cols.length, defaultValue: '矩阵 {{rows}}排×{{cols}}列' })}</span>
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
              {t('workbench:rackMatrixEmpty')}
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
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)
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
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Download size={14} className="text-success-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('workbench:exportView.title', { name: projectName })}</span>
      </div>
      <div className="border rounded p-3 space-y-1.5">
        <p className="text-2xs text-gray-500">{t('workbench:exportView.toMc')}</p>
        <p className="text-2xs text-gray-400">{t('workbench:exportView.toMcHint')}</p>
      </div>
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
        setWorkbenchSubview(next[next.length - 1] ?? 'main')
      } else if (sv === subview && next.length === 0) {
        setWorkbenchSubview('main')
      }
      return next
    })
  }, [subview, setOpenedSubviews, setWorkbenchSubview])

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
      setWorkbenchSubview('main')
      setOpenedSubviews(['main'])
    }
  }, [selectedProjectName, setWorkbenchSubview])

  // AL-A5：工作台内新建 AIDC 项目（默认 64 台参数，后续向导版见 P-B）
  const createAidcProject = useCallback(async () => {
    const name = newAidcName.trim()
    if (!name) { addToast('warning', t('workbench:aidcCreate.pleaseEnterName')); return }
    setCreating(true)
    try {
      const res = await window.electron.aidc.project.create(name, {
        gpu_count: 64, site: 'BJ01', pfc_queue: 3, cnp_queue: 6,
      })
      if (res?.error) { addToast('error', t('workbench:aidcCreate.failed', { err: res.error })); return }
      addToast('success', t('workbench:aidcCreate.created', { name }))
      setNewAidcName('')
      await window.electron.project.list().then((list) => {
        const item = (list as Array<{ id: number; name: string; index: number }>)?.find((p) => p.name === name)
        if (item) selectProject(item)
      })
      setAidcProjects((prev) => (prev.includes(name) ? prev : [...prev, name]))
    } catch (e) {
      addToast('error', t('workbench:aidcCreate.failed', { err: String(e) }))
    } finally {
      setCreating(false)
    }
  }, [newAidcName, addToast, selectProject, t])

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
              onClick={() => setActiveActivity('project')}
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
              onContextMenu={(e) => {
                e.preventDefault()
                setSubviewCtx({ sv, x: e.clientX, y: e.clientY })
              }}
              className={`flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-2xs rounded-t border-t border-x transition-colors shrink-0 ${active ? 'bg-white dark:bg-app border-gray-200 dark:border-edge-subtle text-primary-600 dark:text-primary-400 font-medium' : 'border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover'}`}
            >
              <button type="button" onClick={() => setWorkbenchSubview(sv)} className="shrink-0">
                {t(SUBVIEW_KEYS[sv] ?? `workbench:subview.${sv}`, sv)}
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

      {/* 内容区（AL-M4c keep-alive：激活页签 + 最近 N 挂载,超限非激活卸载释放内存） */}
      <div className="flex-1 overflow-auto p-4">
        {openedSubviews.map((sv) => {
          const mounted = mountedSubviews.has(sv)
          if (!mounted) return null
          return (
            <div key={sv} className={sv === subview ? '' : 'hidden'}>
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
            <div className="flex items-center gap-2 mb-3">
              <input
                value={newAidcName}
                onChange={(e) => setNewAidcName(e.target.value)}
                placeholder={t('workbench:aidcCreate.placeholder')}
                className="text-xs rounded border bg-white dark:bg-app px-2 py-1 flex-1 max-w-[280px]"
              />
              <button type="button" onClick={createAidcProject} disabled={creating}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50">
                <Plus size={12} /> {t('workbench:aidcCreate.create')}
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
