/**
 * AutoLink V2.4.7 — 机房平面布局 Tab
 *
 * 集成：
 *   - DataCenterStats：机房统计面板
 *   - DataCenterLayout：SVG 机柜平面图
 *   - 参数调整：每排机柜数、机柜尺寸、排间距
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Settings2, ChevronDown, ChevronRight, Download } from 'lucide-react'
import { useRackStore } from '@/stores/rack.store'
import { useDataCenterStore } from '@/stores/datacenter.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { DataCenterLayout } from '@/components/datacenter/DataCenterLayout'
import { DataCenterStats } from '@/components/datacenter/DataCenterStats'
import { exportSvgFile, exportSvgAsPng, makeTimestampedFilename } from '@/utils/exportSvg'

export function DataCenterTab() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const cabinets = useRackStore((s) => s.cabinets)
  const initFromTopology = useRackStore((s) => s.initFromTopology)
  const params = useDataCenterStore((s) => s.params)
  const setParams = useDataCenterStore((s) => s.setParams)
  const addToast = useToastStore((s) => s.addToast)
  const [showSettings, setShowSettings] = useState(false)
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)

  // 自动从拓扑初始化机柜
  useEffect(() => {
    if (selectedProjectName && cabinets.length === 0) {
      // 从 design.store 加载已保存拓扑，然后初始化机柜
      import('@/stores/design.store').then(({ useDesignStore }) => {
        const topo = useDesignStore.getState().topology
        if (topo) {
          initFromTopology(topo.nodes, params.cabinetHeight === 100 ? 42 : 49)
        }
      })
    }
  }, [selectedProjectName, cabinets.length, initFromTopology, params.cabinetHeight])

  const handleExportSvg = async () => {
    const svg = svgContainerRef.current?.querySelector('svg')
    if (!svg || !selectedProjectName) {
      addToast('error', t('common:toast.noRackDataToExport'))
      return
    }
    try {
      const filename = makeTimestampedFilename('机房平面布局', 'svg')
      await exportSvgFile(svg as SVGSVGElement, selectedProjectName, filename)
      addToast('success', t('common:toast.exportedToOutput', { filename }))
    } catch (err) {
      addToast('error', t('common:toast.exportFailed', { error: err instanceof Error ? err.message : t('common:toast.unknownError') }))
    }
    setShowExportMenu(false)
  }

  const handleExportPng = async () => {
    const svg = svgContainerRef.current?.querySelector('svg')
    if (!svg || !selectedProjectName) {
      addToast('error', t('common:toast.noRackDataToExport'))
      return
    }
    addToast('info', t('common:toast.generatingPng'))
    try {
      const filename = makeTimestampedFilename('机房平面布局', 'png')
      await exportSvgAsPng(svg as SVGSVGElement, selectedProjectName, filename, 2)
      addToast('success', t('common:toast.exportedToOutput', { filename }))
    } catch (err) {
      addToast('error', t('common:toast.exportFailed', { error: err instanceof Error ? err.message : t('common:toast.unknownError') }))
    }
    setShowExportMenu(false)
  }

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-app-elevated">
        <Building2 size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400">{t('datacenter:noProject', '请先选择项目')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-app-elevated">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-edge-subtle">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-primary-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t('datacenter:title', '机房平面布局')}
          </span>
          <span className="text-xs text-gray-400">{selectedProjectName}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 导出按钮 */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-500"
            >
              <Download size={12} />
              导出
              <ChevronDown size={10} />
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded shadow-lg py-1 min-w-[120px]">
                  <button
                    onClick={handleExportSvg}
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300"
                  >
                    导出 SVG
                  </button>
                  <button
                    onClick={handleExportPng}
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300"
                  >
                    导出 PNG
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-500"
          >
            <Settings2 size={12} />
            {showSettings ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('datacenter:layoutSettings', '布局参数')}
          </button>
        </div>
      </div>

      {/* 参数设置面板 */}
      {showSettings && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-app/50 border-b border-gray-200 dark:border-edge-subtle">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            <label className="text-2xs">
              <span className="block text-gray-500 mb-0.5">{t('datacenter:cabinetsPerRow', '每排机柜数')}</span>
              <input
                type="number"
                min={4}
                max={16}
                value={params.cabinetsPerRow}
                onChange={(e) => setParams({ cabinetsPerRow: Math.max(4, Math.min(16, Number(e.target.value) || 8)) })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app"
              />
            </label>
            <label className="text-2xs">
              <span className="block text-gray-500 mb-0.5">{t('datacenter:cabinetWidth', '机柜宽度(px)')}</span>
              <input
                type="number"
                min={40}
                max={120}
                value={params.cabinetWidth}
                onChange={(e) => setParams({ cabinetWidth: Math.max(40, Math.min(120, Number(e.target.value) || 60)) })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app"
              />
            </label>
            <label className="text-2xs">
              <span className="block text-gray-500 mb-0.5">{t('datacenter:cabinetHeight', '机柜高度(px)')}</span>
              <input
                type="number"
                min={60}
                max={200}
                value={params.cabinetHeight}
                onChange={(e) => setParams({ cabinetHeight: Math.max(60, Math.min(200, Number(e.target.value) || 100)) })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app"
              />
            </label>
            <label className="text-2xs">
              <span className="block text-gray-500 mb-0.5">{t('datacenter:rowGap', '排间距(px)')}</span>
              <input
                type="number"
                min={30}
                max={120}
                value={params.rowGap}
                onChange={(e) => setParams({ rowGap: Math.max(30, Math.min(120, Number(e.target.value) || 60)) })}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app"
              />
            </label>
          </div>
        </div>
      )}

      {/* 统计面板 */}
      <DataCenterStats />

      {/* 平面布局 */}
      <div className="flex-1 min-h-0" ref={svgContainerRef}>
        <DataCenterLayout />
      </div>
    </div>
  )
}
