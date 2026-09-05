import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Server, Zap, HardDrive, FolderOpen, FileText,
  Play, Download, GitBranch, CheckCircle,
  XCircle, Loader2, Monitor, Settings, ExternalLink,
} from 'lucide-react'
import { useDesignStore, type TopologyNode } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useToastStore } from '@/stores/toast.store'
import { EmptyState } from '@/components/ui/EmptyState'

/* -------------------------------------------------- */
/*  Props                                             */
/* -------------------------------------------------- */
interface Props {
  projectName?: string | null
}

/* -------------------------------------------------- */
/*  Helpers                                           */
/* -------------------------------------------------- */
interface DeviceGroup {
  type: string
  count: number
  totalPower: number
  label: string
  icon: React.ReactNode
}

function groupDevices(nodes: TopologyNode[]): DeviceGroup[] {
  const map = new Map<string, { count: number; totalPower: number }>()
  for (const node of nodes) {
    const key = node.group || node.type
    const entry = map.get(key) || { count: 0, totalPower: 0 }
    entry.count++
    entry.totalPower += node.powerWatts || 2000
    map.set(key, entry)
  }
  const result: DeviceGroup[] = []
  for (const [key, val] of map) {
    let label = key
    let icon: React.ReactNode = <Server size={14} />
    if (key.toLowerCase().includes('gpu')) { label = 'GPU服务器'; icon = <Server size={14} className="text-info-500" /> }
    else if (key.toLowerCase().includes('storage') || key.toLowerCase().includes('存储')) { label = '存储服务器'; icon = <HardDrive size={14} className="text-success-500" /> }
    else if (key.toLowerCase().includes('compute') || key.toLowerCase().includes('通算')) { label = '通算服务器'; icon = <Monitor size={14} className="text-purple-500" /> }
    else if (key.toLowerCase().includes('switch') || key.toLowerCase().includes('交换机')) { label = '交换机'; icon = <GitBranch size={14} className="text-warning-500" /> }
    result.push({ type: key, count: val.count, totalPower: val.totalPower, label, icon })
  }
  // Sort: servers first, then switches
  result.sort((a, b) => {
    const aIsSwitch = a.type.toLowerCase().includes('switch')
    const bIsSwitch = b.type.toLowerCase().includes('switch')
    if (aIsSwitch && !bIsSwitch) return 1
    if (!aIsSwitch && bIsSwitch) return -1
    return b.count - a.count
  })
  return result
}

/* -------------------------------------------------- */
/*  Skeleton loader                                   */
/* -------------------------------------------------- */
function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" style={{ width: `${60 + (i * 13) % 40}%` }} />
      ))}
    </div>
  )
}

/* -------------------------------------------------- */
/*  ProjectOverviewTab                                */
/* -------------------------------------------------- */
export function ProjectOverviewTab({ projectName }: Props) {
  const { t } = useTranslation()
  const topology = useDesignStore((s) => s.topology)
  const summary = useDesignStore((s) => s.summary)
  const valid = useDesignStore((s) => s.valid)

  const cabinets = useRackStore((s) => s.cabinets)
  const initFromTopology = useRackStore((s) => s.initFromTopology)

  const openTab = useWorkspaceStore((s) => s.openTab)
  const addToast = useToastStore((s) => s.addToast)

  const [outputFiles, setOutputFiles] = useState<{ name: string; type: string }[]>([])
  const [loadingOutput, setLoadingOutput] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate initial loading
    const t = setTimeout(() => setLoading(false), 400)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!projectName) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时异步加载输出文件列表并更新加载态
    setLoadingOutput(true)
    window.electron?.project?.listOutputFiles(projectName)
      .then((files) => setOutputFiles(files || []))
      .catch(() => setOutputFiles([]))
      .finally(() => setLoadingOutput(false))
  }, [projectName])

  const handleInitRack = useCallback(() => {
    if (topology?.nodes) {
      initFromTopology(topology.nodes)
    }
  }, [topology, initFromTopology])

  const handleOpenDesign = useCallback(() => {
    openTab({ type: 'design', title: '设计', closable: false, projectName: projectName ?? undefined })
  }, [openTab, projectName])

  // T10: 一键渲染方案 A — 跳转工作台 + toast 提示(真正渲染由工作台触发)
  const handleQuickRender = useCallback(() => {
    openTab({ type: 'workbench', title: '工作台', closable: false, projectName: projectName ?? undefined })
    addToast('info', t('common:toast.renderHint'))
  }, [openTab, addToast, projectName, t])

  // No project name
  if (!projectName) {
    return (
      <div className="h-full flex items-center justify-center text-center p-6">
        <div>
          <FolderOpen size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">请先选择一个项目</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full p-6 space-y-4">
        <Skeleton lines={1} />
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-4">
            <Skeleton lines={4} />
          </div>
          <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-4">
            <Skeleton lines={4} />
          </div>
          <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-4">
            <Skeleton lines={4} />
          </div>
          <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-4">
            <Skeleton lines={4} />
          </div>
        </div>
      </div>
    )
  }

  const deviceGroups = topology?.nodes ? groupDevices(topology.nodes) : []
  const topologyMode = summary?.mode || (topology ? '已生成' : null)

  const fileIcon = (type: string) => {
    if (type === 'xlsx' || type === 'xls') return <FileText size={14} className="text-success-500 shrink-0" />
    if (type === 'png' || type === 'jpg' || type === 'jpeg') return <Monitor size={14} className="text-info-500 shrink-0" />
    return <FileText size={14} className="text-gray-500 shrink-0" />
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-edge-subtle shrink-0 bg-gray-50 dark:bg-app/50">
        <div className="flex items-center gap-2">
          <FolderOpen size={18} className="text-primary-500" />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            项目：{projectName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenDesign}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app-elevated text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            <Settings size={13} />
            编辑配置
          </button>
          <button
            onClick={() => window.electron?.shell?.openPath(projectName)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app-elevated text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            <ExternalLink size={13} />
            在管理器中打开
          </button>
        </div>
      </div>

      {/* Content - Two column grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-4">
          {/* 设备清单 (左) */}
          <SectionCard title="设备清单" icon={<Server size={14} />}>
            {deviceGroups.length > 0 ? (
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-2xs text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 pb-1">
                  <span>设备类型</span>
                  <span className="text-right">数量</span>
                  <span className="text-right">功耗</span>
                </div>
                {deviceGroups.map((g) => (
                  <div
                    key={g.type}
                    className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 text-xs"
                  >
                    <div className="flex items-center gap-1.5">
                      {g.icon}
                      <span className="text-gray-700 dark:text-gray-300">{g.label}</span>
                    </div>
                    <span className="text-right font-medium text-gray-800 dark:text-gray-200 tabular-nums">{g.count}</span>
                    <span className="text-right text-gray-500 dark:text-gray-400 tabular-nums">{g.totalPower.toLocaleString()}W</span>
                  </div>
                ))}
                <div className="border-t border-gray-200 dark:border-edge-subtle pt-1.5 mt-1.5">
                  <div className="flex justify-between px-2 text-xs">
                    <span className="text-gray-500 dark:text-gray-400">合计</span>
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {deviceGroups.reduce((s, g) => s + g.count, 0)} 台 · {deviceGroups.reduce((s, g) => s + g.totalPower, 0).toLocaleString()}W
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={Server}
                title="请先进入设计面板生成拓扑"
                action={{ label: '打开设计', onClick: handleOpenDesign }}
              />
            )}
          </SectionCard>

          {/* 设计状态 (右) */}
          <SectionCard title="设计状态" icon={<GitBranch size={14} />}>
            {topology ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">拓扑模式</span>
                  <span className="font-medium text-gray-800 dark:text-gray-200">{topologyMode}</span>
                </div>
                {summary && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">GPUID 数量</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">{summary.numServers}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">总服务器</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">{summary.totalServers}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">参数网 Leaf/Spine</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">{summary.paramLeafCount}/{summary.paramSpineCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">存储网 Leaf/Spine</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">{summary.storageLeafCount}/{summary.storageSpineCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">端口使用率</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        {summary.paramDownlink && summary.paramLeafCount
                          ? `${Math.round(((summary.numServers * (summary.paramPortsPerServer || 8)) / (summary.paramDownlink * summary.paramLeafCount)) * 100)}%`
                          : '-'}
                      </span>
                    </div>
                    {valid !== null && (
                      <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-2xs ${
                        valid ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300' : 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-300'
                      }`}>
                        {valid ? <CheckCircle size={12} /> : <XCircle size={12} />}
                        {valid ? '验证通过' : '验证未通过'}
                      </div>
                    )}
                  </>
                )}
                {!summary && (
                  <p className="text-gray-400 dark:text-gray-500 text-xs">已有拓扑数据，但缺少设计摘要信息</p>
                )}
              </div>
            ) : (
              <EmptyState
                icon={GitBranch}
                title="暂无拓扑数据"
                action={{ label: '打开设计', onClick: handleOpenDesign }}
              />
            )}
          </SectionCard>

          {/* 机柜概览 (左) */}
          <SectionCard title="机柜概览" icon={<HardDrive size={14} />}>
            {cabinets.length > 0 ? (
              <div className="space-y-2">
                {cabinets.map((cab) => {
                  const usedU = cab.devices.reduce((s, d) => s + (d.endU - d.startU + 1), 0)
                  const pct = cab.totalU > 0 ? Math.round((usedU / cab.totalU) * 100) : 0
                  const power = cab.devices.reduce((s, d) => s + d.power_watts, 0)
                  const powerPct = cab.power_limit > 0 ? Math.round((power / cab.power_limit) * 100) : 0
                  return (
                    <div key={cab.id} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-700 dark:text-gray-300 font-medium">{cab.name}</span>
                        <span className="text-gray-500 dark:text-gray-400">{pct}% · {usedU}/{cab.totalU}U · {power}W</span>
                      </div>
                      <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-error-500' : pct > 70 ? 'bg-warning-500' : 'bg-primary-500'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      {powerPct > 0 && (
                        <div className="flex items-center gap-1 text-2xs text-gray-400 dark:text-gray-500">
                          <Zap size={10} />
                          <span>功耗 {powerPct}%</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                icon={HardDrive}
                title="暂无数据"
                action={topology?.nodes ? { label: '从拓扑初始化', onClick: handleInitRack } : undefined}
              />
            )}
          </SectionCard>

          {/* 输出文件 (右) */}
          <SectionCard title="输出文件" icon={<Download size={14} />}>
            {loadingOutput ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 py-2">
                <Loader2 size={14} className="animate-spin" />
                加载中...
              </div>
            ) : outputFiles.length > 0 ? (
              <div className="space-y-1">
                {outputFiles.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 text-xs cursor-pointer"
                    onClick={() => openTab({
                      type: 'output',
                      title: f.name,
                      closable: true,
                      state: { fileName: f.name, fileType: f.type },
                    })}
                  >
                    {fileIcon(f.type)}
                    <span className="text-gray-700 dark:text-gray-300 truncate">{f.name}</span>
                    <span className="ml-auto text-2xs text-gray-400 dark:text-gray-500 uppercase">{f.type}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={FileText} title="暂无输出文件" />
            )}
          </SectionCard>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 dark:border-edge-subtle shrink-0 bg-gray-50 dark:bg-app/50">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mr-2">快速操作</span>
        <button
          onClick={handleQuickRender}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white transition-colors"
        >
          <Play size={13} />
          一键渲染
        </button>
        <button
          onClick={() => openTab({ type: 'output', title: '导出设备清单', closable: true, state: { fileName: '设备清单.xlsx', fileType: 'xlsx' } })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app-elevated text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
        >
          <Download size={13} />
          导出设备清单
        </button>
        <button
          onClick={() => openTab({ type: 'output', title: '导出上机表', closable: true, state: { fileName: '上机表.xlsx', fileType: 'xlsx' } })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app-elevated text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
        >
          <Download size={13} />
          上机表
        </button>
        <button
          onClick={() => openTab({ type: 'output', title: '导出拓扑图', closable: true, state: { fileName: '拓扑图.png', fileType: 'png' } })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app-elevated text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
        >
          <Download size={13} />
          导出拓扑图
        </button>
      </div>
    </div>
  )
}

/* -------------------------------------------------- */
/*  Sub-components                                    */
/* -------------------------------------------------- */
function SectionCard({ title, icon, children }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 dark:bg-app/50 text-xs font-medium text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-edge-subtle">
        {icon}
        <span>{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}
