import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('common')
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

  // P4: 合并重复菜单项 — 删除 handleOpenProjectDirectory,仅保留 handleShowInExplorer(带 toast 提示)

  const handleShowInExplorer = useCallback(async () => {
    if (!selectedProjectName) {
      addToast('warning', t('menu.toast.selectProjectFirst'))
      return
    }
    try {
      const wsp = await window.electron?.app?.getPath?.('workspace')
      if (wsp) {
        const folderPath = `${wsp}\\${selectedProjectName}`
        window.electron?.shell?.showItemInFolder?.(folderPath)
      }
    } catch { /* silently ignore */ }
  }, [selectedProjectName, addToast, t])

  const handleSaveConfig = useCallback(async () => {
    if (!selectedProjectName) {
      addToast('warning', t('menu.toast.selectProjectFirst'))
      return
    }
    try {
      await useDesignStore.getState().saveConfig(selectedProjectName)
      addToast('success', t('menu.toast.configSaved'))
    } catch (e: any) {
      addToast('error', t('menu.toast.saveFailed', { error: e?.message || String(e) }))
    }
  }, [selectedProjectName, addToast, t])

  const handleExit = useCallback(() => {
    window.electron?.window?.close()
  }, [])

  const handlePreferences = useCallback(() => {
    setActiveActivity('settings')
  }, [setActiveActivity])

  // T5: 编辑菜单功能实现(使用浏览器原生能力)
  const handleUndo = useCallback(() => {
    document.execCommand('undo')
  }, [])
  const handleRedo = useCallback(() => {
    document.execCommand('redo')
  }, [])
  const handleCut = useCallback(() => {
    document.execCommand('cut')
  }, [])
  const handleCopy = useCallback(() => {
    document.execCommand('copy')
  }, [])
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      document.execCommand('insertText', false, text)
    } catch {
      document.execCommand('paste')
    }
  }, [])
  const handleSelectAll = useCallback(() => {
    document.execCommand('selectAll')
  }, [])
  const handleFind = useCallback(() => {
    // 触发 Ctrl+F 事件,各组件如有监听则响应
    const evt = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })
    window.dispatchEvent(evt)
  }, [])

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
      addToast('warning', t('menu.toast.selectProjectFirst'))
      return
    }
    try {
      addToast('info', t('menu.toast.validating'))
      await useDesignStore.getState().validate(selectedProjectName)
      addToast('success', t('menu.toast.validatePassed'))
    } catch (e: any) {
      addToast('error', t('menu.toast.validateFailed', { error: e?.message || String(e) }))
    }
  }, [selectedProjectName, addToast, t])

  const handleRender = useCallback(() => {
    if (!selectedProjectName) {
      addToast('warning', t('menu.toast.selectProjectFirst'))
      return
    }
    // Switch to workbench and trigger render
    setActiveActivity('workbench')
    openTab({ type: 'workbench', title: t('menu.workbench'), closable: false })
    addToast('info', t('menu.toast.renderHint'))
  }, [selectedProjectName, addToast, setActiveActivity, openTab, t])

  const handleExportRackTable = useCallback(async () => {
    if (!selectedProjectName) {
      addToast('warning', t('menu.toast.selectProjectFirst'))
      return
    }
    try {
      addToast('info', t('menu.toast.exportingRackTable'))
      const filePath = await useRackStore.getState().exportToExcel(selectedProjectName)
      addToast('success', t('menu.toast.rackTableExported', { path: filePath }))
    } catch (e: any) {
      addToast('error', t('menu.toast.exportFailed', { error: e?.message || String(e) }))
    }
  }, [selectedProjectName, addToast, t])

  const handleExportDeviceList = useCallback(async () => {
    if (!selectedProjectName) {
      addToast('warning', t('menu.toast.selectProjectFirst'))
      return
    }
    try {
      addToast('info', t('menu.toast.exportingDeviceList'))
      if (window.electron?.render?.exportConnections) {
        await window.electron.render.exportConnections(selectedProjectName, ['deviceList'])
        addToast('success', t('menu.toast.deviceListExported'))
        // Refresh projects to show new files
        useProjectStore.getState().fetchProjects()
      }
    } catch (e: any) {
      addToast('error', t('menu.toast.exportFailed', { error: e?.message || String(e) }))
    }
  }, [selectedProjectName, addToast, t])

  // P2: 用户指南改为本地加载(工作区标签页),不再跳转 GitHub
  const handleUserGuide = useCallback(() => {
    openTab({ type: 'guide', title: t('guide.title'), closable: true })
  }, [openTab, t])

  const handleKeyboardShortcuts = useCallback(() => {
    // V2.4.4: 弹出独立快捷键对话框（替代原来的 toast 提示）
    setShowShortcutsDialog(true)
  }, [setShowShortcutsDialog])

  const handleCheckUpdate = useCallback(async () => {
    try {
      addToast('info', t('menu.toast.checkingUpdate'))
      const result = await window.electron?.app?.checkUpdate?.()
      if (result?.updateAvailable) {
        addToast('info', t('menu.toast.newVersionFound', { version: result.version || '' }))
      } else {
        addToast('success', t('menu.toast.upToDate'))
      }
    } catch {
      addToast('error', t('menu.toast.checkUpdateFailed'))
    }
  }, [addToast, t])

  const handleAbout = useCallback(() => {
    setShowAboutDialog(true)
  }, [setShowAboutDialog])

  // --- Menu definitions ---
  // P3: 全部菜单项 i18n 化;P4: 删除重复的「打开项目目录」
  const MENUS: Record<string, MenuItem[]> = {
    [t('menu.topLevel.file')]: [
      { label: t('menu.file.newProject'), shortcut: 'Ctrl+N', action: handleNewProject },
      { label: t('menu.file.showInExplorer'), action: handleShowInExplorer },
      { separator: true },
      { label: t('menu.file.saveConfig'), shortcut: 'Ctrl+S', action: handleSaveConfig },
      { label: t('menu.file.exit'), action: handleExit },
    ],
    [t('menu.topLevel.edit')]: [
      { label: t('menu.edit.undo'), shortcut: 'Ctrl+Z', action: handleUndo },
      { label: t('menu.edit.redo'), shortcut: 'Ctrl+Y', action: handleRedo },
      { separator: true },
      { label: t('menu.edit.cut'), shortcut: 'Ctrl+X', action: handleCut },
      { label: t('menu.edit.copy'), shortcut: 'Ctrl+C', action: handleCopy },
      { label: t('menu.edit.paste'), shortcut: 'Ctrl+V', action: handlePaste },
      { separator: true },
      { label: t('menu.edit.selectAll'), shortcut: 'Ctrl+A', action: handleSelectAll },
      { label: t('menu.edit.find'), shortcut: 'Ctrl+F', action: handleFind },
      { separator: true },
      { label: t('menu.edit.preferences'), shortcut: 'Ctrl+,', action: handlePreferences },
    ],
    [t('menu.topLevel.view')]: [
      { label: t('menu.view.fileBrowser'), shortcut: 'Ctrl+B', action: handleToggleSidebar },
      { label: t('menu.view.logPanel'), shortcut: 'Ctrl+J', action: handleTogglePanel },
      { separator: true },
      { label: t('menu.view.zoomIn'), shortcut: 'Ctrl+=', action: handleZoomIn },
      { label: t('menu.view.zoomOut'), shortcut: 'Ctrl+-', action: handleZoomOut },
      { separator: true },
      { label: t('menu.view.fullscreen'), shortcut: 'F11', action: handleFullscreen },
    ],
    [t('menu.topLevel.project')]: [
      { label: t('menu.project.projectSettings'), action: handleProjectSettings },
      { label: t('menu.project.validateTopology'), action: handleValidateTopology },
      { label: t('menu.project.renderOutput'), action: handleRender },
      { separator: true },
      { label: t('menu.project.exportRackTable'), action: handleExportRackTable },
      { label: t('menu.project.exportDeviceList'), action: handleExportDeviceList },
    ],
    [t('menu.topLevel.help')]: [
      { label: t('menu.help.userGuide'), action: handleUserGuide },
      { label: t('menu.help.keyboardShortcuts'), shortcut: 'Ctrl+K', action: handleKeyboardShortcuts },
      { separator: true },
      { label: t('menu.help.checkUpdate'), action: handleCheckUpdate },
      { label: t('menu.help.about'), action: handleAbout },
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

// P3: ShortcutsDialog i18n 化(由组件内部 useTranslation 驱动)
function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common')
  const SHORTCUTS: { category: string; items: { keys: string; desc: string }[] }[] = [
    {
      category: t('menu.shortcuts.general'),
      items: [
        { keys: 'Ctrl+N', desc: t('menu.shortcuts.newProject') },
        { keys: 'Ctrl+S', desc: t('menu.shortcuts.saveConfig') },
        { keys: 'Ctrl+,', desc: t('menu.shortcuts.preferences') },
      ],
    },
    {
      category: t('menu.shortcuts.view'),
      items: [
        { keys: 'Ctrl+B', desc: t('menu.shortcuts.toggleFileBrowser') },
        { keys: 'Ctrl+J', desc: t('menu.shortcuts.toggleLogPanel') },
        { keys: 'Ctrl+=', desc: t('menu.shortcuts.zoomIn') },
        { keys: 'Ctrl+-', desc: t('menu.shortcuts.zoomOut') },
        { keys: 'F11', desc: t('menu.shortcuts.fullscreen') },
      ],
    },
    {
      category: t('menu.shortcuts.workspace'),
      items: [
        { keys: 'Ctrl+Shift+E', desc: t('menu.shortcuts.designView') },
        { keys: 'Ctrl+Shift+D', desc: t('menu.shortcuts.deviceView') },
        { keys: 'Ctrl+Shift+W', desc: t('menu.shortcuts.wiringView') },
        { keys: 'Ctrl+Shift+V', desc: t('menu.shortcuts.visualizationView') },
        { keys: 'Ctrl+K', desc: t('menu.shortcuts.shortcutsRef') },
      ],
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[520px] max-h-[80vh] overflow-auto border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('menu.shortcuts.title')}</h2>
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
