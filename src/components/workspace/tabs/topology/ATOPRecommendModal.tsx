/**
 * AutoLink V3.2.0-T9-2 — ATOP 自动拓扑优化推荐弹窗
 *
 * 模型通信特征（AllReduce/All-to-All/P2P + 通信占比）→ ZCube 2D/3D cube
 * 拓扑推荐。调用 backend `atop:recommend`（只读计算），展示推荐理由与
 * 渲染元数据，可一键把推荐拓扑应用到画布（复用 zcube_group/plane_id 双平面着色）。
 */
import { useState } from 'react'
import { X, Sparkles, Loader2, CheckCircle2, AlertTriangle, ArrowRight, Layers } from 'lucide-react'
import { useDesignStore } from '@/stores/design.store'
import { useToastStore } from '@/stores/toast.store'

interface ATOPResult {
  success: boolean
  error?: string
  feature?: {
    modelName: string
    modelType: string
    communicationPattern: 'allreduce' | 'alltoall' | 'p2p'
    commRatio: number
    precision: string
    numExperts: number
    trafficBreakdown: { allreduce: number; alltoall: number; p2p: number }
    parallel: { tp: number; dp: number; pp: number }
    nicsPerGpu: number
  }
  cube?: { dims: number[]; dim: number; volume: number; numGpus: number }
  topology?: {
    nodes: Array<{
      id: string
      type: string
      group: string
      podid: string
      zcubeGroup?: string
      planeId?: number
      cubeRank?: number
      cubePos?: number[]
    }>
    edges: Array<{ source: string; target: string; speed: string; description: string }>
  }
  zcube?: {
    stats: Record<string, number>
    params: { nics_per_gpu: number; switch_ports: number; leaf_count: number }
    meta: { cubeDimensions: number[]; dim: number; numGpus: number; groups: { A: number; B: number }; noSpine: boolean }
  }
  validation?: { valid: boolean; issues: Array<{ rule_id: string; severity: string; message: string }> }
  rationale?: { summary: string; points: string[] }
}

const PATTERN_LABEL: Record<string, string> = {
  allreduce: 'AllReduce',
  alltoall: 'All-to-All',
  p2p: 'P2P',
}

export function ATOPRecommendModal({ open, defaultNumGpus, onClose }: {
  open: boolean
  defaultNumGpus: number
  onClose: () => void
}) {
  const addToast = useToastStore((s) => s.addToast)
  const [numGpus, setNumGpus] = useState<number>(defaultNumGpus || 1024)
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ATOPResult | null>(null)
  const [applied, setApplied] = useState(false)

  if (!open) return null

  const handleRecommend = async () => {
    if (!numGpus || numGpus <= 0) {
      addToast('error', '请输入有效的 GPU 数量', 4000)
      return
    }
    setLoading(true)
    setApplied(false)
    try {
      const res = (await window.electron.atop.recommend({
        numGpus,
        model: model.trim() || undefined,
      })) as ATOPResult
      setResult(res)
      if (res.success) {
        addToast('success', `ATOP 推荐完成：${res.cube?.dim}D cube · ${res.cube?.dims.join('×')}`, 4000)
      }
    } catch (err) {
      setResult({ success: false, error: (err as Error).message })
      addToast('error', `ATOP 推荐失败：${(err as Error).message}`, 5000)
    } finally {
      setLoading(false)
    }
  }

  const handleApply = () => {
    if (!result?.topology || !result.zcube) return
    const nodes = result.topology.nodes
    const edges = result.topology.edges
    useDesignStore.getState().restoreTopology(nodes as never, edges as never)
    useDesignStore.setState({
      summary: {
        mode: 'zcube',
        numServers: result.zcube.meta.numGpus,
        totalServers: result.zcube.meta.numGpus,
        paramLeafCount: result.zcube.meta.groups.A + result.zcube.meta.groups.B,
        paramSpineCount: 0,
        paramCoreCount: 0,
        paramSpeed: '400G',
        storageSpeed: '200G',
        paramDownlink: result.zcube.stats.downlink_per_leaf ?? 0,
        storageDownlink: 0,
        storageLeafCount: 0,
        storageSpineCount: 0,
      },
      valid: result.validation?.valid ?? null,
      validationIssues: (result.validation?.issues ?? []).map((i) => ({
        rule_id: i.rule_id,
        severity: i.severity as 'error' | 'warning' | 'info',
        category: 'ATOP 推荐校验',
        message: i.message,
        affected_items: [],
        recommendation: '',
      })),
    })
    setApplied(true)
    addToast('success', '推荐拓扑已应用到画布（GPU 按 A/B 组双平面着色）', 4000)
  }

  const f = result?.feature
  const cube = result?.cube
  const errors = result?.validation?.issues.filter((i) => i.severity === 'error') ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60" onClick={onClose}>
      <div
        className="w-[720px] max-h-[86vh] flex flex-col bg-white dark:bg-app-surface rounded-lg shadow-2xl border border-gray-200 dark:border-edge-subtle"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
            <Sparkles size={15} className="text-primary-500" />
            ATOP 自动拓扑优化
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-500">
            <X size={15} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-2xs">
          {/* inputs */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-gray-500 dark:text-gray-400">GPU 数量</span>
              <input
                type="number"
                min={1}
                value={numGpus}
                onChange={(e) => setNumGpus(Number(e.target.value))}
                className="w-full px-2 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app-input text-gray-800 dark:text-gray-200"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-500 dark:text-gray-400">模型档案（可选）</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="如 deepseek-v3 / llama3-70b"
                className="w-full px-2 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app-input text-gray-800 dark:text-gray-200 placeholder-gray-400"
              />
            </label>
          </div>
          <button
            onClick={handleRecommend}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-60"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? '推荐中…' : '生成拓扑推荐'}
          </button>

          {/* error */}
          {result && !result.success && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
              <AlertTriangle size={14} />{result.error}
            </div>
          )}

          {/* result */}
          {result?.success && f && cube && (
            <>
              {/* feature summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <SummaryChip label="通信模式" value={PATTERN_LABEL[f.communicationPattern] ?? f.communicationPattern} />
                <SummaryChip label="通信占比" value={`${Math.round(f.commRatio * 100)}%`} />
                <SummaryChip label="Cube 维度" value={`${cube.dim}D · ${cube.dims.join('×')}`} />
                <SummaryChip label="网卡/GPU" value={`${f.nicsPerGpu} 口`} />
              </div>

              {/* zcube stats */}
              <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-1.5 bg-gray-50 dark:bg-app-hover/40">
                <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 font-medium">
                  <Layers size={13} />ZCube 扁平二部图（无 Spine）
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-gray-500 dark:text-gray-400">
                  <span>每组 Leaf：{result.zcube?.params.leaf_count} 台</span>
                  <span>Leaf 端口：{result.zcube?.params.switch_ports}</span>
                  <span>组 A：{result.zcube?.meta.groups.A} GPU</span>
                  <span>组 B：{result.zcube?.meta.groups.B} GPU</span>
                </div>
                {result.zcube?.meta.noSpine && (
                  <span className="text-2xs text-primary-600 dark:text-primary-400">任意 GPU 间独享最短路径</span>
                )}
              </div>

              {/* validation */}
              <div className={`flex items-center gap-2 px-3 py-2 rounded ${
                result.validation?.valid
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
              }`}>
                {result.validation?.valid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                拓扑校验：{result.validation?.valid ? '通过（V020 结构规则无 error）' : `存在 ${errors.length} 项错误`}
              </div>

              {/* rationale */}
              <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-1">
                <div className="font-medium text-gray-600 dark:text-gray-300">推荐理由</div>
                {result.rationale?.points.map((p, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-gray-500 dark:text-gray-400">
                    <span className="text-primary-500 mt-0.5">•</span>{p}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* footer */}
        {result?.success && result.topology && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <span className="mr-auto text-gray-400 dark:text-gray-500">
              {result.zcube?.meta.numGpus} GPU · {result.topology.nodes.length} 节点 · {result.topology.edges.length} 链路
            </span>
            <button onClick={onClose} className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300">
              关闭
            </button>
            <button
              onClick={handleApply}
              disabled={applied}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-60"
            >
              <ArrowRight size={13} />
              {applied ? '已应用' : '应用到拓扑'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 dark:border-gray-700 px-3 py-2">
      <div className="text-gray-400 dark:text-gray-500">{label}</div>
      <div className="mt-0.5 font-medium text-gray-700 dark:text-gray-200">{value}</div>
    </div>
  )
}
