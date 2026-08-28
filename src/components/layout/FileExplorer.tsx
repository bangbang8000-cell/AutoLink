import React, { useCallback, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore, type WorkbenchSubview } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useRenderStore } from '@/stores/render.store'
import { useRoomStore } from '@/stores/room.store'
import { useExplorerStore } from '@/stores/explorer.store'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import { deriveSubviewStatus, type SubviewStatus, type SubviewStatusDeps, type SubviewStatusTone } from '@/utils/subviewStatus'
import { OutputExplorer } from '@/components/layout/OutputExplorer'
import {
  ChevronRight, ChevronDown,
  AlertTriangle,
  Wrench, Play, CheckCircle, XCircle, Loader2, Zap,
  Table2, List, FileSpreadsheet, GitBranch, Package,
  Cpu, Network, Database, FolderOpen, FileCheck2, Download, Boxes,
} from 'lucide-react'
import clsx from 'clsx'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useToastStore } from '@/stores/toast.store'
import { Toggle } from '@/components/ui/Toggle'
import { INPUT_CLASS } from '@/components/ui/SettingsRow'
import { NODE_TYPE_LABELS } from '@/constants/labels'
import { ProjectExplorer } from '@/components/layout/ProjectListPanel'
import { SettingsExplorer, NumberInputMini, SelectMini } from '@/components/layout/SettingsPanel'
import { CloudPanel } from '@/components/cloud/CloudPanel'
import { SearchPanel } from '@/components/search/SearchPanel'

export function FileExplorer() {
  const activeActivity = useUIStore((s) => s.activeActivity)
  // 打磨轮（v1.2 / M2）：云平台开关关闭时云中心回落到项目浏览器
  const cloudEnabled = useUIStore((s) => s.cloudEnabled)

  switch (activeActivity) {
    // V3.3.1: 全局搜索（本地 + 云端二合一）
    case 'search':        return <SearchPanel />
    case 'project':        return <ProjectExplorer />
    case 'design':         return <DesignExplorer />
    case 'workbench':      return <WorkbenchExplorer />
    case 'visualization':  return <VisualizationExplorer />
    case 'device_library': return <DeviceLibExplorer />
    // V3.3.0-T13: 云中心（v1.2：仅云开关开启时显示）
    case 'cloud':          return cloudEnabled ? <CloudPanel /> : <ProjectExplorer />
    // 打磨轮（v1.6 / AL-O2a）：输出结果（全部项目）
    case 'output':         return <OutputExplorer />
    case 'settings':       return <SettingsExplorer />
    default:           return <ProjectExplorer />
  }
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
        openTab({ type: 'visualization', title: `${t('common:menu.topology')} - ${selectedProjectName}`, closable: true, projectName: selectedProjectName })
        initFromTopology(topology.nodes)
      }
      const err = useDesignStore.getState().error
      if (err) addToast('error', err)
    } catch (err) { addToast('error', (err as Error).message) }
  }

  const handleOpenFullDesign = () => {
    openTab({ type: 'design', title: t('common:menu.design'), closable: true, projectName: selectedProjectName ?? undefined })
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
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('common:explorer.design.title')}</span>
        <button onClick={handleOpenFullDesign}
          className="text-2xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-app-hover">
          {t('common:explorer.design.openFullSize')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Mode selector */}
        <select value={config.downlink_mode}
          onChange={(e) => updateConfig({ downlink_mode: e.target.value as 'full' | 'custom' })}
          className={`w-full ${INPUT_CLASS} text-gray-800 dark:text-gray-200`}>
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
          <div className="border border-gray-200 dark:border-edge-subtle rounded p-2.5 space-y-1.5">
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

// 打磨轮（v1.6 / AL-N1c）：工作台子视图按流程排序——①规划 ②组网设计（含组网设计+机柜设计）③组网渲染 ④校对/输出 ⑤导出
// AL-N2（PRD v3.2）：移除静态 ①-⑤ 徽标，右侧状态标签由 deriveSubviewStatus 按数据就绪度动态推导
const WORKBENCH_SUBVIEWS: Array<{ id: WorkbenchSubview; label: string; icon: React.ReactNode }> = [
  { id: 'aidc', label: 'AIDC 规划', icon: <Cpu size={13} className="text-emerald-500" /> },
  { id: 'design', label: '组网设计', icon: <Wrench size={13} className="text-warning-500" /> },
  // AL-N1（PRD v3.2）：中栏拆「机房设计」「机柜设计」两个独立入口（替换坏链 rack；均挂组网设计组）
  { id: 'roomdesign', label: '机房设计', icon: <Boxes size={13} className="text-primary-500" /> },
  { id: 'rackdesign', label: '机柜设计', icon: <Database size={13} className="text-purple-500" /> },
  { id: 'main', label: '组网渲染', icon: <Zap size={13} className="text-gray-400" /> },
  { id: 'visualization', label: '拓扑', icon: <Network size={13} className="text-info-500" /> },
  // 打磨轮（v1.6 / AL-O2c）：本项目输出留在工作台
  { id: 'results', label: '本项目输出', icon: <FileCheck2 size={13} className="text-info-500" /> },
  { id: 'export', label: '导出', icon: <Download size={13} className="text-success-500" /> },
]

/** AL-N2：动态状态标签色调（已完成=绿 / 待操作=灰 / 进行中=蓝） */
const STATUS_TONE_CLASS: Record<SubviewStatusTone, string> = {
  done: 'text-success-600 dark:text-success-400',
  pending: 'text-gray-400 dark:text-gray-500',
  active: 'text-info-500',
}

function WorkbenchExplorer() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const summary = useDesignStore((s) => s.summary)
  const valid = useDesignStore((s) => s.valid)
  const generating = useDesignStore((s) => s.generating)
  const cabinets = useRackStore((s) => s.cabinets)
  const unplacedDevices = useRackStore((s) => s.unplacedDevices)
  const selectedOutputTypes = useRenderStore((s) => s.selectedOutputTypes)
  const renderStatus = useRenderStore((s) => s.progress.status)
  const roomMatrix = useRoomStore((s) => s.matrix)
  const outputBatches = useExplorerStore((s) => s.outputBatches)
  const toggleOutputType = useRenderStore((s) => s.toggleOutputType)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const subview = useUIStore((s) => s.workbenchSubview)
  const setWorkbenchSubview = useUIStore((s) => s.setWorkbenchSubview)

  // AL-N2：输出批次非空 → results/export「已完成」（复用 explorer.store 缓存，缺失时懒加载）
  useEffect(() => {
    if (!selectedProjectName) return
    const cached = useExplorerStore.getState().outputBatches[selectedProjectName]
    if (cached) return
    const fetcher = window.electron?.project?.listOutputBatches
    if (fetcher) {
      fetcher(selectedProjectName)
        .then((batches) => useExplorerStore.getState().setOutputBatches(selectedProjectName, batches))
        .catch(() => {})
    }
  }, [selectedProjectName])

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
  const rackHasCabinets = cabinets.length > 0
  const roomMatrixFinalized = roomMatrix?.finalized === true
  const hasOutputBatches = (outputBatches[selectedProjectName] ?? []).length > 0

  // AL-N2：每行动态状态——active 子视图 / 读取中优先「进行中」；否则按数据就绪度「已完成 / 待操作」
  const subviewStatuses = useMemo(() => {
    const deps: SubviewStatusDeps = {
      designValid: valid,
      rackReady,
      rackHasCabinets,
      roomMatrixFinalized,
      hasOutputBatches,
      hasSelectedOutputTypes: selectedOutputTypes.length > 0,
      activeSubview: subview,
    }
    const reading = (id: WorkbenchSubview): boolean =>
      (id === 'design' && generating) || (id === 'main' && renderStatus === 'rendering')
    const map = {} as Record<WorkbenchSubview, SubviewStatus>
    for (const s of WORKBENCH_SUBVIEWS) {
      map[s.id] = deriveSubviewStatus(s.id, { ...deps, reading: reading(s.id) })
    }
    return map
  }, [valid, rackReady, rackHasCabinets, roomMatrixFinalized, hasOutputBatches, selectedOutputTypes.length, subview, generating, renderStatus])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('common:explorer.workbench.title')}</span>
        <button onClick={handleOpenFullWorkbench}
          className="text-2xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-app-hover">
          {t('common:explorer.workbench.openFullSize')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* 打磨轮（v1.2）：工作台子视图按钮（点击加载工作区对应界面） */}
        <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
          <div className="px-2.5 py-1.5 bg-gray-50 dark:bg-app/50 text-2xs font-medium text-gray-500 dark:text-gray-400">工作台视图</div>
          <div className="p-1.5 space-y-0.5">
            {WORKBENCH_SUBVIEWS.map((s) => (
              <button key={s.id} type="button"
                onClick={() => setWorkbenchSubview(s.id)}
                className={clsx(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded transition-colors',
                  subview === s.id
                    ? 'bg-primary-500 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover',
                )}>
                {s.icon}
                <span className="truncate">{s.label}</span>
                <span className={clsx('ml-auto text-2xs shrink-0',
                  subview === s.id ? 'text-white/80' : STATUS_TONE_CLASS[subviewStatuses[s.id].tone])}>
                  {subviewStatuses[s.id].label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Project info */}
        <div className="bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs">
            <FolderOpen size={12} className="text-gray-400" />
            <span className="font-medium text-gray-700 dark:text-gray-200 truncate">{selectedProjectName}</span>
          </div>
        </div>

        {/* M8（AL-U1）：移除「本项目输出」中栏 OutputSection —— 成果查看经工作台「输出结果」子视图 / 侧栏「输出」活动兜底 */}

        {/* Readiness */}
        <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-2.5 space-y-2">
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
        <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
          <div className="px-2.5 py-1.5 bg-gray-50 dark:bg-app/50 text-2xs font-medium text-gray-500 dark:text-gray-400">{t('common:explorer.workbench.outputTypes')}</div>
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
    openTab({ type: 'visualization', title: t('common:explorer.visualization.title'), closable: false, projectName: selectedProjectName ?? undefined })
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
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('common:explorer.visualization.title')}</span>
        <button onClick={handleOpenFullVisualization}
          className="text-2xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-app-hover">
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
            <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-2.5 space-y-1.5">
              <label className="text-2xs text-gray-500 uppercase tracking-wider">{t('common:explorer.visualization.topologyOverview')}</label>
              <div className="space-y-1 text-2xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('common:explorer.visualization.totalNodes')}</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300 font-mono tabular-nums">{topology.nodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('common:explorer.visualization.totalConnections')}</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300 font-mono tabular-nums">{topology.edges.length}</span>
                </div>
              </div>
            </div>

            {/* Node Type Stats */}
            <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-2.5">
              <label className="text-2xs text-gray-500 uppercase tracking-wider">{t('common:explorer.visualization.nodeTypeStats')}</label>
              <div className="mt-1.5 space-y-1">
                {Object.entries(nodeStats).map(([type, count]) => (
                  <div key={type} className="flex justify-between items-center">
                    <span className="text-2xs text-gray-500">{NODE_TYPE_LABELS[type] || type}</span>
                    <span className="text-2xs font-medium text-gray-700 dark:text-gray-300 font-mono tabular-nums">{count}</span>
                  </div>
                ))}
                {Object.keys(nodeStats).length === 0 && (
                  <p className="text-2xs text-gray-400 italic">{t('common:explorer.visualization.noNodeData')}</p>
                )}
              </div>
            </div>

            {/* Cabinet List */}
            {cabinets.length > 0 && (
              <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-2.5">
                <label className="text-2xs text-gray-500 uppercase tracking-wider">{t('common:explorer.visualization.cabinetList')}</label>
                <div className="mt-1.5 space-y-1">
                  {cabinets.map((cab) => (
                    <div key={cab.id} className="flex justify-between items-center">
                      <span className="text-2xs text-gray-500 truncate max-w-[120px]">{cab.name}</span>
                      <span className="text-2xs font-medium text-gray-700 dark:text-gray-300 font-mono tabular-nums">{cab.devices.length}</span>
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
      <div className="px-3 py-2 border-b border-gray-200 dark:border-edge-subtle shrink-0">
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
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover/50 border-l-2 border-l-transparent',
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
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover/50 border-l-2 border-l-transparent',
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
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover/50 border-l-2 border-l-transparent',
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
