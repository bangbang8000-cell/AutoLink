import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Folder,
  FolderOpen,
  Search,
  Star,
  Plus,
  Upload,
  Package,
  Loader2,
  Cloud,
  History,
} from 'lucide-react'
import { useUIStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useCloudStore } from '@/stores/cloud.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useExplorerStore } from '@/stores/explorer.store'
import { useToastStore } from '@/stores/toast.store'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDeleteDialog, type DeleteTarget } from '@/components/layout/ConfirmDeleteDialog'
import { RenameProjectModal } from '@/components/layout/RenameProjectModal'
import { PasswordPromptModal } from '@/components/layout/PasswordPromptModal'
import { TreeNode } from '@/components/layout/TreeNode'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import type { FileTreeNode, GroupKey, OutputBatch, OutputBatchFile } from '@/types/file-tree'
import {
  Section,
  collectAllDirPaths,
  renderProjectChildren,
} from '@/components/layout/FileTreePanel'
import { OutputSection } from '@/components/layout/OutputSection'
import { TemplateSection } from '@/components/layout/TemplateSection'

export function ProjectExplorer() {
  const { t } = useTranslation()
  const {
    projects,
    templates,
    selectProject,
    selectedProjectName,
    deleteProjects,
    convertToTemplate,
    duplicateProject,
    renameProject,
    exportProject,
    importProject,
    batchExportProjects,
    favoriteProjects,
    toggleFavorite,
    recentProjects,
  } = useProjectStore()
  const openTab = useWorkspaceStore((s) => s.openTab)
  const addToast = useToastStore((s) => s.addToast)
  const setShowCreateProjectWizard = useUIStore((s) => s.setShowCreateProjectWizard)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)
  const setExplorerGroupMode = useUIStore((s) => s.setExplorerGroupMode)
  const explorerGroupMode = useUIStore((s) => s.explorerGroupMode)
  // V3.3.1-T14-7: 侧栏云端分组（登录后展示云端项目）
  const loggedIn = useCloudStore((s) => s.loggedIn)
  const remoteProjects = useCloudStore((s) => s.remoteProjects)
  const fetchRemoteProjects = useCloudStore((s) => s.fetchRemoteProjects)
  // V3.3.2-T15-1: 分享链接
  const createShare = useCloudStore((s) => s.createShare)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // H3（D-7 并列陈列）：侧栏顶部 项目列表 | 模板中心 切页
  const [activePane, setActivePane] = useState<'projects' | 'templates'>('projects')
  const [renameModal, setRenameModal] = useState<{
    type: 'rename' | 'duplicate' | 'convertToTemplate'
    projectName: string
  } | null>(null)
  // V3.3.2-T15-2: 加密导出/加密导入密码框
  const [passwordModal, setPasswordModal] = useState<{
    mode: 'export' | 'import'
    projectName?: string
  } | null>(null)
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

  const handleOpenProject = useCallback(
    (name: string) => {
      const project = projects.find((p) => p.name === name)
      if (project) {
        selectProject(project)
        openTab({
          type: 'projectOverview',
          title: t('common:explorer.toast.projectOverviewTitle', { name }),
          closable: true,
          projectName: name,
          state: { projectName: name },
        })
      }
    },
    [projects, selectProject, openTab],
  )

  // T9: 项目文件树展开/折叠 — 首次展开拉取结构 + 输出批次并缓存到 store
  const toggleProjectExpand = useCallback(
    async (projectName: string) => {
      // 只要结构缓存为空就拉取(不依赖当前展开状态)
      // 修复重启后 expandedProjects 持久化为 true 但 projectStructures 为空导致点击无响应的问题
      if (!projectStructures[projectName]) {
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
    },
    [projectStructures, toggleProject, setProjectStructure, setOutputBatches],
  )

  // 重启后自动恢复已展开项目的结构缓存
  // persist 持久化了 expandedProjects 但不持久化 projectStructures,导致重启后项目展开但子节点为空
  useEffect(() => {
    for (const name of Object.keys(expandedProjects)) {
      if (expandedProjects[name] && !projectStructures[name]) {
        Promise.all([
          window.electron?.project?.getStructure(name),
          window.electron?.project?.listOutputBatches(name),
        ])
          .then(([structure, batches]) => {
            setProjectStructure(name, (structure as FileTreeNode[]) || [])
            setOutputBatches(name, (batches as OutputBatch[]) || [])
          })
          .catch(() => {
            setProjectStructure(name, [])
            setOutputBatches(name, [])
          })
      }
    }
    // 只在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // V3.3.1-T14-7: 登录后自动拉取云端项目列表
  useEffect(() => {
    if (loggedIn) {
      fetchRemoteProjects().catch(() => {})
    }
  }, [loggedIn, fetchRemoteProjects])

  // T9: 删除文件/批次后刷新项目结构 + 批次缓存
  const refreshProjectStructure = useCallback(
    async (projectName: string) => {
      try {
        const [structure, batches] = await Promise.all([
          window.electron?.project?.getStructure(projectName),
          window.electron?.project?.listOutputBatches(projectName),
        ])
        setProjectStructure(projectName, (structure as FileTreeNode[]) || [])
        setOutputBatches(projectName, (batches as OutputBatch[]) || [])
      } catch {
        /* ignore */
      }
    },
    [setProjectStructure, setOutputBatches],
  )

  // T6: 点击项目内文件 → 打开 fileViewer (filePath 用 node.path 相对项目根)
  const handleProjectFileClick = useCallback(
    (projectName: string, node: FileTreeNode) => {
      // v2.8.1-T5: 点击 topology.json 打开可编辑拓扑视图(而非 JSON 文本)
      if (node.name === 'topology.json') {
        const project = projects.find((p) => p.name === projectName)
        if (project) {
          selectProject(project)
        }
        openTab({
          type: 'topology',
          title: t('common:menu.topology'),
          closable: true,
          projectName: projectName,
        })
        return
      }
      openTab({
        type: 'fileViewer',
        title: node.name,
        closable: true,
        projectName: projectName,
        state: { filePath: node.path, projectName, isTemplate: false },
      })
    },
    [openTab, selectProject, projects, t],
  )

  // T9: 点击批次内文件 → 打开 fileViewer (filePath 用 workspace 相对路径)
  const handleBatchFileClick = useCallback(
    (_projectName: string, _batch: OutputBatch, file: OutputBatchFile) => {
      openTab({
        type: 'fileViewer',
        title: file.name,
        closable: true,
        projectName: _projectName,
        state: { filePath: file.path, projectName: _projectName, isTemplate: false },
      })
    },
    [openTab],
  )

  const handleOpenInExplorer = useCallback(async (projectName: string) => {
    const wsp = await window.electron?.app?.getPath('workspace')
    const folderPath = `${wsp}\\${projectName}`
    window.electron?.shell?.showItemInFolder(folderPath)
  }, [])

  const handleDeleteProject = useCallback((project: { id: number; name: string }) => {
    setDeleteTarget({ name: project.name, type: 'project' })
  }, [])

  const handleConvertToTemplate = useCallback((projectName: string) => {
    setRenameModal({ type: 'convertToTemplate', projectName })
  }, [])

  const handleDuplicate = useCallback((projectName: string) => {
    setRenameModal({ type: 'duplicate', projectName })
  }, [])

  const handleRename = useCallback((projectName: string) => {
    setRenameModal({ type: 'rename', projectName })
  }, [])

  const handleRenameConfirm = useCallback(
    async (value: string) => {
      if (!renameModal) return
      if (renameModal.type === 'duplicate') {
        await duplicateProject(renameModal.projectName, value)
        addToast('success', t('common:explorer.toast.projectDuplicated', { name: value }))
      } else if (renameModal.type === 'convertToTemplate') {
        try {
          await convertToTemplate(renameModal.projectName, { name: value })
          addToast(
            'success',
            t('common:explorer.toast.projectConvertedToTemplate', {
              projectName: renameModal.projectName,
              templateName: value,
            }),
          )
        } catch (err) {
          addToast(
            'error',
            t('common:explorer.toast.convertFailed', {
              error: err instanceof Error ? err.message : String(err),
            }),
          )
          throw err
        }
      } else {
        await renameProject(renameModal.projectName, value)
        addToast('success', t('common:explorer.toast.projectRenamed', { name: value }))
      }
    },
    [renameModal, duplicateProject, renameProject, convertToTemplate, addToast, t],
  )

  const handleExport = useCallback(
    async (projectName: string) => {
      if (exporting) return
      setExporting(true)
      try {
        const result = await exportProject(projectName)
        if (!result.canceled && result.zipPath) {
          addToast(
            'success',
            t('common:explorer.toast.projectExported', { name: projectName, path: result.zipPath }),
          )
        }
      } catch (err) {
        addToast(
          'error',
          t('common:explorer.toast.exportFailed', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      } finally {
        setExporting(false)
      }
    },
    [exporting, exportProject, addToast, t],
  )

  // V3.3.2-T15-2: 加密导出（密码二次确认）
  const handleEncryptedExport = useCallback(
    async (projectName: string, password: string) => {
      if (exporting) return
      setExporting(true)
      try {
        const result = await exportProject(projectName, { password })
        if (!result.canceled && result.zipPath) {
          addToast(
            'success',
            t('common:explorer.toast.projectExportedEncrypted', {
              name: projectName,
              path: result.zipPath,
            }),
          )
        }
      } catch (err) {
        addToast(
          'error',
          t('common:explorer.toast.exportFailed', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      } finally {
        setExporting(false)
      }
    },
    [exporting, exportProject, addToast, t],
  )

  const handleImport = useCallback(async () => {
    if (importing) return
    setImporting(true)
    try {
      const result = await importProject()
      if (!result.canceled && result.projectName) {
        addToast(
          'success',
          t('common:explorer.toast.projectImported', { name: result.projectName }),
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // T15-2: 加密 ZIP 需要密码
      if (msg.includes('加密')) {
        setPasswordModal({ mode: 'import' })
      } else {
        addToast('error', t('common:explorer.toast.importFailed', { error: msg }))
      }
    } finally {
      setImporting(false)
    }
  }, [importing, importProject, addToast, t])

  // V3.3.2-T15-2: 带密码重试导入（重新选文件）
  const handleImportWithPassword = useCallback(
    async (password: string) => {
      if (importing) return
      setImporting(true)
      try {
        const result = await importProject({ password })
        if (!result.canceled && result.projectName) {
          addToast(
            'success',
            t('common:explorer.toast.projectImported', { name: result.projectName }),
          )
        }
      } catch (err) {
        addToast(
          'error',
          t('common:explorer.toast.importFailed', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      } finally {
        setImporting(false)
      }
    },
    [importing, importProject, addToast, t],
  )

  // V3.3.2-T15-1: 分享链接（登录校验 → 生成只读快照上传 → 复制预览 URL）
  const handleShareLink = useCallback(
    async (projectName: string) => {
      if (!loggedIn) {
        addToast('warning', t('common:explorer.toast.shareNotLoggedIn'))
        setActiveActivity('cloud')
        return
      }
      try {
        const res = await createShare(projectName)
        await navigator.clipboard.writeText(res.fullUrl)
        addToast(
          'success',
          t('common:explorer.toast.shareCreated', { name: projectName, url: res.fullUrl }),
        )
      } catch (err) {
        addToast(
          'error',
          t('common:explorer.toast.shareFailed', {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [loggedIn, createShare, addToast, setActiveActivity, t],
  )

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
          addToast(
            'success',
            t('common:explorer.toast.batchExportSuccess', {
              count: successes.length,
              dir: result.targetDir,
            }),
          )
        } else {
          addToast(
            'warning',
            t('common:explorer.toast.batchExportPartial', {
              success: successes.length,
              fail: failures.length,
              details: failures.map((f) => `  - ${f.name}: ${f.error}`).join('\n'),
            }),
          )
        }
      }
    } catch (err) {
      addToast(
        'error',
        t('common:explorer.toast.batchExportFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    } finally {
      setBatchExporting(false)
    }
  }, [batchExporting, batchExportProjects, sortedProjects, addToast, t])

  // T10: 项目文件右键菜单(openFile/showInFileManager/copyFilePath/deleteFile[仅输出文件])
  const buildProjectFileContextMenu = (
    projectName: string,
    node: FileTreeNode,
  ): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        label: t('common:explorer.contextMenu.openFile'),
        action: () => handleProjectFileClick(projectName, node),
      },
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
  const buildProjectDirContextMenu = (
    projectName: string,
    node: FileTreeNode,
  ): ContextMenuItem[] => [
    {
      label: t('common:explorer.contextMenu.openInFileManager'),
      action: async () => {
        const wsp = await window.electron?.app?.getPath('workspace')
        window.electron?.shell?.showItemInFolder(`${wsp}/${projectName}/${node.path}`)
      },
    },
  ]

  // T10: 智能分组右键菜单(expandAll/collapseAll)
  const buildProjectGroupContextMenu = (
    projectName: string,
    groupKey: GroupKey,
    nodes: FileTreeNode[],
    batches: OutputBatch[],
  ): ContextMenuItem[] => [
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
  const buildBatchFileContextMenu = (
    projectName: string,
    batch: OutputBatch,
    file: OutputBatchFile,
  ): ContextMenuItem[] => [
    {
      label: t('common:explorer.contextMenu.openFile'),
      action: () => handleBatchFileClick(projectName, batch, file),
    },
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
          await window.electron?.project?.deleteOutputFile(
            projectName,
            `${batch.name}/${file.name}`,
          )
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
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 dark:border-edge-subtle shrink-0">
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
            className="w-full pl-7 pr-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
        </div>
        <button
          onClick={handleImport}
          disabled={importing}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          title={t('common:project.importZip', '导入项目 ZIP')}
        >
          {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        </button>
        {projects.length > 1 && (
          <button
            onClick={handleBatchExport}
            disabled={batchExporting}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('common:project.batchExport', '批量导出项目')}
          >
            {batchExporting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Package size={14} />
            )}
          </button>
        )}
        {selectedProjectName && (
          <button
            onClick={() => handleOpenInExplorer(selectedProjectName)}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500"
            title={t('common:explorer.openInExplorer')}
          >
            <FolderOpen size={14} />
          </button>
        )}
      </div>

      {/* H3：项目列表 | 模板中心 并列切页（对齐 MC ExplorerPanel） */}
      <div className="flex items-center border-b border-gray-200 dark:border-edge-subtle shrink-0">
        {(['projects', 'templates'] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            onClick={() => setActivePane(pane)}
            className={`flex-1 py-1.5 text-2xs font-medium border-b-2 transition-colors ${
              activePane === pane
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {pane === 'projects'
              ? t('common:explorer.allProjects', '项目列表')
              : t('common:explorer.templates', '模板中心')}
          </button>
        ))}
        {/* 打磨轮（v1.2 复核）：分组模式切换（智能/真实）由设置移入项目浏览器 */}
        {activePane === 'projects' && (
          <div className="ml-auto pr-2 flex items-center gap-0.5 shrink-0">
            {(['smart', 'raw'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setExplorerGroupMode(m)}
                className={`text-2xs px-1.5 py-0.5 rounded transition-colors ${
                  explorerGroupMode === m
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover'
                }`}
                title={m === 'smart' ? '智能分组（按文件用途）' : '真实分组（按文件系统目录）'}
              >
                {m === 'smart' ? '智能' : '真实'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto py-1">
        {activePane === 'projects' && (
          <>
            {/* 4.4 F4-4：最近使用项目（持久化，点击直接打开） */}
            {recentProjects.filter((n) => sortedProjects.some((p) => p.name === n)).length > 0 && (
              <Section
                title={t('common:explorer.recentProjects', '最近项目')}
                icon={<History size={14} />}
                sectionKey="recent-projects"
              >
                {recentProjects
                  .filter((n) => sortedProjects.some((p) => p.name === n))
                  .map((n) => {
                    const p = sortedProjects.find((x) => x.name === n)!
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => handleOpenProject(p.name)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover/50 text-left"
                      >
                        <History size={12} className="text-gray-400 shrink-0" />
                        <span className="truncate">{p.name}</span>
                        <span className="ml-auto text-2xs text-gray-400 shrink-0">
                          {p.updatedAt ? p.updatedAt.slice(0, 10) : ''}
                        </span>
                      </button>
                    )
                  })}
              </Section>
            )}

            {/* Projects section */}
            <Section
              title={t('common:explorer.allProjects')}
              icon={<Folder size={14} />}
              sectionKey="projects"
            >
              {sortedProjects.length === 0 ? (
                <div className="py-2">
                  <EmptyState
                    icon={Folder}
                    title={
                      projects.length === 0
                        ? t('common:explorer.noProjects', '暂无项目')
                        : t('common:explorer.noSearchResults', '未找到匹配的项目')
                    }
                    description={
                      projects.length === 0
                        ? t('common:explorer.createProjectHint', '点击上方 + 按钮创建新项目')
                        : t('common:explorer.changeSearchQuery', '尝试更换搜索关键词')
                    }
                  />
                </div>
              ) : (
                sortedProjects.map((p) => {
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
                          isFavorite ? (
                            <Star size={12} className="text-warning-400" fill="currentColor" />
                          ) : p.name === selectedProjectName ? (
                            <FolderOpen size={12} className="text-gray-400" />
                          ) : (
                            <Folder size={12} className="text-gray-400" />
                          )
                        }
                        trailing={
                          <span className="flex items-center gap-1.5 shrink-0">
                            {/* 4.4 F4-4：行内收藏星标（点击切换） */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleFavorite(p.name)
                              }}
                              title={
                                isFavorite
                                  ? t('common:explorer.contextMenu.unfavorite')
                                  : t('common:explorer.contextMenu.favorite')
                              }
                              aria-label={
                                isFavorite
                                  ? t('common:explorer.contextMenu.unfavorite')
                                  : t('common:explorer.contextMenu.favorite')
                              }
                              className={`transition-colors ${isFavorite ? 'text-warning-400' : 'text-gray-300 dark:text-gray-600 hover:text-warning-400'}`}
                            >
                              <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
                            </button>
                            {p.fileCount != null && (
                              <span className="text-2xs text-gray-400 dark:text-gray-500">
                                {p.fileCount}
                              </span>
                            )}
                          </span>
                        }
                        onClick={() => handleOpenProject(p.name)}
                        onArrowClick={() => toggleProjectExpand(p.name)}
                        isExpanded={isExpanded}
                        hasChildren={(p.fileCount ?? 0) > 0 || structure.length > 0}
                        contextMenu={[
                          {
                            label: t('common:explorer.contextMenu.setAsCurrent'),
                            action: () => handleOpenProject(p.name),
                          },
                          {
                            label: t('common:explorer.contextMenu.openInFileManager'),
                            action: () => handleOpenInExplorer(p.name),
                          },
                          {
                            label: t('common:explorer.contextMenu.duplicateProject'),
                            action: () => handleDuplicate(p.name),
                          },
                          {
                            label: t('common:explorer.contextMenu.rename'),
                            action: () => handleRename(p.name),
                          },
                          {
                            label: t('common:explorer.contextMenu.exportZip'),
                            action: () => handleExport(p.name),
                          },
                          {
                            label: t('common:explorer.contextMenu.exportZipEncrypted'),
                            action: () => setPasswordModal({ mode: 'export', projectName: p.name }),
                          },
                          {
                            label: t('common:explorer.contextMenu.shareLink'),
                            action: () => handleShareLink(p.name),
                          },
                          {
                            label: t('common:explorer.contextMenu.convertToTemplate'),
                            action: () => handleConvertToTemplate(p.name),
                          },
                          {
                            label: isFavorite
                              ? t('common:explorer.contextMenu.unfavorite')
                              : t('common:explorer.contextMenu.favorite'),
                            action: () => toggleFavorite(p.name),
                          },
                          {
                            label: t('common:explorer.contextMenu.deleteProject'),
                            danger: true,
                            action: () => handleDeleteProject(p),
                          },
                        ]}
                      />
                      {isExpanded &&
                        structure.length > 0 &&
                        renderProjectChildren(p.name, structure, 1, explorerGroupMode, {
                          onFileClick: (node) => handleProjectFileClick(p.name, node),
                          onDirToggle: (scope, relativePath) => toggleDir(scope, relativePath),
                          isDirExpanded: (scope, relativePath) =>
                            !!expandedDirs[`dir:${scope}/${relativePath}`],
                          isGroupExpanded: (pn, gk) => !!expandedGroups[`group:${pn}/${gk}`],
                          onGroupToggle: (pn, gk) => toggleGroup(pn, gk),
                          batches,
                          isBatchExpanded: (pn, bn) => !!expandedBatches[`batch:${pn}/${bn}`],
                          onBatchToggle: (pn, bn) => toggleBatch(pn, bn),
                          onBatchFileClick: (pn, batch, file) =>
                            handleBatchFileClick(pn, batch, file),
                          fileContextMenuBuilder: (node) =>
                            buildProjectFileContextMenu(p.name, node),
                          dirContextMenuBuilder: (node) => buildProjectDirContextMenu(p.name, node),
                          groupContextMenuBuilder: (gk, nodes) =>
                            buildProjectGroupContextMenu(p.name, gk, nodes, batches),
                          batchContextMenuBuilder: (batch) => buildBatchContextMenu(p.name, batch),
                          batchFileContextMenuBuilder: (batch, file) =>
                            buildBatchFileContextMenu(p.name, batch, file),
                        })}
                    </div>
                  )
                })
              )}
            </Section>

            {/* V3.3.1-T14-7: 云端项目分组（登录后显示） */}
            {loggedIn && (
              <Section
                title={t('common:explorer.cloudProjects')}
                icon={<Cloud size={14} />}
                sectionKey="cloud-projects"
              >
                {remoteProjects.length === 0 ? (
                  <div className="px-3 py-2 text-2xs text-gray-400 dark:text-gray-500">
                    {t('common:explorer.noCloudProjects')}
                  </div>
                ) : (
                  remoteProjects.map((p) => (
                    <TreeNode
                      key={`${p.owner}/${p.name}`}
                      label={p.name}
                      depth={0}
                      leading={<Cloud size={12} className="text-cyan-400" />}
                      trailing={
                        <span className="text-2xs text-gray-400 dark:text-gray-500">{p.owner}</span>
                      }
                      onClick={() => setActiveActivity('cloud')}
                    />
                  ))
                )}
              </Section>
            )}

            {/* Output Section */}
            <OutputSection projects={projects} openTab={openTab} />
          </>
        )}
        {activePane === 'templates' && (
          <TemplateSection
            templates={templates}
            openTab={openTab}
            handleOpenInExplorer={handleOpenInExplorer}
          />
        )}
      </div>

      {/* Confirm Delete Dialog */}
      {deleteTarget && (
        <ConfirmDeleteDialog
          target={deleteTarget}
          onConfirm={async () => {
            const project = projects.find((p) => p.name === deleteTarget.name)
            if (project) {
              await deleteProjects([project.name])
              addToast(
                'success',
                t('common:explorer.toast.projectDeleted', { name: deleteTarget.name }),
              )
            }
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* Rename/Duplicate/ConvertToTemplate Modal */}
      {renameModal && (
        <RenameProjectModal
          title={
            renameModal.type === 'duplicate'
              ? t('common:project.duplicate')
              : renameModal.type === 'convertToTemplate'
                ? t('common:explorer.contextMenu.convertToTemplate')
                : t('common:project.rename')
          }
          label={
            renameModal.type === 'convertToTemplate'
              ? t('common:explorer.toast.templateNamePrompt')
              : t('common:project.newName')
          }
          defaultValue={
            renameModal.type === 'duplicate'
              ? `${renameModal.projectName}${t('common:explorer.copySuffix')}`
              : renameModal.projectName
          }
          onConfirm={handleRenameConfirm}
          onClose={() => setRenameModal(null)}
        />
      )}

      {/* V3.3.2-T15-2: 加密导出 / 加密导入密码框 */}
      {passwordModal && (
        <PasswordPromptModal
          title={
            passwordModal.mode === 'export'
              ? t('common:passwordPrompt.exportTitle')
              : t('common:passwordPrompt.importTitle')
          }
          label={
            passwordModal.mode === 'export'
              ? t('common:passwordPrompt.exportLabel')
              : t('common:passwordPrompt.importLabel')
          }
          requireConfirm={passwordModal.mode === 'export'}
          onConfirm={async (password) => {
            if (passwordModal.mode === 'export' && passwordModal.projectName) {
              await handleEncryptedExport(passwordModal.projectName, password)
            } else {
              await handleImportWithPassword(password)
            }
          }}
          onClose={() => setPasswordModal(null)}
        />
      )}
    </div>
  )
}
