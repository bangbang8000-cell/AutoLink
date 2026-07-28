import React, { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Eye, Trash2, Loader2 } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRenderStore } from '@/stores/render.store'
import { useToastStore } from '@/stores/toast.store'
import { exportTopologyPng } from '@/utils/exportTopology'

export function WorkbenchActionCard() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const topology = useDesignStore((s) => s.topology)
  const cabinets = useRackStore((s) => s.cabinets)
  const exportToExcel = useRackStore((s) => s.exportToExcel)
  const {
    progress, selectedOutputTypes, batchMode, batchProjects,
    setProgress, addResult, clearResults, resetProgress,
  } = useRenderStore()
  const addToast = useToastStore((s) => s.addToast)

  const isRendering = progress.status === 'rendering'
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
    const unsub = window.electron.render.onProgress((data: any) => {
      if (data?.status === 'start') {
        setProgress({ message: data.message || '开始渲染...' })
      } else if (data?.status === 'complete') {
        setProgress({ status: 'complete', message: data.message || '渲染完成', progress: 100 })
      } else if (data?.status === 'error') {
        setProgress({ status: 'error', message: data.message || '渲染失败', error: data.message })
      }
    })
    cleanupRef.current = unsub
    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [setProgress])

  const handleRender = useCallback(async () => {
    if (!selectedProjectName && !batchMode) {
      addToast('warning', '请先选择一个项目')
      return
    }

    const projects = batchMode ? batchProjects : [selectedProjectName!]
    if (projects.length === 0) {
      addToast('warning', '请选择要渲染的项目')
      return
    }

    clearResults()
    setProgress({ status: 'rendering', message: '开始渲染...', progress: 0 })

    const totalSteps =
      (selectedOutputTypes.includes('connections') ? projects.length : 0) +
      (selectedOutputTypes.includes('rackTable') ? projects.length : 0) +
      (selectedOutputTypes.includes('topology') ? projects.length : 0) +
      (selectedOutputTypes.includes('deviceList') ? projects.length : 0)
    let completedSteps = 0

    const updateProgress = () => {
      completedSteps++
      setProgress({
        progress: Math.round((completedSteps / Math.max(totalSteps, 1)) * 100),
        message: `渲染中... (${completedSteps}/${totalSteps})`,
      })
    }

    for (let i = 0; i < projects.length; i++) {
      const projectName = projects[i]

      try {
        // 1. Export connections table (via Python engine)
        if (selectedOutputTypes.includes('connections')) {
          setProgress({ message: `[${projectName}] 生成连接关系表...` })
          try {
            const result = await window.electron.render.exportConnections(projectName, ['connections'])
            const data = result as any
            const file = data?.data?.results?.[0]?.file || `${projectName}/output/连接关系表.xlsx`
            addResult({
              type: 'connections',
              file: typeof file === 'string' ? file : `${projectName}/output/连接关系表.xlsx`,
              status: 'success',
              timestamp: new Date().toISOString(),
            })
          } catch (err) {
            addResult({
              type: 'connections',
              file: `${projectName}/output/连接关系表.xlsx`,
              status: 'error',
              error: (err as Error).message,
              timestamp: new Date().toISOString(),
            })
          }
          updateProgress()
        }

        // 2. Export rack table (via rack.store frontend xlsx)
        if (selectedOutputTypes.includes('rackTable') && cabinets.length > 0) {
          setProgress({ message: `[${projectName}] 生成上机表...` })
          try {
            const filePath = await exportToExcel(projectName)
            addResult({
              type: 'rackTable',
              file: filePath || `${projectName}/output/上机表.xlsx`,
              status: filePath ? 'success' : 'error',
              error: filePath ? undefined : '导出失败',
              timestamp: new Date().toISOString(),
            })
          } catch (err) {
            addResult({
              type: 'rackTable',
              file: `${projectName}/output/上机表.xlsx`,
              status: 'error',
              error: (err as Error).message,
              timestamp: new Date().toISOString(),
            })
          }
          updateProgress()
        }

        // 3. Export topology PNG (via ECharts utility)
        if (selectedOutputTypes.includes('topology') && topology) {
          setProgress({ message: `[${projectName}] 生成拓扑图...` })
          try {
            const base64 = await exportTopologyPng(topology.nodes, topology.edges)
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            const fileName = `组网拓扑图_${timestamp}.png`
            const filePath = await window.electron?.export?.saveFile(projectName, fileName, base64)
            addResult({
              type: 'topology',
              file: filePath || `${projectName}/output/${fileName}`,
              status: filePath ? 'success' : 'error',
              error: filePath ? undefined : '保存失败',
              timestamp: new Date().toISOString(),
            })
          } catch (err) {
            addResult({
              type: 'topology',
              file: `${projectName}/output/组网拓扑图.png`,
              status: 'error',
              error: (err as Error).message,
              timestamp: new Date().toISOString(),
            })
          }
          updateProgress()
        }

        // 4. Export device list (via Python engine)
        if (selectedOutputTypes.includes('deviceList')) {
          setProgress({ message: `[${projectName}] 生成设备清单...` })
          try {
            const result = await window.electron.render.exportConnections(projectName, ['deviceList'])
            const data = result as any
            const file = data?.data?.results?.find((r: any) => r.type === 'deviceList')?.file
            addResult({
              type: 'deviceList',
              file: file || `${projectName}/output/设备清单.xlsx`,
              status: file ? 'success' : 'error',
              timestamp: new Date().toISOString(),
            })
          } catch (err) {
            addResult({
              type: 'deviceList',
              file: `${projectName}/output/设备清单.xlsx`,
              status: 'error',
              error: (err as Error).message,
              timestamp: new Date().toISOString(),
            })
          }
          updateProgress()
        }
      } catch (err) {
        addToast('error', `${projectName} 渲染失败: ${(err as Error).message}`)
      }
    }

    setProgress({ status: 'complete', message: '渲染完成', progress: 100 })
    addToast('success', '渲染完成')
  }, [
    selectedProjectName, batchMode, batchProjects, selectedOutputTypes,
    cabinets, topology, exportToExcel,
    setProgress, addResult, clearResults, addToast,
  ])

  const handleClear = useCallback(() => {
    clearResults()
    resetProgress()
  }, [clearResults, resetProgress])

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
        <Play size={12} />
        {t('workbench:renderActions')}
      </div>
      <div className="p-3 space-y-3">
        {/* Progress bar */}
        {isRendering && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-gray-500">
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

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRender}
            disabled={isRendering || selectedOutputTypes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRendering ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Play size={13} />
            )}
            {t('workbench:oneClickRender')}
          </button>

          <button
            onClick={() => addToast('info', '预览功能开发中')}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Eye size={13} />
            {t('workbench:preview')}
          </button>

          <button
            onClick={handleClear}
            disabled={isRendering}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Trash2 size={13} />
            {t('workbench:clear')}
          </button>
        </div>
      </div>
    </div>
  )
}
