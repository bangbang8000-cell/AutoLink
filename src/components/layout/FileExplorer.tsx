import React, { useCallback, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore, type ThemeMode } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRenderStore } from '@/stores/render.store'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import {
  FolderOpen, Folder, Search, ChevronRight, ChevronDown,
  Sun, Moon, Monitor, Globe, Keyboard, Info, Palette, FileOutput,
  Cpu, Wifi, Network, Database, AlertTriangle, Shield, Download,
  Upload, RotateCcw, ExternalLink, Check,
  Wrench, Play, CheckCircle, XCircle, Loader2, Zap,
  Table2, List, FileSpreadsheet, GitBranch, Package,
} from 'lucide-react'
import clsx from 'clsx'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { AboutDialog } from '@/components/layout/AboutDialog'
import { useToastStore } from '@/stores/toast.store'
import { ConfirmDeleteDialog, type DeleteTarget } from '@/components/layout/ConfirmDeleteDialog'
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
  const { projects, templates, selectProject, selectedProjectName, deleteProjects, convertToTemplate } = useProjectStore()
  const openTab = useWorkspaceStore((s) => s.openTab)
  const addToast = useToastStore((s) => s.addToast)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const handleOpenProject = useCallback((name: string) => {
    const project = projects.find((p) => p.name === name)
    if (project) {
      selectProject(project)
      openTab({
        type: 'projectOverview',
        title: `项目概览 - ${name}`,
        closable: true,
        state: { projectName: name },
      })
    }
  }, [projects, selectProject, openTab])

  const handleOpenInExplorer = useCallback(async (projectName: string) => {
    const wsp = await window.electron?.app?.getPath('workspace')
    const folderPath = `${wsp}\\${projectName}`
    window.electron?.shell?.showItemInFolder(folderPath)
  }, [])

  const handleDeleteProject = useCallback((project: { id: number; name: string }) => {
    setDeleteTarget({ name: project.name, type: 'project' })
  }, [])

  const handleConvertToTemplate = useCallback((projectName: string) => {
    const name = prompt('请输入模板名称：', projectName)
    if (!name?.trim()) return
    convertToTemplate(projectName, { name: name.trim() })
      .then(() => addToast('success', `项目 "${projectName}" 已转为模板 "${name.trim()}"`))
      .catch((err) => addToast('error', `转换失败: ${err instanceof Error ? err.message : err}`))
  }, [convertToTemplate, addToast])

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            placeholder={t('common:search')}
            className="w-full pl-7 pr-2 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
        </div>
        {selectedProjectName && (
          <button
            onClick={() => handleOpenInExplorer(selectedProjectName)}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
            title="在文件管理器中打开"
          >
            <FolderOpen size={14} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto py-1">
        {/* Projects section */}
        <Section title="全部项目" icon={<Folder size={14} />}>
          {projects.map((p) => (
            <TreeItem
              key={p.name}
              label={p.name}
              active={p.name === selectedProjectName}
              onClick={() => handleOpenProject(p.name)}
              onDoubleClick={() => handleOpenProject(p.name)}
              contextMenu={[
                { label: '设为当前项目', action: () => handleOpenProject(p.name) },
                { label: '在文件管理器中打开', action: () => handleOpenInExplorer(p.name) },
                { label: '转为模板', action: () => handleConvertToTemplate(p.name) },
                { label: '删除项目', action: () => handleDeleteProject(p) },
              ]}
            />
          ))}
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
              await deleteProjects([String(project.id)])
              addToast('success', `项目 "${deleteTarget.name}" 已删除`)
            }
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// Simple tree section component
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [expanded, setExpanded] = React.useState(true)
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span>{title}</span>
      </button>
      {expanded && <div className="pl-1">{children}</div>}
    </div>
  )
}

// Simple tree item
function TreeItem({ label, active, onClick, onDoubleClick, contextMenu }: {
  label: string
  active?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  contextMenu?: { label: string; action: () => void }[]
}) {
  const [showContext, setShowContext] = React.useState(false)
  const [pos, setPos] = React.useState({ x: 0, y: 0 })

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setPos({ x: e.clientX, y: e.clientY })
    setShowContext(true)
  }

  return (
    <>
      <div
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={handleContextMenu}
        className={clsx(
          'flex items-center gap-1.5 px-3 pl-6 py-1 text-xs cursor-pointer select-none transition-colors',
          active
            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-l-2 border-l-primary-500'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-l-transparent'
        )}
      >
        <span className="truncate">{label}</span>
      </div>
      {showContext && contextMenu && (
        <div
          className="fixed z-[80] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{ left: pos.x, top: pos.y }}
        >
          {contextMenu.map((item) => (
            <button
              key={item.label}
              onClick={() => { item.action(); setShowContext(false) }}
              className="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
            >
              {item.label}
            </button>
          ))}
          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
          <button
            onClick={() => setShowContext(false)}
            className="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            关闭
          </button>
        </div>
      )}
      {/* Click outside to close */}
      {showContext && (
        <div className="fixed inset-0 z-[79]" onClick={() => setShowContext(false)} />
      )}
    </>
  )
}

// Expandable tree item for nested structures (output batches, template files)
function ExpandableTreeItem({ label, depth = 6, onClick, onContextMenu }: {
  label: string
  depth?: number
  onClick?: () => void
  onContextMenu?: React.MouseEventHandler
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="flex items-center gap-1.5 px-3 py-0.5 text-[11px] cursor-pointer select-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-l-transparent"
      style={{ paddingLeft: `${depth * 4 + 4}px` }}
    >
      <span className="truncate">{label}</span>
    </div>
  )
}

// Output section: lists output batches per project
function OutputSection({ projects, openTab }: {
  projects: { name: string }[]
  openTab: (tab: Omit<import('@/stores/workspace.store').WorkspaceTab, 'id'>) => string
}) {
  const { t } = useTranslation()
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const [batchesMap, setBatchesMap] = useState<Record<string, Array<{ name: string; files: Array<{ name: string; path: string }> }>>>({})
  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({})
  const addToast = useToastStore((s) => s.addToast)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const refreshBatches = useCallback((projectName: string) => {
    // Clear cache and force re-fetch
    setBatchesMap((prev) => {
      const next = { ...prev }
      delete next[projectName]
      return next
    })
    setExpandedProjects((prev) => {
      const next = { ...prev }
      delete next[projectName]
      return next
    })
  }, [])

  const toggleProject = useCallback(async (projectName: string) => {
    const currently = expandedProjects[projectName]
    if (!currently) {
      // Load batches
      try {
        const batches = await window.electron.project.listOutputBatches(projectName)
        setBatchesMap((prev) => ({ ...prev, [projectName]: batches }))
      } catch {
        setBatchesMap((prev) => ({ ...prev, [projectName]: [] }))
      }
    }
    setExpandedProjects((prev) => ({ ...prev, [projectName]: !currently }))
  }, [expandedProjects])

  const toggleBatch = useCallback((batchKey: string) => {
    setExpandedBatches((prev) => ({ ...prev, [batchKey]: !prev[batchKey] }))
  }, [])

  const handleFileClick = useCallback((filePath: string, fileName: string) => {
    openTab({
      type: 'fileViewer',
      title: fileName,
      closable: true,
      state: { filePath, isTemplate: false },
    })
  }, [openTab])

  if (projects.length === 0) return null

  return (
    <>
      <Section title="输出文件" icon={<FileOutput size={14} />}>
        {projects.map((p) => {
          const isExpanded = expandedProjects[p.name]
          const batches = batchesMap[p.name] || []
          return (
            <div key={p.name}>
              <TreeItem
                label={p.name}
                onClick={() => toggleProject(p.name)}
              />
              {isExpanded && batches.length === 0 && (
                <div className="text-[10px] text-gray-400 italic py-0.5" style={{ paddingLeft: '28px' }}>
                  {t('common:noData', '暂无输出批次')}
                </div>
              )}
              {isExpanded && batches.map((batch) => {
                const batchKey = `${p.name}/${batch.name}`
                const isBatchExpanded = expandedBatches[batchKey]
                return (
                  <div key={batchKey}>
                    <ExpandableTreeItem
                      label={batch.name}
                      depth={6}
                      onClick={() => toggleBatch(batchKey)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setDeleteTarget({ name: `${p.name} / ${batch.name}`, type: 'batch' })
                      }}
                    />
                    {isBatchExpanded && batch.files.map((f) => (
                      <ExpandableTreeItem
                        key={f.path}
                        label={f.name}
                        depth={9}
                        onClick={() => handleFileClick(f.path, f.name)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setDeleteTarget({ name: f.name, type: 'file' })
                        }}
                      />
                    ))}
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
            // Find which project the target belongs to
            for (const p of projects) {
              const batches = batchesMap[p.name] || []
              for (const batch of batches) {
                if (deleteTarget.type === 'batch' && deleteTarget.name === `${p.name} / ${batch.name}`) {
                  await window.electron.project.deleteOutputBatch(p.name, batch.name)
                  addToast('success', `批次 "${batch.name}" 已删除`)
                  refreshBatches(p.name)
                  return
                }
                if (deleteTarget.type === 'file') {
                  for (const f of batch.files) {
                    if (f.name === deleteTarget.name) {
                      // filePath is like "projectName/output/batchName/fileName"
                      const relPath = f.path.substring(f.path.indexOf('/output/') + 8) // strip "projectName/output/"
                      await window.electron.project.deleteOutputFile(p.name, relPath)
                      addToast('success', `文件 "${f.name}" 已删除`)
                      refreshBatches(p.name)
                      return
                    }
                  }
                }
              }
              if (deleteTarget.type === 'clearOutput' && deleteTarget.name.startsWith(p.name)) {
                await window.electron.project.clearOutput(p.name)
                addToast('success', `项目 "${p.name}" 的输出已清空`)
                refreshBatches(p.name)
                return
              }
            }
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}

// Template section with expandable file tree
function TemplateSection({ templates, openTab, handleOpenInExplorer }: {
  templates: { id: string; name: string; isBuiltin?: boolean }[]
  openTab: (tab: Omit<import('@/stores/workspace.store').WorkspaceTab, 'id'>) => string
  handleOpenInExplorer: (name: string) => void
}) {
  const [expandedTemplates, setExpandedTemplates] = useState<Record<string, boolean>>({})
  const [structureMap, setStructureMap] = useState<Record<string, Array<{ name: string; type: string; children?: Array<{ name: string; type: string; children?: unknown[] }> }>>>({})
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({})
  const deleteTemplate = useProjectStore((s) => s.deleteTemplate)
  const addToast = useToastStore((s) => s.addToast)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const toggleTemplate = useCallback(async (tplName: string) => {
    const currently = expandedTemplates[tplName]
    if (!currently) {
      try {
        const structure = await window.electron.template.getStructure(tplName)
        setStructureMap((prev) => ({ ...prev, [tplName]: structure }))
      } catch {
        setStructureMap((prev) => ({ ...prev, [tplName]: [] }))
      }
    }
    setExpandedTemplates((prev) => ({ ...prev, [tplName]: !currently }))
  }, [expandedTemplates])

  const toggleDir = useCallback((dirKey: string) => {
    setExpandedDirs((prev) => ({ ...prev, [dirKey]: !prev[dirKey] }))
  }, [])

  const handleTemplateFileClick = useCallback((tplName: string, filePath: string, fileName: string) => {
    openTab({
      type: 'fileViewer',
      title: fileName,
      closable: true,
      state: { templateName: tplName, filePath, isTemplate: true },
    })
  }, [openTab])

  const renderStructure = (items: Array<{ name: string; type: string; children?: unknown[] }>, tplName: string, basePath: string, depth: number) => {
    return items.map((item) => {
      const itemPath = basePath ? `${basePath}/${item.name}` : item.name
      const dirKey = `${tplName}/${itemPath}`

      if (item.type === 'directory') {
        const isDirExpanded = expandedDirs[dirKey]
        return (
          <div key={dirKey}>
            <ExpandableTreeItem
              label={item.name}
              depth={depth}
              onClick={() => toggleDir(dirKey)}
            />
            {isDirExpanded && item.children && Array.isArray(item.children) && (
              renderStructure(item.children as Array<{ name: string; type: string; children?: unknown[] }>, tplName, itemPath, depth + 1)
            )}
          </div>
        )
      }

      return (
        <ExpandableTreeItem
          key={dirKey}
          label={item.name}
          depth={depth}
          onClick={() => handleTemplateFileClick(tplName, itemPath, item.name)}
        />
      )
    })
  }

  return (
    <>
      <Section title="模板中心" icon={<Folder size={14} />}>
        {templates.map((tpl) => {
          const isExpanded = expandedTemplates[tpl.name]
          const structure = structureMap[tpl.name] || []
          return (
            <div key={tpl.id}>
              <TreeItem
                label={tpl.name}
                onClick={() => toggleTemplate(tpl.name)}
                contextMenu={[
                  { label: '查看模板文件', action: () => toggleTemplate(tpl.name) },
                  { label: '在文件管理器中打开', action: () => handleOpenInExplorer(tpl.name) },
                  ...(tpl.isBuiltin ? [] : [{ label: '删除模板', action: () => setDeleteTarget({ name: tpl.name, type: 'template' }) }]),
                ]}
              />
              {isExpanded && structure.length === 0 && (
                <div className="text-[10px] text-gray-400 italic py-0.5" style={{ paddingLeft: '28px' }}>
                  无模板文件
                </div>
              )}
              {isExpanded && renderStructure(structure, tpl.name, '', 6)}
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
            addToast('success', `模板 "${deleteTarget.name}" 已删除`)
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}

function DesignExplorer() {
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
        openTab({ type: 'visualization', title: `可视化 - ${selectedProjectName}`, closable: true })
        initFromTopology(topology.nodes)
      }
      const err = useDesignStore.getState().error
      if (err) addToast('error', err)
    } catch (err) { addToast('error', (err as Error).message) }
  }

  const handleOpenFullDesign = () => {
    openTab({ type: 'design', title: '拓扑设计', closable: true })
  }

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Wrench size={28} className="text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-xs text-gray-400">请在「项目」中选择或创建项目</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">设计</span>
        <button onClick={handleOpenFullDesign}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
          全尺寸打开
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Mode selector */}
        <select value={config.downlink_mode}
          onChange={(e) => updateConfig({ downlink_mode: e.target.value as 'full' | 'custom' })}
          className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200">
          <option value="full">全模式（自动计算）</option>
          <option value="custom">自定义模式</option>
        </select>

        {/* Server config */}
        <div className="space-y-2">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">GPU服务器</label>
          <NumberInputMini label="GPU数量" value={config.num_servers}
            onChange={(v) => updateConfig({ num_servers: v })} />
          <NumberInputMini label="每台参数网卡数" value={config.param_ports_per_server}
            onChange={(v) => updateConfig({ param_ports_per_server: v })} />
        </div>

        {/* Switch config */}
        <div className="space-y-2">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">交换机参数</label>
          <NumberInputMini label="参数网端口数" value={config.param_switch_ports}
            onChange={(v) => updateConfig({ param_switch_ports: v })} />
          <SelectMini label="参数网络速度" value={config.param_speed}
            onChange={(v) => updateConfig({ param_speed: v })}
            options={['100G','200G','400G','800G'].map(v => ({ value: v, label: v }))} />
        </div>

        {/* Network toggles */}
        <div className="space-y-1.5">
          <ToggleMini label="业务/带内管理" checked={config.biz_enabled}
            onChange={(v) => updateConfig({ biz_enabled: v })} />
          <ToggleMini label="带外管理OOB" checked={config.oob_enabled}
            onChange={(v) => updateConfig({ oob_enabled: v })} />
        </div>

        {/* Generate button */}
        <button onClick={handleGenerate} disabled={generating || !selectedProjectName}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50">
          {generating ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          生成拓扑
        </button>

        {/* Design summary */}
        {summary && (
          <div className="border border-gray-200 dark:border-gray-700 rounded p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              {valid ? <CheckCircle size={12} className="text-gray-400" /> : <XCircle size={12} className="text-gray-400" />}
              <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
                {valid ? '验证通过' : '验证失败'}
              </span>
            </div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 space-y-0.5">
              <div>GPU: {summary.numServers}台 · Leaf: {summary.paramLeafCount} · Spine: {summary.paramSpineCount}</div>
              <div>参数网: {summary.paramSpeed} · 存储网: {summary.storageSpeed}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WorkbenchExplorer() {
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const summary = useDesignStore((s) => s.summary)
  const valid = useDesignStore((s) => s.valid)
  const cabinets = useRackStore((s) => s.cabinets)
  const unplacedDevices = useRackStore((s) => s.unplacedDevices)
  const selectedOutputTypes = useRenderStore((s) => s.selectedOutputTypes)
  const toggleOutputType = useRenderStore((s) => s.toggleOutputType)
  const openTab = useWorkspaceStore((s) => s.openTab)

  const handleOpenFullWorkbench = () => {
    openTab({ type: 'workbench', title: '工作台', closable: false })
  }

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Zap size={28} className="text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-xs text-gray-400">选择项目后开始使用工作台</p>
      </div>
    )
  }

  const totalDevices = cabinets.reduce((sum, c) => sum + c.devices.length, 0) + unplacedDevices.length
  const placedDevices = cabinets.reduce((sum, c) => sum + c.devices.length, 0)
  const rackReady = totalDevices > 0 && placedDevices === totalDevices

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">工作台</span>
        <button onClick={handleOpenFullWorkbench}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
          全尺寸打开
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
            <span className="text-[10px] text-gray-500">
              拓扑: {valid === true ? '通过' : valid === false ? '失败' : '待生成'}
            </span>
            {summary && <span className="text-[10px] text-gray-400">({summary.totalServers}台)</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {rackReady ? <CheckCircle size={11} className="text-gray-400" />
              : totalDevices > 0 ? <AlertTriangle size={11} className="text-gray-400" />
              : <AlertTriangle size={11} className="text-gray-400" />}
            <span className="text-[10px] text-gray-500">
              机柜: {totalDevices === 0 ? '待规划' : rackReady ? `就绪 (${placedDevices}台)` : `${placedDevices}/${totalDevices}台`}
            </span>
          </div>
        </div>

        {/* Output types */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-[10px] font-medium text-gray-500 dark:text-gray-400">输出类型</div>
          <div className="p-2 space-y-1">
            {([
              { type: 'connections' as const, icon: <FileSpreadsheet size={12} className="text-gray-400" />, label: '连接关系表' },
              { type: 'rackTable' as const, icon: <Table2 size={12} className="text-gray-400" />, label: '上机表' },
              { type: 'topology' as const, icon: <GitBranch size={12} className="text-gray-400" />, label: '拓扑图' },
              { type: 'deviceList' as const, icon: <List size={12} className="text-gray-400" />, label: '设备清单' },
            ]).map(def => (
              <label key={def.type} className="flex items-center gap-2 cursor-pointer py-0.5">
                <input type="checkbox" checked={selectedOutputTypes.includes(def.type)}
                  onChange={() => toggleOutputType(def.type)} className="text-primary-500 shrink-0 w-3 h-3" />
                {def.icon}
                <span className="text-[11px] text-gray-600 dark:text-gray-400">{def.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function VisualizationExplorer() {
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const topology = useDesignStore((s) => s.topology)
  const cabinets = useRackStore((s) => s.cabinets)
  const openTab = useWorkspaceStore((s) => s.openTab)

  const handleOpenFullVisualization = () => {
    openTab({ type: 'visualization', title: '可视化', closable: false })
  }

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <GitBranch size={28} className="text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-xs text-gray-400">请在「项目」中选择或创建项目</p>
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
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">可视化</span>
        <button onClick={handleOpenFullVisualization}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
          全尺寸打开
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {!topology ? (
          <div className="text-center py-6">
            <GitBranch size={24} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-400">尚未生成拓扑</p>
            <p className="text-[10px] text-gray-400 mt-0.5">请在「设计」中生成拓扑数据</p>
          </div>
        ) : (
          <>
            {/* Topology Overview */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-1.5">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">拓扑概览</label>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-gray-500">节点总数</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{topology.nodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">连接总数</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{topology.edges.length}</span>
                </div>
              </div>
            </div>

            {/* Node Type Stats */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">节点类型统计</label>
              <div className="mt-1.5 space-y-1">
                {Object.entries(nodeStats).map(([type, count]) => (
                  <div key={type} className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">{NODE_TYPE_LABELS[type] || type}</span>
                    <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{count}</span>
                  </div>
                ))}
                {Object.keys(nodeStats).length === 0 && (
                  <p className="text-[10px] text-gray-400 italic">无节点数据</p>
                )}
              </div>
            </div>

            {/* Cabinet List */}
            {cabinets.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">机柜列表</label>
                <div className="mt-1.5 space-y-1">
                  {cabinets.map((cab) => (
                    <div key={cab.id} className="flex justify-between items-center">
                      <span className="text-[10px] text-gray-500 truncate max-w-[120px]">{cab.name}</span>
                      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{cab.devices.length}台</span>
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
  { key: 'gpu_servers', label: 'GPU服务器', icon: Cpu },
  { key: 'storage_servers', label: '存储服务器', icon: Database, children: [
    { key: 'storage_servers_all_flash', label: '全闪' },
    { key: 'storage_servers_hybrid_flash', label: '混闪' },
  ]},
  { key: 'compute_servers', label: '通算服务器', icon: Cpu },
  { key: 'switches', label: '交换机', icon: Network, children: [
    { key: 'switches_param', label: '参数面交换机' },
    { key: 'switches_storage', label: '存储交换机' },
    { key: 'switches_biz', label: '业务交换机' },
    { key: 'switches_oob', label: '带外交换机' },
  ]},
  { key: 'custom', label: '自定义', icon: Wrench },
]

function DeviceLibExplorer() {
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

    if (reuseTab && activeTab?.type === 'deviceLibrary') {
      // Reuse: update the existing tab in-place
      updateTab(activeTab.id, {
        title: `设备库-${label}`,
        state: { category: categoryKey },
      })
      setActiveTab(activeTab.id)
    } else {
      openTab({
        type: 'deviceLibrary',
        title: `设备库-${label}`,
        closable: true,
        state: { category: categoryKey },
      })
    }
  }, [reuseTab, tabs, activeTabId, updateTab, setActiveTab, openTab])

  const handleOpenCategory = useCallback((label: string, categoryKey: string) => {
    openOrReuseDeviceTab(label, categoryKey)
  }, [openOrReuseDeviceTab])

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">设备库</p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{allDevices.length} 台设备</p>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {/* "全部设备" */}
        <button
          onClick={() => openOrReuseDeviceTab('全部', '')}
          className={clsx(
            'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
            !activeCategory
              ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-l-2 border-l-primary-500'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-l-transparent',
          )}
        >
          <Package size={13} />
          <span>全部设备</span>
          <span className="ml-auto text-[10px] text-gray-400">{allDevices.length}</span>
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
                <span className="truncate">{node.label}</span>
                <span className="ml-auto text-[10px] text-gray-400 shrink-0">{count}</span>
              </button>

              {hasChildren && isExpanded && node.children!.map((child) => {
                const childActive = activeCategory === child.key
                const childCount = categoryCounts[child.key] || 0
                return (
                  <button
                    key={child.key}
                    onClick={() => handleOpenCategory(child.label, child.key)}
                    className={clsx(
                      'w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-[11px] transition-colors',
                      childActive
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-l-2 border-l-primary-500'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-l-transparent',
                    )}
                  >
                    <span className="truncate">{child.label}</span>
                    <span className="ml-auto text-[10px] text-gray-400 shrink-0">{childCount}</span>
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
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'language', label: '语言', icon: Globe },
  { key: 'projectDefaults', label: '项目默认值', icon: Cpu },
  { key: 'output', label: '输出', icon: FileOutput },
  { key: 'keyboard', label: '快捷键', icon: Keyboard },
  { key: 'deviceLibrary', label: '设备库', icon: Database },
  { key: 'network', label: '网络', icon: Wifi },
  { key: 'data', label: '数据', icon: Shield },
  { key: 'about', label: '关于', icon: Info },
] as const

type SettingsCategory = typeof SETTINGS_CATEGORIES[number]['key']

function SettingsExplorer() {
  const [activeCat, setActiveCat] = useState<SettingsCategory>('appearance')
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">设置</span>
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
                <span>{cat.label}</span>
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

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h4 className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/* 1. Appearance */
function AppearanceSettings() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const [fontSize, setFontSize] = useLocalStorage('autolink-font-size', 14)
  const [compactMode, setCompactMode] = useLocalStorage('autolink-compact-mode', false)
  const [animations, setAnimations] = useLocalStorage('autolink-animations', true)

  return (
    <SettingsSection title="外观设置">
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">主题模式</label>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {([{ mode: 'light' as ThemeMode, icon: <Sun size={13} />, label: '浅色' },
           { mode: 'dark' as ThemeMode, icon: <Moon size={13} />, label: '深色' },
           { mode: 'system' as ThemeMode, icon: <Monitor size={13} />, label: '跟随系统' },
        ]).map((item) => (
          <button
            key={item.mode}
            onClick={() => setTheme(item.mode)}
            className={`flex flex-col items-center gap-0.5 py-2 rounded border text-[10px] transition-colors
              ${theme === item.mode
                ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'}`}
          >
            {item.icon}{item.label}
          </button>
        ))}
      </div>

      <SettingsRow label="字体大小">
        <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}
          className="text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
          {[12, 13, 14, 16, 18].map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
      </SettingsRow>

      <SettingsRow label="紧凑模式">
        <Toggle checked={compactMode} onChange={setCompactMode} />
      </SettingsRow>

      <SettingsRow label="动画效果">
        <Toggle checked={animations} onChange={setAnimations} />
      </SettingsRow>
    </SettingsSection>
  )
}

/* 2. Language */
function LanguageSettings() {
  const { i18n } = useTranslation()
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)

  return (
    <SettingsSection title="语言 / Language">
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
  const [defaultRack, setDefaultRack] = useLocalStorage('autolink-default-rack', 42)
  const [defaultPowerLimit, setDefaultPowerLimit] = useLocalStorage('autolink-default-power', 6000)
  const [defaultPortSpeed, setDefaultPortSpeed] = useLocalStorage('autolink-default-port-speed', '400G')

  return (
    <SettingsSection title="新建项目默认值">
      <SettingsRow label="默认机柜类型">
        <select value={defaultRack} onChange={(e) => setDefaultRack(Number(e.target.value))}
          className="text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
          <option value={42}>42U</option>
          <option value={49}>49U</option>
        </select>
      </SettingsRow>
      <SettingsRow label="默认功率上限 (W)">
        <input type="number" value={defaultPowerLimit}
          onChange={(e) => setDefaultPowerLimit(Number(e.target.value))}
          className="w-20 text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
      </SettingsRow>
      <SettingsRow label="默认端口速率">
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
  const [defaultFormat, setDefaultFormat] = useLocalStorage('autolink-output-format', 'xlsx')
  const [outputDir, setOutputDir] = useLocalStorage('autolink-output-dir', '')
  const [autoSaveInterval, setAutoSaveInterval] = useLocalStorage('autolink-autosave-interval', 5)

  return (
    <SettingsSection title="输出设置">
      <SettingsRow label="默认输出格式">
        <select value={defaultFormat} onChange={(e) => setDefaultFormat(e.target.value)}
          className="text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="csv">CSV (.csv)</option>
          <option value="png">PNG 图片</option>
        </select>
      </SettingsRow>
      <SettingsRow label="输出目录">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 max-w-[120px] truncate">{outputDir || '默认'}</span>
          <button
            onClick={async () => {
              const result = await window.electron?.dialog?.openDirectory?.()
              if (result) setOutputDir(result as string)
            }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            选择...
          </button>
        </div>
      </SettingsRow>
      <SettingsRow label="自动保存间隔 (分钟)">
        <input type="number" value={autoSaveInterval} min={1} max={60}
          onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
          className="w-16 text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
      </SettingsRow>
    </SettingsSection>
  )
}

/* 5. Keyboard Shortcuts */
function KeyboardSettings() {
  const defaultShortcuts = [
    { keys: 'Ctrl+Shift+E', desc: '项目浏览器' },
    { keys: 'Ctrl+Shift+W', desc: '工作台' },
    { keys: 'Ctrl+Shift+D', desc: '拓扑设计' },
    { keys: 'Ctrl+Shift+V', desc: '可视化' },
    { keys: 'Ctrl+,', desc: '设置' },
    { keys: 'Ctrl+B', desc: '显示/隐藏侧栏' },
    { keys: 'Ctrl+J', desc: '显示/隐藏面板' },
    { keys: 'Ctrl+W', desc: '关闭当前标签' },
    { keys: 'Ctrl+Shift+T', desc: '恢复关闭标签' },
  ]

  const [shortcuts] = useLocalStorage('autolink-keybindings', defaultShortcuts)

  return (
    <SettingsSection title="键盘快捷键">
      <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
        {shortcuts.map((s) => (
          <div key={s.keys}
            className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 text-xs">
            <span className="text-gray-600 dark:text-gray-400">{s.desc}</span>
            <kbd className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono">
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
  const [dataDir, setDataDir] = useLocalStorage('autolink-device-data-dir', '')
  const [autoUpdate, setAutoUpdate] = useLocalStorage('autolink-device-auto-update', true)
  const [reuseTab, setReuseTab] = useLocalStorage('autolink-device-tab-reuse', true)

  return (
    <SettingsSection title="设备库设置">
      <SettingsRow label="数据目录">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400 max-w-[120px] truncate">{dataDir || '默认'}</span>
          <button
            onClick={async () => {
              const result = await window.electron?.dialog?.openDirectory?.()
              if (result) setDataDir(result as string)
            }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            选择...
          </button>
        </div>
      </SettingsRow>
      <SettingsRow label="自动更新设备库">
        <Toggle checked={autoUpdate} onChange={setAutoUpdate} />
      </SettingsRow>
      <SettingsRow label="复用设备库页签">
        <Toggle checked={reuseTab} onChange={setReuseTab} />
      </SettingsRow>
    </SettingsSection>
  )
}

/* 7. Network */
function NetworkSettings() {
  const [autoCheck, setAutoCheck] = useLocalStorage('autolink-auto-update-check', true)
  const [proxyHost, setProxyHost] = useLocalStorage('autolink-proxy-host', '')
  const [proxyPort, setProxyPort] = useLocalStorage('autolink-proxy-port', '')

  return (
    <SettingsSection title="网络设置">
      <SettingsRow label="自动检查更新">
        <Toggle checked={autoCheck} onChange={setAutoCheck} />
      </SettingsRow>
      <SettingsRow label="代理服务器">
        <div className="flex items-center gap-1">
          <input placeholder="主机" value={proxyHost}
            onChange={(e) => setProxyHost(e.target.value)}
            className="w-20 text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
          <span className="text-gray-400">:</span>
          <input placeholder="端口" value={proxyPort}
            onChange={(e) => setProxyPort(e.target.value)}
            className="w-14 text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
        </div>
      </SettingsRow>
    </SettingsSection>
  )
}

/* 8. Data */
function DataSettings() {
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
      addToast('success', '数据导出成功')
    } catch { addToast('error', '导出失败') }
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
        addToast('success', '数据导入成功，请刷新页面加载新配置')
      } catch { addToast('error', '导入失败，请检查文件格式') }
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
    addToast('info', '所有设置已重置')
  }

  return (
    <SettingsSection title="数据管理">
      <button onClick={handleExportAll}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
        <Download size={13} />导出全部数据
      </button>
      <button onClick={handleImport}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
        <Upload size={13} />导入数据
      </button>
      <button onClick={handleReset}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10">
        <RotateCcw size={13} />重置所有设置
      </button>
    </SettingsSection>
  )
}

/* 9. About */
function AboutSettings({ onOpenAbout }: { onOpenAbout: () => void }) {
  const [lastCheck, setLastCheck] = useLocalStorage('autolink-last-update-check', '')

  const handleCheckUpdate = () => {
    const now = new Date().toISOString()
    setLastCheck(now)
  }

  return (
    <SettingsSection title="关于 AutoLink">
      <div className="border border-gray-200 dark:border-gray-700 rounded p-3">
        <div className="text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">版本</span>
            <span className="font-medium text-gray-700 dark:text-gray-300">2.0.1</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">许可证</span>
            <span className="text-gray-500">MIT</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">上次检查更新</span>
            <span className="text-gray-500">{lastCheck ? new Date(lastCheck).toLocaleString() : '从未'}</span>
          </div>
        </div>
      </div>
      <button onClick={handleCheckUpdate}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
        <ExternalLink size={13} />检查更新
      </button>
      <button onClick={onOpenAbout}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
        <Info size={13} />查看完整信息 & 第三方许可
      </button>
    </SettingsSection>
  )
}

/* ---------- shared mini components ---------- */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors ${checked ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'left-4' : 'left-0.5'}`} />
    </button>
  )
}

function useRequireToast() {
  return useToastStore.getState().addToast
}

/* ---------- mini form components for explorers ---------- */

function NumberInputMini({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-gray-500 dark:text-gray-400">{label}</span>
      <input type="number" value={value}
        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(v) }}
        className="w-20 px-1.5 py-1 text-[11px] text-right rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400" />
    </div>
  )
}

function SelectMini({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-gray-500 dark:text-gray-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-20 px-1 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function ToggleMini({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer">
      <span className="text-[10px] text-gray-500 dark:text-gray-400">{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative w-7 h-4 rounded-full transition-colors ${checked ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'left-3.5' : 'left-0.5'}`} />
      </button>
    </label>
  )
}
