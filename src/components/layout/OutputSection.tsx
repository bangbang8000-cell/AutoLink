import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileOutput, Folder, FolderOpen } from 'lucide-react'
import { useExplorerStore } from '@/stores/explorer.store'
import { useToastStore } from '@/stores/toast.store'
import { ConfirmDeleteDialog, type DeleteTarget } from '@/components/layout/ConfirmDeleteDialog'
import { TreeNode } from '@/components/layout/TreeNode'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import { Section, getFileIcon } from '@/components/layout/FileTreePanel'
import type { WorkspaceTab } from '@/stores/workspace.store'

// Output section: lists output batches per project
export function OutputSection({ projects, openTab }: {
  projects: { name: string }[]
  openTab: (tab: Omit<WorkspaceTab, 'id'>) => string
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

  const handleFileClick = useCallback((filePath: string, fileName: string, projectName: string) => {
    openTab({
      type: 'fileViewer',
      title: fileName,
      closable: true,
      state: { filePath, projectName, isTemplate: false },
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
    { label: t('common:explorer.contextMenu.openFile'), action: () => handleFileClick(filePath, fileName, projectName) },
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
                          onClick={() => handleFileClick(f.path, f.name, p.name)}
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
