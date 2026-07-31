import React, { useCallback, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore, type ThemeMode, type ExplorerGroupMode } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRenderStore } from '@/stores/render.store'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import { useExplorerStore } from '@/stores/explorer.store'
import {
  FolderOpen, Folder, Search, ChevronRight, ChevronDown,
  Sun, Moon, Monitor, Globe, Keyboard, Info, Palette, FileOutput,
  Cpu, Wifi, Network, Database, AlertTriangle, Shield, Download,
  Upload, RotateCcw, ExternalLink, Check,
  Wrench, Play, CheckCircle, XCircle, Loader2, Zap,
  Table2, List, FileSpreadsheet, GitBranch, Package,
  Star, Plus, FolderTree,
  FileText, Image as ImageIcon, FileCode, File as FileIcon, LayoutTemplate, FileInput,
} from 'lucide-react'
import clsx from 'clsx'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { AboutDialog } from '@/components/layout/AboutDialog'
import { useToastStore } from '@/stores/toast.store'
import { ConfirmDeleteDialog, type DeleteTarget } from '@/components/layout/ConfirmDeleteDialog'
import { RenameProjectModal } from '@/components/layout/RenameProjectModal'
import { EditTemplateModal } from '@/components/layout/EditTemplateModal'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import { TreeNode } from '@/components/layout/TreeNode'
import type { FileTreeNode, GroupKey, GroupedNode, OutputBatch, OutputBatchFile } from '@/types/file-tree'
import { groupProjectFiles, groupTemplateFiles } from '@/utils/file-grouping'
import i18next from 'i18next'
import { Toggle } from '@/components/ui/Toggle'
import { SettingsSection, SettingsRow, INPUT_CLASS } from '@/components/ui/SettingsRow'
import { NODE_TYPE_LABELS } from '@/constants/labels'

export function FileExplorer() {
  const activeActivity = useUIStore((s) => s.activeActivity)

  switch (activeActivity) {
    case 'project':        return <ProjectExplorer />
    case 'design':         return <DesignExplorer />
    case 'workbench':      return <WorkbenchExplorer />
    case 'visualization':  return <VisualizationExplorer />
    case 'device_library': return <DeviceLibExplorer />
    case 'settings':       return <SettingsExplorer />
    default:           return <ProjectExplorer />
  }
}

function ProjectExplorer() {
  const { t } = useTranslation()
  const { projects, templates, selectProject, selectedProjectName, deleteProjects, convertToTemplate, duplicateProject, renameProject, exportProject, importProject, batchExportProjects, favoriteProjects, toggleFavorite } = useProjectStore()
  const openTab = useWorkspaceStore((s) => s.openTab)
  const addToast = useToastStore((s) => s.addToast)
  const setShowCreateProjectWizard = useUIStore((s) => s.setShowCreateProjectWizard)
  const explorerGroupMode = useUIStore((s) => s.explorerGroupMode)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [renameModal, setRenameModal] = useState<{ type: 'rename' | 'duplicate'; projectName: string } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [batchExporting, setBatchExporting] = useState(false)
  // T9: 项目展开状态改用 explorer.store
  const expandedProjects = useExplorerStore((s) => s.expandedProjects)
  const projectStructures = useExplorerStore((s) => s.projectStructures)
  const expandedGroups = useExplorerStore((s) => s.expandedGroups)
  const expandedDirs = useExplorerStore((s) => s.expandedDirs)
  const expandedBatches = useExplorerStore((s) => s.expandedBatches)
  const outputBatches = useExplorerStore((s) => s.outputBatches)
  const toggleProject = useExplorerStore((s) => s.toggleProject)
  const toggleGroup = useExplorerStore((s) => s.toggleGroup)
  const toggleDir = useExplorerStore((s) => s.toggleDir)
  const toggleBatch = useExplorerStore((s) => s.toggleBatch)
  const setProjectStructure = useExplorerStore((s) => s.setProjectStructure)
  const setOutputBatches = useExplorerStore((s) => s.setOutputBatches)

  const handleOpenProject = useCallback((name: string) => {
    const project = projects.find((p) => p.name === name)
    if (project) {
      selectProject(project)
      openTab({
        type: 'projectOverview',
        title: t('common:explorer.toast.projectOverviewTitle', { name }),
        closable: true,
        state: { projectName: name },
      })
    }
  }, [projects, selectProject, openTab])

  // T9: 项目文件树展开/折叠 — 首次展开拉取结构 + 输出批次并缓存到 store
  const toggleProjectExpand = useCallback(async (projectName: string) => {
    const currently = expandedProjects[projectName]
    if (!currently && !projectStructures[projectName]) {
      try {
        const [structure, batches] = await Promise.all([
          window.electron?.project?.getStructure(projectName),
          window.electron?.project?.listOutputBatches(projectName),
        ])
        setProjectStructure(projectName, (structure as FileTreeNode[]) || [])
        setOutputBatches(projectName, (batches as OutputBatch[]) || [])
      } catch {
        setProjectStructure(projectName, [])
        setOutputBatches(projectName, [])
      }
    }
    toggleProject(projectName)
  }, [expandedProjects, projectStructures, toggleProject, setProjectStructure, setOutputBatches])

  // T9: 删除文件/批次后刷新项目结构 + 批次缓存
  const refreshProjectStructure = useCallback(async (projectName: string) => {
    try {
      const [structure, batches] = await Promise.all([
        window.electron?.project?.getStructure(projectName),
        window.electron?.project?.listOutputBatches(projectName),
      ])
      setProjectStructure(projectName, (structure as FileTreeNode[]) || [])
      setOutputBatches(projectName, (batches as OutputBatch[]) || [])
    } catch { /* ignore */ }
  }, [setProjectStructure, setOutputBatches])

  // T6: 点击项目内文件 → 打开 fileViewer (filePath 用 node.path 相对项目根)
  const handleProjectFileClick = useCallback((projectName: string, node: FileTreeNode) => {
    openTab({
      type: 'fileViewer',
      title: node.name,
      closable: true,
      state: { filePath: node.path, projectName, isTemplate: false },
    })
  }, [openTab])

  // T9: 点击批次内文件 → 打开 fileViewer (filePath 用 workspace 相对路径)
  const handleBatchFileClick = useCallback((_projectName: string, _batch: OutputBatch, file: OutputBatchFile) => {
    openTab({
      type: 'fileViewer',
      title: file.name,
      closable: true,
      state: { filePath: file.path, isTemplate: false },
    })
  }, [openTab])

  const handleOpenInExplorer = useCallback(async (projectName: string) => {
    const wsp = await window.electron?.app?.getPath('workspace')
    const folderPath = `${wsp}\\${projectName}`
    window.electron?.shell?.showItemInFolder(folderPath)
  }, [])

  const handleDeleteProject = useCallback((project: { id: number; name: string }) => {
    setDeleteTarget({ name: project.name, type: 'project' })
  }, [])

  const handleConvertToTemplate = useCallback((projectName: string) => {
    const name = prompt(t('common:explorer.toast.templateNamePrompt'), projectName)
    if (!name?.trim()) return
    convertToTemplate(projectName, { name: name.trim() })
      .then(() => addToast('success', t('common:explorer.toast.projectConvertedToTemplate', { projectName, templateName: name.trim() })))
      .catch((err) => addToast('error', t('common:explorer.toast.convertFailed', { error: err instanceof Error ? err.message : String(err) })))
  }, [convertToTemplate, addToast, t])

  const handleDuplicate = useCallback((projectName: string) => {
    setRenameModal({ type: 'duplicate', projectName })
  }, [])

  const handleRename = useCallback((projectName: string) => {
    setRenameModal({ type: 'rename', projectName })
  }, [])

  const handleRenameConfirm = useCallback(async (value: string) => {
    if (!renameModal) return
    if (renameModal.type === 'duplicate') {
      await duplicateProject(renameModal.projectName, value)
      addToast('success', t('common:explorer.toast.projectDuplicated', { name: value }))
    } else {
      await renameProject(renameModal.projectName, value)
      addToast('success', t('common:explorer.toast.projectRenamed', { name: value }))
    }
  }, [renameModal, duplicateProject, renameProject, addToast, t])

  const handleExport = useCallback(async (projectName: string) => {
    if (exporting) return
    setExporting(true)
    try {
      const result = await exportProject(projectName)
      if (!result.canceled && result.zipPath) {
        addToast('success', t('common:explorer.toast.projectExported', { name: projectName, path: result.zipPath }))
      }
    } catch (err) {
      addToast('error', t('common:explorer.toast.exportFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setExporting(false)
    }
  }, [exporting, exportProject, addToast, t])

  const handleImport = useCallback(async () => {
    if (importing) return
    setImporting(true)
    try {
      const result = await importProject()
      if (!result.canceled && result.projectName) {
        addToast('success', t('common:explorer.toast.projectImported', { name: result.projectName }))
      }
    } catch (err) {
      addToast('error', t('common:explorer.toast.importFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setImporting(false)
    }
  }, [importing, importProject, addToast, t])

  // 搜索过滤 + 收藏置顶排序
  const favoriteSet = new Set(favoriteProjects)
  const filteredProjects = searchQuery.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : projects
  // 排序：收藏在前，其余按原顺序
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    const aFav = favoriteSet.has(a.name) ? 0 : 1
    const bFav = favoriteSet.has(b.name) ? 0 : 1
    return aFav - bFav
  })

  const handleBatchExport = useCallback(async () => {
    if (batchExporting) return
    if (sortedProjects.length === 0) {
      addToast('warning', t('common:explorer.toast.noProjectsToExport'))
      return
    }
    setBatchExporting(true)
    try {
      const names = sortedProjects.map((p) => p.name)
      const result = await batchExportProjects(names)
      if (!result.canceled && result.result) {
        const { successes, failures } = result.result
        if (failures.length === 0) {
          addToast('success', t('common:explorer.toast.batchExportSuccess', { count: successes.length, dir: result.targetDir }))
        } else {
          addToast('warning', t('common:explorer.toast.batchExportPartial', {
            success: successes.length,
            fail: failures.length,
            details: failures.map((f) => `  - ${f.name}: ${f.error}`).join('\n')
          }))
        }
      }
    } catch (err) {
      addToast('error', t('common:explorer.toast.batchExportFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBatchExporting(false)
    }
  }, [batchExporting, batchExportProjects, sortedProjects, addToast, t])

  // T10: 项目文件右键菜单(openFile/showInFileManager/copyFilePath/deleteFile[仅输出文件])
  const buildProjectFileContextMenu = (projectName: string, node: FileTreeNode): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: t('common:explorer.contextMenu.openFile'), action: () => handleProjectFileClick(projectName, node) },
      {
        label: t('common:explorer.contextMenu.showInFileManager'),
        action: async () => {
          const wsp = await window.electron?.app?.getPath('workspace')
          window.electron?.shell?.showItemInFolder(`${wsp}/${projectName}/${node.path}`)
        },
      },
      {
        label: t('common:explorer.contextMenu.copyFilePath'),
        action: async () => {
          const wsp = await window.electron?.app?.getPath('workspace')
          await navigator.clipboard.writeText(`${wsp}/${projectName}/${node.path}`)
          addToast('success', t('common:explorer.toast.filePathCopied', '已复制文件路径'))
        },
      },
    ]
    if (node.path.startsWith('output/')) {
      items.push({
        label: t('common:explorer.contextMenu.deleteFile'),
        danger: true,
        action: async () => {
          const relPath = node.path.substring('output/'.length)
          try {
            await window.electron?.project?.deleteOutputFile(projectName, relPath)
            addToast('success', t('common:explorer.toast.fileDeleted', { name: node.name }))
            await refreshProjectStructure(projectName)
          } catch (err) {
            addToast('error', err instanceof Error ? err.message : String(err))
          }
        },
      })
    }
    return items
  }

  // T10: 真实目录右键菜单(raw 模式,1 项)
  const buildProjectDirContextMenu = (projectName: string, node: FileTreeNode): ContextMenuItem[] => [
    {
      label: t('common:explorer.contextMenu.openInFileManager'),
      action: async () => {
        const wsp = await window.electron?.app?.getPath('workspace')
        window.electron?.shell?.showItemInFolder(`${wsp}/${projectName}/${node.path}`)
      },
    },
  ]

  // T10: 智能分组右键菜单(expandAll/collapseAll)
  const buildProjectGroupContextMenu = (projectName: string, groupKey: GroupKey, nodes: FileTreeNode[], batches: OutputBatch[]): ContextMenuItem[] => [
    {
      label: t('common:explorer.contextMenu.expandAll'),
      action: () => {
        const dirPaths = collectAllDirPaths(nodes)
        if (dirPaths.length > 0) {
          useExplorerStore.setState((s) => {
            const next = { ...s.expandedDirs }
            for (const p of dirPaths) next[`dir:project:${projectName}/${p}`] = true
            return { expandedDirs: next }
          })
        }
        if (groupKey === 'output' && batches.length > 0) {
          useExplorerStore.setState((s) => {
            const next = { ...s.expandedBatches }
            for (const b of batches) next[`batch:${projectName}/${b.name}`] = true
            return { expandedBatches: next }
          })
        }
      },
    },
    {
      label: t('common:explorer.contextMenu.collapseAll'),
      action: () => {
        const dirPaths = collectAllDirPaths(nodes)
        if (dirPaths.length > 0) {
          useExplorerStore.setState((s) => {
            const next = { ...s.expandedDirs }
            for (const p of dirPaths) next[`dir:project:${projectName}/${p}`] = false
            return { expandedDirs: next }
          })
        }
        if (groupKey === 'output' && batches.length > 0) {
          useExplorerStore.setState((s) => {
            const next = { ...s.expandedBatches }
            for (const b of batches) next[`batch:${projectName}/${b.name}`] = false
            return { expandedBatches: next }
          })
        }
      },
    },
  ]

  // T10: 批次节点右键菜单(openInFileManager/deleteBatch)
  const buildBatchContextMenu = (projectName: string, batch: OutputBatch): ContextMenuItem[] => [
    {
      label: t('common:explorer.contextMenu.openInFileManager'),
      action: async () => {
        const wsp = await window.electron?.app?.getPath('workspace')
        window.electron?.shell?.showItemInFolder(`${wsp}/${projectName}/output/${batch.name}`)
      },
    },
    {
      label: t('common:explorer.contextMenu.deleteBatch'),
      danger: true,
      action: async () => {
        try {
          await window.electron?.project?.deleteOutputBatch(projectName, batch.name)
          addToast('success', t('common:explorer.toast.batchDeleted', { name: batch.name }))
          await refreshProjectStructure(projectName)
        } catch (err) {
          addToast('error', err instanceof Error ? err.message : String(err))
        }
      },
    },
  ]

  // T10: 批次内文件右键菜单(4 项)
  const buildBatchFileContextMenu = (projectName: string, batch: OutputBatch, file: OutputBatchFile): ContextMenuItem[] => [
    { label: t('common:explorer.contextMenu.openFile'), action: () => handleBatchFileClick(projectName, batch, file) },
    {
      label: t('common:explorer.contextMenu.showInFileManager'),
      action: async () => {
        const wsp = await window.electron?.app?.getPath('workspace')
        window.electron?.shell?.showItemInFolder(`${wsp}/${file.path}`)
      },
    },
    {
      label: t('common:explorer.contextMenu.copyFilePath'),
      action: async () => {
        const wsp = await window.electron?.app?.getPath('workspace')
        await navigator.clipboard.writeText(`${wsp}/${file.path}`)
        addToast('success', t('common:explorer.toast.filePathCopied', '已复制文件路径'))
      },
    },
    {
      label: t('common:explorer.contextMenu.deleteFile'),
      danger: true,
      action: async () => {
        try {
          await window.electron?.project?.deleteOutputFile(projectName, `${batch.name}/${file.name}`)
          addToast('success', t('common:explorer.toast.fileDeleted', { name: file.name }))
          await refreshProjectStructure(projectName)
        } catch (err) {
          addToast('error', err instanceof Error ? err.message : String(err))
        }
      },
    },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <button
          onClick={() => setShowCreateProjectWizard(true)}
          className="flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded bg-primary-500 hover:bg-primary-600 text-white shrink-0"
          title={t('common:project.new', '新建项目')}
        >
          <Plus size={13} />
          <span>{t('common:project.new', '新建项目')}</span>
        </button>
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('common:search')}
            className="w-full pl-7 pr-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
        </div>
        <button
          onClick={handleImport}
          disabled={importing}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          title={t('common:project.importZip', '导入项目 ZIP')}
        >
          {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        </button>
        {projects.length > 1 && (
          <button
            onClick={handleBatchExport}
            disabled={batchExporting}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('common:project.batchExport', '批量导出项目')}
          >
            {batchExporting ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
          </button>
        )}
        {selectedProjectName && (
          <button
            onClick={() => handleOpenInExplorer(selectedProjectName)}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
            title={t('common:explorer.openInExplorer')}
          >
            <FolderOpen size={14} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto py-1">
        {/* Projects section */}
        <Section title={t('common:explorer.allProjects')} icon={<Folder size={14} />} sectionKey="projects">
          {sortedProjects.map((p) => {
            const isFavorite = favoriteSet.has(p.name)
            const isExpanded = expandedProjects[p.name]
            const structure = projectStructures[p.name] || []
            const batches = outputBatches[p.name] || []
            return (
              <div key={p.name}>
                <TreeNode
                  label={p.name}
                  depth={0}
                  isActive={p.name === selectedProjectName}
                  leading={
                    isFavorite
                      ? <Star size={12} className="text-warning-400" fill="currentColor" />
                      : p.name === selectedProjectName
                        ? <FolderOpen size={12} className="text-gray-400" />
                        : <Folder size={12} className="text-gray-400" />
                  }
                  trailing={p.fileCount != null ? (
                    <span className="text-2xs text-gray-400 dark:text-gray-500">{p.fileCount}</span>
                  ) : undefined}
                  onClick={() => handleOpenProject(p.name)}
                  onArrowClick={() => toggleProjectExpand(p.name)}
                  isExpanded={isExpanded}
                  hasChildren={(p.fileCount ?? 0) > 0 || structure.length > 0}
                  contextMenu={[
                    { label: t('common:explorer.contextMenu.setAsCurrent'), action: () => handleOpenProject(p.name) },
                    { label: t('common:explorer.contextMenu.openInFileManager'), action: () => handleOpenInExplorer(p.name) },
                    { label: t('common:explorer.contextMenu.duplicateProject'), action: () => handleDuplicate(p.name) },
                    { label: t('common:explorer.contextMenu.rename'), action: () => handleRename(p.name) },
                    { label: t('common:explorer.contextMenu.exportZip'), action: () => handleExport(p.name) },
                    { label: t('common:explorer.contextMenu.convertToTemplate'), action: () => handleConvertToTemplate(p.name) },
                    { label: isFavorite ? t('common:explorer.contextMenu.unfavorite') : t('common:explorer.contextMenu.favorite'), action: () => toggleFavorite(p.name) },
                    { label: t('common:explorer.contextMenu.deleteProject'), danger: true, action: () => handleDeleteProject(p) },
                  ]}
                />
                {isExpanded && structure.length > 0 && (
                  renderProjectChildren(p.name, structure, 1, explorerGroupMode, {
                    onFileClick: (node) => handleProjectFileClick(p.name, node),
                    onDirToggle: (scope, relativePath) => toggleDir(scope, relativePath),
                    isDirExpanded: (scope, relativePath) => !!expandedDirs[`dir:${scope}/${relativePath}`],
                    isGroupExpanded: (pn, gk) => !!expandedGroups[`group:${pn}/${gk}`],
                    onGroupToggle: (pn, gk) => toggleGroup(pn, gk),
                    batches,
                    isBatchExpanded: (pn, bn) => !!expandedBatches[`batch:${pn}/${bn}`],
                    onBatchToggle: (pn, bn) => toggleBatch(pn, bn),
                    onBatchFileClick: (pn, batch, file) => handleBatchFileClick(pn, batch, file),
                    fileContextMenuBuilder: (node) => buildProjectFileContextMenu(p.name, node),
                    dirContextMenuBuilder: (node) => buildProjectDirContextMenu(p.name, node),
                    groupContextMenuBuilder: (gk, nodes) => buildProjectGroupContextMenu(p.name, gk, nodes, batches),
                    batchContextMenuBuilder: (batch) => buildBatchContextMenu(p.name, batch),
                    batchFileContextMenuBuilder: (batch, file) => buildBatchFileContextMenu(p.name, batch, file),
                  })
                )}
              </div>
            )
          })}
        </Section>

        {/* Output Section */}
        <OutputSection projects={projects} openTab={openTab} />

        {/* Templates */}
        <TemplateSection templates={templates} openTab={openTab} handleOpenInExplorer={handleOpenInExplorer} />
      </div>

      {/* Confirm Delete Dialog */}
      {deleteTarget && (
        <ConfirmDeleteDialog
          target={deleteTarget}
          onConfirm={async () => {
            const project = projects.find((p) => p.name === deleteTarget.name)
            if (project) {
              await deleteProjects([project.name])
              addToast('success', t('common:explorer.toast.projectDeleted', { name: deleteTarget.name }))
            }
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* Rename/Duplicate Modal */}
      {renameModal && (
        <RenameProjectModal
          title={renameModal.type === 'duplicate' ? t('common:project.duplicate') : t('common:project.rename')}
          label={renameModal.type === 'duplicate' ? t('common:project.newName') : t('common:project.newName')}
          defaultValue={renameModal.type === 'duplicate' ? `${renameModal.projectName}${t('common:explorer.copySuffix')}` : renameModal.projectName}
          onConfirm={handleRenameConfirm}
          onClose={() => setRenameModal(null)}
        />
      )}
    </div>
  )
}

// Simple tree section component
function Section({ title, icon, children, actions, sectionKey }: { title: string; icon: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; sectionKey?: string }) {
  // sectionKey 提供时使用 explorer.store 持久化折叠状态,否则使用局部 state
  const storeCollapsed = useExplorerStore((s) => (sectionKey ? !!s.collapsedSections[sectionKey] : false))
  const toggleSection = useExplorerStore((s) => s.toggleSection)
  const [localExpanded, setLocalExpanded] = React.useState(true)
  const expanded = sectionKey ? !storeCollapsed : localExpanded
  const toggle = () => {
    if (sectionKey) toggleSection(sectionKey)
    else setLocalExpanded(!localExpanded)
  }
  return (
    <div>
      <div className="flex items-center group">
        <button
          onClick={toggle}
          className="flex-1 flex items-center gap-1.5 px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {icon}
          <span>{title}</span>
        </button>
        {actions && (
          <div className="flex items-center pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {actions}
          </div>
        )}
      </div>
      {expanded && <div className="pl-1">{children}</div>}
    </div>
  )
}

// U1: 输出文件图标
function getFileIcon(fileName: string): { Icon: React.ComponentType<{ size?: number; className?: string }>; color: string } {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'xlsx':
    case 'csv':
      return { Icon: FileSpreadsheet, color: 'text-success-500' }
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
      return { Icon: ImageIcon, color: 'text-info-500' }
    case 'json':
    case 'txt':
    case 'md':
      return { Icon: FileText, color: 'text-gray-400' }
    case 'html':
      return { Icon: FileCode, color: 'text-warning-500' }
    default:
      return { Icon: FileIcon, color: 'text-gray-400' }
  }
}

// T8: 文件类型图标映射(两种模式通用)
function getFileTypeIcon(fileName: string): { Icon: React.ComponentType<{ size?: number; className?: string }>; color: string } {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'json':
    case 'ini':
      return { Icon: FileCode, color: 'text-gray-400' }
    case 'xlsx':
    case 'csv':
      return { Icon: FileSpreadsheet, color: 'text-success-500' }
    case 'png':
    case 'jpg':
    case 'jpeg':
      return { Icon: ImageIcon, color: 'text-info-500' }
    case 'txt':
    case 'md':
      return { Icon: FileText, color: 'text-gray-400' }
    default:
      return { Icon: FileIcon, color: 'text-gray-400' }
  }
}

// T8: 智能分组图标映射
const GROUP_ICON_MAP: Record<GroupKey, React.ComponentType<{ size?: number; className?: string }>> = {
  input: FileInput,
  output: FileOutput,
  topology: Network,
  other: FileIcon,
}

// T10: 递归收集所有目录节点路径(用于分组全部展开/折叠)
function collectAllDirPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (list: FileTreeNode[]) => {
    for (const n of list) {
      if (n.type === 'directory') {
        paths.push(n.path)
        if (n.children) walk(n.children)
      }
    }
  }
  walk(nodes)
  return paths
}

// T8: renderTreeNodes 的 handlers 接口
interface TreeHandlers {
  onFileClick: (node: FileTreeNode) => void
  onDirToggle: (scope: string, relativePath: string) => void
  isDirExpanded: (scope: string, relativePath: string) => boolean
  scope: string
  contextMenuBuilder?: (node: FileTreeNode) => ContextMenuItem[]
}

// T8: 统一递归树渲染器(替代 renderProjectStructure 和 renderStructure)
function renderTreeNodes(
  nodes: FileTreeNode[],
  depth: number,
  handlers: TreeHandlers,
): React.ReactNode {
  return nodes.map((node) => {
    if (node.type === 'directory') {
      const isExpanded = handlers.isDirExpanded(handlers.scope, node.path)
      const hasChildren = !!(node.children && node.children.length > 0)
      return (
        <div key={node.path}>
          <TreeNode
            label={node.name}
            depth={depth}
            leading={
              isExpanded
                ? <FolderOpen size={12} className="text-gray-400" />
                : <Folder size={12} className="text-gray-400" />
            }
            onClick={() => handlers.onDirToggle(handlers.scope, node.path)}
            onArrowClick={() => handlers.onDirToggle(handlers.scope, node.path)}
            isExpanded={isExpanded}
            hasChildren={hasChildren}
            contextMenu={handlers.contextMenuBuilder?.(node)}
          />
          {isExpanded && node.children && node.children.length > 0 && (
            renderTreeNodes(node.children, depth + 1, handlers)
          )}
        </div>
      )
    }

    // 文件节点
    const { Icon, color } = getFileTypeIcon(node.name)
    return (
      <TreeNode
        key={node.path}
        label={node.name}
        depth={depth}
        leading={<Icon size={12} className={color} />}
        onClick={() => handlers.onFileClick(node)}
        contextMenu={handlers.contextMenuBuilder?.(node)}
      />
    )
  })
}

// T9: renderProjectChildren 的 handlers 接口(explorer.store 接入 + 批次 + 右键菜单)
interface ProjectChildrenHandlers {
  onFileClick: (node: FileTreeNode) => void
  onDirToggle: (scope: string, relativePath: string) => void
  isDirExpanded: (scope: string, relativePath: string) => boolean
  isGroupExpanded?: (projectName: string, groupKey: string) => boolean
  onGroupToggle?: (projectName: string, groupKey: string) => void
  // T9: output 批次(smart 模式优先使用 batches 数据)
  batches?: OutputBatch[]
  isBatchExpanded?: (projectName: string, batchName: string) => boolean
  onBatchToggle?: (projectName: string, batchName: string) => void
  onBatchFileClick?: (projectName: string, batch: OutputBatch, file: OutputBatchFile) => void
  // T10: 右键菜单构建器
  fileContextMenuBuilder?: (node: FileTreeNode) => ContextMenuItem[]
  dirContextMenuBuilder?: (node: FileTreeNode) => ContextMenuItem[]
  groupContextMenuBuilder?: (groupKey: GroupKey, nodes: FileTreeNode[]) => ContextMenuItem[]
  batchContextMenuBuilder?: (batch: OutputBatch) => ContextMenuItem[]
  batchFileContextMenuBuilder?: (batch: OutputBatch, file: OutputBatchFile) => ContextMenuItem[]
}

// T9: 项目子节点渲染(双模式:smart/raw)
function renderProjectChildren(
  projectName: string,
  structure: FileTreeNode[],
  depth: number,
  groupMode: ExplorerGroupMode,
  handlers: ProjectChildrenHandlers,
): React.ReactNode {
  const treeHandlers: TreeHandlers = {
    onFileClick: handlers.onFileClick,
    onDirToggle: handlers.onDirToggle,
    isDirExpanded: handlers.isDirExpanded,
    scope: `project:${projectName}`,
    contextMenuBuilder: (node) => node.type === 'directory'
      ? (handlers.dirContextMenuBuilder?.(node) ?? [])
      : (handlers.fileContextMenuBuilder?.(node) ?? []),
  }

  if (groupMode === 'raw') {
    // raw 模式:直接递归渲染真实目录树
    return renderTreeNodes(structure, depth, treeHandlers)
  }

  // smart 模式:按文件用途智能分组
  const groups: GroupedNode[] = groupProjectFiles(structure)

  return groups.map((group) => {
    const groupKey = group.group
    const isExpanded = handlers.isGroupExpanded?.(projectName, groupKey) ?? false
    const GroupIcon = GROUP_ICON_MAP[groupKey]
    const hasChildren = group.nodes.length > 0

    return (
      <div key={`group:${projectName}/${groupKey}`}>
        <TreeNode
          label={i18next.t(`common:explorer.group.${groupKey}`)}
          depth={depth}
          leading={<GroupIcon size={12} className="text-gray-400" />}
          onClick={() => handlers.onGroupToggle?.(projectName, groupKey)}
          onArrowClick={() => handlers.onGroupToggle?.(projectName, groupKey)}
          isExpanded={isExpanded}
          hasChildren={hasChildren}
          contextMenu={handlers.groupContextMenuBuilder?.(groupKey, group.nodes)}
        />
        {isExpanded && hasChildren && (
          groupKey === 'output'
            ? renderOutputGroup(group.nodes, depth + 1, treeHandlers, projectName, handlers)
            : renderTreeNodes(group.nodes, depth + 1, treeHandlers)
        )}
      </div>
    )
  })
}

// T9: output 分组特殊处理 — 优先使用 batches 数据渲染批次节点,回退到目录结构
function renderOutputGroup(
  nodes: FileTreeNode[],
  depth: number,
  treeHandlers: TreeHandlers,
  projectName: string,
  handlers: ProjectChildrenHandlers,
): React.ReactNode {
  // 优先使用 batches(smart 模式下由 listOutputBatches 提供)
  if (handlers.batches && handlers.batches.length > 0) {
    return handlers.batches.map((batch) => {
      const isExpanded = handlers.isBatchExpanded?.(projectName, batch.name) ?? false
      const hasChildren = batch.files.length > 0
      return (
        <div key={`batch:${projectName}/${batch.name}`}>
          <TreeNode
            label={batch.name}
            depth={depth}
            leading={
              isExpanded
                ? <FolderOpen size={12} className="text-gray-400" />
                : <Folder size={12} className="text-gray-400" />
            }
            onClick={() => handlers.onBatchToggle?.(projectName, batch.name)}
            onArrowClick={() => handlers.onBatchToggle?.(projectName, batch.name)}
            isExpanded={isExpanded}
            hasChildren={hasChildren}
            contextMenu={handlers.batchContextMenuBuilder?.(batch)}
          />
          {isExpanded && batch.files.map((f) => {
            const { Icon, color } = getFileTypeIcon(f.name)
            return (
              <TreeNode
                key={f.path}
                label={f.name}
                depth={depth + 1}
                leading={<Icon size={12} className={color} />}
                onClick={() => handlers.onBatchFileClick?.(projectName, batch, f)}
                contextMenu={handlers.batchFileContextMenuBuilder?.(batch, f)}
              />
            )
          })}
        </div>
      )
    })
  }

  // 回退:从目录结构渲染批次(output/ 目录下的子目录)
  const outputDir = nodes.find((n) => n.type === 'directory' && n.name === 'output')
  const batchDirs = outputDir?.children ?? nodes

  return batchDirs.map((batch) => {
    if (batch.type !== 'directory') {
      // output 根目录下的散落文件,直接渲染
      const { Icon, color } = getFileTypeIcon(batch.name)
      return (
        <TreeNode
          key={batch.path}
          label={batch.name}
          depth={depth}
          leading={<Icon size={12} className={color} />}
          onClick={() => handlers.onFileClick(batch)}
          contextMenu={handlers.fileContextMenuBuilder?.(batch)}
        />
      )
    }

    // 批次目录节点
    const batchPath = batch.path
    const isExpanded = treeHandlers.isDirExpanded(treeHandlers.scope, batchPath)
    const hasChildren = !!(batch.children && batch.children.length > 0)

    return (
      <div key={batchPath}>
        <TreeNode
          label={batch.name}
          depth={depth}
          leading={
            isExpanded
              ? <FolderOpen size={12} className="text-gray-400" />
              : <Folder size={12} className="text-gray-400" />
          }
          onClick={() => treeHandlers.onDirToggle(treeHandlers.scope, batchPath)}
          onArrowClick={() => treeHandlers.onDirToggle(treeHandlers.scope, batchPath)}
          isExpanded={isExpanded}
          hasChildren={hasChildren}
          contextMenu={handlers.dirContextMenuBuilder?.(batch)}
        />
        {isExpanded && batch.children && batch.children.length > 0 && (
          renderTreeNodes(batch.children, depth + 1, treeHandlers)
        )}
      </div>
    )
  })
}

// T11: renderTemplateChildren 的 handlers 接口
interface TemplateChildrenHandlers {
  onFileClick: (node: FileTreeNode) => void
  onDirToggle: (scope: string, relativePath: string) => void
  isDirExpanded: (scope: string, relativePath: string) => boolean
  isGroupExpanded?: (templateName: string, groupKey: string) => boolean
  onGroupToggle?: (templateName: string, groupKey: string) => void
  fileContextMenuBuilder?: (node: FileTreeNode) => ContextMenuItem[]
  dirContextMenuBuilder?: (node: FileTreeNode) => ContextMenuItem[]
  groupContextMenuBuilder?: (groupKey: GroupKey, nodes: FileTreeNode[]) => ContextMenuItem[]
}

// T11: 模板子节点渲染(双模式:smart/raw,无 output 批次处理)
function renderTemplateChildren(
  templateName: string,
  structure: FileTreeNode[],
  depth: number,
  groupMode: ExplorerGroupMode,
  handlers: TemplateChildrenHandlers,
): React.ReactNode {
  const treeHandlers: TreeHandlers = {
    onFileClick: handlers.onFileClick,
    onDirToggle: handlers.onDirToggle,
    isDirExpanded: handlers.isDirExpanded,
    scope: `template:${templateName}`,
    contextMenuBuilder: (node) => node.type === 'directory'
      ? (handlers.dirContextMenuBuilder?.(node) ?? [])
      : (handlers.fileContextMenuBuilder?.(node) ?? []),
  }

  if (groupMode === 'raw') {
    return renderTreeNodes(structure, depth, treeHandlers)
  }

  // smart 模式:配置文件/其他文件
  const groups: GroupedNode[] = groupTemplateFiles(structure)
  return groups.map((group) => {
    const groupKey = group.group
    const isExpanded = handlers.isGroupExpanded?.(templateName, groupKey) ?? false
    const GroupIcon = GROUP_ICON_MAP[groupKey]
    const hasChildren = group.nodes.length > 0
    return (
      <div key={`group:template:${templateName}/${groupKey}`}>
        <TreeNode
          label={i18next.t(`common:explorer.group.${groupKey}`)}
          depth={depth}
          leading={<GroupIcon size={12} className="text-gray-400" />}
          onClick={() => handlers.onGroupToggle?.(templateName, groupKey)}
          onArrowClick={() => handlers.onGroupToggle?.(templateName, groupKey)}
          isExpanded={isExpanded}
          hasChildren={hasChildren}
          contextMenu={handlers.groupContextMenuBuilder?.(groupKey, group.nodes)}
        />
        {isExpanded && hasChildren && (
          renderTreeNodes(group.nodes, depth + 1, treeHandlers)
        )}
      </div>
    )
  })
}

// Output section: lists output batches per project
function OutputSection({ projects, openTab }: {
  projects: { name: string }[]
  openTab: (tab: Omit<import('@/stores/workspace.store').WorkspaceTab, 'id'>) => string
}) {
  const { t } = useTranslation()
  // T12: 展开/批次状态改用 explorer.store
  const expandedOutputProjects = useExplorerStore((s) => s.expandedOutputProjects)
  const outputBatches = useExplorerStore((s) => s.outputBatches)
  const expandedBatches = useExplorerStore((s) => s.expandedBatches)
  const toggleOutputProject = useExplorerStore((s) => s.toggleOutputProject)
  const toggleBatch = useExplorerStore((s) => s.toggleBatch)
  const setOutputBatches = useExplorerStore((s) => s.setOutputBatches)
  const addToast = useToastStore((s) => s.addToast)
  // T12: 删除上下文(比按名称匹配更可靠)
  const [deleteCtx, setDeleteCtx] = useState<{
    type: 'batch' | 'file'
    projectName: string
    batchName: string
    fileName?: string
  } | null>(null)

  const deleteTarget: DeleteTarget | null = deleteCtx
    ? { type: deleteCtx.type, name: deleteCtx.type === 'batch' ? deleteCtx.batchName : (deleteCtx.fileName || '') }
    : null

  const refreshBatches = useCallback(async (projectName: string) => {
    try {
      const batches = await window.electron.project.listOutputBatches(projectName)
      setOutputBatches(projectName, batches)
    } catch {
      setOutputBatches(projectName, [])
    }
  }, [setOutputBatches])

  // T12: 首次展开拉取批次并缓存到 store
  const toggleProject = useCallback(async (projectName: string) => {
    const currently = expandedOutputProjects[projectName]
    if (!currently && !outputBatches[projectName]) {
      try {
        const batches = await window.electron.project.listOutputBatches(projectName)
        setOutputBatches(projectName, batches)
      } catch {
        setOutputBatches(projectName, [])
      }
    }
    toggleOutputProject(projectName)
  }, [expandedOutputProjects, outputBatches, toggleOutputProject, setOutputBatches])

  const handleFileClick = useCallback((filePath: string, fileName: string) => {
    openTab({
      type: 'fileViewer',
      title: fileName,
      closable: true,
      state: { filePath, isTemplate: false },
    })
  }, [openTab])

  // T12: 批次右键菜单(openInFileManager/deleteBatch)
  const buildBatchContextMenu = (projectName: string, batchName: string): ContextMenuItem[] => [
    {
      label: t('common:explorer.contextMenu.openInFileManager'),
      action: async () => {
        const wsp = await window.electron?.app?.getPath('workspace')
        window.electron?.shell?.showItemInFolder(`${wsp}/${projectName}/output/${batchName}`)
      },
    },
    {
      label: t('common:explorer.contextMenu.deleteBatch'),
      danger: true,
      action: () => setDeleteCtx({ type: 'batch', projectName, batchName }),
    },
  ]

  // T12: 文件右键菜单(openFile/showInFileManager/copyFilePath/deleteFile)
  const buildFileContextMenu = (projectName: string, batchName: string, filePath: string, fileName: string): ContextMenuItem[] => [
    { label: t('common:explorer.contextMenu.openFile'), action: () => handleFileClick(filePath, fileName) },
    {
      label: t('common:explorer.contextMenu.showInFileManager'),
      action: async () => {
        const wsp = await window.electron?.app?.getPath('workspace')
        window.electron?.shell?.showItemInFolder(`${wsp}/${filePath}`)
      },
    },
    {
      label: t('common:explorer.contextMenu.copyFilePath'),
      action: async () => {
        const wsp = await window.electron?.app?.getPath('workspace')
        await navigator.clipboard.writeText(`${wsp}/${filePath}`)
        addToast('success', t('common:explorer.toast.filePathCopied', '已复制文件路径'))
      },
    },
    {
      label: t('common:explorer.contextMenu.deleteFile'),
      danger: true,
      action: () => setDeleteCtx({ type: 'file', projectName, batchName, fileName }),
    },
  ]

  if (projects.length === 0) return null

  return (
    <>
      <Section title={t('common:explorer.outputFiles')} icon={<FileOutput size={14} />} sectionKey="output">
        {projects.map((p) => {
          const isExpanded = expandedOutputProjects[p.name]
          const batches = outputBatches[p.name] || []
          return (
            <div key={p.name}>
              <TreeNode
                label={p.name}
                depth={0}
                leading={<FolderOpen size={12} className="text-gray-400" />}
                onClick={() => toggleProject(p.name)}
                onArrowClick={() => toggleProject(p.name)}
                isExpanded={isExpanded}
                hasChildren
              />
              {isExpanded && batches.length === 0 && (
                <div className="text-2xs text-gray-400 italic py-0.5" style={{ paddingLeft: '16px' }}>
                  {t('common:noData', '暂无输出批次')}
                </div>
              )}
              {isExpanded && batches.map((batch) => {
                const isBatchExpanded = expandedBatches[`batch:${p.name}/${batch.name}`]
                return (
                  <div key={`batch:${p.name}/${batch.name}`}>
                    <TreeNode
                      label={batch.name}
                      depth={1}
                      leading={
                        isBatchExpanded
                          ? <FolderOpen size={12} className="text-gray-400" />
                          : <Folder size={12} className="text-gray-400" />
                      }
                      onClick={() => toggleBatch(p.name, batch.name)}
                      onArrowClick={() => toggleBatch(p.name, batch.name)}
                      isExpanded={isBatchExpanded}
                      hasChildren={batch.files.length > 0}
                      contextMenu={buildBatchContextMenu(p.name, batch.name)}
                    />
                    {isBatchExpanded && batch.files.map((f) => {
                      const { Icon, color } = getFileIcon(f.name)
                      return (
                        <TreeNode
                          key={f.path}
                          label={f.name}
                          depth={2}
                          leading={<Icon size={12} className={color} />}
                          onClick={() => handleFileClick(f.path, f.name)}
                          contextMenu={buildFileContextMenu(p.name, batch.name, f.path, f.name)}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </Section>

      {/* Confirm Delete Dialog */}
      {deleteTarget && (
        <ConfirmDeleteDialog
          target={deleteTarget}
          onConfirm={async () => {
            if (!deleteCtx) return
            try {
              if (deleteCtx.type === 'batch') {
                await window.electron.project.deleteOutputBatch(deleteCtx.projectName, deleteCtx.batchName)
                addToast('success', t('common:explorer.toast.batchDeleted', { name: deleteCtx.batchName }))
              } else {
                // deleteOutputFile 期望相对 output 目录的路径:batchName/fileName
                await window.electron.project.deleteOutputFile(deleteCtx.projectName, `${deleteCtx.batchName}/${deleteCtx.fileName}`)
                addToast('success', t('common:explorer.toast.fileDeleted', { name: deleteCtx.fileName }))
              }
              await refreshBatches(deleteCtx.projectName)
            } catch (err) {
              addToast('error', err instanceof Error ? err.message : String(err))
            }
          }}
          onClose={() => setDeleteCtx(null)}
        />
      )}
    </>
  )
}

// Template section with expandable file tree
function TemplateSection({ templates, openTab, handleOpenInExplorer }: {
  templates: { id: string; name: string; description?: string; scenario?: string; tags?: string[]; isBuiltin?: boolean }[]
  openTab: (tab: Omit<import('@/stores/workspace.store').WorkspaceTab, 'id'>) => string
  handleOpenInExplorer: (name: string) => void
}) {
  const { t } = useTranslation()
  const explorerGroupMode = useUIStore((s) => s.explorerGroupMode)
  // T11: 模板展开状态改用 explorer.store
  const expandedTemplates = useExplorerStore((s) => s.expandedTemplates)
  const templateStructures = useExplorerStore((s) => s.templateStructures)
  const expandedGroups = useExplorerStore((s) => s.expandedGroups)
  const expandedDirs = useExplorerStore((s) => s.expandedDirs)
  const toggleTemplateStore = useExplorerStore((s) => s.toggleTemplate)
  const toggleGroup = useExplorerStore((s) => s.toggleGroup)
  const toggleDir = useExplorerStore((s) => s.toggleDir)
  const setTemplateStructure = useExplorerStore((s) => s.setTemplateStructure)
  const { deleteTemplate, updateTemplate, exportTemplate, importTemplate } = useProjectStore()
  const addToast = useToastStore((s) => s.addToast)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; description: string; scenario: string; tags: string[]; isBuiltin?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  // T11: 首次展开拉取结构并缓存到 store
  const toggleTemplateExpand = useCallback(async (tplName: string) => {
    const currently = expandedTemplates[tplName]
    if (!currently && !templateStructures[tplName]) {
      try {
        const structure = await window.electron.template.getStructure(tplName)
        setTemplateStructure(tplName, (structure as FileTreeNode[]) || [])
      } catch {
        setTemplateStructure(tplName, [])
      }
    }
    toggleTemplateStore(tplName)
  }, [expandedTemplates, templateStructures, toggleTemplateStore, setTemplateStructure])

  // T6: 点击模板内文件 → 打开 fileViewer (filePath 用 node.path 相对模板根)
  const handleTemplateFileClick = useCallback((tplName: string, node: FileTreeNode) => {
    openTab({
      type: 'fileViewer',
      title: node.name,
      closable: true,
      state: { templateName: tplName, filePath: node.path, isTemplate: true },
    })
  }, [openTab])

  const handleEditTemplate = useCallback((tpl: { id: string; name: string; description?: string; scenario?: string; tags?: string[]; isBuiltin?: boolean }) => {
    if (tpl.isBuiltin) {
      addToast('warning', t('common:explorer.toast.builtinTemplateNotEditable'))
      return
    }
    setEditTarget({
      id: tpl.id,
      name: tpl.name,
      description: tpl.description || '',
      scenario: tpl.scenario || '',
      tags: tpl.tags || [],
      isBuiltin: tpl.isBuiltin,
    })
  }, [addToast])

  const handleEditConfirm = useCallback(async (updates: { name: string; description: string; scenario: string; tags: string[]; configContent?: string }) => {
    if (!editTarget) return
    await updateTemplate(editTarget.id, updates)
    addToast('success', t('common:explorer.toast.templateUpdated', { id: editTarget.id }))
  }, [editTarget, updateTemplate, addToast])

  const handleExportTemplate = useCallback(async (tplName: string) => {
    if (busy) return
    setBusy(true)
    try {
      const result = await exportTemplate(tplName)
      if (!result.canceled && result.zipPath) {
        addToast('success', t('common:explorer.toast.templateExported', { name: tplName, path: result.zipPath }))
      }
    } catch (err) {
      addToast('error', t('common:explorer.toast.exportFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }, [busy, exportTemplate, addToast])

  const handleImportTemplate = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await importTemplate()
      if (!result.canceled && result.templateName) {
        addToast('success', t('common:explorer.toast.templateImported', { name: result.templateName }))
      }
    } catch (err) {
      addToast('error', t('common:explorer.toast.importFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }, [busy, importTemplate, addToast])

  // T11: 模板文件右键菜单(openFile)
  const buildTemplateFileContextMenu = (tplName: string, node: FileTreeNode): ContextMenuItem[] => [
    { label: t('common:explorer.contextMenu.openFile'), action: () => handleTemplateFileClick(tplName, node) },
  ]

  // T11: 模板目录右键菜单(openInFileManager)
  const buildTemplateDirContextMenu = (tplName: string, _node: FileTreeNode): ContextMenuItem[] => [
    {
      label: t('common:explorer.contextMenu.openInFileManager'),
      action: () => handleOpenInExplorer(tplName),
    },
  ]

  // T11: 智能分组右键菜单(expandAll/collapseAll)
  const buildTemplateGroupContextMenu = (tplName: string, _groupKey: GroupKey, nodes: FileTreeNode[]): ContextMenuItem[] => [
    {
      label: t('common:explorer.contextMenu.expandAll'),
      action: () => {
        const dirPaths = collectAllDirPaths(nodes)
        if (dirPaths.length > 0) {
          useExplorerStore.setState((s) => {
            const next = { ...s.expandedDirs }
            for (const p of dirPaths) next[`dir:template:${tplName}/${p}`] = true
            return { expandedDirs: next }
          })
        }
      },
    },
    {
      label: t('common:explorer.contextMenu.collapseAll'),
      action: () => {
        const dirPaths = collectAllDirPaths(nodes)
        if (dirPaths.length > 0) {
          useExplorerStore.setState((s) => {
            const next = { ...s.expandedDirs }
            for (const p of dirPaths) next[`dir:template:${tplName}/${p}`] = false
            return { expandedDirs: next }
          })
        }
      },
    },
  ]

  return (
    <>
      <Section
        title={t('common:explorer.templateCenter')}
        icon={<Folder size={14} />}
        sectionKey="templates"
        actions={
          <button
            onClick={handleImportTemplate}
            disabled={busy}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 disabled:opacity-50"
            title={t('common:template.importZip', '导入模板 ZIP')}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          </button>
        }
      >
        {templates.map((tpl) => {
          const isExpanded = expandedTemplates[tpl.name]
          const structure = templateStructures[tpl.name] || []
          return (
            <div key={tpl.id}>
              <TreeNode
                label={
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{tpl.name}</span>
                    {tpl.isBuiltin && (
                      <span className="shrink-0 text-3xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1 rounded">
                        {t('common:template.builtin', '内置')}
                      </span>
                    )}
                    {tpl.description && (
                      <span className="truncate text-2xs text-gray-400 dark:text-gray-500 max-w-[100px]">
                        {tpl.description}
                      </span>
                    )}
                  </span>
                }
                depth={0}
                onClick={() => toggleTemplateExpand(tpl.name)}
                onArrowClick={() => toggleTemplateExpand(tpl.name)}
                isExpanded={isExpanded}
                hasChildren
                leading={<LayoutTemplate size={12} className="text-gray-400 dark:text-gray-500 shrink-0" />}
                contextMenu={[
                  { label: t('common:explorer.contextMenu.viewTemplateFiles'), action: () => toggleTemplateExpand(tpl.name) },
                  { label: t('common:explorer.contextMenu.openInFileManager'), action: () => handleOpenInExplorer(tpl.name) },
                  { label: t('common:explorer.contextMenu.exportZip'), action: () => handleExportTemplate(tpl.name) },
                  ...(tpl.isBuiltin
                    ? []
                    : [
                        { label: t('common:explorer.contextMenu.editTemplate'), action: () => handleEditTemplate(tpl) },
                        { label: t('common:explorer.contextMenu.deleteTemplate'), action: () => setDeleteTarget({ name: tpl.name, type: 'template' as const }) },
                      ]
                  ),
                ]}
              />
              {isExpanded && structure.length === 0 && (
                <div className="text-2xs text-gray-400 italic py-0.5" style={{ paddingLeft: '28px' }}>
                  {t('common:explorer.noTemplateFiles')}
                </div>
              )}
              {isExpanded && structure.length > 0 && (
                renderTemplateChildren(tpl.name, structure, 1, explorerGroupMode, {
                  onFileClick: (node) => handleTemplateFileClick(tpl.name, node),
                  onDirToggle: (scope, relativePath) => toggleDir(scope, relativePath),
                  isDirExpanded: (scope, relativePath) => !!expandedDirs[`dir:${scope}/${relativePath}`],
                  isGroupExpanded: (tplName, gk) => !!expandedGroups[`group:${tplName}/${gk}`],
                  onGroupToggle: (tplName, gk) => toggleGroup(tplName, gk),
                  fileContextMenuBuilder: (node) => buildTemplateFileContextMenu(tpl.name, node),
                  dirContextMenuBuilder: (node) => buildTemplateDirContextMenu(tpl.name, node),
                  groupContextMenuBuilder: (gk, nodes) => buildTemplateGroupContextMenu(tpl.name, gk, nodes),
                })
              )}
            </div>
          )
        })}
      </Section>

      {/* Confirm Delete Dialog */}
      {deleteTarget && (
        <ConfirmDeleteDialog
          target={deleteTarget}
          onConfirm={async () => {
            await deleteTemplate(deleteTarget.name)
            addToast('success', t('common:explorer.toast.templateDeleted', { name: deleteTarget.name }))
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* Edit Template Modal */}
      {editTarget && (
        <EditTemplateModal
          template={editTarget}
          onConfirm={handleEditConfirm}
          onClose={() => setEditTarget(null)}
        />
      )}
    </>
  )
}

function DesignExplorer() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const config = useDesignStore((s) => s.config)
  const generating = useDesignStore((s) => s.generating)
  const summary = useDesignStore((s) => s.summary)
  const valid = useDesignStore((s) => s.valid)
  const updateConfig = useDesignStore((s) => s.updateConfig)
  const generate = useDesignStore((s) => s.generate)
  const loadConfig = useDesignStore((s) => s.loadConfig)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const addToast = useToastStore((s) => s.addToast)
  const initFromTopology = useRackStore((s) => s.initFromTopology)

  useEffect(() => {
    if (selectedProjectName) loadConfig(selectedProjectName)
  }, [selectedProjectName])

  const handleGenerate = async () => {
    if (!selectedProjectName) return
    try {
      await generate(selectedProjectName)
      const topology = useDesignStore.getState().topology
      if (topology?.nodes?.length) {
        openTab({ type: 'visualization', title: `${t('common:menu.topology')} - ${selectedProjectName}`, closable: true })
        initFromTopology(topology.nodes)
      }
      const err = useDesignStore.getState().error
      if (err) addToast('error', err)
    } catch (err) { addToast('error', (err as Error).message) }
  }

  const handleOpenFullDesign = () => {
    openTab({ type: 'design', title: t('common:menu.design'), closable: true })
  }

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Wrench size={28} className="text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-xs text-gray-400">{t('common:explorer.design.selectProject')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('common:explorer.design.title')}</span>
        <button onClick={handleOpenFullDesign}
          className="text-2xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
          {t('common:explorer.design.openFullSize')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Mode selector */}
        <select value={config.downlink_mode}
          onChange={(e) => updateConfig({ downlink_mode: e.target.value as 'full' | 'custom' })}
          className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200">
          <option value="full">{t('common:explorer.design.fullMode')}</option>
          <option value="custom">{t('common:explorer.design.customMode')}</option>
        </select>

        {/* Server config */}
        <div className="space-y-2">
          <label className="text-2xs text-gray-500 uppercase tracking-wider">{t('common:explorer.design.gpuServer')}</label>
          <NumberInputMini label={t('common:explorer.design.gpuCount')} value={config.num_servers}
            onChange={(v) => updateConfig({ num_servers: v })} />
          <NumberInputMini label={t('common:explorer.design.paramPortsPerServer')} value={config.param_ports_per_server}
            onChange={(v) => updateConfig({ param_ports_per_server: v })} />
        </div>

        {/* Switch config */}
        <div className="space-y-2">
          <label className="text-2xs text-gray-500 uppercase tracking-wider">{t('common:explorer.design.switchParams')}</label>
          <NumberInputMini label={t('common:explorer.design.paramSwitchPorts')} value={config.param_switch_ports}
            onChange={(v) => updateConfig({ param_switch_ports: v })} />
          <SelectMini label={t('common:explorer.design.paramNetworkSpeed')} value={config.param_speed}
            onChange={(v) => updateConfig({ param_speed: v })}
            options={['100G','200G','400G','800G'].map(v => ({ value: v, label: v }))} />
        </div>

        {/* Network toggles */}
        <div className="space-y-1.5">
          <Toggle size="sm" label={t('common:explorer.design.bizInbandMgmt')} checked={config.biz_enabled}
            onChange={(v) => updateConfig({ biz_enabled: v })} />
          <Toggle size="sm" label={t('common:explorer.design.oobMgmt')} checked={config.oob_enabled}
            onChange={(v) => updateConfig({ oob_enabled: v })} />
        </div>

        {/* Generate button */}
        <button onClick={handleGenerate} disabled={generating || !selectedProjectName}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50">
          {generating ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {t('common:explorer.design.generateTopology')}
        </button>

        {/* Design summary */}
        {summary && (
          <div className="border border-gray-200 dark:border-gray-700 rounded p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              {valid ? <CheckCircle size={12} className="text-gray-400" /> : <XCircle size={12} className="text-gray-400" />}
              <span className="text-2xs font-medium text-gray-700 dark:text-gray-300">
                {valid ? t('common:explorer.design.validationPassed') : t('common:explorer.design.validationFailed')}
              </span>
            </div>
            <div className="text-2xs text-gray-500 dark:text-gray-400 space-y-0.5">
              <div>GPU: {summary.numServers} · Leaf: {summary.paramLeafCount} · Spine: {summary.paramSpineCount}</div>
              <div>{summary.paramSpeed} · {summary.storageSpeed}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WorkbenchExplorer() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const summary = useDesignStore((s) => s.summary)
  const valid = useDesignStore((s) => s.valid)
  const cabinets = useRackStore((s) => s.cabinets)
  const unplacedDevices = useRackStore((s) => s.unplacedDevices)
  const selectedOutputTypes = useRenderStore((s) => s.selectedOutputTypes)
  const toggleOutputType = useRenderStore((s) => s.toggleOutputType)
  const openTab = useWorkspaceStore((s) => s.openTab)

  const handleOpenFullWorkbench = () => {
    openTab({ type: 'workbench', title: t('common:explorer.workbench.title'), closable: false })
  }

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Zap size={28} className="text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-xs text-gray-400">{t('common:explorer.workbench.selectProject')}</p>
      </div>
    )
  }

  const totalDevices = cabinets.reduce((sum, c) => sum + c.devices.length, 0) + unplacedDevices.length
  const placedDevices = cabinets.reduce((sum, c) => sum + c.devices.length, 0)
  const rackReady = totalDevices > 0 && placedDevices === totalDevices

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('common:explorer.workbench.title')}</span>
        <button onClick={handleOpenFullWorkbench}
          className="text-2xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
          {t('common:explorer.workbench.openFullSize')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Project info */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs">
            <FolderOpen size={12} className="text-gray-400" />
            <span className="font-medium text-gray-700 dark:text-gray-200 truncate">{selectedProjectName}</span>
          </div>
        </div>

        {/* Readiness */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            {valid === true ? <CheckCircle size={11} className="text-gray-400" />
              : valid === false ? <XCircle size={11} className="text-gray-400" />
              : <AlertTriangle size={11} className="text-gray-400" />}
            <span className="text-2xs text-gray-500">
              {valid === true ? t('common:explorer.workbench.topologyPassed') : valid === false ? t('common:explorer.workbench.topologyFailed') : t('common:explorer.workbench.topologyPending')}
            </span>
            {summary && <span className="text-2xs text-gray-400">({summary.totalServers})</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {rackReady ? <CheckCircle size={11} className="text-gray-400" />
              : totalDevices > 0 ? <AlertTriangle size={11} className="text-gray-400" />
              : <AlertTriangle size={11} className="text-gray-400" />}
            <span className="text-2xs text-gray-500">
              {totalDevices === 0 ? t('common:explorer.workbench.rackPending') : rackReady ? t('common:explorer.workbench.rackReady', { count: placedDevices }) : t('common:explorer.workbench.rackPartial', { placed: placedDevices, total: totalDevices })}
            </span>
          </div>
        </div>

        {/* Output types */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-2xs font-medium text-gray-500 dark:text-gray-400">{t('common:explorer.workbench.outputTypes')}</div>
          <div className="p-2 space-y-1">
            {([
              { type: 'connections' as const, icon: <FileSpreadsheet size={12} className="text-gray-400" />, label: t('common:explorer.workbench.connectionTable') },
              { type: 'rackTable' as const, icon: <Table2 size={12} className="text-gray-400" />, label: t('common:explorer.workbench.rackTable') },
              { type: 'topology' as const, icon: <GitBranch size={12} className="text-gray-400" />, label: t('common:explorer.workbench.topologyDiagram') },
              { type: 'deviceList' as const, icon: <List size={12} className="text-gray-400" />, label: t('common:explorer.workbench.deviceList') },
            ]).map(def => (
              <label key={def.type} className="flex items-center gap-2 cursor-pointer py-0.5">
                <input type="checkbox" checked={selectedOutputTypes.includes(def.type)}
                  onChange={() => toggleOutputType(def.type)} className="text-primary-500 shrink-0 w-3 h-3" />
                {def.icon}
                <span className="text-2xs text-gray-600 dark:text-gray-400">{def.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function VisualizationExplorer() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const topology = useDesignStore((s) => s.topology)
  const cabinets = useRackStore((s) => s.cabinets)
  const openTab = useWorkspaceStore((s) => s.openTab)

  const handleOpenFullVisualization = () => {
    openTab({ type: 'visualization', title: t('common:explorer.visualization.title'), closable: false })
  }

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <GitBranch size={28} className="text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-xs text-gray-400">{t('common:explorer.visualization.selectProject')}</p>
      </div>
    )
  }

  const nodeStats: Record<string, number> = {}
  if (topology?.nodes) {
    for (const node of topology.nodes) {
      nodeStats[node.type] = (nodeStats[node.type] || 0) + 1
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('common:explorer.visualization.title')}</span>
        <button onClick={handleOpenFullVisualization}
          className="text-2xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
          {t('common:explorer.visualization.openFullSize')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {!topology ? (
          <div className="text-center py-6">
            <GitBranch size={24} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-400">{t('common:explorer.visualization.noTopology')}</p>
            <p className="text-2xs text-gray-400 mt-0.5">{t('common:explorer.visualization.generateInDesign')}</p>
          </div>
        ) : (
          <>
            {/* Topology Overview */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-1.5">
              <label className="text-2xs text-gray-500 uppercase tracking-wider">{t('common:explorer.visualization.topologyOverview')}</label>
              <div className="space-y-1 text-2xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('common:explorer.visualization.totalNodes')}</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{topology.nodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('common:explorer.visualization.totalConnections')}</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{topology.edges.length}</span>
                </div>
              </div>
            </div>

            {/* Node Type Stats */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5">
              <label className="text-2xs text-gray-500 uppercase tracking-wider">{t('common:explorer.visualization.nodeTypeStats')}</label>
              <div className="mt-1.5 space-y-1">
                {Object.entries(nodeStats).map(([type, count]) => (
                  <div key={type} className="flex justify-between items-center">
                    <span className="text-2xs text-gray-500">{NODE_TYPE_LABELS[type] || type}</span>
                    <span className="text-2xs font-medium text-gray-700 dark:text-gray-300">{count}</span>
                  </div>
                ))}
                {Object.keys(nodeStats).length === 0 && (
                  <p className="text-2xs text-gray-400 italic">{t('common:explorer.visualization.noNodeData')}</p>
                )}
              </div>
            </div>

            {/* Cabinet List */}
            {cabinets.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5">
                <label className="text-2xs text-gray-500 uppercase tracking-wider">{t('common:explorer.visualization.cabinetList')}</label>
                <div className="mt-1.5 space-y-1">
                  {cabinets.map((cab) => (
                    <div key={cab.id} className="flex justify-between items-center">
                      <span className="text-2xs text-gray-500 truncate max-w-[120px]">{cab.name}</span>
                      <span className="text-2xs font-medium text-gray-700 dark:text-gray-300">{cab.devices.length}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ================================================== */
/*  DeviceLibExplorer — hierarchical category tree    */
/* ================================================== */

interface CategoryTreeNode {
  key: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  children?: { key: string; label: string }[]
}

const DEVICE_CATEGORY_TREE: CategoryTreeNode[] = [
  { key: 'gpu_servers', label: 'gpuServers', icon: Cpu },
  { key: 'storage_servers', label: 'storageServers', icon: Database, children: [
    { key: 'storage_servers_all_flash', label: 'allFlash' },
    { key: 'storage_servers_hybrid_flash', label: 'hybridFlash' },
  ]},
  { key: 'compute_servers', label: 'computeServers', icon: Cpu },
  { key: 'switches', label: 'switches', icon: Network, children: [
    { key: 'switches_param', label: 'paramSwitches' },
    { key: 'switches_storage', label: 'storageSwitches' },
    { key: 'switches_biz', label: 'bizSwitches' },
    { key: 'switches_oob', label: 'oobSwitches' },
  ]},
  { key: 'custom', label: 'custom', icon: Wrench },
]

function DeviceLibExplorer() {
  const { t } = useTranslation()
  const openTab = useWorkspaceStore((s) => s.openTab)
  const updateTab = useWorkspaceStore((s) => s.updateTab)
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const { allDevices, loadLibrary } = useDeviceLibraryStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [reuseTab] = useLocalStorage('autolink-device-tab-reuse', true)

  useEffect(() => { loadLibrary() }, [])

  // Compute counts per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const d of allDevices) {
      counts[d.category] = (counts[d.category] || 0) + 1
    }
    return counts
  }, [allDevices])

  const getNodeCount = (node: CategoryTreeNode): number => {
    if (node.children) {
      return node.children.reduce((sum, c) => sum + (categoryCounts[c.key] || 0), 0)
    }
    return categoryCounts[node.key] || 0
  }

  // Find the category of the currently active deviceLibrary tab
  const activeCategory = useMemo(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (activeTab?.type === 'deviceLibrary') {
      return activeTab.state?.category as string | undefined
    }
    return undefined
  }, [tabs, activeTabId])

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /** Open or reuse a deviceLibrary tab */
  const openOrReuseDeviceTab = useCallback((label: string, categoryKey: string) => {
    const activeTab = tabs.find((t) => t.id === activeTabId)
    const tabTitle = t('common:explorer.deviceLibrary.tabTitle', { label })

    if (reuseTab && activeTab?.type === 'deviceLibrary') {
      // Reuse: update the existing tab in-place
      updateTab(activeTab.id, {
        title: tabTitle,
        state: { category: categoryKey },
      })
      setActiveTab(activeTab.id)
    } else {
      openTab({
        type: 'deviceLibrary',
        title: tabTitle,
        closable: true,
        state: { category: categoryKey },
      })
    }
  }, [reuseTab, tabs, activeTabId, updateTab, setActiveTab, openTab, t])

  const handleOpenCategory = useCallback((labelKey: string, categoryKey: string) => {
    const label = t(`common:explorer.deviceLibrary.categories.${labelKey}`)
    openOrReuseDeviceTab(label, categoryKey)
  }, [openOrReuseDeviceTab, t])

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('common:explorer.deviceLibrary.title')}</p>
        <p className="text-2xs text-gray-400 dark:text-gray-500 mt-0.5">{t('common:explorer.deviceLibrary.deviceCount', { count: allDevices.length })}</p>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {/* "全部设备" */}
        <button
          onClick={() => openOrReuseDeviceTab(t('common:explorer.deviceLibrary.allDevices'), '')}
          className={clsx(
            'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
            !activeCategory
              ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-l-2 border-l-primary-500'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-l-transparent',
          )}
        >
          <Package size={13} />
          <span>{t('common:explorer.deviceLibrary.allDevices')}</span>
          <span className="ml-auto text-2xs text-gray-400">{allDevices.length}</span>
        </button>

        {DEVICE_CATEGORY_TREE.map((node) => {
          const hasChildren = !!node.children
          const isExpanded = expanded.has(node.key)
          const isActive = activeCategory === node.key
          const hasActiveChild = hasChildren && node.children!.some((c) => c.key === activeCategory)
          const Icon = node.icon
          const count = getNodeCount(node)

          return (
            <div key={node.key}>
              <button
                onClick={() => {
                  if (hasChildren) toggleExpand(node.key)
                  handleOpenCategory(node.label, node.key)
                }}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                  (isActive || hasActiveChild)
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-l-2 border-l-primary-500'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-l-transparent',
                )}
              >
                {hasChildren ? (
                  isExpanded ? <ChevronDown size={11} className="text-gray-400 shrink-0" /> : <ChevronRight size={11} className="text-gray-400 shrink-0" />
                ) : (
                  <span className="w-[11px] shrink-0" />
                )}
                <Icon size={13} className="shrink-0" />
                <span className="truncate">{t(`common:explorer.deviceLibrary.categories.${node.label}`)}</span>
                <span className="ml-auto text-2xs text-gray-400 shrink-0">{count}</span>
              </button>

              {hasChildren && isExpanded && node.children!.map((child) => {
                const childActive = activeCategory === child.key
                const childCount = categoryCounts[child.key] || 0
                return (
                  <button
                    key={child.key}
                    onClick={() => handleOpenCategory(child.label, child.key)}
                    className={clsx(
                      'w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-2xs transition-colors',
                      childActive
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-l-2 border-l-primary-500'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-l-transparent',
                    )}
                  >
                    <span className="truncate">{t(`common:explorer.deviceLibrary.categories.${child.label}`)}</span>
                    <span className="ml-auto text-2xs text-gray-400 shrink-0">{childCount}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ================================================== */
/*  SettingsExplorer — two-column layout              */
/* ================================================== */
const SETTINGS_CATEGORIES = [
  { key: 'appearance', label: 'appearance', icon: Palette },
  { key: 'language', label: 'language', icon: Globe },
  { key: 'projectDefaults', label: 'projectDefaults', icon: Cpu },
  { key: 'output', label: 'output', icon: FileOutput },
  { key: 'keyboard', label: 'keyboard', icon: Keyboard },
  { key: 'deviceLibrary', label: 'deviceLibrary', icon: Database },
  { key: 'network', label: 'network', icon: Wifi },
  { key: 'explorer', label: 'explorer', icon: FolderTree },
  { key: 'data', label: 'data', icon: Shield },
  { key: 'about', label: 'about', icon: Info },
] as const

type SettingsCategory = typeof SETTINGS_CATEGORIES[number]['key']

function SettingsExplorer() {
  const { t } = useTranslation()
  const [activeCat, setActiveCat] = useState<SettingsCategory>('appearance')
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('common:explorer.settings.title')}</span>
      </div>
      <div className="flex-1 flex overflow-hidden">
        {/* Left: category nav */}
        <div className="w-36 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-auto py-1">
          {SETTINGS_CATEGORIES.map((cat) => {
            const Icon = cat.icon
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCat(cat.key)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left',
                  activeCat === cat.key
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-l-2 border-l-primary-500'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-l-transparent',
                )}
              >
                <Icon size={13} />
                <span>{t(`common:explorer.settings.categories.${cat.label}`)}</span>
              </button>
            )
          })}
        </div>

        {/* Right: content */}
        <div className="flex-1 overflow-auto">
          <div className="p-3">
            {activeCat === 'appearance' && <AppearanceSettings />}
            {activeCat === 'language' && <LanguageSettings />}
            {activeCat === 'projectDefaults' && <ProjectDefaultsSettings />}
            {activeCat === 'output' && <OutputSettings />}
            {activeCat === 'keyboard' && <KeyboardSettings />}
            {activeCat === 'deviceLibrary' && <DeviceLibrarySettings />}
            {activeCat === 'network' && <NetworkSettings />}
            {activeCat === 'explorer' && <ExplorerSettings />}
            {activeCat === 'data' && <DataSettings />}
            {activeCat === 'about' && <AboutSettings onOpenAbout={() => setAboutOpen(true)} />}
          </div>
        </div>
      </div>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

/* ---------- sub-components ---------- */

/* 1. Appearance */
function AppearanceSettings() {
  const { t } = useTranslation()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const [fontSize, setFontSize] = useLocalStorage('autolink-font-size', 14)
  const [compactMode, setCompactMode] = useLocalStorage('autolink-compact-mode', false)
  const [animations, setAnimations] = useLocalStorage('autolink-animations', true)

  return (
    <SettingsSection title={t('common:explorer.settings.appearance.title')}>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('common:explorer.settings.appearance.themeMode')}</label>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {([{ mode: 'light' as ThemeMode, icon: <Sun size={13} />, label: t('common:explorer.settings.appearance.light') },
           { mode: 'dark' as ThemeMode, icon: <Moon size={13} />, label: t('common:explorer.settings.appearance.dark') },
           { mode: 'system' as ThemeMode, icon: <Monitor size={13} />, label: t('common:explorer.settings.appearance.system') },
        ]).map((item) => (
          <button
            key={item.mode}
            onClick={() => setTheme(item.mode)}
            className={`flex flex-col items-center gap-0.5 py-2 rounded border text-2xs transition-colors
              ${theme === item.mode
                ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'}`}
          >
            {item.icon}{item.label}
          </button>
        ))}
      </div>

      <SettingsRow label={t('common:explorer.settings.appearance.fontSize')}>
        <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}
          className="text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
          {[12, 13, 14, 16, 18].map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
      </SettingsRow>

      <SettingsRow label={t('common:explorer.settings.appearance.compactMode')}>
        <Toggle checked={compactMode} onChange={setCompactMode} />
      </SettingsRow>

      <SettingsRow label={t('common:explorer.settings.appearance.animations')}>
        <Toggle checked={animations} onChange={setAnimations} />
      </SettingsRow>
    </SettingsSection>
  )
}

/* 2. Language */
function LanguageSettings() {
  const { t, i18n } = useTranslation()
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)

  return (
    <SettingsSection title={t('common:explorer.settings.languageTitle')}>
      {[
        { code: 'zh-CN', label: '简体中文' },
        { code: 'en', label: 'English' },
        { code: 'ja', label: '日本語' },
        { code: 'ko', label: '한국어' },
        { code: 'zh-TW', label: '繁體中文' },
      ].map((lang) => (
        <button
          key={lang.code}
          onClick={() => { setLanguage(lang.code); i18n.changeLanguage(lang.code) }}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded border transition-colors
            ${language === lang.code
              ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
              : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300'}`}
        >
          {lang.label}
          {language === lang.code && <Check size={13} className="text-gray-400" />}
        </button>
      ))}
    </SettingsSection>
  )
}

/* 3. Project Defaults */
function ProjectDefaultsSettings() {
  const { t } = useTranslation()
  const [defaultRack, setDefaultRack] = useLocalStorage('autolink-default-rack', 42)
  const [defaultPowerLimit, setDefaultPowerLimit] = useLocalStorage('autolink-default-power', 6000)
  const [defaultPortSpeed, setDefaultPortSpeed] = useLocalStorage('autolink-default-port-speed', '400G')

  return (
    <SettingsSection title={t('common:explorer.settings.projectDefaults.title')}>
      <SettingsRow label={t('common:explorer.settings.projectDefaults.defaultRackType')}>
        <select value={defaultRack} onChange={(e) => setDefaultRack(Number(e.target.value))}
          className="text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
          <option value={42}>42U</option>
          <option value={49}>49U</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.projectDefaults.defaultPowerLimit')}>
        <input type="number" value={defaultPowerLimit}
          onChange={(e) => setDefaultPowerLimit(Number(e.target.value))}
          className="w-20 text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.projectDefaults.defaultPortSpeed')}>
        <select value={defaultPortSpeed} onChange={(e) => setDefaultPortSpeed(e.target.value)}
          className="text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
          {['100G', '200G', '400G', '800G'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </SettingsRow>
    </SettingsSection>
  )
}

/* 4. Output */
function OutputSettings() {
  const { t } = useTranslation()
  const [defaultFormat, setDefaultFormat] = useLocalStorage('autolink-output-format', 'xlsx')
  const [outputDir, setOutputDir] = useLocalStorage('autolink-output-dir', '')
  const [autoSaveInterval, setAutoSaveInterval] = useLocalStorage('autolink-autosave-interval', 5)

  return (
    <SettingsSection title={t('common:explorer.settings.output.title')}>
      <SettingsRow label={t('common:explorer.settings.output.defaultFormat')}>
        <select value={defaultFormat} onChange={(e) => setDefaultFormat(e.target.value)}
          className="text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
          <option value="xlsx">{t('common:explorer.settings.output.formatExcel')}</option>
          <option value="csv">{t('common:explorer.settings.output.formatCsv')}</option>
          <option value="png">{t('common:explorer.settings.output.formatPng')}</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.output.outputDir')}>
        <div className="flex items-center gap-1">
          <span className="text-2xs text-gray-400 max-w-[120px] truncate">{outputDir || t('common:explorer.settings.output.default')}</span>
          <button
            onClick={async () => {
              const result = await window.electron?.dialog?.openDirectory?.()
              if (result) setOutputDir(result as string)
            }}
            className="text-2xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            {t('common:explorer.settings.output.select')}
          </button>
        </div>
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.output.autoSaveInterval')}>
        <input type="number" value={autoSaveInterval} min={1} max={60}
          onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
          className="w-16 text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
      </SettingsRow>
    </SettingsSection>
  )
}

/* 5. Keyboard Shortcuts */
function KeyboardSettings() {
  const { t } = useTranslation()
  const defaultShortcuts = [
    { keys: 'Ctrl+Shift+E', desc: t('common:explorer.settings.keyboard.projectExplorer') },
    { keys: 'Ctrl+Shift+W', desc: t('common:explorer.settings.keyboard.workbench') },
    { keys: 'Ctrl+Shift+D', desc: t('common:explorer.settings.keyboard.topologyDesign') },
    { keys: 'Ctrl+Shift+V', desc: t('common:explorer.settings.keyboard.visualization') },
    { keys: 'Ctrl+,', desc: t('common:explorer.settings.keyboard.settings') },
    { keys: 'Ctrl+B', desc: t('common:explorer.settings.keyboard.toggleSidebar') },
    { keys: 'Ctrl+J', desc: t('common:explorer.settings.keyboard.togglePanel') },
    { keys: 'Ctrl+W', desc: t('common:explorer.settings.keyboard.closeTab') },
    { keys: 'Ctrl+Shift+T', desc: t('common:explorer.settings.keyboard.restoreTab') },
  ]

  const [shortcuts] = useLocalStorage('autolink-keybindings', defaultShortcuts)

  return (
    <SettingsSection title={t('common:explorer.settings.keyboard.title')}>
      <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
        {shortcuts.map((s) => (
          <div key={s.keys}
            className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 text-xs">
            <span className="text-gray-600 dark:text-gray-400">{s.desc}</span>
            <kbd className="px-1.5 py-0.5 text-2xs rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}

/* 6. Device Library */
function DeviceLibrarySettings() {
  const { t } = useTranslation()
  const [dataDir, setDataDir] = useLocalStorage('autolink-device-data-dir', '')
  const [autoUpdate, setAutoUpdate] = useLocalStorage('autolink-device-auto-update', true)
  const [reuseTab, setReuseTab] = useLocalStorage('autolink-device-tab-reuse', true)

  return (
    <SettingsSection title={t('common:explorer.settings.deviceLibrary.title')}>
      <SettingsRow label={t('common:explorer.settings.deviceLibrary.dataDir')}>
        <div className="flex items-center gap-1">
          <span className="text-2xs text-gray-400 max-w-[120px] truncate">{dataDir || t('common:explorer.settings.output.default')}</span>
          <button
            onClick={async () => {
              const result = await window.electron?.dialog?.openDirectory?.()
              if (result) setDataDir(result as string)
            }}
            className="text-2xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            {t('common:explorer.settings.output.select')}
          </button>
        </div>
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.deviceLibrary.autoUpdate')}>
        <Toggle checked={autoUpdate} onChange={setAutoUpdate} />
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.deviceLibrary.reuseTab')}>
        <Toggle checked={reuseTab} onChange={setReuseTab} />
      </SettingsRow>
    </SettingsSection>
  )
}

/* 7. Network */
function NetworkSettings() {
  const { t } = useTranslation()
  const [autoCheck, setAutoCheck] = useLocalStorage('autolink-auto-update-check', true)
  const [proxyHost, setProxyHost] = useLocalStorage('autolink-proxy-host', '')
  const [proxyPort, setProxyPort] = useLocalStorage('autolink-proxy-port', '')

  return (
    <SettingsSection title={t('common:explorer.settings.network.title')}>
      <SettingsRow label={t('common:explorer.settings.network.autoCheckUpdate')}>
        <Toggle checked={autoCheck} onChange={setAutoCheck} />
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.network.proxyServer')}>
        <div className="flex items-center gap-1">
          <input placeholder={t('common:explorer.settings.network.host')} value={proxyHost}
            onChange={(e) => setProxyHost(e.target.value)}
            className="w-20 text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
          <span className="text-gray-400">:</span>
          <input placeholder={t('common:explorer.settings.network.port')} value={proxyPort}
            onChange={(e) => setProxyPort(e.target.value)}
            className={clsx('w-20', INPUT_CLASS)} />
        </div>
      </SettingsRow>
    </SettingsSection>
  )
}

/* 8a. Explorer (项目浏览器) */
function ExplorerSettings() {
  const { t } = useTranslation()
  const groupMode = useUIStore((s) => s.explorerGroupMode)
  const setGroupMode = useUIStore((s) => s.setExplorerGroupMode)
  const resetAll = useExplorerStore((s) => s.resetAll)
  const addToast = useToastStore((s) => s.addToast)

  const handleResetExpand = () => {
    resetAll()
    addToast('info', t('common:explorer.settings.data.resetExplorerStateDone'))
  }

  return (
    <SettingsSection title={t('common:explorer.settings.explorer.title')}>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
        {t('common:explorer.settings.explorer.groupMode')}
      </label>
      <div className="space-y-1.5 mb-3">
        {([
          { mode: 'smart' as const, label: t('common:explorer.settings.explorer.smartGroup'), desc: t('common:explorer.settings.explorer.smartGroupDesc') },
          { mode: 'raw' as const, label: t('common:explorer.settings.explorer.rawGroup'), desc: t('common:explorer.settings.explorer.rawGroupDesc') },
        ]).map((item) => (
          <button
            key={item.mode}
            onClick={() => setGroupMode(item.mode)}
            className={`w-full text-left px-2.5 py-2 rounded border text-xs transition-colors
              ${groupMode === item.mode
                ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${groupMode === item.mode ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
              <span className="font-medium">{item.label}</span>
            </div>
            <p className="mt-0.5 ml-4 text-2xs text-gray-400 dark:text-gray-500">{item.desc}</p>
          </button>
        ))}
      </div>

      <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
        <button onClick={handleResetExpand}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
          <RotateCcw size={13} />{t('common:explorer.settings.data.resetExplorerState')}
        </button>
      </div>
    </SettingsSection>
  )
}

/* 8. Data */
function DataSettings() {
  const { t } = useTranslation()
  const addToast = useRequireToast()

  const handleExportAll = () => {
    try {
      const allKeys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        allKeys.push(localStorage.key(i)!)
      }
      const data: Record<string, unknown> = {}
      for (const key of allKeys.filter((k) => k.startsWith('autolink-'))) {
        try { data[key] = JSON.parse(localStorage.getItem(key)!) } catch { data[key] = localStorage.getItem(key) }
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `autolink-data-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(url)
      addToast('success', t('common:explorer.settings.data.exportSuccess'))
    } catch { addToast('error', t('common:explorer.settings.data.exportFailed')) }
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        for (const [key, value] of Object.entries(data)) {
          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
        }
        addToast('success', t('common:explorer.settings.data.importSuccess'))
      } catch { addToast('error', t('common:explorer.settings.data.importFailed')) }
    }
    input.click()
  }

  const handleReset = () => {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (k.startsWith('autolink-')) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
    addToast('info', t('common:explorer.settings.data.resetDone'))
  }

  return (
    <SettingsSection title={t('common:explorer.settings.data.title')}>
      <button onClick={handleExportAll}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
        <Download size={13} />{t('common:explorer.settings.data.exportAll')}
      </button>
      <button onClick={handleImport}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
        <Upload size={13} />{t('common:explorer.settings.data.importData')}
      </button>
      <button onClick={handleReset}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-error-200 dark:border-error-800 text-error-500 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/10">
        <RotateCcw size={13} />{t('common:explorer.settings.data.resetAll')}
      </button>
    </SettingsSection>
  )
}

/* 9. About */
function AboutSettings({ onOpenAbout }: { onOpenAbout: () => void }) {
  const { t } = useTranslation()
  const [lastCheck, setLastCheck] = useLocalStorage('autolink-last-update-check', '')
  const [appVersion, setAppVersion] = useState('...')

  useEffect(() => {
    window.electron?.app?.getVersion?.().then((v: string) => v && setAppVersion(v)).catch(() => {})
  }, [])

  const handleCheckUpdate = async () => {
    try {
      await window.electron?.app?.checkUpdate?.()
      const now = new Date().toISOString()
      setLastCheck(now)
      onOpenAbout()
    } catch {
      onOpenAbout()
    }
  }

  return (
    <SettingsSection title={t('common:explorer.settings.about.title')}>
      <div className="border border-gray-200 dark:border-gray-700 rounded p-3">
        <div className="text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">{t('common:explorer.settings.about.version')}</span>
            <span className="font-medium text-gray-700 dark:text-gray-300">{appVersion}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">{t('common:explorer.settings.about.license')}</span>
            <span className="text-gray-500">MIT</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">{t('common:explorer.settings.about.lastCheckUpdate')}</span>
            <span className="text-gray-500">{lastCheck ? new Date(lastCheck).toLocaleString() : t('common:explorer.settings.about.never')}</span>
          </div>
        </div>
      </div>
      <button onClick={handleCheckUpdate}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
        <ExternalLink size={13} />{t('common:explorer.settings.about.checkUpdate')}
      </button>
      <button onClick={onOpenAbout}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
        <Info size={13} />{t('common:explorer.settings.about.viewFullInfo')}
      </button>
    </SettingsSection>
  )
}

/* ---------- shared mini components ---------- */

function useRequireToast() {
  return useToastStore.getState().addToast
}

/* ---------- mini form components for explorers ---------- */

function NumberInputMini({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-2xs text-gray-500 dark:text-gray-400">{label}</span>
      <input type="number" value={value}
        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(v) }}
        className="w-20 px-1.5 py-1 text-2xs text-right rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400" />
    </div>
  )
}

function SelectMini({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-2xs text-gray-500 dark:text-gray-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-20 px-1 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
