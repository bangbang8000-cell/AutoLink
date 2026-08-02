import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, LayoutTemplate, Loader2, Upload } from 'lucide-react'
import { useUIStore } from '@/stores/ui.store'
import { useExplorerStore } from '@/stores/explorer.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { ConfirmDeleteDialog, type DeleteTarget } from '@/components/layout/ConfirmDeleteDialog'
import { EditTemplateModal } from '@/components/layout/EditTemplateModal'
import { TreeNode } from '@/components/layout/TreeNode'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import type { FileTreeNode, GroupKey } from '@/types/file-tree'
import { Section, collectAllDirPaths, renderTemplateChildren } from '@/components/layout/FileTreePanel'
import type { WorkspaceTab } from '@/stores/workspace.store'

// Template section with expandable file tree
export function TemplateSection({ templates, openTab, handleOpenInExplorer }: {
  templates: { id: string; name: string; description?: string; scenario?: string; tags?: string[]; isBuiltin?: boolean }[]
  openTab: (tab: Omit<WorkspaceTab, 'id'>) => string
  handleOpenInExplorer: (name: string) => void
}) {
  const { t } = useTranslation()
  const explorerGroupMode = useUIStore((s) => s.explorerGroupMode)
  const openWizardFromTemplate = useUIStore((s) => s.openWizardFromTemplate)
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
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500 disabled:opacity-50"
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
                  { label: t('common:explorer.contextMenu.createFromTemplate', '基于此模板创建项目'), action: () => openWizardFromTemplate(tpl.name) },
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
