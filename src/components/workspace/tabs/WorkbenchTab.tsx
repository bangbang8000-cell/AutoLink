import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, FolderOpen, Settings, Cpu, Plus } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useRenderStore } from '@/stores/render.store'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'
import { WorkbenchScopeCard } from '@/components/workbench/WorkbenchScopeCard'
import { WorkbenchReadinessCard } from '@/components/workbench/WorkbenchReadinessCard'
import { WorkbenchOutputCard } from '@/components/workbench/WorkbenchOutputCard'
import { WorkbenchActionCard } from '@/components/workbench/WorkbenchActionCard'
import { WorkbenchResultCard } from '@/components/workbench/WorkbenchResultCard'
import { AidcPlannerPanel } from '@/components/aidc/AidcPlannerPanel'
import { DesignTab } from '@/components/workspace/tabs/DesignTab'
import { TopologyTab } from '@/components/workspace/tabs/TopologyTab'
import { useToastStore } from '@/stores/toast.store'
import clsx from 'clsx'

const SUBVIEWS: Array<{ id: WorkbenchSubview; label: string }> = [
  { id: 'main', label: '常规渲染' },
  { id: 'aidc', label: 'AIDC 规划' },
  { id: 'design', label: '设计' },
  { id: 'visualization', label: '可视化' },
]

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

      {/* 打磨轮（P-A）：子视图切换 */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        {SUBVIEWS.map((s) => (
          <button key={s.id} type="button" onClick={() => setWorkbenchSubview(s.id)}
            className={clsx('px-3 py-1 text-xs rounded transition-colors',
              subview === s.id
                ? 'bg-primary-500 text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-app-hover',
              // 非 AIDC 项目：AIDC 规划按钮置灰（仍可点入查看/新建）
              s.id === 'aidc' && !isAidc && subview !== 'aidc' && 'opacity-40')}
            title={s.id === 'aidc' && !isAidc ? '当前项目非 AIDC 规划类（可点入新建 AIDC 项目）' : undefined}>
            {s.id === 'aidc' ? <Cpu size={12} className="inline mr-1" /> : null}
            {s.label}
          </button>
        ))}
      </div>

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
        {subview === 'design' && <DesignTab />}

        {/* ===== 可视化 ===== */}
        {subview === 'visualization' && <TopologyTab />}
      </div>
    </div>
  )
}
