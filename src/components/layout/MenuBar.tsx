import { useState, useRef, useEffect, useCallback } from 'react'
import clsx from 'clsx'
import { useUIStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { useWorkspaceStore } from '@/stores/workspace.store'

interface MenuItem {
  label?: string
  shortcut?: string
  action?: () => void
  separator?: boolean
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const setActiveActivity = useUIStore((s) => s.setActiveActivity)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const togglePanel = useUIStore((s) => s.togglePanel)
  const setShowCreateProjectWizard = useUIStore((s) => s.setShowCreateProjectWizard)
  const setShowAboutDialog = useUIStore((s) => s.setShowAboutDialog)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const addToast = useToastStore((s) => s.addToast)
  const openTab = useWorkspaceStore((s) => s.openTab)

  // --- Action callbacks ---
  const handleNewProject = useCallback(() => {
    setShowCreateProjectWizard(true)
  }, [setShowCreateProjectWizard])

  const handleOpenProjectDirectory = useCallback(async () => {
    try {
      if (selectedProjectName) {
        const wsp = await window.electron?.app?.getPath?.('workspace')
        if (wsp) {
          const folderPath = `${wsp}\\${selectedProjectName}`
          window.electron?.shell?.showItemInFolder?.(folderPath)
        }
      }
    } catch { /* silently ignore */ }
  }, [selectedProjectName])

  const handleShowInExplorer = useCallback(async () => {
    if (!selectedProjectName) {
      addToast('warning', '请先选择一个项目')
      return
    }
    try {
      const wsp = await window.electron?.app?.getPath?.('workspace')
      if (wsp) {
        const folderPath = `${wsp}\\${selectedProjectName}`
        window.electron?.shell?.showItemInFolder?.(folderPath)
      }
    } catch { /* silently ignore */ }
  }, [selectedProjectName, addToast])

  const handleSaveConfig = useCallback(async () => {
    if (!selectedProjectName) {
      addToast('warning', '请先选择一个项目')
      return
    }
    try {
      await useDesignStore.getState().saveConfig(selectedProjectName)
      addToast('success', '配置已保存')
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message || e}`)
    }
  }, [selectedProjectName, addToast])

  const handleExit = useCallback(() => {
    window.electron?.window?.close()
  }, [])

  const handlePreferences = useCallback(() => {
    setActiveActivity('settings')
  }, [setActiveActivity])

  const handleToggleSidebar = useCallback(() => {
    toggleSidebar()
  }, [toggleSidebar])

  const handleTogglePanel = useCallback(() => {
    togglePanel()
  }, [togglePanel])

  const handleZoomIn = useCallback(() => {
    // Zoom in the current workspace
    const currentZoom = parseFloat(document.documentElement.style.getPropertyValue('--workspace-zoom') || '1')
    const newZoom = Math.min(currentZoom + 0.1, 2.0)
    document.documentElement.style.setProperty('--workspace-zoom', String(newZoom))
  }, [])

  const handleZoomOut = useCallback(() => {
    const currentZoom = parseFloat(document.documentElement.style.getPropertyValue('--workspace-zoom') || '1')
    const newZoom = Math.max(currentZoom - 0.1, 0.3)
    document.documentElement.style.setProperty('--workspace-zoom', String(newZoom))
  }, [])

  const handleFullscreen = useCallback(() => {
    window.electron?.window?.maximize()
  }, [])

  const handleProjectSettings = useCallback(() => {
    setActiveActivity('settings')
  }, [setActiveActivity])

  const handleValidateTopology = useCallback(async () => {
    if (!selectedProjectName) {
      addToast('warning', '请先选择一个项目')
      return
    }
    try {
      addToast('info', '正在验证拓扑...')
      await useDesignStore.getState().validate(selectedProjectName)
      addToast('success', '拓扑验证通过')
    } catch (e: any) {
      addToast('error', `验证失败: ${e?.message || e}`)
    }
  }, [selectedProjectName, addToast])

  const handleRender = useCallback(() => {
    if (!selectedProjectName) {
      addToast('warning', '请先选择一个项目')
      return
    }
    // Switch to workbench and trigger render
    setActiveActivity('workbench')
    openTab({ type: 'workbench', title: '工作台', closable: false })
    addToast('info', '请在工作台中点击"一键渲染"开始渲染')
  }, [selectedProjectName, addToast, setActiveActivity, openTab])

  const handleExportRackTable = useCallback(async () => {
    if (!selectedProjectName) {
      addToast('warning', '请先选择一个项目')
      return
    }
    try {
      addToast('info', '正在导出上机表...')
      const filePath = await useRackStore.getState().exportToExcel(selectedProjectName)
      addToast('success', `上机表已导出: ${filePath}`)
    } catch (e: any) {
      addToast('error', `导出失败: ${e?.message || e}`)
    }
  }, [selectedProjectName, addToast])

  const handleExportDeviceList = useCallback(async () => {
    if (!selectedProjectName) {
      addToast('warning', '请先选择一个项目')
      return
    }
    try {
      addToast('info', '正在导出设备清单...')
      if (window.electron?.render?.exportConnections) {
        await window.electron.render.exportConnections(selectedProjectName, ['deviceList'])
        addToast('success', '设备清单已导出')
        // Refresh projects to show new files
        useProjectStore.getState().fetchProjects()
      }
    } catch (e: any) {
      addToast('error', `导出失败: ${e?.message || e}`)
    }
  }, [selectedProjectName, addToast])

  const handleUserGuide = useCallback(() => {
    addToast('info', '请访问 AutoLink 文档页面查看用户指南')
  }, [addToast])

  const handleKeyboardShortcuts = useCallback(() => {
    setActiveActivity('settings')
    addToast('info', '快捷键: Ctrl+B 文件浏览器 | Ctrl+J 日志面板 | Ctrl+, 设置 | Ctrl+Shift+E/D/W/V 切换视图')
  }, [setActiveActivity, addToast])

  const handleCheckUpdate = useCallback(async () => {
    try {
      addToast('info', '正在检查更新...')
      const result = await window.electron?.app?.checkUpdate?.()
      if (result?.updateAvailable) {
        addToast('info', `发现新版本: ${result.version}`)
      } else {
        addToast('success', '已是最新版本')
      }
    } catch {
      addToast('error', '检查更新失败')
    }
  }, [addToast])

  const handleAbout = useCallback(() => {
    setShowAboutDialog(true)
  }, [setShowAboutDialog])

  // --- Menu definitions ---
  const MENUS: Record<string, MenuItem[]> = {
    '文件': [
      { label: '新建项目', shortcut: 'Ctrl+N', action: handleNewProject },
      { label: '打开项目目录', action: handleOpenProjectDirectory },
      { separator: true },
      { label: '在文件管理器中打开项目', action: handleShowInExplorer },
      { separator: true },
      { label: '保存配置', shortcut: 'Ctrl+S', action: handleSaveConfig },
      { label: '退出', action: handleExit },
    ],
    '编辑': [
      { label: '首选项', shortcut: 'Ctrl+,', action: handlePreferences },
    ],
    '视图': [
      { label: '文件浏览器', shortcut: 'Ctrl+B', action: handleToggleSidebar },
      { label: '日志面板', shortcut: 'Ctrl+J', action: handleTogglePanel },
      { separator: true },
      { label: '放大', shortcut: 'Ctrl+=', action: handleZoomIn },
      { label: '缩小', shortcut: 'Ctrl+-', action: handleZoomOut },
      { separator: true },
      { label: '全屏', shortcut: 'F11', action: handleFullscreen },
    ],
    '项目': [
      { label: '项目设置', action: handleProjectSettings },
      { label: '验证拓扑', action: handleValidateTopology },
      { label: '渲染输出', action: handleRender },
      { separator: true },
      { label: '导出上机表', action: handleExportRackTable },
      { label: '导出设备清单', action: handleExportDeviceList },
    ],
    '帮助': [
      { label: '用户指南', action: handleUserGuide },
      { label: '快捷键参考', shortcut: 'Ctrl+K', action: handleKeyboardShortcuts },
      { separator: true },
      { label: '检查更新', action: handleCheckUpdate },
      { label: '关于 AutoLink', action: handleAbout },
    ],
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleMenuClick = (menuName: string) => {
    setOpenMenu(openMenu === menuName ? null : menuName)
  }

  return (
    <div ref={menuRef} className="flex items-center h-7 text-xs select-none" style={{ WebkitAppRegion: 'no-drag' }}>
      {Object.keys(MENUS).map((menuName) => (
        <div key={menuName} className="relative">
          <button
            onClick={() => handleMenuClick(menuName)}
            onMouseEnter={() => { if (openMenu) setOpenMenu(menuName) }}
            className={clsx(
              'px-2.5 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
              openMenu === menuName ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'
            )}
          >
            {menuName}
          </button>
          {openMenu === menuName && (
            <div className="absolute top-full left-0 mt-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-[70] min-w-[200px]">
              {MENUS[menuName].map((item, i) => {
                if (item.separator) {
                  return <div key={i} className="my-1 border-t border-gray-200 dark:border-gray-700" />
                }
                return (
                  <button
                    key={item.label || i}
                    onClick={() => {
                      item.action?.()
                      setOpenMenu(null)
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className="text-[10px] text-gray-400 ml-6">{item.shortcut}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
