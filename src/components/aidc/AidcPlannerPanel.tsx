/**
 * AIDC 规划工作台（G1：REQ-A1/A2）。
 *
 * 宏观参数（基础 + 高级）→ `plan:aidc` → 完整 plan:table 展示：
 *   - 基础参数：机房 / GPU 规模 / PFC / CNP
 *   - 高级参数（可折叠）：收敛比 / 多轨 / AS 段 / VLAN 范围 / 命名格式（只读）/ 设备型号（只读）
 *   - 表格视图：设备清单 / 接线 / 终端 / 宏观参数
 *   - 拓扑预览：轻量 SVG（AidcTopologyPreview）
 *   - 桥接标识 chips（source/projectType/bridgeVersion，契约 v1.1）
 */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SectionCard } from '@/components/ui/SectionCard'
import { Tabs } from '@/components/ui/Tabs'
import { Network, Zap, Server, GitBranch, ChevronDown, ChevronRight, Tag } from 'lucide-react'
import { AidcTopologyPreview } from './AidcTopologyPreview'
import {
  ROLE_LABEL, macroNum,
  type PlanConnection, type PlanDevice, type PlanSummary, type PlanTerminal,
} from './aidcTypes'

// ---- 辅助：camelCase 优先读取宏观数值 ----
const mnum = (p: PlanSummary, camel: string, snake: string, fb: number) =>
  macroNum(p.macro, camel, snake) ?? fb

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
            {open ? '收起' : `展开 ${rest.length} 台`}
          </button>
          {open && rest.map((d) => <DeviceRow key={d.name} d={d} />)}
        </>
      )}
    </div>
  )
}

function DeviceRow({ d }: { d: PlanDevice }) {
  const tag = [
    d.rack != null ? `机柜 R${String(d.rack).padStart(2, '0')}` : null,
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
  if (!conns.length) return <p className="text-sm text-gray-400">无接线</p>
  return (
    <div className="max-h-72 overflow-auto border rounded">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-50 dark:bg-app-surface">
          <tr className="text-left text-gray-500">
            <th className="px-2 py-1">本端</th><th className="px-2 py-1">本端端口</th>
            <th className="px-2 py-1">对端</th><th className="px-2 py-1">速率</th>
            <th className="px-2 py-1">描述</th>
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
  const groups = useMemo(() => {
    const g: Record<string, PlanTerminal[]> = {}
    for (const t of terms) (g[t.src] ??= []).push(t)
    return Object.entries(g)
  }, [terms])
  const [openDev, setOpenDev] = useState<string | null>(null)
  if (!terms.length) return <p className="text-sm text-gray-400">无终端</p>
  return (
    <div className="max-h-72 overflow-auto border rounded p-1 space-y-1">
      {groups.map(([dev, ts]) => (
        <div key={dev} className="text-xs">
          <button type="button" onClick={() => setOpenDev(openDev === dev ? null : dev)}
            className="flex items-center gap-1 text-gray-600 dark:text-gray-300 w-full text-left">
            {openDev === dev ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="font-mono">{dev}</span>
            <span className="text-gray-400">· {ts.length} 端口 · VLAN {[...new Set(ts.map((t) => t.vlan).filter((v) => v != null))].join('/')}</span>
          </button>
          {openDev === dev && (
            <div className="pl-4 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              {ts.map((t, i) => (
                <div key={i} className="flex gap-2 font-mono text-gray-500">
                  <span>{t.src_port}</span>
                  <span>VLAN {t.vlan ?? '-'}</span>
                  <span>{t.desc ?? ''}</span>
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
  const m = plan.macro
  const rows: Array<[string, string]> = [
    ['机房', m.site],
    ['GPU 规模', String(mnum(plan, 'gpuCount', 'gpu_count', 0))],
    ['PFC 队列', String(mnum(plan, 'pfcQueue', 'pfc_queue', 3))],
    ['CNP 队列', String(mnum(plan, 'cnpQueue', 'cnp_queue', 6))],
    ['BGP 多路径', String(mnum(plan, 'bgpMaxPaths', 'bgp_max_paths', 16))],
    ['收敛比', String(mnum(plan, 'convergence', 'convergence', 1))],
    ['多轨数', String(mnum(plan, 'rails', 'rails', 8))],
    ['AS 段', JSON.stringify(m.asRange ?? m.as_range)],
    ['VLAN 范围', JSON.stringify(m.vlanRanges ?? m.vlan_ranges)],
    ['命名格式', m.naming?.format ?? ''],
    ['OSPF', JSON.stringify(m.ospf)],
    ['地址段', JSON.stringify(m.ipSegments)],
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
        <span>拓扑 {plan.topology ? `${plan.topology.layers} 层 · ${plan.topology.spines} Spine / ${plan.topology.leaves} Leaf` : '-'}</span>
        <span>BGP ECMP {proto?.bgp?.ecmp ?? '-'}</span>
        <span>OSPF {proto?.ospf ? `${proto.ospf.process}/${proto.ospf.area}` : '-'}</span>
      </div>
    </div>
  )
}

export function AidcPlannerPanel() {
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
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState('')

  const buildParams = () => ({
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

  const run = async () => {
    setLoading(true)
    setError('')
    try {
      const res = (await window.electron.aidc.plan(buildParams())) as PlanSummary
      if (res?.error) setError(res.error)
      else setPlan(res)
    } catch (e) {
      setError(`规划失败: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  const doExport = async (format: 'json' | 'excel') => {
    setExporting(true)
    setExportMsg('')
    try {
      const res = await window.electron.aidc.exportPlan(buildParams(), format)
      if (res?.canceled) setExportMsg('已取消')
      else if (res?.error) setExportMsg(`导出失败: ${res.error}`)
      else setExportMsg(`已导出 → ${res?.path ?? ''}`)
    } catch (e) {
      setExportMsg(`导出失败: ${String(e)}`)
    } finally {
      setExporting(false)
    }
  }

  const groups = useGroups(plan)
  const totalDevices = useMemo(() => {
    if (!plan) return 0
    return plan.deviceList.reduce((s, d) => s + (d.count ?? 1), 0)
  }, [plan])

  const pfcDisp = plan ? mnum(plan, 'pfcQueue', 'pfc_queue', 0) : 0
  const cnpDisp = plan ? mnum(plan, 'cnpQueue', 'cnp_queue', 0) : 0

  const tabItems = [
    { value: 'dev', label: '设备清单' },
    { value: 'conn', label: '接线' },
    { value: 'term', label: '终端' },
    { value: 'macro', label: '宏观参数' },
    { value: 'topo', label: '拓扑' },
  ]

  return (
    <SectionCard title="AIDC 规划">
      <p className="text-xs text-gray-500 mb-3">宏观参数 → plan:table（契约 v1.1）→ MC 导入渲染</p>

      {/* 基础参数 */}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <label className="text-sm">机房</label>
          <Input value={site} onChange={(e) => setSite(e.target.value)} aria-label="机房" />
        </div>
        <div>
          <label className="text-sm">GPU 规模</label>
          <Input value={gpuCount} onChange={(e) => setGpuCount(e.target.value)} type="number" min={32} step={32} aria-label="GPU 规模" />
        </div>
        <div>
          <label className="text-sm">PFC 队列（0-7）</label>
          <Input value={pfcQueue} onChange={(e) => setPfcQueue(e.target.value)} type="number" min={0} max={7} aria-label="PFC 队列" />
        </div>
        <div>
          <label className="text-sm">CNP 队列（0-7）</label>
          <Input value={cnpQueue} onChange={(e) => setCnpQueue(e.target.value)} type="number" min={0} max={7} aria-label="CNP 队列" />
        </div>
      </div>

      {/* 高级参数 */}
      <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-primary-500 flex items-center gap-1 mb-3">
        {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        高级宏观参数（收敛比 / 多轨 / AS 段 / VLAN 范围）
      </button>
      {showAdvanced && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3 p-3 border rounded bg-gray-50/50 dark:bg-app-surface">
          <div>
            <label className="text-sm">收敛比 (0,4]</label>
            <Input value={convergence} onChange={(e) => setConvergence(e.target.value)} type="number" min={0.5} step={0.5} aria-label="收敛比" />
          </div>
          <div>
            <label className="text-sm">多轨数 1-16</label>
            <Input value={rails} onChange={(e) => setRails(e.target.value)} type="number" min={1} max={16} aria-label="多轨数" />
          </div>
          <div>
            <label className="text-sm">AS 起始</label>
            <Input value={asStart} onChange={(e) => setAsStart(e.target.value)} type="number" min={65001} max={65500} aria-label="AS 起始" />
          </div>
          <div>
            <label className="text-sm">AS 结束</label>
            <Input value={asEnd} onChange={(e) => setAsEnd(e.target.value)} type="number" min={65001} max={65500} aria-label="AS 结束" />
          </div>
          <div>
            <label className="text-sm">VLAN 计算 起,止</label>
            <Input value={vlanCompute} onChange={(e) => setVlanCompute(e.target.value)} placeholder="100,199" aria-label="VLAN 计算" />
          </div>
          <div>
            <label className="text-sm">VLAN 存储 起,止</label>
            <Input value={vlanStorage} onChange={(e) => setVlanStorage(e.target.value)} placeholder="200,299" aria-label="VLAN 存储" />
          </div>
          <div>
            <label className="text-sm">VLAN 业务 起,止</label>
            <Input value={vlanBiz} onChange={(e) => setVlanBiz(e.target.value)} placeholder="300,399" aria-label="VLAN 业务" />
          </div>
          <div>
            <label className="text-sm">VLAN 带外 起,止</label>
            <Input value={vlanOob} onChange={(e) => setVlanOob(e.target.value)} placeholder="400,499" aria-label="VLAN 带外" />
          </div>
        </div>
      )}

      <Button onClick={run} disabled={loading}>
        {loading ? '生成中…' : '生成规划'}
      </Button>

      <div className="flex items-center gap-2 mt-2">
        <Button variant="secondary" size="sm" onClick={() => doExport('json')} disabled={exporting}>
          {exporting ? '导出中…' : '导出 plan.json'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => doExport('excel')} disabled={exporting}>
          {exporting ? '导出中…' : '导出规划 Excel'}
        </Button>
        {exportMsg && <span className="text-xs text-gray-500">{exportMsg}</span>}
      </div>

      {error && <p className="text-red-500 mt-3 text-sm">{error}</p>}

      {plan && !error && (
        <div className="mt-4">
          {/* 摘要 + 桥接标识 */}
          <div className="flex flex-wrap items-center gap-2 text-sm mb-3">
            <span className="flex items-center gap-1"><GitBranch size={16} />
              {plan.meta.project} · {plan.meta.site} · PFC={pfcDisp} · CNP={cnpDisp}
            </span>
            {(plan.meta.source || plan.meta.projectType || plan.meta.bridgeVersion) && (
              <span className="flex items-center gap-1 text-xs bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 rounded px-1.5 py-0.5">
                <Tag size={12} /> 桥接 {plan.meta.source ?? '-'}/{plan.meta.projectType ?? '-'}/v{plan.meta.bridgeVersion ?? '-'}
              </span>
            )}
            <span className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Network size={14} /> 接线 {plan.connections.length}</span>
              <span className="flex items-center gap-1"><Zap size={14} /> 终端 {plan.terminals.length}</span>
              <span className="flex items-center gap-1"><Server size={14} /> {totalDevices} 台</span>
            </span>
          </div>

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
                          <span className="text-gray-500">{devs.length} 台</span>
                        </div>
                        <DeviceNames devices={devs} />
                      </div>
                    ))}
                  </div>
                )}
                {active === 'conn' && <ConnectionsView conns={plan.connections} />}
                {active === 'term' && <TerminalsView terms={plan.terminals} />}
                {active === 'macro' && <MacroView plan={plan} />}
                {active === 'topo' && <AidcTopologyPreview plan={plan} />}
              </div>
            )}
          </Tabs>
        </div>
      )}
    </SectionCard>
  )
}
