/**
 * AIDC 规划工作台（G1：REQ-A1/A2）。
 *
 * 宏观参数（基础 + 高级）→ `plan:aidc` → 完整 plan:table 展示：
 *   - 基础参数：机房 / GPU 规模 / PFC / CNP
 *   - 高级参数（可折叠）：收敛比 / 多轨 / AS 段 / VLAN 范围 / 命名格式（只读）/ 设备型号（只读）
 *   - 表格视图：设备清单 / 接线 / 终端 / 宏观参数
 *   - 拓扑预览：轻量 SVG（AidcTopologyPreview）
 *   - 桥接标识 chips（source/projectType/bridgeVersion，契约 v1.1）
 * V5.0.11: 全部文案接入 i18n（aidc 命名空间），切换语言后工作台 AIDC 规划子视图同步切换。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SectionCard } from '@/components/ui/SectionCard'
import { Tabs } from '@/components/ui/Tabs'
import {
  Network, Zap, Server, GitBranch, ChevronDown, ChevronRight, Tag,
  FolderOpen, History, Wrench,
} from 'lucide-react'
import { useDesignStore, type DesignConfig } from '@/stores/design.store'
import { ensureMatrixRacks } from '@/utils/ensureMatrixRacks'
import type { RackMatrixLayoutOptions } from '@/utils/rackMatrixLayout'
import { buildPlanDesignPatch, rackMatrixOptsFromProjectConfig } from '@/utils/planToDesign'
import { macroToInput } from '@/utils/aidcDelivery'
import {
  ROLE_LABEL, macroNum,
  type PlanConnection, type PlanDevice, type PlanMacro, type PlanSummary, type PlanTerminal,
} from './aidcTypes'


// ---- 辅助：camelCase 优先读取宏观数值 ----
const mnum = (p: PlanSummary, camel: string, snake: string, fb: number) =>
  macroNum(p.macro, camel, snake) ?? fb

/** 高级（面板未暴露编辑）宏观参数：随项目持久化并在重开时透传，避免丢参数。 */
function extractAdv(input: Record<string, unknown>): Record<string, unknown> {
  const adv: Record<string, unknown> = {}
  for (const k of ['bgp_max_paths', 'naming_format', 'ip_segments', 'ospf', 'device_models']) {
    if (input[k] !== undefined && input[k] !== null) adv[k] = input[k]
  }
  return adv
}

/** 设备清单按角色分组 */
function useGroups(plan: PlanSummary | null) {
  return useMemo(() => {
    if (!plan) return []
    const g: Record<string, PlanDevice[]> = {}
    for (const d of plan.deviceList) (g[d.role] ??= []).push(d)
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]))
  }, [plan])
}

function DeviceNames({ devices }: { devices: PlanDevice[] }) {
  const { t } = useTranslation('aidc')
  const [open, setOpen] = useState(false)
  const first = devices.slice(0, 3)
  const rest = devices.slice(3)
  return (
    <div>
      {first.map((d) => <DeviceRow key={d.name} d={d} />)}
      {rest.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen(!open)}
            className="text-xs text-primary-500 flex items-center gap-1 mt-1">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {open ? t('collapse') : t('expandN', { count: rest.length })}
          </button>
          {open && rest.map((d) => <DeviceRow key={d.name} d={d} />)}
        </>
      )}
    </div>
  )
}

function DeviceRow({ d }: { d: PlanDevice }) {
  const { t } = useTranslation('aidc')
  const tag = [
    d.rack != null ? t('rackR', { no: String(d.rack).padStart(2, '0') }) : null,
    d.asn != null ? `ASN ${d.asn}` : null,
    d.mlag_pair != null ? `MLAG-${d.mlag_pair}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className="font-mono">{d.name}</span>
      <span className="text-gray-400">{tag}</span>
    </div>
  )
}

function ConnectionsView({ conns }: { conns: PlanConnection[] }) {
  const { t } = useTranslation('aidc')
  if (!conns.length) return <p className="text-sm text-gray-400">{t('noConnections')}</p>
  return (
    <div className="max-h-72 overflow-auto border rounded">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-50 dark:bg-app-surface">
          <tr className="text-left text-gray-500">
            <th className="px-2 py-1">{t('from')}</th><th className="px-2 py-1">{t('fromPort')}</th>
            <th className="px-2 py-1">{t('to')}</th><th className="px-2 py-1">{t('rate')}</th>
            <th className="px-2 py-1">{t('desc')}</th>
          </tr>
        </thead>
        <tbody>
          {conns.map((c, i) => (
            <tr key={i} className="border-t border-gray-100 dark:border-edge-subtle">
              <td className="px-2 py-0.5 font-mono">{c.src}</td>
              <td className="px-2 py-0.5 font-mono">{c.src_port}</td>
              <td className="px-2 py-0.5 font-mono">{c.dst}{c.dst_ip ? ` (${c.dst_ip})` : ''}</td>
              <td className="px-2 py-0.5">{c.rate ?? '-'}</td>
              <td className="px-2 py-0.5 text-gray-500">{c.desc ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TerminalsView({ terms }: { terms: PlanTerminal[] }) {
  const { t } = useTranslation('aidc')
  const groups = useMemo(() => {
    const g: Record<string, PlanTerminal[]> = {}
    for (const t of terms) (g[t.src] ??= []).push(t)
    return Object.entries(g)
  }, [terms])
  const [openDev, setOpenDev] = useState<string | null>(null)
  if (!terms.length) return <p className="text-sm text-gray-400">{t('noTerminals')}</p>
  return (
    <div className="max-h-72 overflow-auto border rounded p-1 space-y-1">
      {groups.map(([dev, ts]) => (
        <div key={dev} className="text-xs">
          <button type="button" onClick={() => setOpenDev(openDev === dev ? null : dev)}
            className="flex items-center gap-1 text-gray-600 dark:text-gray-300 w-full text-left">
            {openDev === dev ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="font-mono">{dev}</span>
            <span className="text-gray-400">· {t('nPorts', { count: ts.length })} · {t('vlan')} {[...new Set(ts.map((t) => t.vlan).filter((v) => v != null))].join('/')}</span>
          </button>
          {openDev === dev && (
            <div className="pl-4 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              {ts.map((term, i) => (
                <div key={i} className="flex gap-2 font-mono text-gray-500">
                  <span>{term.src_port}</span>
                  <span>{t('vlan')} {term.vlan ?? '-'}</span>
                  <span>{term.desc ?? ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}


function MacroView({ plan }: { plan: PlanSummary }) {
  const { t } = useTranslation('aidc')
  const m = plan.macro
  const rows: Array<[string, string]> = [
    [t('macroSite'), m.site],
    [t('macroGpuScale'), String(mnum(plan, 'gpuCount', 'gpu_count', 0))],
    [t('macroPfc'), String(mnum(plan, 'pfcQueue', 'pfc_queue', 3))],
    [t('macroCnp'), String(mnum(plan, 'cnpQueue', 'cnp_queue', 6))],
    [t('macroBgp'), String(mnum(plan, 'bgpMaxPaths', 'bgp_max_paths', 16))],
    [t('macroConvergence'), String(mnum(plan, 'convergence', 'convergence', 1))],
    [t('macroRails'), String(mnum(plan, 'rails', 'rails', 8))],
    [t('macroAsRange'), JSON.stringify(m.asRange ?? m.as_range)],
    [t('macroVlanRanges'), JSON.stringify(m.vlanRanges ?? m.vlan_ranges)],
    [t('macroNaming'), m.naming?.format ?? ''],
    [t('macroOspf'), JSON.stringify(m.ospf)],
    [t('macroIpSegments'), JSON.stringify(m.ipSegments)],
  ]
  const proto = plan.protocols
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-x-6">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-gray-100 dark:border-edge-subtle py-1">
            <span className="text-gray-500">{k}</span>
            <span className="font-mono text-right break-all">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-gray-500">
        <span>{plan.topology
          ? t('topologyInfo', { layers: plan.topology.layers, spines: plan.topology.spines, leaves: plan.topology.leaves })
          : '-'}</span>
        <span>BGP ECMP {proto?.bgp?.ecmp ?? '-'}</span>
        <span>OSPF {proto?.ospf ? `${proto.ospf.process}/${proto.ospf.area}` : '-'}</span>
      </div>
    </div>
  )
}

const genUuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `aidc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

interface AidcProjectItem {
  name: string
  projectId: string
  projectName: string
  planVersion: number
  updatedAt?: string
  site?: string
  gpuCount?: number
}

export function AidcPlannerPanel({ boundProjectName }: { boundProjectName?: string | null }) {
  const { t } = useTranslation('aidc')
  // 契约 v1.2（P1）：项目身份——P1 起由 AL 项目持久化（会话内 mint 作为未保存时兜底）
  const [projectId, setProjectId] = useState(genUuid)
  const [projectName, setProjectName] = useState('')
  const [currentProject, setCurrentProject] = useState<string | null>(null)
  const [projects, setProjects] = useState<AidcProjectItem[]>([])
  const [openName, setOpenName] = useState('')
  const [advMacro, setAdvMacro] = useState<Record<string, unknown>>({})
  const [history, setHistory] = useState<Array<{ version: number; planHash: string; generatedAt?: string }>>([])
  const [projectLoading, setProjectLoading] = useState(false)
  // 基础参数
  const [site, setSite] = useState('BJ01')
  const [gpuCount, setGpuCount] = useState('64')
  const [pfcQueue, setPfcQueue] = useState('3')
  const [cnpQueue, setCnpQueue] = useState('6')
  // 高级参数
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [convergence, setConvergence] = useState('1')
  const [rails, setRails] = useState('8')
  const [asStart, setAsStart] = useState('65001')
  const [asEnd, setAsEnd] = useState('65500')
  const [vlanCompute, setVlanCompute] = useState('100,199')
  const [vlanStorage, setVlanStorage] = useState('200,299')
  const [vlanBiz, setVlanBiz] = useState('300,399')
  const [vlanOob, setVlanOob] = useState('400,499')

  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exportMsg, setExportMsg] = useState('')

  const buildParams = () => ({
    // 契约 v1.2：项目身份
    project_id: projectId,
    ...(projectName.trim() ? { project_name: projectName.trim() } : {}),
    ...advMacro, // 高级宏观（持久化透传，避免只传基础字段丢参数）
    site,
    gpu_count: Number(gpuCount),
    pfc_queue: Number(pfcQueue),
    cnp_queue: Number(cnpQueue),
    convergence: Number(convergence),
    rails: Number(rails),
    as_range: [Number(asStart), Number(asEnd)],
    vlan_ranges: {
      compute: vlanCompute.split(',').map(Number),
      storage: vlanStorage.split(',').map(Number),
      biz: vlanBiz.split(',').map(Number),
      oob: vlanOob.split(',').map(Number),
    },
  })

  const refreshProjects = useCallback(async () => {
    try {
      const res = (await window.electron.aidc.project.list()) as { ok?: boolean; projects?: AidcProjectItem[] }
      if (res?.ok) setProjects(res.projects ?? [])
    } catch { /* ignore */ }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载/项目刷新时异步加载项目列表并更新加载态
  useEffect(() => { refreshProjects() }, [refreshProjects])

  const run = async () => {
    setLoading(true)
    setError('')
    try {
      const res = (await window.electron.aidc.plan(buildParams())) as PlanSummary
      if (res?.error) setError(res.error)
      else setPlan(res)
    } catch (e) {
      setError(t('planFailed', { error: String(e) }))
    } finally {
      setLoading(false)
    }
  }

  // 打磨轮（v1.3）：AIDC 规划 → 应用到设计（写设计配置结构字段 + 设计:generate），
  // 使拓扑/机柜/常规渲染都以设计为事实源（工作台统一）
  const applyToDesign = async () => {
    if (!boundProjectName) { setError(t('needProjectFirst')); return }
    if (!plan) { setError(t('needPlanFirst')); return }
    setLoading(true); setError(''); setExportMsg('')
    try {
      const ds = useDesignStore.getState()
      // AL-P4：plan → 设计配置映射（协议/速率/端口数/网络开关/收敛比）；plan 缺字段不覆盖原配置
      ds.updateConfig(buildPlanDesignPatch(plan) as DesignConfig)
      await ds.generate(boundProjectName)
      // 打磨轮（v1.4 / AL-R2c）：AIDC 机柜 = 矩阵（矩阵权威；无矩阵回退按拓扑生成）
      const topo = useDesignStore.getState().topology
      if (topo?.nodes?.length) {
        // AL-R3：矩阵落位按项目 gpu_per_cabinet（及机柜 U/功率/顶部预留）生效；读取失败用默认
        let rackOpts: RackMatrixLayoutOptions = {}
        try {
          rackOpts = rackMatrixOptsFromProjectConfig(
            (await window.electron.project.getFile(boundProjectName, 'project_config.json')) ?? null,
          )
        } catch { /* 读取失败：保持默认落位参数 */ }
        const res = await ensureMatrixRacks(boundProjectName, topo.nodes, rackOpts)
        setExportMsg(res.usedMatrix ? t('appliedWithMatrix') : t('appliedNoMatrix'))
      } else {
        setExportMsg(t('appliedEmpty'))
      }
    } catch (e) {
      setError(t('applyFailed', { error: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }

  // P1（A-4）：项目打开/保存/另存为
  // V5.0.11: 普通 AL 项目（无 AIDC plan.json）load 失败时，回退读取 project_config.json
  // 的 GPU 服务器规模回填基础参数，保证 GPU 规模随项目选择动态更新（不再停在默认 64）。
  const openProject = async (name: string) => {
    if (!name) return
    setProjectLoading(true); setError(''); setExportMsg('')
    try {
      const res = (await window.electron.aidc.project.load(name)) as {
        error?: string; name: string; projectId: string; projectName?: string
        plan?: PlanSummary; macro?: PlanMacro
        history?: Array<{ version: number; planHash: string; generatedAt?: string }>
      }
      if (res?.error) {
        // 非 AIDC 项目回退：读 project_config.json 的 GPU 规模（num_gpu_servers）
        setCurrentProject(name)
        try {
          const raw = await window.electron.project.getFile(name, 'project_config.json')
          if (raw) {
            const cfg = JSON.parse(raw) as { topology?: { num_gpu_servers?: number; site?: string } }
            const n = cfg.topology?.num_gpu_servers
            if (typeof n === 'number' && n > 0) setGpuCount(String(n))
            if (cfg.topology?.site) setSite(cfg.topology.site)
            setExportMsg(t('boundProject', { name }))
          } else {
            setExportMsg(t('boundProjectSimple', { name }))
          }
        } catch { setExportMsg(t('boundProjectSimple', { name })) }
        setError('')
        return
      }
      setCurrentProject(res.name ?? name)
      setProjectId(res.projectId || projectId)
      if (res.projectName) setProjectName(res.projectName)
      const inp = macroToInput((res.macro as Partial<PlanMacro> | undefined) ?? {})
      setSite(String(inp.site ?? 'BJ01'))
      setGpuCount(String(inp.gpu_count ?? 64))
      setPfcQueue(String(inp.pfc_queue ?? 3))
      setCnpQueue(String(inp.cnp_queue ?? 6))
      setConvergence(String(inp.convergence ?? 1))
      setRails(String(inp.rails ?? 8))
      if (Array.isArray(inp.as_range)) {
        setAsStart(String(inp.as_range[0])); setAsEnd(String(inp.as_range[1]))
      }
      const vr = inp.vlan_ranges as Record<string, [number, number]> | undefined
      if (vr) {
        setVlanCompute(vr.compute?.join(',') ?? '100,199')
        setVlanStorage(vr.storage?.join(',') ?? '200,299')
        setVlanBiz(vr.biz?.join(',') ?? '300,399')
        setVlanOob(vr.oob?.join(',') ?? '400,499')
      }
      setAdvMacro(extractAdv(inp))
      setPlan(res.plan ?? null)
      setHistory(res.history ?? [])
      setExportMsg(t('openedProject', { name, version: res.plan?.meta?.planVersion ?? '' }))
    } catch (e) {
      setError(t('openFailed', { error: String(e) }))
    } finally {
      setProjectLoading(false)
    }
  }

  // 打磨轮（P-A）：工作台绑定当前 AIDC 项目——传入 boundProjectName 时自动加载（含切换项目）
  useEffect(() => {
    if (boundProjectName && boundProjectName !== currentProject) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 绑定项目变化时异步加载项目并更新内部加载态
      void openProject(boundProjectName)
    }
    // openProject 随渲染重建，这里仅依赖 boundProjectName/currentProject，避免循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundProjectName, currentProject])

  const saveProject = async () => {
    const name = projectName.trim()
    if (!name) { setError(t('saveNameRequired')); return }
    setProjectLoading(true); setError(''); setExportMsg('')
    try {
      const macro = buildParams()
      const res = (currentProject
        ? await window.electron.aidc.project.save(currentProject, macro)
        : await window.electron.aidc.project.create(name, macro)) as {
          error?: string; name: string; projectId: string
          plan?: PlanSummary; planVersion: number; changed?: boolean
        }
      if (res?.error) { setError(res.error); return }
      setCurrentProject(res.name ?? currentProject)
      setProjectId(res.projectId)
      if (res.plan) setPlan(res.plan)
      setHistory([])
      setExportMsg(res.changed === false
        ? t('savedNoChange', { version: res.planVersion })
        : t('savedVersion', { version: res.planVersion, suffix: res.changed ? t('savedNewVersion') : '' }))
      await refreshProjects()
    } catch (e) {
      setError(t('saveFailed', { error: String(e) }))
    } finally {
      setProjectLoading(false)
    }
  }

  const saveAsProject = async () => {
    const name = projectName.trim()
    if (!name) { setError(t('saveAsNameRequired')); return }
    setProjectLoading(true); setError(''); setExportMsg('')
    try {
      const res = (await window.electron.aidc.project.create(name, buildParams())) as {
        error?: string; name: string; projectId: string
        plan?: PlanSummary; planVersion: number
      }
      if (res?.error) { setError(res.error); return }
      setCurrentProject(res.name ?? name)
      setProjectId(res.projectId)
      if (res.plan) setPlan(res.plan)
      setHistory([])
      setExportMsg(t('savedAs', { name: res.name, version: res.planVersion }))
      await refreshProjects()
    } catch (e) {
      setError(t('saveAsFailed', { error: String(e) }))
    } finally {
      setProjectLoading(false)
    }
  }

  const groups = useGroups(plan)
  const totalDevices = useMemo(() => {
    if (!plan) return 0
    return plan.deviceList.reduce((s, d) => s + (d.count ?? 1), 0)
  }, [plan])

  const pfcDisp = plan ? mnum(plan, 'pfcQueue', 'pfc_queue', 0) : 0
  const cnpDisp = plan ? mnum(plan, 'cnpQueue', 'cnp_queue', 0) : 0

  // 打磨轮（v1.3）：机柜/拓扑移至工作台设计子视图（TopologyTab/RackTab 以设计为源），AIDC 规划不再独立
  const tabItems = [
    { value: 'dev', label: t('deviceList') },
    { value: 'conn', label: t('connections') },
    { value: 'term', label: t('terminals') },
    { value: 'macro', label: t('macro') },
  ]

  return (
    <SectionCard title={t('title')}>
      <p className="text-xs text-gray-500 mb-3">{t('subtitle')}</p>

      {/* P1（A-4）：项目保存/打开 */}
      <div className="flex flex-wrap items-center gap-2 mb-3 p-2 border rounded bg-gray-50/50 dark:bg-app-surface">
        <FolderOpen size={14} className="text-gray-400" />
        <select
          value={openName}
          onChange={(e) => setOpenName(e.target.value)}
          className="text-xs rounded border bg-white dark:bg-app px-2 py-1 max-w-[220px]"
          aria-label={t('selectProjectAria')}
        >
          <option value="">{t('selectProjectPlaceholder')}</option>
          {projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.projectName || p.name}（v{p.planVersion}）
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" onClick={() => openProject(openName)}
          disabled={projectLoading || !openName}>{t('open')}</Button>
        <Button size="sm" variant="secondary" onClick={saveProject}
          disabled={projectLoading}>{t('save')}</Button>
        {currentProject && (
          <Button size="sm" variant="ghost" onClick={saveAsProject}
            disabled={projectLoading}>{t('saveAs')}</Button>
        )}
        {currentProject && (
          <span className="text-xs text-gray-500 font-mono">{t('current', { name: currentProject })}</span>
        )}
      </div>

      {/* 基础参数 */}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <label className="text-sm">{t('projectName')}</label>
          <Input value={projectName} onChange={(e) => setProjectName(e.target.value)}
            placeholder={`${site}-${gpuCount}`} aria-label={t('projectName')} />
        </div>
        <div>
          <label className="text-sm">{t('site')}</label>
          <Input value={site} onChange={(e) => setSite(e.target.value)} aria-label={t('site')} />
        </div>
        <div>
          <label className="text-sm">{t('gpuScale')}</label>
          <Input value={gpuCount} onChange={(e) => setGpuCount(e.target.value)} type="number" min={32} step={32} aria-label={t('gpuScale')} />
        </div>
        <div>
          <label className="text-sm">{t('pfcQueue')}</label>
          <Input value={pfcQueue} onChange={(e) => setPfcQueue(e.target.value)} type="number" min={0} max={7} aria-label={t('pfcQueue')} />
        </div>
        <div>
          <label className="text-sm">{t('cnpQueue')}</label>
          <Input value={cnpQueue} onChange={(e) => setCnpQueue(e.target.value)} type="number" min={0} max={7} aria-label={t('cnpQueue')} />
        </div>
      </div>

      {/* 高级参数 */}
      <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-primary-500 flex items-center gap-1 mb-3">
        {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('advanced')}
      </button>
      {showAdvanced && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3 p-3 border rounded bg-gray-50/50 dark:bg-app-surface">
          <div>
            <label className="text-sm">{t('convergence')}</label>
            <Input value={convergence} onChange={(e) => setConvergence(e.target.value)} type="number" min={0.5} step={0.5} aria-label={t('convergence')} />
          </div>
          <div>
            <label className="text-sm">{t('rails')}</label>
            <Input value={rails} onChange={(e) => setRails(e.target.value)} type="number" min={1} max={16} aria-label={t('rails')} />
          </div>
          <div>
            <label className="text-sm">{t('asStart')}</label>
            <Input value={asStart} onChange={(e) => setAsStart(e.target.value)} type="number" min={65001} max={65500} aria-label={t('asStart')} />
          </div>
          <div>
            <label className="text-sm">{t('asEnd')}</label>
            <Input value={asEnd} onChange={(e) => setAsEnd(e.target.value)} type="number" min={65001} max={65500} aria-label={t('asEnd')} />
          </div>
          <div>
            <label className="text-sm">{t('vlanCompute')}</label>
            <Input value={vlanCompute} onChange={(e) => setVlanCompute(e.target.value)} placeholder="100,199" aria-label={t('vlanCompute')} />
          </div>
          <div>
            <label className="text-sm">{t('vlanStorage')}</label>
            <Input value={vlanStorage} onChange={(e) => setVlanStorage(e.target.value)} placeholder="200,299" aria-label={t('vlanStorage')} />
          </div>
          <div>
            <label className="text-sm">{t('vlanBiz')}</label>
            <Input value={vlanBiz} onChange={(e) => setVlanBiz(e.target.value)} placeholder="300,399" aria-label={t('vlanBiz')} />
          </div>
          <div>
            <label className="text-sm">{t('vlanOob')}</label>
            <Input value={vlanOob} onChange={(e) => setVlanOob(e.target.value)} placeholder="400,499" aria-label={t('vlanOob')} />
          </div>
        </div>
      )}

      <Button onClick={run} disabled={loading}>
        {loading ? t('generating') : t('generate')}
      </Button>
      <Button variant="secondary" onClick={applyToDesign} disabled={loading || !plan}
        className="ml-2">
        <Wrench size={12} className="inline mr-1" /> {t('applyToDesign')}
      </Button>

      {exportMsg && <p className="text-xs text-gray-500 mt-2">{exportMsg}</p>}

      {error && <p className="text-red-500 mt-3 text-sm">{error}</p>}

      {plan && !error && (
        <div className="mt-4">
          {/* 摘要 + 桥接标识 */}
          <div className="flex flex-wrap items-center gap-2 text-sm mb-3">
            <span className="flex items-center gap-1"><GitBranch size={16} />
              {plan.meta.projectName || plan.meta.project} · {plan.meta.site}
              {plan.meta.planVersion ? <span className="text-gray-400">v{plan.meta.planVersion}</span> : null}
              {plan.meta.projectId ? (
                <span className="text-gray-400 font-mono">#{String(plan.meta.projectId).replace(/-/g, '').slice(0, 8)}</span>
              ) : null}
              · PFC={pfcDisp} · CNP={cnpDisp}
            </span>
            {(plan.meta.source || plan.meta.projectType || plan.meta.bridgeVersion) && (
              <span className="flex items-center gap-1 text-xs bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 rounded px-1.5 py-0.5">
                <Tag size={12} /> {t('bridge')} {plan.meta.source ?? '-'}/{plan.meta.projectType ?? '-'}/v{plan.meta.bridgeVersion ?? '-'}
              </span>
            )}
            <span className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Network size={14} /> {t('nConnections', { count: plan.connections.length })}</span>
              <span className="flex items-center gap-1"><Zap size={14} /> {t('nTerminals', { count: plan.terminals.length })}</span>
              <span className="flex items-center gap-1"><Server size={14} /> {t('nDevices', { count: totalDevices })}</span>
            </span>
          </div>

          {/* P1（A-7）：版本历史 */}
          {history.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mt-2 text-2xs">
              <History size={12} className="text-gray-400" />
              <span className="text-gray-500">{t('versionHistory')}</span>
              {history.map((h) => (
                <span key={h.version}
                  className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-app-surface text-gray-500 font-mono"
                  title={`v${h.version} · ${h.generatedAt ?? ''} · ${h.planHash?.slice(0, 12) ?? ''}`}>
                  v{h.version}{h.generatedAt ? ` · ${h.generatedAt.slice(0, 10)}` : ''}
                </span>
              ))}
            </div>
          )}

          <Tabs items={tabItems} defaultValue="dev">
            {(active) => (
              <div className="mt-3">
                {active === 'dev' && (
                  <div className="space-y-2">
                    {groups.map(([role, devs]) => (
                      <div key={role} className="border rounded p-2">
                        <div className="flex items-center gap-2 text-sm mb-1">
                          <Server size={14} />
                          <span>{ROLE_LABEL[role] ?? role}</span>
                          <span className="text-gray-400 font-mono">{devs[0]?.model}</span>
                          <span className="text-gray-500">{t('nDevices', { count: devs.length })}</span>
                        </div>
                        <DeviceNames devices={devs} />
                      </div>
                    ))}
                  </div>
                )}
                {active === 'conn' && <ConnectionsView conns={plan.connections} />}
                {active === 'term' && <TerminalsView terms={plan.terminals} />}
                {active === 'macro' && <MacroView plan={plan} />}
              </div>
            )}
          </Tabs>
        </div>
      )}
    </SectionCard>
  )
}
