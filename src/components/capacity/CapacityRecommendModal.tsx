/**
 * V3.1.3-T7-4: 容量规划推荐向导
 *
 * 选模型 + GPU 规模 + 预算档位 → backend `capacity:recommend` 计算
 * Scale-Up/Scale-Out 协议/速率/收敛比/层数/通信开销 → 一键应用
 * （映射到 DesignConfig：param_speed / param_protocol / num_servers）。
 */
import { useEffect, useState } from 'react'
import { Gauge, Loader2, Sparkles, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToastStore } from '@/stores/toast.store'
import type { DesignConfig } from '@/stores/design.store'

export interface CapacityPreset {
  id: string
  name: string
  model_type: string
  num_params: number
  context_length: number
  precision: string
  num_experts: number
}

export interface CapacityRecommendation {
  success: boolean
  error?: string
  /** V3.1.3-T7-5: 预估值标注（解析法，非实测） */
  estimated?: boolean
  estimation?: {
    label: string
    method: string
    accuracy: string
    note: string
  }
  model?: {
    name: string
    model_type: string
    num_params_b: number
    context_length: number
    precision: string
    num_experts: number
  }
  comm?: { total_gib: number; comm_ratio: number }
  recommendation?: {
    scale_up_protocol: string
    scale_up_domain: number
    scale_out_protocol: string
    scale_out_speed: string
    convergence_ratio: number
    tier_count: number
    estimated_comm_overhead: number
  }
  notes?: Array<{ level: string; message: string }>
}

export const CAPACITY_BUDGETS = [
  { value: 'economy', label: '经济型 (economy)' },
  { value: 'standard', label: '标准型 (standard)' },
  { value: 'premium', label: '旗舰型 (premium)' },
]

const PROTOCOL_LABELS: Record<string, string> = {
  NVLink: 'NVLink (Scale-Up)',
  UALink: 'UALink (Scale-Up)',
  UB: 'UB 超节点',
  none: '不启用 Scale-Up',
  IB: 'InfiniBand',
  RoCE: 'RoCE (以太网)',
  UEC: 'UEC (超以太网)',
}

interface Props {
  open: boolean
  onClose: () => void
  /** 一键应用回调：接收映射后的 DesignConfig patch */
  onApply: (patch: Partial<DesignConfig>) => void
  /** 当前 GPU 服务器数（预填） */
  initialNumServers?: number
}

export function CapacityRecommendModal({ open, onClose, onApply, initialNumServers }: Props) {
  const addToast = useToastStore((s) => s.addToast)
  const [presets, setPresets] = useState<CapacityPreset[]>([])
  const [model, setModel] = useState('')
  const [numGpus, setNumGpus] = useState(initialNumServers ? initialNumServers * 8 : 1024)
  const [budget, setBudget] = useState('standard')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CapacityRecommendation | null>(null)

  useEffect(() => {
    if (!open) return
    setResult(null)
    const load = async () => {
      try {
        const res = await window.electron.capacity.listPresets()
        setPresets(res.presets)
        if (!model && res.presets.length > 0) setModel(res.presets[0].id)
      } catch (err: any) {
        addToast('error', err?.message || '加载模型档案失败', 4000)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleRecommend = async () => {
    if (!model) {
      addToast('warning', '请选择模型', 3000)
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const res = await window.electron.capacity.recommend({ model, numGpus, budget })
      if (!res.success) {
        addToast('error', res.error || '推荐计算失败', 4000)
      }
      setResult(res)
    } catch (err: any) {
      addToast('error', err?.message || '推荐计算失败', 4000)
    } finally {
      setLoading(false)
    }
  }

  const handleApply = () => {
    const rec = result?.recommendation
    if (!rec) return
    const patch: Partial<DesignConfig> = {
      param_speed: rec.scale_out_speed,
      // UEC 走以太网 → 映射 RoCE；IB 直映射
      param_protocol: rec.scale_out_protocol === 'IB' ? 'IB' : 'RoCE',
      num_servers: Math.max(1, Math.ceil(numGpus / 8)),
    }
    onApply(patch)
    addToast('success', `已应用容量推荐：${rec.scale_out_speed} ${rec.scale_out_protocol}，收敛比 ${rec.convergence_ratio}`, 4000)
    onClose()
  }

  const rec = result?.recommendation
  const modelInfo = result?.model

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="容量规划推荐"
      width={560}
      footer={
        rec && (
          <div className="flex justify-end">
            <button
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
            >
              <CheckCircle2 size={13} />
              一键应用
            </button>
          </div>
        )
      }
    >
      {/* 输入表单 */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-gray-500 dark:text-gray-400">训练模型</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.model_type === 'moe' ? 'MoE' : 'Dense'} · {p.precision} · {Math.round(p.num_params / 1e9)}B）
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-gray-500 dark:text-gray-400">目标 GPU 数量</span>
            <input
              type="number"
              min={1}
              step={8}
              value={numGpus}
              onChange={(e) => setNumGpus(Math.max(1, Number(e.target.value)))}
              className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-gray-500 dark:text-gray-400">预算档位</span>
          <select
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
          >
            {CAPACITY_BUDGETS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </label>
        <button
          onClick={handleRecommend}
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Gauge size={13} />}
          {loading ? '计算中...' : '计算容量推荐'}
        </button>
      </div>

      {/* 错误 */}
      {result?.error && (
        <div className="mt-3 flex items-start gap-2 p-2.5 rounded text-xs bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>{result.error}</span>
        </div>
      )}

      {/* 推荐结果 */}
      {rec && (
        <div className="mt-4 space-y-3">
          {modelInfo && (
            <div className="text-2xs text-gray-500 dark:text-gray-400">
              {modelInfo.name} · {modelInfo.num_params_b}B 参数 · {modelInfo.model_type === 'moe' ? 'MoE' : 'Dense'}
              {' · '}{Math.round((modelInfo.context_length / 1024))}K 上下文 · {modelInfo.precision.toUpperCase()}
            </div>
          )}
          {/* V3.1.3-T7-5: 预估值标注 */}
          {result.estimated && (
            <div className="flex items-center gap-1.5 text-2xs px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/40">
              <Sparkles size={11} className="shrink-0" />
              <span>
                {result.estimation?.label || '预估值'} · {result.estimation?.method || '解析法'} · 误差 {result.estimation?.accuracy || '±15-20%'}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-2.5">
              <div className="text-2xs text-gray-400 dark:text-gray-500 mb-1.5">Scale-Up</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {rec.scale_up_protocol === 'none' ? '不启用' : PROTOCOL_LABELS[rec.scale_up_protocol] || rec.scale_up_protocol}
              </div>
              {rec.scale_up_domain > 0 && (
                <div className="text-2xs text-gray-400 dark:text-gray-500 mt-0.5">域大小 {rec.scale_up_domain}</div>
              )}
            </div>
            <div className="border border-gray-200 dark:border-edge-subtle rounded-lg p-2.5">
              <div className="text-2xs text-gray-400 dark:text-gray-500 mb-1.5">Scale-Out</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {rec.scale_out_speed} {PROTOCOL_LABELS[rec.scale_out_protocol] || rec.scale_out_protocol}
              </div>
              <div className="text-2xs text-gray-400 dark:text-gray-500 mt-0.5">收敛比 ≤ {rec.convergence_ratio} · {rec.tier_count} 层</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-2xs text-gray-500 dark:text-gray-400">
            <Sparkles size={12} className="text-amber-500" />
            预估通信开销占比 {Math.round(rec.estimated_comm_overhead * 100)}% · 每步通信量约 {result?.comm?.total_gib ?? '-'} GiB
          </div>
          {/* notes */}
          {result?.notes && result.notes.length > 0 && (
            <div className="space-y-1">
              {result.notes.map((n, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-1.5 text-2xs ${
                    n.level === 'warn'
                      ? 'text-warning-600 dark:text-warning-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {n.level === 'warn' ? <AlertTriangle size={11} className="shrink-0 mt-0.5" /> : <ArrowRight size={11} className="shrink-0 mt-0.5" />}
                  <span>{n.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
