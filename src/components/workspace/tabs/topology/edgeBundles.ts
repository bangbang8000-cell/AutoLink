/**
 * F5（5.4.4 可用性修复，D2 拍板「聚合束流」）：大规模拓扑边聚合——
 * 按 (source,target) 对把多条物理链路聚为一束：1 条束边 = N 条物理边，
 * 束宽随 N 缩放、label 标注 ×N。信息保真度高于步长抽样（抽样丢边，聚束不丢对）。
 *
 * 5.5.2 / A13：从 TopologyTab 外移，供「屏幕视图」与「导出快照」共用同一算法，
 * 保证开束流时导出的束数与屏幕一致。
 */
import type { Edge } from '@xyflow/react'

export function aggregateEdgesToBundles(
  edges: Edge[],
  opts: { minBundle?: number } = {},
): Edge[] {
  const minBundle = opts.minBundle ?? 2
  const byPair = new Map<string, Edge[]>()
  for (const e of edges) {
    const key = `${e.source}→${e.target}`
    const arr = byPair.get(key)
    if (arr) arr.push(e)
    else byPair.set(key, [e])
  }
  const out: Edge[] = []
  for (const arr of byPair.values()) {
    if (arr.length < minBundle) {
      out.push(...arr)
      continue
    }
    const first = arr[0]
    const width = Math.min(2 + Math.log2(arr.length) * 1.5, 8)
    out.push({
      ...first,
      id: `bundle-${first.source}-${first.target}-${arr.length}`,
      style: { ...first.style, strokeWidth: width, opacity: 0.75 },
      data: {
        ...(first.data ?? {}),
        label: `${(first.data as { label?: string } | undefined)?.label ?? ''} ×${arr.length}`,
        bundleCount: arr.length,
      },
    })
  }
  return out
}
