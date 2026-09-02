import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Eye, Trash2, Loader2, Download } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRoomStore } from '@/stores/room.store'
import { useRenderStore } from '@/stores/render.store'
import { useUIStore } from '@/stores/ui.store'
import { useToastStore } from '@/stores/toast.store'
import { exportTopologyViewPng } from '@/utils/exportTopologyView'
import { roomLayoutArt, rackElevationSvg, rackElevationSize, svgToPngBase64 } from '@/utils/exportGraphics'
import { summarizeBatch, type BatchItemResult } from '@/utils/batchOps'

// V2.9.1-T4: IPC 动态返回结构类型化（避免 any）
interface RenderProgressData {
  status?: 'start' | 'complete' | 'error'
  message?: string
  progress?: number
}

// 打磨轮（v1.5 / AL-O1c）：由后端 Python 生成的材料类型（一次 export 调用合并）
const PYTHON_TYPES = ['connections', 'deviceList', 'cablingGuide', 'bom', 'pdfReport']

export function WorkbenchActionCard() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const topology = useDesignStore((s) => s.topology)
  // 2026-08-24（修复）：导出组网拓扑图时带上 topology.json 保存的布局，内容与拓扑视图一致
  const savedLayout = useDesignStore((s) => s.layout)
  const designValid = useDesignStore((s) => s.valid)
  const cabinets = useRackStore((s) => s.cabinets)
  const matrix = useRoomStore((s) => s.matrix)
  const exportToExcel = useRackStore((s) => s.exportToExcel)
  const {
    progress, selectedOutputTypes, batchMode, batchProjects, batchSummary, batchExportProgress,
    setProgress, addResult, clearResults, resetProgress, deleteOutput,
    setBatchSummary, setBatchExportProgress,
  } = useRenderStore()
  const addToast = useToastStore((s) => s.addToast)
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)
  const [batchExporting, setBatchExporting] = useState(false)

  const isRendering = progress.status === 'rendering'
  // 打磨轮（v1.6 / AL-N1d）：依赖门禁——组网设计有拓扑产出即可渲染（软门禁）；
  // 机柜设计未就绪时提示，不硬置灰
  const designReady = designValid === true || (topology?.nodes?.length ?? 0) > 0
  const rackReady = !!matrix && cabinets.length > 0
  const renderGate = designReady
  const cleanupRef = useRef<(() => void) | null>(null)
  const prevStatusRef = useRef(progress.status)

  // When rendering completes, refresh project list and toast
  useEffect(() => {
    if (prevStatusRef.current === 'rendering' && progress.status === 'complete') {
      // Refresh output files list in FileExplorer
      useProjectStore.getState().fetchProjects()
    }
    prevStatusRef.current = progress.status
  }, [progress.status])

  // Subscribe to IPC render:progress events
  useEffect(() => {
    if (!window.electron?.render?.onProgress) return
    const unsub = window.electron.render.onProgress((data) => {
      const d = data as RenderProgressData
      if (d?.status === 'start') {
        setProgress({ message: d.message || '开始渲染...' })
      } else if (d?.status === 'complete') {
        setProgress({ status: 'complete', message: d.message || '渲染完成', progress: 100 })
      } else if (d?.status === 'error') {
        setProgress({ status: 'error', message: d.message || '渲染失败', error: d.message })
      }
    })
    cleanupRef.current = unsub
    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [setProgress])

  // 打磨轮（v1.5 / AL-O1c）：一键渲染全部材料——Python 类型一次调用合并 → 版本批次目录；
  // 前端产物（上机表/拓扑图/布局图/柜图）写入同一批次；分步进度按实际产物动态计数。
  const handleRender = useCallback(async () => {
    if (!selectedProjectName && !batchMode) {
      addToast('warning', t('common:toast.selectProjectFirst'))
      return
    }

    const projects = batchMode ? batchProjects : [selectedProjectName!]
    if (projects.length === 0) {
      addToast('warning', t('common:toast.selectRenderProject'))
      return
    }

    clearResults()
    setProgress({ status: 'rendering', message: '开始渲染...', progress: 0 })

    const pythonTypes = selectedOutputTypes.filter((t) => PYTHON_TYPES.includes(t))
    const frontendTypes = selectedOutputTypes.filter((t) => !PYTHON_TYPES.includes(t))
    // 每项目步数 = Python 合并 1 步 + 前端每类型 1 步
    const stepsPerProject = (pythonTypes.length > 0 ? 1 : 0) + frontendTypes.length
    const totalSteps = projects.length * Math.max(stepsPerProject, 1)
    let completedSteps = 0

    const updateProgress = () => {
      completedSteps++
      setProgress({
        progress: Math.round((completedSteps / Math.max(totalSteps, 1)) * 100),
        message: `渲染中... (${completedSteps}/${totalSteps})`,
      })
    }

    const nowIso = () => new Date().toISOString()
    const batchRel = (batch: string | undefined, file: string) =>
      `output/${batch ? `${batch}/` : ''}${file}`

    // 4.4 F4-2: 批量渲染失败汇总（多项目/失败可查）
    const failures: Array<{ project: string; error: string }> = []

    for (const projectName of projects) {
      let batchName: string | undefined
      const projectErrors: string[] = []
      try {
        // 1. Python 基础材料（连接/设备/布线/BOM/PDF 一次调用，产出版本批次目录）
        if (pythonTypes.length > 0) {
          setProgress({ message: `[${projectName}] 生成基础表项与报告...` })
          try {
            const result = await window.electron.render.exportConnections(projectName, pythonTypes)
            const data = result as { batchName?: string; version?: number; results?: { type?: string; file?: string; status?: string }[] }
            batchName = data?.batchName
            for (const r of data?.results ?? []) {
              if (!r.type) continue
              addResult({
                type: r.type,
                file: r.file ?? '',
                status: r.status === 'success' ? 'success' : 'error',
                error: r.status === 'success' ? undefined : `生成 ${r.type} 失败`,
                timestamp: nowIso(),
              })
            }
          } catch (err) {
            projectErrors.push((err as Error).message)
            addToast('error', t('common:toast.renderFailed', { project: projectName, error: (err as Error).message }))
          }
          updateProgress()
        }

        // 2. 上机表（前端 XLSX → 批次目录）
        if (frontendTypes.includes('rackTable') && cabinets.length > 0) {
          setProgress({ message: `[${projectName}] 生成上机表...` })
          try {
            const filePath = await exportToExcel(projectName, batchName)
            addResult({
              type: 'rackTable',
              file: filePath || batchRel(batchName, '上机表.xlsx'),
              status: filePath ? 'success' : 'error',
              error: filePath ? undefined : '导出失败',
              timestamp: nowIso(),
            })
          } catch (err) {
            addResult({ type: 'rackTable', file: batchRel(batchName, '上机表.xlsx'), status: 'error', error: (err as Error).message, timestamp: nowIso() })
          }
          updateProgress()
        }

        // 3. 拓扑图（前端 ECharts → 批次目录）
        if (frontendTypes.includes('topology') && topology) {
          setProgress({ message: `[${projectName}] 生成拓扑图...` })
          try {
            const base64 = await exportTopologyViewPng(topology.nodes, topology.edges, savedLayout)
            const fileName = '组网拓扑图.png'
            const filePath = await window.electron.render.saveOutputFile(projectName, batchRel(batchName, fileName), base64)
            addResult({ type: 'topology', file: filePath || batchRel(batchName, fileName), status: filePath ? 'success' : 'error', error: filePath ? undefined : '保存失败', timestamp: nowIso() })
          } catch (err) {
            addResult({ type: 'topology', file: batchRel(batchName, '组网拓扑图.png'), status: 'error', error: (err as Error).message, timestamp: nowIso() })
          }
          updateProgress()
        }

        // 4. 机房-机柜布局图（roomLayoutArt → PNG → 批次目录）
        if (frontendTypes.includes('roomLayout')) {
          setProgress({ message: `[${projectName}] 生成机房布局图...` })
          try {
            const art = roomLayoutArt()
            if (!art) {
              addResult({ type: 'roomLayout', file: batchRel(batchName, '机房布局图.png'), status: 'error', error: '未定义机房矩阵', timestamp: nowIso() })
            } else {
              const base64 = await svgToPngBase64(art.svg, art.width, art.height)
              const filePath = await window.electron.render.saveOutputFile(projectName, batchRel(batchName, '机房布局图.png'), base64)
              addResult({ type: 'roomLayout', file: filePath || batchRel(batchName, '机房布局图.png'), status: filePath ? 'success' : 'error', error: filePath ? undefined : '保存失败', timestamp: nowIso() })
            }
          } catch (err) {
            addResult({ type: 'roomLayout', file: batchRel(batchName, '机房布局图.png'), status: 'error', error: (err as Error).message, timestamp: nowIso() })
          }
          updateProgress()
        }

        // 5. 每柜上架图（rackElevationSvg → PNG → racks/ 子目录）
        if (frontendTypes.includes('rackImages') && cabinets.length > 0) {
          setProgress({ message: `[${projectName}] 生成柜上架图...` })
          try {
            let saved = 0
            for (const cab of cabinets) {
              const svg = rackElevationSvg(cab)
              const size = rackElevationSize(cab)
              const base64 = await svgToPngBase64(svg, size.width, size.height)
              const safeName = cab.name.replace(/[^\w一-龥-]/g, '_') || `R${cab.id}`
              await window.electron.render.saveOutputFile(projectName, batchRel(batchName, `racks/${safeName}.png`), base64)
              saved++
            }
            addResult({ type: 'rackImages', file: batchRel(batchName, 'racks/'), status: saved > 0 ? 'success' : 'error', error: saved > 0 ? undefined : '无柜可导出', timestamp: nowIso() })
          } catch (err) {
            addResult({ type: 'rackImages', file: batchRel(batchName, 'racks/'), status: 'error', error: (err as Error).message, timestamp: nowIso() })
          }
          updateProgress()
        }
      } catch (err) {
        projectErrors.push((err as Error).message)
        addToast('error', t('common:toast.renderFailed', { project: projectName, error: (err as Error).message }))
      }
      if (projectErrors.length > 0) failures.push({ project: projectName, error: projectErrors[0] })
    }

    setProgress({ status: 'complete', message: '渲染完成', progress: 100 })

    // 4.4 F4-2: 写入批量渲染失败汇总（进度可查）并提示汇总结果
    const batchResults: BatchItemResult[] = projects.map((p) => {
      const f = failures.find((x) => x.project === p)
      return f ? { project: p, ok: false, error: f.error } : { project: p, ok: true }
    })
    const summary = summarizeBatch(batchResults)
    setBatchSummary(summary)
    if (summary.failed === 0) {
      addToast('success', t('common:toast.renderComplete'))
    } else {
      addToast('warning', t('common:toast.batchRenderPartial', {
        success: summary.succeeded,
        fail: summary.failed,
        details: summary.failures.map((f) => `  - ${f.project}: ${f.error}`).join('\n'),
      }))
    }
    useProjectStore.getState().fetchProjects()
  }, [
    selectedProjectName, batchMode, batchProjects, selectedOutputTypes,
    cabinets, topology, savedLayout, exportToExcel,
    setProgress, addResult, clearResults, addToast, t, setBatchSummary,
  ])

  const handleClear = useCallback(() => {
    clearResults()
    resetProgress()
  }, [clearResults, resetProgress])

  // 打磨轮（v1.2 / AL-2）：批量删除渲染结果（output/output-label/yaml）
  const handleDeleteOutput = useCallback(async () => {
    const projects = batchMode ? batchProjects : selectedProjectName ? [selectedProjectName] : []
    if (projects.length === 0) {
      addToast('warning', t('common:toast.selectRenderProject'))
      return
    }
    try {
      const res = await deleteOutput(projects)
      addToast('success', `已删除 ${res.deleted} 项渲染结果（${projects.length} 个项目）`)
      useProjectStore.getState().fetchProjects()
    } catch (err) {
      addToast('error', `删除失败: ${(err as Error).message}`)
    }
  }, [batchMode, batchProjects, selectedProjectName, deleteOutput, addToast, t])

  // 4.4 F4-2：批量导出项目包（多项目包，选择目录后逐个导出，进度可查）
  const handleBatchExport = useCallback(async () => {
    if (batchExporting) return
    const projects = batchMode ? batchProjects : selectedProjectName ? [selectedProjectName] : []
    if (projects.length === 0) {
      addToast('warning', t('common:toast.selectRenderProject'))
      return
    }
    setBatchExporting(true)
    setBatchExportProgress({ total: projects.length, done: 0, current: '', message: t('workbench:batchExport.start') })
    try {
      const result = await useProjectStore.getState().batchExportProjects(projects)
      if (!result.canceled && result.result) {
        const { successes, failures } = result.result
        if (failures.length === 0) {
          addToast('success', t('workbench:batchExport.done', { count: successes.length, dir: result.targetDir }))
        } else {
          addToast('warning', t('workbench:batchExport.partial', {
            success: successes.length,
            fail: failures.length,
            details: failures.map((f) => `  - ${f.name}: ${f.error}`).join('\n'),
          }))
        }
      }
    } catch (err) {
      addToast('error', t('workbench:batchExport.failed', { error: (err as Error).message }))
    } finally {
      setBatchExportProgress(null)
      setBatchExporting(false)
    }
  }, [batchMode, batchProjects, selectedProjectName, batchExporting, addToast, t, setBatchExportProgress])

  return (
    <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-app/50 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
        <Play size={12} />
        {t('workbench:renderActions')}
      </div>
      <div className="p-3 space-y-3">
        {/* Progress bar */}
        {isRendering && (
          <div className="space-y-1">
            <div className="flex justify-between text-2xs text-gray-500">
              <span>{progress.message}</span>
              <span>{progress.progress}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary-500 transition-all duration-300"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* 4.4 F4-2：批量导出输出进度（进度可查） */}
        {batchExportProgress && !batchExporting && (
          <div className="px-2.5 py-1.5 rounded border border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-900/20 text-2xs text-primary-700 dark:text-primary-300">
            {batchExportProgress.message}（{batchExportProgress.done}/{batchExportProgress.total}）
          </div>
        )}

        {/* 4.4 F4-2：批量渲染失败汇总（进度可查） */}
        {!isRendering && batchSummary && batchSummary.failed > 0 && (
          <div className="px-2.5 py-1.5 rounded border border-warning-200 dark:border-warning-800 bg-warning-50/60 dark:bg-warning-900/20 text-2xs text-warning-700 dark:text-warning-300">
            <span>{t('workbench:batch.renderSummary', { success: batchSummary.succeeded, fail: batchSummary.failed })}</span>
            <ul className="mt-1 space-y-0.5">
              {batchSummary.failures.map((f) => (
                <li key={f.project} className="truncate">
                  <span className="font-medium">{f.project}</span>: {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 打磨轮（v1.6 / AL-N1d）：渲染门禁提示——组网设计未就绪时置灰；机柜设计未就绪仅提示（软门禁） */}
        {!renderGate && !isRendering && (
          <div className="px-2.5 py-1.5 rounded border border-warning-200 dark:border-warning-800 bg-warning-50/60 dark:bg-warning-900/20 text-2xs text-warning-700 dark:text-warning-300">
            {t('workbench:renderGateHint', '完成组网设计')}
            {designReady ? ' ✓' : '（未就绪，先在设计页生成拓扑）'}
            {' 后可渲染'}
            {!rackReady && (
              <>
                {' · '}
                {t('workbench:rackDesign', '机柜设计')}
                {'（未就绪，建议先完成以输出机柜材料）'}
              </>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRender}
            disabled={isRendering || selectedOutputTypes.length === 0 || !renderGate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRendering ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Play size={13} />
            )}
            {batchMode && batchProjects.length > 0
              ? `批量渲染 ${batchProjects.length} 个项目`
              : t('workbench:oneClickRender')}
          </button>

          <button
            onClick={() => setWorkbenchSubview('results')}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
          >
            <Eye size={13} />
            {t('workbench:preview')}
          </button>

          <button
            onClick={handleClear}
            disabled={isRendering}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover disabled:opacity-50"
          >
            <Trash2 size={13} />
            {t('workbench:clear')}
          </button>

          {/* 打磨轮（v1.2 / AL-2）：批量删除渲染结果 */}
          <button
            onClick={handleDeleteOutput}
            disabled={isRendering || (!batchMode && !selectedProjectName)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded border border-error-300 dark:border-error-700 text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 disabled:opacity-50"
          >
            <Trash2 size={13} />
            {batchMode && batchProjects.length > 0
              ? `删除 ${batchProjects.length} 个项目渲染结果`
              : '删除渲染结果'}
          </button>

          {/* 4.4 F4-2：批量导出项目包（多项目包/批次） */}
          {batchMode && batchProjects.length > 0 && (
            <button
              onClick={handleBatchExport}
              disabled={batchExporting || isRendering}
              className="flex items-center gap-1 px-2 py-1.5 text-xs rounded border border-success-300 dark:border-success-700 text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20 disabled:opacity-50"
            >
              {batchExporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {batchExporting ? t('workbench:batchExport.exporting') : t('workbench:batchExport.button', { count: batchProjects.length })}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
