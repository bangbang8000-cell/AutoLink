import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, FolderOpen, Settings, Plus, Download, FileCheck2, RefreshCw, FolderOpen as FolderIcon } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useRenderStore } from '@/stores/render.store'
import { useUIStore } from '@/stores/ui.store'
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
import { useToastStore } from '@/stores/toast.store'

/** 打磨轮（v1.2 / AL-2）：渲染结果查看（按项目输出批次，参考 MC OutputPanel） */
function RenderResultsView({ projectName }: { projectName: string }) {
  const addToast = useToastStore((s) => s.addToast)
  const [batches, setBatches] = useState<Array<{ name: string; files: Array<{ name: string; path: string }> }>>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    window.electron.project.listOutputBatches(projectName)
      .then((b) => setBatches((b as Array<{ name: string; files: Array<{ name: string; path: string }> }>) || []))
      .catch(() => setBatches([]))
  }, [projectName])

  useEffect(() => { refresh() }, [refresh])

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
        <FileCheck2 size={14} className="text-info-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">渲染结果 — {projectName}</span>
        <button type="button" onClick={refresh}
          className="ml-auto flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover">
          <RefreshCw size={11} /> 刷新
        </button>
        <button type="button" onClick={() => exportBatch(undefined)} disabled={busy || batches.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-40">
          <Download size={11} /> 导出全部渲染结果
        </button>
      </div>
      <p className="text-2xs text-gray-400">每次渲染按时间戳生成一个批次目录（output/&lt;时间戳&gt;/），可单独导出或全部打包。</p>

      {batches.length === 0 ? (
        <p className="text-2xs text-gray-400 border rounded p-4 text-center">暂无渲染结果（在「常规渲染」执行一键渲染后生成）</p>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => (
            <div key={b.name} className="border rounded overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-app/50 text-xs font-medium text-gray-600 dark:text-gray-300">
                <FolderIcon size={12} className="text-gray-400" />
                {b.name}
                <span className="text-2xs text-gray-400">{b.files.length} 个文件</span>
                <div className="ml-auto flex items-center gap-1">
                  <button type="button" onClick={() => exportBatch(b.name)} disabled={busy}
                    className="flex items-center gap-1 px-2 py-0.5 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover">
                    <Download size={10} /> 导出批次
                  </button>
                </div>
              </div>
              {b.files.length > 0 && (
                <div className="px-3 py-1.5 space-y-0.5">
                  {b.files.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 text-2xs font-mono text-gray-500 dark:text-gray-400">
                      <span>·</span>
                      <span>{f.name}</span>
                      <span className="ml-auto text-gray-300 dark:text-gray-600">{f.path}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 打磨轮（v1.4）：机柜子视图——机房矩阵（定义/默认配比自动布点）+ 逐柜微调（RackTab） */
function RackWorkbenchView({ projectName }: { projectName: string }) {
  const addToast = useToastStore((s) => s.addToast)
  const matrix = useRoomStore((s) => s.matrix)
  const loadMatrix = useRoomStore((s) => s.loadMatrix)
  const createMatrix = useRoomStore((s) => s.createMatrix)
  const composeDefaults = useRoomStore((s) => s.composeDefaults)
  const cabinets = useRackStore((s) => s.cabinets)
  const gpuCount = useDesignStore((s) => s.config.num_servers)
  const [rowsInput, setRowsInput] = useState('10')
  const [colsInput, setColsInput] = useState('15')

  useEffect(() => {
    loadMatrix(projectName).catch(() => {})
  }, [projectName, loadMatrix])

  const createMtx = async () => {
    const rows: string[] = []
    const n = Math.max(1, Number(rowsInput) || 1)
    for (let i = 0; i < n; i++) rows.push(String.fromCharCode(65 + i)) // A, B, C…
    const cols = Array.from({ length: Math.max(1, Number(colsInput) || 1) }, (_, i) => i + 1)
    const ok = await createMatrix(projectName, rows, cols)
    if (ok) {
      addToast('success', '机柜矩阵已创建，可「自动布点默认配比」', 5000)
      await loadMatrix(projectName)
    } else {
      addToast('error', '矩阵创建失败', 5000)
    }
  }

  const autoCompose = () => {
    if (!matrix) {
      addToast('warning', '请先定义机柜矩阵（排/列）', 4000)
      return
    }
    const net = Math.max(4, cabinets.filter((c) => c.type === 'network').length)
    composeDefaults({ gpuCount: gpuCount || 64, networkCount: net })
    addToast('success', '已按默认配比布点（每列 1 电源 + 空调 + GPU(1柜1台) + 网络），可微调', 5000)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">机柜（机房矩阵 + 逐柜）</span>
        {matrix ? (
          <>
            <span className="text-2xs text-gray-400">矩阵 {matrix.rows.length}排×{matrix.cols.length}列</span>
            <button type="button" onClick={autoCompose}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover">
              <Download size={11} /> 自动布点默认配比
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <label className="text-2xs text-gray-400">排数
              <input className="w-12 ml-1 px-1 py-0.5 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app"
                value={rowsInput} onChange={(e) => setRowsInput(e.target.value)} />
            </label>
            <label className="text-2xs text-gray-400">列数
              <input className="w-12 ml-1 px-1 py-0.5 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app"
                value={colsInput} onChange={(e) => setColsInput(e.target.value)} />
            </label>
            <button type="button" onClick={createMtx}
              className="px-2 py-1 text-2xs rounded bg-primary-500 hover:bg-primary-600 text-white">创建矩阵</button>
          </div>
        )}
      </div>
      <RackTab cabinetId={null} />
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
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const selectProject = useProjectStore((s) => s.selectProject)
  const addToast = useToastStore((s) => s.addToast)
  const progress = useRenderStore((s) => s.progress)
  const isRendering = progress.status === 'rendering'
  const subview = useUIStore((s) => s.workbenchSubview)
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)

  const [aidcProjects, setAidcProjects] = useState<string[]>([])
  const [newAidcName, setNewAidcName] = useState('')
  const [creating, setCreating] = useState(false)

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
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <Zap size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">{t('workbench:title')}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('workbench:noProject')}</p>
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

      {/* 打磨轮（v1.2）：子视图切换按钮已移至中栏（WorkbenchExplorer）；工作区仅渲染对应界面 */}

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-4">
        {/* ===== 常规渲染 ===== */}
        {subview === 'main' && (
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

            <div className="grid grid-cols-2 gap-4 mb-4">
              <WorkbenchScopeCard />
              <WorkbenchReadinessCard />
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <WorkbenchOutputCard />
              <WorkbenchActionCard />
            </div>

            {isRendering && (
              <div className="mb-4 space-y-1.5">
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                    {progress.message}
                  </span>
                  <span className="font-medium tabular-nums">{progress.progress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-300"
                    style={{ width: `${progress.progress}%` }} />
                </div>
              </div>
            )}

            <div>
              <WorkbenchResultCard />
            </div>
          </>
        )}

        {/* ===== AIDC 规划 ===== */}
        {subview === 'aidc' && (
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
            <AidcPlannerPanel boundProjectName={selectedProjectName} />
          </div>
        )}

        {/* ===== 设计 ===== */}
        {/* ===== 渲染结果 ===== */}
        {subview === 'results' && <RenderResultsView projectName={selectedProjectName} />}

        {subview === 'design' && <DesignTab />}

        {/* ===== 可视化 ===== */}
        {subview === 'visualization' && <TopologyTab />}

        {/* ===== 机柜（v1.4：机房矩阵默认配比 + RackTab 微调） ===== */}
        {subview === 'rack' && <RackWorkbenchView projectName={selectedProjectName} />}

        {/* ===== 归档/导出（v1.3） ===== */}
        {subview === 'export' && <ExportView projectName={selectedProjectName} />}
      </div>
    </div>
  )
}
