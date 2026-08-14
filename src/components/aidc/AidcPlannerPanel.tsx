/**
 * AIDC 规划面板（P1.3，复用现有框架/UI）。
 *
 * 宏观参数（机房/GPU 规模/PFC-CNP 队列）→ 调 `plan:aidc` → 展示规划摘要（plan:table）。
 * 自包含组件，可挂载到工作台/向导任意位置。
 */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SectionCard } from '@/components/ui/SectionCard'
import { Network, Zap, Server, GitBranch } from 'lucide-react'

interface PlanSummary {
  meta: { project: string; site: string }
  macro: Record<string, unknown>
  deviceList: Array<{ role: string; count: number; model: string }>
  connections: unknown[]
  terminals: unknown[]
  error?: string
}

const ROLE_LABEL: Record<string, string> = {
  SPINE: '参数 Spine', LEAF: '参数 Leaf', STO_SPINE: '存储 Spine', STO_LEAF: '存储 Leaf',
  BIZ_AGG: '业务汇聚', BIZ_ACCESS: '业务接入', OOB_AGG: '带外汇聚', OOB_ACCESS: '带外接入',
}

export function AidcPlannerPanel() {
  const [site, setSite] = useState('BJ01')
  const [gpuCount, setGpuCount] = useState('64')
  const [pfcQueue, setPfcQueue] = useState('3')
  const [cnpQueue, setCnpQueue] = useState('6')
  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    setLoading(true)
    setError('')
    try {
      const res = (await window.electron.aidc.plan({
        site, gpu_count: Number(gpuCount), pfc_queue: Number(pfcQueue), cnp_queue: Number(cnpQueue),
      })) as PlanSummary
      if (res?.error) {
        setError(res.error)
      } else {
        setPlan(res)
      }
    } catch (e) {
      setError(`规划失败: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  const totalDevices = plan?.deviceList.reduce((s, d) => s + (d.count ?? 1), 0) ?? 0

  return (
    <SectionCard title="AIDC 规划">
      <p className="text-xs text-gray-500 mb-3">宏观参数 → plan:table（AL→MC 接口契约）</p>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-sm">机房</label>
          <Input value={site} onChange={(e) => setSite(e.target.value)} />
        </div>
        <div>
          <label className="text-sm">GPU 规模</label>
          <Input value={gpuCount} onChange={(e) => setGpuCount(e.target.value)} type="number" />
        </div>
        <div>
          <label className="text-sm">PFC 队列（0-7）</label>
          <Input value={pfcQueue} onChange={(e) => setPfcQueue(e.target.value)} type="number" min={0} max={7} />
        </div>
        <div>
          <label className="text-sm">CNP 队列（0-7）</label>
          <Input value={cnpQueue} onChange={(e) => setCnpQueue(e.target.value)} type="number" min={0} max={7} />
        </div>
      </div>
      <Button onClick={run} disabled={loading}>
        {loading ? '生成中…' : '生成规划'}
      </Button>

      {error && <p className="text-red-500 mt-3">{error}</p>}

      {plan && !error && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <GitBranch size={16} />
            {plan.meta.project} · {plan.meta.site} · PFC={String(plan.macro.pfc_queue)} · CNP={String(plan.macro.cnp_queue)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {plan.deviceList.map((d) => (
              <div key={d.role} className="flex items-center justify-between border rounded p-2 text-sm">
                <span className="flex items-center gap-2">
                  <Server size={14} /> {ROLE_LABEL[d.role] ?? d.role}
                </span>
                <span className="text-gray-500">{d.model}</span>
                <span className="font-mono">{d.count}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1"><Network size={14} /> 接线 {plan.connections.length}</span>
            <span className="flex items-center gap-1"><Zap size={14} /> 终端 {plan.terminals.length}</span>
            <span>共 {totalDevices} 台设备</span>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
