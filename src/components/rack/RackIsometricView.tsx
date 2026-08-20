/**
 * AutoLink V2.4.7 — 机架 3D 等距视图（打磨轮 v1.5 / AL-V1b 精修）
 *
 * 使用 SVG 等距投影渲染机柜（30°）：
 *   - 机柜前面板：设备分布 + U 位空槽网格 + 颜色区分
 *   - 机柜顶面与右侧面：3D 立体感
 *   - U 位标尺：左侧等距对齐
 *   - 缩放：+/-/重置
 *   - 交互：点设备高亮 + tooltip
 *
 * 等距投影公式（30°）：
 *   screenX = (x - z) * cos(30°) = (x - z) * 0.866
 *   screenY = (x + z) * sin(30°) - y = (x + z) * 0.5 - y
 */
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type RackCabinet, CABINET_TYPE_LABELS } from '@/stores/rack.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { exportSvgAsPng, exportSvgFile, makeTimestampedFilename } from '@/utils/exportSvg'
import { Box, Download, ChevronDown, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'

interface Props {
  cabinet: RackCabinet
}

// 等距投影常量
const COS30 = 0.866
const SIN30 = 0.5

// 机柜 3D 尺寸（单位：unit）
const CAB_WIDTH = 60      // X 方向
const CAB_DEPTH = 40      // Z 方向
const U_HEIGHT = 4        // 每 U 高度
const OFFSET_X = 90       // 左侧 U 标尺空间
const OFFSET_Y = 60       // 顶部标题空间

/** 3D 坐标 → 屏幕 2D 坐标 */
function iso(x: number, y: number, z: number): { sx: number; sy: number } {
  return { sx: (x - z) * COS30, sy: (x + z) * SIN30 - y }
}

/** iso 坐标 → SVG 坐标（Y 翻转 + 平移） */
function T(p: { sx: number; sy: number }): { x: number; y: number } {
  return { x: p.sx + OFFSET_X, y: -p.sy + OFFSET_Y }
}

interface IsoPath {
  points: string
  fill: string
  stroke: string
  strokeWidth?: number
}

/** 计算机柜 3D 框架路径 */
function buildCabinetFrame(totalU: number) {
  const h = totalU * U_HEIGHT
  const b0 = T(iso(0, 0, 0))
  const b1 = T(iso(CAB_WIDTH, 0, 0))
  const b2 = T(iso(CAB_WIDTH, 0, CAB_DEPTH))
  const t0 = T(iso(0, h, 0))
  const t1 = T(iso(CAB_WIDTH, h, 0))
  const t2 = T(iso(CAB_WIDTH, h, CAB_DEPTH))
  const t3 = T(iso(0, h, CAB_DEPTH))

  const front: IsoPath = {
    points: `${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}`,
    fill: '#f9fafb', stroke: '#9ca3af', strokeWidth: 1,
  }
  const top: IsoPath = {
    points: `${t0.x},${t0.y} ${t1.x},${t1.y} ${t2.x},${t2.y} ${t3.x},${t3.y}`,
    fill: '#e5e7eb', stroke: '#9ca3af', strokeWidth: 1,
  }
  const right: IsoPath = {
    points: `${b1.x},${b1.y} ${b2.x},${b2.y} ${t2.x},${t2.y} ${t1.x},${t1.y}`,
    fill: '#d1d5db', stroke: '#9ca3af', strokeWidth: 1,
  }
  return { front, top, right, p: { b0, b1, t0, t1 }, height: h }
}

const getTypeColor = (type: string): { fill: string; stroke: string } => {
  const t = type.toLowerCase()
  if (t.includes('gpu')) return { fill: '#3b82f6', stroke: '#1e40af' }
  if (t.includes('存储') || t.includes('storage')) return { fill: '#22c55e', stroke: '#15803d' }
  if (t.includes('switch') || t.includes('交换机')) return { fill: '#f59e0b', stroke: '#b45309' }
  if (t.includes('通算') || t.includes('compute')) return { fill: '#a855f7', stroke: '#6b21a8' }
  if (t.includes('安全') || t.includes('security')) return { fill: '#ef4444', stroke: '#991b1b' }
  return { fill: '#9ca3af', stroke: '#4b5563' }
}

export function RackIsometricView({ cabinet }: Props) {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const addToast = useToastStore((s) => s.addToast)
  const svgRef = useRef<SVGSVGElement>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  // 打磨轮（v1.5 / AL-V1b）：缩放 + 设备选中高亮
  const [scale, setScale] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const totalPower = useMemo(
    () => cabinet.devices.reduce((s, d) => s + d.power_watts, 0),
    [cabinet.devices],
  )

  const handleExportSvg = async () => {
    if (!svgRef.current || !selectedProjectName) return
    try {
      const filename = makeTimestampedFilename(`机架3D_${cabinet.name}`, 'svg')
      await exportSvgFile(svgRef.current, selectedProjectName, filename)
      addToast('success', t('common:toast.exportedToOutput', { filename }))
    } catch (err) {
      addToast('error', t('common:toast.exportFailed', { error: err instanceof Error ? err.message : t('common:toast.unknownError') }))
    }
    setShowExportMenu(false)
  }

  const handleExportPng = async () => {
    if (!svgRef.current || !selectedProjectName) return
    addToast('info', t('common:toast.generatingPng'))
    try {
      const filename = makeTimestampedFilename(`机架3D_${cabinet.name}`, 'png')
      await exportSvgAsPng(svgRef.current, selectedProjectName, filename, 2)
      addToast('success', t('common:toast.exportedToOutput', { filename }))
    } catch (err) {
      addToast('error', t('common:toast.exportFailed', { error: err instanceof Error ? err.message : t('common:toast.unknownError') }))
    }
    setShowExportMenu(false)
  }

  const frame = useMemo(() => buildCabinetFrame(cabinet.totalU), [cabinet.totalU])

  // 打磨轮（v1.5 / AL-V1b）：前面板 U 位空槽网格（每 U 一条分界线）
  const gridLines = useMemo(() => {
    const lines: { u: number; x1: number; y1: number; x2: number; y2: number }[] = []
    for (let u = 0; u <= cabinet.totalU; u++) {
      const y = u * U_HEIGHT
      const left = T(iso(2, y, 0))
      const right = T(iso(CAB_WIDTH - 2, y, 0))
      lines.push({ u, x1: left.x, y1: left.y, x2: right.x, y2: right.y })
    }
    return lines
  }, [cabinet.totalU])

  // 设备块（含前面板三面 + 标签）
  const deviceBlocks = useMemo(() => {
    return cabinet.devices.map((d) => {
      const yStart = (d.startU - 1) * U_HEIGHT
      const yEnd = d.endU * U_HEIGHT
      const color = getTypeColor(d.type)
      const p1 = T(iso(2, yStart, 0))
      const p2 = T(iso(CAB_WIDTH - 2, yStart, 0))
      const p3 = T(iso(CAB_WIDTH - 2, yEnd, 0))
      const p4 = T(iso(2, yEnd, 0))
      const thick = 3
      const f2 = T(iso(CAB_WIDTH - 2, yStart, -thick))
      const f3 = T(iso(CAB_WIDTH - 2, yEnd, -thick))
      const f4 = T(iso(2, yEnd, -thick))
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        startU: d.startU,
        endU: d.endU,
        power_watts: d.power_watts,
        frontFace: `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`,
        topFace: `${f4.x},${f4.y} ${f3.x},${f3.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`,
        rightFace: `${p2.x},${p2.y} ${p3.x},${p3.y} ${f3.x},${f3.y} ${f2.x},${f2.y}`,
        color,
        labelPos: { x: (p1.x + p2.x) / 2, y: (p1.y + p4.y) / 2 },
        height: yEnd - yStart,
        uHeight: d.endU - d.startU + 1,
      }
    })
  }, [cabinet.devices])

  // U 位标尺
  const uRuler = useMemo(() => {
    const marks: { u: number; x: number; y: number }[] = []
    for (let u = 1; u <= cabinet.totalU; u += 5) {
      const p = T(iso(0, (u - 1) * U_HEIGHT, 0))
      marks.push({ u, x: p.x - 6, y: p.y })
    }
    if (cabinet.totalU % 5 !== 0) {
      const p = T(iso(0, cabinet.totalU * U_HEIGHT, 0))
      marks.push({ u: cabinet.totalU, x: p.x - 6, y: p.y })
    }
    return marks
  }, [cabinet.totalU])

  // 视口尺寸（随缩放）
  const svgWidth = 320
  const svgHeight = 80 + cabinet.totalU * U_HEIGHT * 0.5 + 60
  // 缩放中心（机柜前板中心）
  const cx = (frame.p.b0.x + frame.p.b1.x) / 2
  const cy = (frame.p.b0.y + frame.p.t0.y) / 2

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-gray-200 dark:border-edge-subtle bg-gray-50 dark:bg-app/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Box size={13} className="text-purple-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {cabinet.name} · {t('rack:isoView')}
            </span>
            {/* 打磨轮（v1.5 / AL-V1b）：柜类型标签 */}
            <span className="px-1.5 py-0.5 text-2xs rounded bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">
              {CABINET_TYPE_LABELS[cabinet.type] ?? cabinet.type}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-2xs text-gray-500 dark:text-gray-400">
              <span>{cabinet.devices.length} 台设备 · {cabinet.totalU}U</span>
              <span className="font-medium text-orange-600 dark:text-orange-400">
                {(totalPower / 1000).toFixed(2)} kW
              </span>
            </div>
            {/* 打磨轮（v1.5 / AL-V1b）：缩放控制 */}
            <div className="flex items-center bg-white dark:bg-app border border-gray-200 dark:border-gray-600 rounded overflow-hidden">
              <button onClick={() => setScale((s) => Math.max(0.6, +(s - 0.25).toFixed(2)))} title="缩小"
                className="p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"><ZoomOut size={11} /></button>
              <span className="px-1 text-2xs text-gray-500 tabular-nums">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale((s) => Math.min(2, +(s + 0.25).toFixed(2)))} title="放大"
                className="p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"><ZoomIn size={11} /></button>
              <button onClick={() => setScale(1)} title="重置"
                className="p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600 border-l border-gray-200 dark:border-gray-600"><RotateCcw size={11} /></button>
            </div>
            {/* 导出按钮 */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-1 px-1.5 py-0.5 text-2xs rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500"
              >
                <Download size={11} />
                <ChevronDown size={9} />
              </button>
              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded shadow-lg py-1 min-w-[110px]">
                    <button onClick={handleExportSvg}
                      className="block w-full text-left px-3 py-1 text-2xs hover:bg-gray-50 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300">
                      {t('rack:exportSvg')}
                    </button>
                    <button onClick={handleExportPng}
                      className="block w-full text-left px-3 py-1 text-2xs hover:bg-gray-50 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300">
                      {t('rack:exportPng')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3D 视图 */}
      <div className="flex-1 overflow-auto p-3 flex justify-center">
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="block"
        >
          <g transform={`translate(${cx},${cy}) scale(${scale}) translate(${-cx},${-cy})`}>
            {/* 机柜 3D 框架：右侧面 → 顶面 → 前面 */}
            <polygon points={frame.right.points} fill={frame.right.fill} stroke={frame.right.stroke} strokeWidth={frame.right.strokeWidth} />
            <polygon points={frame.top.points} fill={frame.top.fill} stroke={frame.top.stroke} strokeWidth={frame.top.strokeWidth} />
            <polygon points={frame.front.points} fill={frame.front.fill} stroke={frame.front.stroke} strokeWidth={frame.front.strokeWidth} />

            {/* 打磨轮（v1.5 / AL-V1b）：前面板 U 位空槽网格（空槽可见） */}
            {gridLines.map((line) => (
              <line key={`g-${line.u}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                stroke="#cbd5e1" strokeWidth={0.4} />
            ))}

            {/* U 位标尺 */}
            {uRuler.map((mark) => (
              <g key={mark.u}>
                <line x1={mark.x} y1={mark.y} x2={mark.x + 4} y2={mark.y} stroke="#9ca3af" strokeWidth={0.5} />
                <text x={mark.x - 2} y={mark.y + 2} fontSize={7} fill="#6b7280" textAnchor="end">U{mark.u}</text>
              </g>
            ))}

            {/* 设备块（可点击高亮） */}
            {deviceBlocks.map((block) => {
              const isSel = selectedId === block.id
              return (
                <g key={block.id} className="cursor-pointer" onClick={() => setSelectedId(isSel ? null : block.id)}>
                  <polygon points={block.topFace} fill={block.color.fill} opacity={0.7} stroke={block.color.stroke} strokeWidth={0.5} />
                  <polygon points={block.rightFace} fill={block.color.stroke} opacity={0.5} stroke={block.color.stroke} strokeWidth={0.5} />
                  <polygon points={block.frontFace}
                    fill={block.color.fill}
                    stroke={isSel ? '#ffffff' : block.color.stroke}
                    strokeWidth={isSel ? 1.6 : 0.8}
                    opacity={0.92}>
                    <title>{`${block.name}\nU${block.startU}-U${block.endU} · ${block.power_watts}W`}</title>
                  </polygon>
                  {block.height >= 4 && (
                    <text x={block.labelPos.x} y={block.labelPos.y + (block.uHeight >= 4 ? 2 : 0)}
                      fontSize={block.uHeight >= 8 ? 5.5 : 4.5}
                      fill="#fff" textAnchor="middle" fontWeight="bold" pointerEvents="none">
                      {block.name.length > 9 ? block.name.slice(0, 8) + '…' : block.name}
                    </text>
                  )}
                </g>
              )
            })}

            {/* 机柜底部标签 */}
            <text
              x={(frame.p.b0.x + frame.p.b1.x) / 2}
              y={frame.p.b0.y + 14}
              fontSize={8}
              fill="#6b7280"
              textAnchor="middle"
              fontWeight="bold"
            >
              {cabinet.name} · {cabinet.totalU}U
            </text>
          </g>
        </svg>
      </div>
    </div>
  )
}
