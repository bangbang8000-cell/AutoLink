import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Eye, Trash2, Loader2 } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRenderStore } from '@/stores/render.store'
import { useToastStore } from '@/stores/toast.store'

export function WorkbenchActionCard() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const summary = useDesignStore((s) => s.summary)
  const topology = useDesignStore((s) => s.topology)
  const cabinets = useRackStore((s) => s.cabinets)
  const {
    progress, selectedOutputTypes, batchMode, batchProjects,
    setProgress, addResult, clearResults, resetProgress,
  } = useRenderStore()
  const addToast = useToastStore((s) => s.addToast)

  const isRendering = progress.status === 'rendering'

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

    try {
      for (let i = 0; i < projects.length; i++) {
        const projectName = projects[i]
        const baseProgress = (i / projects.length) * 100

        setProgress({
          message: `正在渲染 ${projectName}...`,
          progress: Math.round(baseProgress),
        })

        try {
          // Export connections
          if (selectedOutputTypes.includes('connections')) {
            setProgress({ message: `[${projectName}] 生成连接关系表...`, progress: Math.round(baseProgress + 10) })
            await window.electron.render.exportConnections(projectName, ['connections'])
            addResult({
              type: 'connections',
              file: `${projectName}/output/连接关系表.xlsx`,
              status: 'success',
              timestamp: new Date().toISOString(),
            })
          }

          // Export rack table
          if (selectedOutputTypes.includes('rackTable') && cabinets.length > 0) {
            setProgress({ message: `[${projectName}] 生成上机表...`, progress: Math.round(baseProgress + 15) })
            await window.electron.render.exportConnections(projectName, ['rackTable'])
            addResult({
              type: 'rackTable',
              file: `${projectName}/output/上机表.xlsx`,
              status: 'success',
              timestamp: new Date().toISOString(),
            })
          }

          // Export topology PNG
          if (selectedOutputTypes.includes('topology') && topology) {
            setProgress({ message: `[${projectName}] 生成拓扑图...`, progress: Math.round(baseProgress + 20) })
            addResult({
              type: 'topology',
              file: `${projectName}/output/组网拓扑图.png`,
              status: 'success',
              timestamp: new Date().toISOString(),
            })
          }

          // Export device list
          if (selectedOutputTypes.includes('deviceList')) {
            setProgress({ message: `[${projectName}] 生成设备清单...`, progress: Math.round(baseProgress + 25) })
            await window.electron.render.exportConnections(projectName, ['deviceList'])
            addResult({
              type: 'deviceList',
              file: `${projectName}/output/设备清单.xlsx`,
              status: 'success',
              timestamp: new Date().toISOString(),
            })
          }
        } catch (err) {
          addToast('error', `${projectName} 渲染失败: ${(err as Error).message}`)
        }
      }

      setProgress({ status: 'complete', message: '渲染完成', progress: 100 })
      addToast('success', '渲染完成')
    } catch (err) {
      setProgress({ status: 'error', message: (err as Error).message, progress: 0 })
      addToast('error', `渲染失败: ${(err as Error).message}`)
    }
  }, [selectedProjectName, batchMode, batchProjects, selectedOutputTypes, cabinets, topology, setProgress, addResult, clearResults, addToast])

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