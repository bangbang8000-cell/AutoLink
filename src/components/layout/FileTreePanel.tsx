import React from 'react'
import {
  ChevronRight, ChevronDown,
  Folder, FolderOpen,
  FileText, Image as ImageIcon, FileCode, File as FileIcon,
  FileOutput, FileInput, FileSpreadsheet, Network,
} from 'lucide-react'
import { TreeNode } from '@/components/layout/TreeNode'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import type { FileTreeNode, GroupKey, GroupedNode, OutputBatch, OutputBatchFile } from '@/types/file-tree'
import { groupProjectFiles, groupTemplateFiles } from '@/utils/file-grouping'
import type { ExplorerGroupMode } from '@/stores/ui.store'
import { useExplorerStore } from '@/stores/explorer.store'
import i18next from 'i18next'

// U1: 输出文件图标
export function getFileIcon(fileName: string): { Icon: React.ComponentType<{ size?: number; className?: string }>; color: string } {
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
export function getFileTypeIcon(fileName: string): { Icon: React.ComponentType<{ size?: number; className?: string }>; color: string } {
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
export const GROUP_ICON_MAP: Record<GroupKey, React.ComponentType<{ size?: number; className?: string }>> = {
  input: FileInput,
  output: FileOutput,
  topology: Network,
  other: FileIcon,
}

// T10: 递归收集所有目录节点路径(用于分组全部展开/折叠)
export function collectAllDirPaths(nodes: FileTreeNode[]): string[] {
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
export interface TreeHandlers {
  onFileClick: (node: FileTreeNode) => void
  onDirToggle: (scope: string, relativePath: string) => void
  isDirExpanded: (scope: string, relativePath: string) => boolean
  scope: string
  contextMenuBuilder?: (node: FileTreeNode) => ContextMenuItem[]
}

// T8: 统一递归树渲染器(替代 renderProjectStructure 和 renderStructure)
export function renderTreeNodes(
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
export interface ProjectChildrenHandlers {
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
export function renderProjectChildren(
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
export function renderOutputGroup(
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
export interface TemplateChildrenHandlers {
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
export function renderTemplateChildren(
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

// Simple tree section component (共享:被 ProjectListPanel/OutputSection/TemplateSection 使用)
export function Section({ title, icon, children, actions, sectionKey }: { title: string; icon: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; sectionKey?: string }) {
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
          className="flex-1 flex items-center gap-1.5 px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover/50"
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
