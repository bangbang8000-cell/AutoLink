import React, { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Wrench, Play, RefreshCw, CheckCircle, XCircle,
  Server, HardDrive, Network, Zap,
  AlertTriangle, ChevronDown, ChevronRight, Loader2,
} from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore, type DesignSummary } from '@/stores/design.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useRackStore } from '@/stores/rack.store'

/* -------------------------------------------------- */
/*  Sections                                          */
/* -------------------------------------------------- */
function FormSection({ title, icon, defaultOpen = true, children }: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span>{title}</span>
      </button>
      {open && <div className="px-3 py-2 space-y-3">{children}</div>}
    </div>
  )
}

function NumberInput({ label, value, onChange, min = 0, max = 99999, step = 1, className = '' }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-2xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <input
        type="number" min={min} max={max} step={step}
        value={value}
        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(v) }}
        className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
      />
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
        className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function ToggleSwitch({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-8 h-4 rounded-full transition-colors ${checked ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'left-4' : 'left-0.5'}`} />
      </button>
      <span className="text-2xs text-gray-600 dark:text-gray-400">{label}</span>
    </label>
  )
}

/* -------------------------------------------------- */
/*  DesignSummary                                     */
/* -------------------------------------------------- */
function DesignSummaryView({ summary, valid }: { summary: DesignSummary; valid: boolean | null }) {
  const { t } = useTranslation()
  const totalSw = summary.paramLeafCount + summary.paramSpineCount + summary.paramCoreCount
    + summary.storageLeafCount + summary.storageSpineCount

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-600 dark:text-gray-300">
        {t('design:designSummary')}
      </div>
      <div className="p-3 space-y-3">
        {/* Top row */}
        <div className="grid grid-cols-2 gap-3">
          <StatItem label={t('design:totalServers')} value={summary.totalServers} />
          <StatItem label={t('design:totalSwitches')} value={totalSw} />
        </div>

        {/* Param network */}
        <div>
          <div className="text-2xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            {t('design:summaryParam')} ({summary.paramSpeed})
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <MiniStat label={t('design:paramLeaf')} value={summary.paramLeafCount} />
            <MiniStat label={t('design:paramSpine')} value={summary.paramSpineCount} />
          </div>
        </div>

        {/* Storage network */}
        <div>
          <div className="text-2xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            {t('design:summaryStorage')} ({summary.storageSpeed})
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <MiniStat label={t('design:storageLeaf')} value={summary.storageLeafCount} />
            <MiniStat label={t('design:storageSpine')} value={summary.storageSpineCount} />
          </div>
        </div>

        {/* Validation */}
        {valid !== null && (
          <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded ${valid ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
            {valid ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {valid ? t('design:validationPassed') : t('design:validationFailed')}
          </div>
        )}
      </div>
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800/80 rounded px-2 py-1.5 text-center">
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
/*  DesignPanel                                       */
/* -------------------------------------------------- */
export function DesignPanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const {
    config, summary, valid, generating, error,
    updateConfig, resetConfig, generate, loadConfig, loadSavedTopology, clearResults,
  } = useDesignStore()
  const openTab = useWorkspaceStore((s) => s.openTab)
  const initFromTopology = useRackStore((s) => s.initFromTopology)

  // Load config when project changes
  useEffect(() => {
    if (selectedProjectName) {
      loadConfig(selectedProjectName).then(() => {
        // Try to load pre-saved topology results (e.g. from Demo projects)
        loadSavedTopology(selectedProjectName)
      })
    } else {
      clearResults()
    }
  }, [selectedProjectName])

  const handleGenerate = useCallback(async () => {
    if (!selectedProjectName) return
    await generate(selectedProjectName)
    // Auto-open topology tab and init rack on success
    const state = useDesignStore.getState()
    if (state.topology && state.topology.nodes.length > 0) {
      openTab({ type: 'visualization', title: `拓扑视图 - ${selectedProjectName}`, closable: true })
      initFromTopology(state.topology.nodes)
    }
  }, [selectedProjectName, generate, openTab, initFromTopology])

  const speedOptions = [
    { value: '100G', label: '100G' },
    { value: '200G', label: '200G' },
    { value: '400G', label: '400G' },
    { value: '800G', label: '800G' },
  ]

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <Wrench size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">{t('design:title')}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('design:noProject')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('design:title')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { resetConfig(); clearResults() }}
            className="px-2 py-0.5 text-2xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Mode toggle */}
        <div>
          <label className="block text-2xs text-gray-500 dark:text-gray-400 mb-1.5">{t('design:mode')}</label>
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => updateConfig({ downlink_mode: 'full' })}
              className={`flex-1 py-1.5 text-xs rounded-md transition-colors ${config.downlink_mode === 'full'
                ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
            >
              <Zap size={12} className="inline mr-1" />
              {t('design:modeFull')}
            </button>
            <button
              onClick={() => updateConfig({ downlink_mode: 'custom' })}
              className={`flex-1 py-1.5 text-xs rounded-md transition-colors ${config.downlink_mode === 'custom'
                ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
            >
              <Wrench size={12} className="inline mr-1" />
              {t('design:modeCustom')}
            </button>
          </div>
          <p className="text-2xs text-gray-400 dark:text-gray-500 mt-1">
            {config.downlink_mode === 'full' ? t('design:modeFullDesc') : t('design:modeCustomDesc')}
          </p>
        </div>

        {/* Server config */}
        <FormSection title={t('design:serverConfig')} icon={<Server size={12} />}>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label={t('design:gpuServers')} value={config.num_servers}
              onChange={(v) => updateConfig({ num_servers: v })} min={1} />
            <NumberInput label={t('design:paramPortsPerServer')} value={config.param_ports_per_server}
              onChange={(v) => updateConfig({ param_ports_per_server: v })} min={1} max={32} />
            <NumberInput label={t('design:storageServers')} value={config.additional_storage_servers}
              onChange={(v) => updateConfig({ additional_storage_servers: v })} min={0} />
            <NumberInput label={t('design:computeServers')} value={config.additional_compute_servers}
              onChange={(v) => updateConfig({ additional_compute_servers: v })} min={0} />
            <NumberInput label={t('design:storagePortsPerServer')} value={config.storage_ports_per_server}
              onChange={(v) => updateConfig({ storage_ports_per_server: v })} min={1} max={8} className="col-span-1" />
          </div>
        </FormSection>

        {/* Switch & Speed config */}
        <FormSection title={t('design:switchConfig')} icon={<HardDrive size={12} />}>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label={t('design:paramSwitchPorts')} value={config.param_switch_ports}
              onChange={(v) => updateConfig({ param_switch_ports: v })} min={8} step={8} />
            <NumberInput label={t('design:storageSwitchPorts')} value={config.storage_switch_ports}
              onChange={(v) => updateConfig({ storage_switch_ports: v })} min={8} step={8} />
            <SelectInput label={t('design:paramSpeed')} value={config.param_speed}
              onChange={(v) => updateConfig({ param_speed: v })} options={speedOptions} />
            <SelectInput label={t('design:storageSpeed')} value={config.storage_speed}
              onChange={(v) => updateConfig({ storage_speed: v })} options={speedOptions} />
          </div>
        </FormSection>

        {/* Custom downlink limits */}
        {config.downlink_mode === 'custom' && (
          <FormSection title={t('design:downlinkConfig')} icon={<Network size={12} />}>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label={t('design:paramDownlink')} value={config.param_downlink_limit}
                onChange={(v) => updateConfig({ param_downlink_limit: v })} min={1} />
              <NumberInput label={t('design:storageDownlink')} value={config.storage_downlink_limit}
                onChange={(v) => updateConfig({ storage_downlink_limit: v })} min={1} />
              <NumberInput label={t('design:bizDownlink')} value={config.biz_downlink_limit}
                onChange={(v) => updateConfig({ biz_downlink_limit: v })} min={1} />
              <NumberInput label={t('design:oobDownlink')} value={config.oob_downlink_limit}
                onChange={(v) => updateConfig({ oob_downlink_limit: v })} min={1} />
            </div>
          </FormSection>
        )}

        {/* Toggles */}
        <div className="flex items-center gap-4 px-1">
          <ToggleSwitch label={t('design:oobEnabled')} checked={config.oob_enabled}
            onChange={(v) => updateConfig({ oob_enabled: v })} />
          <ToggleSwitch label={t('design:bizEnabled')} checked={config.biz_enabled}
            onChange={(v) => updateConfig({ biz_enabled: v })} />
        </div>

        {/* Action buttons */}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generating
            ? <Loader2 size={14} className="animate-spin" />
            : <Play size={14} />
          }
          {generating ? t('common:status.rendering') : t('design:generate')}
        </button>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-1.5 p-2 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {/* Design Summary */}
        {summary && <DesignSummaryView summary={summary} valid={valid} />}

        {/* Tip when no result */}
        {!summary && !error && !generating && (
          <div className="text-center py-6">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              配置完成后点击「生成拓扑」调用 Python 引擎计算网络设计
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
