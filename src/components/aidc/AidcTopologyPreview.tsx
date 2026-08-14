/**
 * AIDC 规划拓扑预览（REQ-A2，G1）。
 *
 * 基于 plan:table 的 deviceList 生成轻量 SVG 拓扑：
 * 按平面分组（参数网/存储网/业务&管理网/带外网），聚合层在上、接入层在下，
 * 逐设备节点 + 聚合连线；参数网底部附 GPU 轨示意。
 *
 * 说明：不依赖 TopologyTab（react-flow 项目模型），自包含可直接渲染 plan:table。
 */
import { useMemo } from 'react'
import type { PlanSummary } from './aidcTypes'
import { PLANE_ROLES, ROLE_ABBR, ROLE_LABEL, macroNum } from './aidcTypes'

const W = 360
const BOX_H = 20
const GAP = 10

interface Box { label: string; n: number }

function place(boxes: Box[], y: number): Array<Box & { cx: number; cy: number }> {
  const widths = boxes.map((b) => b.label.length * 6.2 + 14)
  const total = widths.reduce((s, w) => s + w, 0) + (boxes.length - 1) * GAP
  let x = (W - total) / 2
  return boxes.map((b, i) => {
    const w = widths[i]
    const cx = x + w / 2
    x += w + GAP
    return { ...b, cx, cy: y + BOX_H / 2 }
  })
}

function Plane({ title, upperDevs, lowerDevs, gpuCount }: {
  title: string
  upperDevs: PlanSummary['deviceList']
  lowerDevs: PlanSummary['deviceList']
  gpuCount?: number
}) {
  const { upper, lower, lines } = useMemo(() => {
    const ug: Record<string, number> = {}
    for (const d of upperDevs) ug[d.role] = (ug[d.role] ?? 0) + 1
    const lg: Record<string, number> = {}
    for (const d of lowerDevs) lg[d.role] = (lg[d.role] ?? 0) + 1
    // 逐设备节点（≤12 展开为多个，否则聚合为 ×N）
    const expand = (g: Record<string, number>) => {
      const out: Box[] = []
      for (const [role, n] of Object.entries(g)) {
        if (n <= 12) for (let i = 0; i < n; i++) out.push({ label: ROLE_ABBR[role] ?? role, n: 1 })
        else out.push({ label: `${ROLE_ABBR[role] ?? role}×${n}`, n })
      }
      return out
    }
    const u = expand(ug)
    const l = expand(lg)
    const linesArr = u.flatMap((_, ui) => l.map((__, li) => [ui, li] as const))
    return { upper: u, lower: l, lines: linesArr }
  }, [upperDevs, lowerDevs])

  const UY = 34
  const LY = 96
  const GY = 150
  const upBoxes = place(upper, UY)
  const lowBoxes = place(lower, LY)

  return (
    <div className="border rounded p-2">
      <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{title}</div>
      <svg viewBox={`0 0 ${W} 200`} className="w-full max-w-[380px]">
        {/* 连线（聚合：每个接入 → 每个聚合） */}
        {lines.map(([ui, li], i) => {
          const a = upBoxes[ui]
          const b = lowBoxes[li]
          if (!a || !b) return null
          return (
            <line key={`${ui}-${li}`} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy}
              stroke={i % 2 ? '#cbd5e1' : '#94a3b8'} strokeWidth={1} />
          )
        })}
        {upBoxes.map((b, i) => (
          <g key={`u${i}`}>
            <rect x={b.cx - (b.label.length * 6.2 + 14) / 2} y={b.cy - BOX_H / 2}
              width={b.label.length * 6.2 + 14} height={BOX_H} rx={3}
              className="fill-primary-100 stroke-primary-400 dark:fill-primary-900/40 dark:stroke-primary-500" />
            <text x={b.cx} y={b.cy + 3.5} textAnchor="middle" fontSize={9}
              className="fill-gray-700 dark:fill-gray-300">{b.label}</text>
          </g>
        ))}
        {lowBoxes.map((b, i) => (
          <g key={`l${i}`}>
            <rect x={b.cx - (b.label.length * 6.2 + 14) / 2} y={b.cy - BOX_H / 2}
              width={b.label.length * 6.2 + 14} height={BOX_H} rx={3}
              className="fill-secondary-100 stroke-secondary-400 dark:fill-secondary-900/40 dark:stroke-secondary-500" />
            <text x={b.cx} y={b.cy + 3.5} textAnchor="middle" fontSize={9}
              className="fill-gray-700 dark:fill-gray-300">{b.label}</text>
          </g>
        ))}
        {gpuCount !== undefined && (
          <g>
            <rect x={(W - 160) / 2} y={GY - BOX_H / 2} width={160} height={BOX_H} rx={3}
              className="fill-gray-100 stroke-gray-400 dark:fill-gray-800 dark:stroke-gray-600" />
            <text x={W / 2} y={GY + 3.5} textAnchor="middle" fontSize={9}
              className="fill-gray-600 dark:fill-gray-300">
              GPU ×{gpuCount}（8 轨）
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

export function AidcTopologyPreview({ plan }: { plan: PlanSummary }) {
  const gpuCount = macroNum(plan.macro, 'gpuCount', 'gpu_count')
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {PLANE_ROLES.map(({ plane, upper, lower, withGpu }) => {
        const up = plan.deviceList.filter((d) => upper.includes(d.role))
        const lo = plan.deviceList.filter((d) => lower.includes(d.role))
        if (!up.length && !lo.length) return null
        return (
          <Plane key={plane} title={plane}
            upperDevs={up} lowerDevs={lo}
            gpuCount={withGpu ? gpuCount : undefined} />
        )
      })}
      <div className="text-xs text-gray-400 col-span-full mt-1">
        角色：{PLANE_ROLES.flatMap((p) => [...p.upper, ...p.lower]).map((r) => ROLE_LABEL[r]).filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}
