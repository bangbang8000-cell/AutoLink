import { useState, useRef, useEffect, useCallback } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { useUIStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { AboutDialog } from './AboutDialog'

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
  const showAboutDialog = useUIStore((s) => s.showAboutDialog)
  const setShowAboutDialog = useUIStore((s) => s.setShowAboutDialog)
  const showShortcutsDialog = useUIStore((s) => s.showShortcutsDialog)
  const setShowShortcutsDialog = useUIStore((s) => s.setShowShortcutsDialog)
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

  const handleUserGuide = useCallback(async () => {
    // V2.4.4: 通过 shell.openExternal 打开 GitHub Wiki 用户指南
    try {
      await window.electron?.shell?.openExternal?.('https://github.com/bangbang8000-cell/AutoLink/wiki')
    } catch {
      addToast('error', '无法打开用户指南，请检查网络连接')
    }
  }, [addToast])

  const handleKeyboardShortcuts = useCallback(() => {
    // V2.4.4: 弹出独立快捷键对话框（替代原来的 toast 提示）
    setShowShortcutsDialog(true)
  }, [])

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

      {/* V2.4.4: AboutDialog 渲染（消费 ui.store.showAboutDialog 状态） */}
      {showAboutDialog && (
        <AboutDialog onClose={() => setShowAboutDialog(false)} />
      )}

      {/* V2.4.4: 快捷键参考对话框 */}
      {showShortcutsDialog && (
        <ShortcutsDialog onClose={() => setShowShortcutsDialog(false)} />
      )}
    </div>
  )
}

/* ---------- V2.4.4: 快捷键参考对话框 ---------- */

const SHORTCUTS: { category: string; items: { keys: string; desc: string }[] }[] = [
  {
    category: '通用',
    items: [
      { keys: 'Ctrl+N', desc: '新建项目' },
      { keys: 'Ctrl+S', desc: '保存配置' },
      { keys: 'Ctrl+,', desc: '打开首选项' },
    ],
  },
  {
    category: '视图',
    items: [
      { keys: 'Ctrl+B', desc: '切换文件浏览器' },
      { keys: 'Ctrl+J', desc: '切换日志面板' },
      { keys: 'Ctrl+=', desc: '放大' },
      { keys: 'Ctrl+-', desc: '缩小' },
      { keys: 'F11', desc: '全屏' },
    ],
  },
  {
    category: '工作区',
    items: [
      { keys: 'Ctrl+Shift+E', desc: '设计视图' },
      { keys: 'Ctrl+Shift+D', desc: '设备视图' },
      { keys: 'Ctrl+Shift+W', desc: '布线视图' },
      { keys: 'Ctrl+Shift+V', desc: '可视化视图' },
      { keys: 'Ctrl+K', desc: '快捷键参考' },
    ],
  },
]

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[520px] max-h-[80vh] overflow-auto border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">快捷键参考</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {SHORTCUTS.map((group) => (
            <div key={group.category}>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
                {group.category}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.keys} className="flex items-center justify-between py-1">
                    <span className="text-xs text-gray-600 dark:text-gray-300">{item.desc}</span>
                    <kbd className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
