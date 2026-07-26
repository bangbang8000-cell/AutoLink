import React, { useEffect, useCallback, useRef } from 'react'
import clsx from 'clsx'
import { useProjectStore } from '@/stores/project.store'
import { useUIStore } from '@/stores/ui.store'
import { Header } from '@/components/layout/Header'
import { ActivityBar } from '@/components/layout/ActivityBar'
import { StatusBar } from '@/components/layout/StatusBar'
import { ResizableAppLayout } from '@/components/layout/ResizableAppLayout'
import { ExplorerPanel } from '@/components/sidebar/ExplorerPanel'
import { WorkbenchPanel } from '@/components/sidebar/WorkbenchPanel'
import { DesignPanel } from '@/components/sidebar/DesignPanel'
import { RackPanel } from '@/components/sidebar/RackPanel'
import { TopologyPanel } from '@/components/sidebar/TopologyPanel'
import { OutputPanel } from '@/components/sidebar/OutputPanel'
import { SettingsPanel } from '@/components/sidebar/SettingsPanel'
import '@/i18n'

export default function App() {
  const fetchProjects = useProjectStore((s) => s.fetchProjects)
  const fetchTemplates = useProjectStore((s) => s.fetchTemplates)
  const activeActivity = useUIStore((s) => s.activeActivity)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const panelVisible = useUIStore((s) => s.panelVisible)
  const isDark = useUIStore((s) => s.isDark)
  const theme = useUIStore((s) => s.theme)
  const syncSystemTheme = useUIStore((s) => s.syncSystemTheme)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)

  // Apply dark mode to HTML element
  useEffect(() => {
    const root = document.documentElement
    if (isDark) root.classList.add('dark')
    else root.classList.remove('dark')
  }, [isDark])

  // Sync system theme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => syncSystemTheme()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [syncSystemTheme])

  // Initialize on mount
  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    fetchProjects()
    fetchTemplates()
  }, [fetchProjects, fetchTemplates])

  const renderSidebarContent = useCallback(() => {
    switch (activeActivity) {
      case 'explorer':
        return <ExplorerPanel />
      case 'workbench':
        return <WorkbenchPanel />
      case 'design':
        return <DesignPanel />
      case 'rack':
        return <RackPanel />
      case 'topology':
        return <TopologyPanel />
      case 'output':
        return <OutputPanel />
      case 'settings':
        return <SettingsPanel />
      default:
        return <ExplorerPanel />
    }
  }, [activeActivity])

  return (
    <div
      className={clsx(
        'h-screen w-screen flex flex-col overflow-hidden',
        isDark ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900',
      )}
    >
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <ActivityBar />
        <ResizableAppLayout
          isDark={isDark}
          sidebarVisible={sidebarVisible}
          panelVisible={panelVisible}
          sidebar={renderSidebarContent()}
          editor={
            <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
              {selectedProjectName
                ? `当前项目: ${selectedProjectName} - 选择左侧面板进行操作`
                : '在左侧项目浏览器中选择或创建一个项目'}
            </div>
          }
          bottomPanel={<div className="p-3 text-xs text-gray-400">输出日志</div>}
        />
      </div>
      <StatusBar />
    </div>
  )
}
