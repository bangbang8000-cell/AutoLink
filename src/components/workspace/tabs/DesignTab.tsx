import React, { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Wrench, Play, RefreshCw,
  Server, HardDrive, Network, Zap,
  AlertTriangle, ChevronDown, ChevronRight, Loader2,
  Settings2, Gauge,
} from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore, type DesignConfig, type DesignSummary, type EstimateParams } from '@/stores/design.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useToastStore } from '@/stores/toast.store'
import { ensureMatrixRacks } from '@/utils/ensureMatrixRacks'
import { NumberInput, Toggle } from '@/components/ui'
import { PUEEstimatePanel } from './PUEEstimatePanel'
import { ReportViewPanel } from './ReportViewPanel'
import { ValidationPanel } from './ValidationPanel'
import { CapacityRecommendModal } from '@/components/capacity/CapacityRecommendModal'

/* -------------------------------------------------- */
/*  Sub-components (same as DesignPanel)              */
/* -------------------------------------------------- */
function FormSection({ title, icon, defaultOpen = true, children }: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-app/50 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span>{title}</span>
      </button>
      {open && <div className="px-4 py-3 space-y-3">{children}</div>}
    </div>
  )
}

function SelectInput({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="block text-2xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

/* -------------------------------------------------- */
/*  DesignSummary (full width variant)                */
/* -------------------------------------------------- */
function DesignSummaryView({ summary }: { summary: DesignSummary; valid: boolean | null }) {
  const { t } = useTranslation()
  const totalSw = summary.paramLeafCount + summary.paramSpineCount + summary.paramCoreCount
    + summary.storageLeafCount + summary.storageSpineCount
  const totalDevices = summary.totalServers + totalSw
  const portUsage = summary.paramDownlink && summary.paramLeafCount
    ? Math.round(((summary.numServers * 8) / (summary.paramDownlink * summary.paramLeafCount)) * 100)
    : null

  return (
    <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 dark:bg-app/50 text-sm font-medium text-gray-600 dark:text-gray-300">
        {t('design:designSummary')}
      </div>
      <div className="p-4 space-y-4">
        {/* Top stats */}
        <div className="grid grid-cols-4 gap-3">
          <StatItem label={t('design:totalServers')} value={summary.totalServers} />
          <StatItem label={t('design:totalSwitches')} value={totalSw} />
          <StatItem label="设备总数" value={totalDevices} />
          <StatItem label="端口使用率" value={portUsage ? `${portUsage}%` : '-'} />
        </div>

        {/* Network details in 2 columns */}
        <div className="grid grid-cols-2 gap-3">
          {/* Param network */}
          <div className="border border-gray-100 dark:border-edge-subtle rounded p-3">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              {t('design:summaryParam')} ({summary.paramSpeed})
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <MiniStat label={t('design:paramLeaf')} value={summary.paramLeafCount} />
              <MiniStat label={t('design:paramSpine')} value={summary.paramSpineCount} />
              <MiniStat label="Core" value={summary.paramCoreCount} />
            </div>
          </div>

          {/* Storage network */}
          <div className="border border-gray-100 dark:border-edge-subtle rounded p-3">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              {t('design:summaryStorage')} ({summary.storageSpeed})
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <MiniStat label={t('design:storageLeaf')} value={summary.storageLeafCount} />
              <MiniStat label={t('design:storageSpine')} value={summary.storageSpineCount} />
            </div>
          </div>
        </div>

        {/* Validation - V2.4.6: 结构化问题列表 */}
        <ValidationPanel />
      </div>
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 dark:bg-app/80 rounded px-3 py-2 text-center">
      <div className="text-lg font-bold text-gray-800 dark:text-gray-100">{value}</div>
      <div className="text-2xs text-gray-400 dark:text-gray-500">{label}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-700 dark:text-gray-300">{value}</span>
    </div>
  )
}

/* -------------------------------------------------- */
/*  DesignTab                                         */
/* -------------------------------------------------- */
export function DesignTab() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const {
    config, summary, valid, generating, error, estimation, estimating,
    updateConfig, resetConfig, generate, loadConfig, loadSavedTopology, clearResults, estimate,
  } = useDesignStore()
  const openTab = useWorkspaceStore((s) => s.openTab)
  const addToast = useToastStore((s) => s.addToast)

  // V3.1.3-T7-4: 容量规划推荐向导（apply 回调置于 handleUpdateConfig 之后）
  const [showCapacity, setShowCapacity] = useState(false)
  // 打磨轮（v1.2 复核）：配置预设并入设计工作台
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    window.electron.config.listSchema()
      .then((r) => setPresets((r as { presets?: Array<{ id: string; name: string }> })?.presets || []))
      .catch(() => setPresets([]))
  }, [])

  const handleApplyPreset = async (presetId: string) => {
    if (!presetId) return
    try {
      const state = useDesignStore.getState()
      const res = (await window.electron.config.applyPreset(presetId, state.config)) as unknown as
        { config?: DesignConfig; errors?: string[] }
      if (res?.errors?.length) {
        addToast('error', `预设应用失败: ${res.errors.join('; ')}`, 5000)
        return
      }
      if (res?.config) {
        state.updateConfig(res.config)
        addToast('success', '预设已应用到设计配置（可点「生成拓扑」查看）', 4000)
      }
    } catch (err) {
      addToast('error', `预设应用失败: ${(err as Error).message}`, 5000)
    }
  }

  // V2.9.2-T4: 配置变更标记 dirty(关闭需确认); 重置后清除
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const updateTab = useWorkspaceStore((s) => s.updateTab)

  const markDirty = useCallback(() => {
    if (activeTabId) updateTab(activeTabId, { dirty: true })
  }, [activeTabId, updateTab])

  const clearDirty = useCallback(() => {
    if (activeTabId) updateTab(activeTabId, { dirty: false })
  }, [activeTabId, updateTab])

  // 统一入口: 先标记 dirty 再更新配置
  const handleUpdateConfig = useCallback((patch: Partial<DesignConfig>) => {
    markDirty()
    updateConfig(patch)
  }, [markDirty, updateConfig])

  const handleCapacityApply = useCallback((patch: Partial<DesignConfig>) => {
    handleUpdateConfig(patch)
    addToast('success', '容量推荐已应用到设计配置', 3000)
  }, [handleUpdateConfig, addToast])

  useEffect(() => {
    if (selectedProjectName) {
      loadConfig(selectedProjectName).then(() => {
        loadSavedTopology(selectedProjectName)
      })
    } else {
      clearResults()
    }
  }, [selectedProjectName, loadConfig, loadSavedTopology, clearResults])

  const handleGenerate = useCallback(async () => {
    if (!selectedProjectName) return
    await generate(selectedProjectName)
    // 打磨轮（AL-B2）：生成后自动打开拓扑视图；空拓扑给出可读提示；initFromTopology 失败不阻断打开视图
    const state = useDesignStore.getState()
    if (state.error) {
      useToastStore.getState().addToast('error', `生成拓扑失败: ${state.error}`, 6000)
      return
    }
    if (state.topology && state.topology.nodes.length > 0) {
      openTab({ type: 'visualization', title: `拓扑视图 - ${selectedProjectName}`, closable: true, projectName: selectedProjectName })
      // 打磨轮（v1.4 / AL-R2c）：有矩阵按矩阵落位（GPU 1柜1台），无矩阵回退按拓扑生成
      try {
        await ensureMatrixRacks(selectedProjectName, state.topology.nodes)
      } catch (err) {
        console.error('[DesignTab] ensureMatrixRacks failed:', err)
        useToastStore.getState().addToast('warning', '拓扑已生成，但机柜初始化未完成', 5000)
      }
    } else {
      useToastStore.getState().addToast('warning', '生成拓扑结果为空，请检查网络/规模配置', 5000)
    }
  }, [selectedProjectName, generate, openTab])

  const handleReEstimate = useCallback((params: EstimateParams) => {
    if (!selectedProjectName) return
    estimate(selectedProjectName, params)
  }, [selectedProjectName, estimate])

  const speedOptions = [
    { value: '100G', label: '100G' },
    { value: '200G', label: '200G' },
    { value: '400G', label: '400G' },
    { value: '800G', label: '800G' },
  ]

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <Settings2 size={48} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('design:title')}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('design:noProject')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-edge-subtle shrink-0 bg-gray-50 dark:bg-app/50">
        <div className="flex items-center gap-2">
          <Settings2 size={16} className="text-primary-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('design:title')} — {selectedProjectName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 打磨轮（v1.2 复核）：配置预设并入设计工作台 */}
          {presets.length > 0 && (
            <select
              value=""
              onChange={(e) => { const v = e.target.value; e.target.value = ''; void handleApplyPreset(v) }}
              className="px-1.5 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-500"
              aria-label="应用预设">
              <option value="">应用预设…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {/* V3.1.3-T7-4: 容量规划推荐入口 */}
          <button
            onClick={() => setShowCapacity(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-2xs rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500 dark:text-gray-400"
          >
            <Gauge size={12} />
            容量推荐
          </button>
          <button
            onClick={() => { resetConfig(); clearResults(); clearDirty() }}
            className="flex items-center gap-1 px-2.5 py-1 text-2xs rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500 dark:text-gray-400"
          >
            <RefreshCw size={12} />
            重置
          </button>
        </div>
      </div>

      {/* V3.1.3-T7-4: 容量规划推荐向导（一键应用） */}
      <CapacityRecommendModal
        open={showCapacity}
        onClose={() => setShowCapacity(false)}
        onApply={handleCapacityApply}
        initialNumServers={config.num_servers}
      />

      {/* Content - full width layout */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-5">
          {/* Mode toggle */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">{t('design:mode')}</label>
            <div className="flex gap-1 bg-gray-100 dark:bg-app-surface rounded-lg p-0.5 max-w-md">
              <button
                onClick={() => handleUpdateConfig({ downlink_mode: 'full' })}
                className={`flex-1 py-2 text-sm rounded-md transition-colors ${config.downlink_mode === 'full'
                  ? 'bg-white dark:bg-app-hover text-gray-800 dark:text-gray-200 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                  }`}
              >
                <Zap size={14} className="inline mr-1.5" />
                {t('design:modeFull')}
              </button>
              <button
                onClick={() => handleUpdateConfig({ downlink_mode: 'custom' })}
                className={`flex-1 py-2 text-sm rounded-md transition-colors ${config.downlink_mode === 'custom'
                  ? 'bg-white dark:bg-app-hover text-gray-800 dark:text-gray-200 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                  }`}
              >
                <Wrench size={14} className="inline mr-1.5" />
                {t('design:modeCustom')}
              </button>
            </div>
            <p className="text-2xs text-gray-400 dark:text-gray-500 mt-1.5">
              {config.downlink_mode === 'full' ? t('design:modeFullDesc') : t('design:modeCustomDesc')}
            </p>
          </div>

          {/* Server config */}
          <FormSection title={t('design:serverConfig')} icon={<Server size={13} />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumberInput label={t('design:gpuServers')} value={config.num_servers}
                onChange={(v) => handleUpdateConfig({ num_servers: v })} min={1} />
              <NumberInput label={t('design:paramPortsPerServer')} value={config.param_ports_per_server}
                onChange={(v) => handleUpdateConfig({ param_ports_per_server: v })} min={1} max={32} />
              <NumberInput label={t('design:storageServers')} value={config.additional_storage_servers}
                onChange={(v) => handleUpdateConfig({ additional_storage_servers: v })} min={0} />
              <NumberInput label={t('design:computeServers')} value={config.additional_compute_servers}
                onChange={(v) => handleUpdateConfig({ additional_compute_servers: v })} min={0} />
              <NumberInput label={t('design:storagePortsPerServer')} value={config.storage_ports_per_server}
                onChange={(v) => handleUpdateConfig({ storage_ports_per_server: v })} min={1} max={8} />
            </div>
          </FormSection>

          {/* Switch & Speed config */}
          <FormSection title={t('design:switchConfig')} icon={<HardDrive size={13} />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumberInput label={t('design:paramSwitchPorts')} value={config.param_switch_ports}
                onChange={(v) => handleUpdateConfig({ param_switch_ports: v })} min={8} step={8} />
              <NumberInput label={t('design:storageSwitchPorts')} value={config.storage_switch_ports}
                onChange={(v) => handleUpdateConfig({ storage_switch_ports: v })} min={8} step={8} />
              <SelectInput label={t('design:paramSpeed')} value={config.param_speed}
                onChange={(v) => handleUpdateConfig({ param_speed: v })} options={speedOptions} />
              <SelectInput label={t('design:storageSpeed')} value={config.storage_speed}
                onChange={(v) => handleUpdateConfig({ storage_speed: v })} options={speedOptions} />
            </div>
          </FormSection>

          {/* V2.7.2: 高级配置 — Rail-Optimized 模式与协议 */}
          <FormSection title="高级配置" icon={<Network size={13} />} defaultOpen={config.rail_mode === 'rail_optimized'}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SelectInput
                label="Rail 模式"
                value={config.rail_mode}
                onChange={(v) => handleUpdateConfig({ rail_mode: v as 'standard' | 'rail_optimized' })}
                options={[
                  { value: 'standard', label: 'Standard (Fat-Tree)' },
                  { value: 'rail_optimized', label: 'Rail-Optimized (SuperPOD)' },
                ]}
              />
              {config.rail_mode === 'rail_optimized' && (
                <NumberInput
                  label="Rail 数量"
                  value={config.rail_count}
                  onChange={(v) => handleUpdateConfig({ rail_count: v })}
                  min={2} max={16} step={1}
                />
              )}
              <SelectInput
                label="参数网协议"
                value={config.param_protocol}
                onChange={(v) => handleUpdateConfig({ param_protocol: v as 'IB' | 'RoCE' })}
                options={[
                  { value: 'RoCE', label: 'RoCE (以太网)' },
                  { value: 'IB', label: 'InfiniBand' },
                ]}
              />
            </div>
            {config.rail_mode === 'rail_optimized' && (
              <p className="text-2xs text-gray-400 dark:text-gray-500">
                Rail-Optimized 模式采用 NVIDIA SuperPOD 8-Rail 架构,服务器交错分配到各 Rail,单 Rail 故障不影响整体可用性。
              </p>
            )}
          </FormSection>

          {/* Custom downlink limits */}
          {config.downlink_mode === 'custom' && (
            <FormSection title={t('design:downlinkConfig')} icon={<Network size={13} />}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <NumberInput label={t('design:paramDownlink')} value={config.param_downlink_limit}
                  onChange={(v) => handleUpdateConfig({ param_downlink_limit: v })} min={1} />
                <NumberInput label={t('design:storageDownlink')} value={config.storage_downlink_limit}
                  onChange={(v) => handleUpdateConfig({ storage_downlink_limit: v })} min={1} />
                <NumberInput label={t('design:bizDownlink')} value={config.biz_downlink_limit}
                  onChange={(v) => handleUpdateConfig({ biz_downlink_limit: v })} min={1} />
                <NumberInput label={t('design:oobDownlink')} value={config.oob_downlink_limit}
                  onChange={(v) => handleUpdateConfig({ oob_downlink_limit: v })} min={1} />
              </div>
            </FormSection>
          )}

          {/* Toggles */}
          <div className="flex items-center gap-6 px-1">
            <Toggle label={t('design:oobEnabled')} checked={config.oob_enabled}
              onChange={(v) => handleUpdateConfig({ oob_enabled: v })} />
            <Toggle label={t('design:bizEnabled')} checked={config.biz_enabled}
              onChange={(v) => handleUpdateConfig({ biz_enabled: v })} />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-medium rounded-lg bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating
                ? <Loader2 size={16} className="animate-spin" />
                : <Play size={16} />
              }
              {generating ? t('common:status.rendering') : t('design:generate')}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded text-sm bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-300">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          {/* Design Summary */}
          {summary && <DesignSummaryView summary={summary} valid={valid ?? null} />}

          {/* V2.4: PUE 与能耗估算 */}
          {estimation && !estimation.error && (
            <PUEEstimatePanel
              estimation={estimation}
              estimating={estimating}
              onReEstimate={handleReEstimate}
            />
          )}
          {estimation?.error && (
            <div className="flex items-start gap-2 p-3 rounded text-sm bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-300">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1">{estimation.error}</span>
            </div>
          )}

          {/* V2.4: 完整报告视图（可折叠，按需加载） */}
          {summary && <ReportViewPanel projectName={selectedProjectName} />}

          {/* Tip when no result */}
          {!summary && !error && !generating && (
            <div className="text-center py-10">
              <Settings2 size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-400 dark:text-gray-500">
                配置完成后点击「生成拓扑」调用 Python 引擎计算网络设计
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
