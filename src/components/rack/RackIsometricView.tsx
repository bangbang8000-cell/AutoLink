/**
 * AutoLink V2.4.7 — 机架 3D 等距视图
 *
 * 使用 SVG 等距投影渲染机柜：
 *   - 机柜前面板：显示设备分布与颜色
 *   - 机柜顶面与右侧面：提供 3D 立体感
 *   - U位标尺：左侧等距对齐
 *   - 顶部信息：机柜名 / 总功率 / 设备数
 *
 * 等距投影公式（30°）：
 *   screenX = (x - z) * cos(30°) = (x - z) * 0.866
 *   screenY = (x + z) * sin(30°) - y = (x + z) * 0.5 - y
 */
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type RackCabinet } from '@/stores/rack.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { exportSvgAsPng, exportSvgFile, makeTimestampedFilename } from '@/utils/exportSvg'
import { Box, Download, ChevronDown } from 'lucide-react'

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

/** 3D 坐标 → 屏幕 2D 坐标 */
function iso(x: number, y: number, z: number): { sx: number; sy: number } {
  return {
    sx: (x - z) * COS30,
    sy: (x + z) * SIN30 - y,
  }
}

interface IsoPath {
  points: string
  fill: string
  stroke: string
  strokeWidth?: number
}

/** 计算机柜 3D 框架路径 */
function buildCabinetFrame(totalU: number, offsetX: number, offsetY: number) {
  const h = totalU * U_HEIGHT

  // 8 个顶点
  // 底部 4 个
  const b0 = iso(0, 0, 0)               // 左前下
  const b1 = iso(CAB_WIDTH, 0, 0)       // 右前下
  const b2 = iso(CAB_WIDTH, 0, CAB_DEPTH) // 右后下
  const b3 = iso(0, 0, CAB_DEPTH)       // 左后下
  // 顶部 4 个
  const t0 = iso(0, h, 0)
  const t1 = iso(CAB_WIDTH, h, 0)
  const t2 = iso(CAB_WIDTH, h, CAB_DEPTH)
  const t3 = iso(0, h, CAB_DEPTH)

  // 平移
  const T = (p: { sx: number; sy: number }) => ({
    x: p.sx + offsetX,
    y: -p.sy + offsetY,  // SVG Y 轴向下
  })

  const p = {
    b0: T(b0), b1: T(b1), b2: T(b2), b3: T(b3),
    t0: T(t0), t1: T(t1), t2: T(t2), t3: T(t3),
  }

  // 前面（左前 → 右前 → 右上前 → 左上前）
  const front: IsoPath = {
    points: `${p.b0.x},${p.b0.y} ${p.b1.x},${p.b1.y} ${p.t1.x},${p.t1.y} ${p.t0.x},${p.t0.y}`,
    fill: '#f9fafb',
    stroke: '#9ca3af',
    strokeWidth: 1,
  }

  // 顶面（左上前 → 右上前 → 右上后 → 左上后）
  const top: IsoPath = {
    points: `${p.t0.x},${p.t0.y} ${p.t1.x},${p.t1.y} ${p.t2.x},${p.t2.y} ${p.t3.x},${p.t3.y}`,
    fill: '#e5e7eb',
    stroke: '#9ca3af',
    strokeWidth: 1,
  }

  // 右侧面（右前下 → 右后下 → 右上后 → 右上前）
  const right: IsoPath = {
    points: `${p.b1.x},${p.b1.y} ${p.b2.x},${p.b2.y} ${p.t2.x},${p.t2.y} ${p.t1.x},${p.t1.y}`,
    fill: '#d1d5db',
    stroke: '#9ca3af',
    strokeWidth: 1,
  }

  return { front, top, right, points: p, height: h }
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

  // 计算机柜 3D 框架
  // offset 用来将整个机柜平移到 SVG 视口中央
  const frame = useMemo(() => {
    // 因为等距投影会让 y 轴翻转，我们需要预留顶部空间
    // 计算最大 sy（屏幕 Y，翻转前）= (CAB_WIDTH + CAB_DEPTH) * SIN30 = 100 * 0.5 = 50
    // 加上机柜高度 totalU * U_HEIGHT
    // SVG Y 向下，所以顶部内容 y 较小
    const offsetX = 80   // 给左侧 U 位标尺留空间
    const offsetY = 60   // 给顶部标题留空间 + 顶面投影
    return buildCabinetFrame(cabinet.totalU, offsetX, offsetY)
  }, [cabinet.totalU])

  // 计算每个设备在前面板上的 3D 块
  const deviceBlocks = useMemo(() => {
    return cabinet.devices.map((d) => {
      const yStart = (d.startU - 1) * U_HEIGHT
      const yEnd = d.endU * U_HEIGHT
      const color = getTypeColor(d.type)

      // 前面板上的 4 个角（z = 0）
      const p1 = iso(2, yStart, 0)         // 左下
      const p2 = iso(CAB_WIDTH - 2, yStart, 0)  // 右下
      const p3 = iso(CAB_WIDTH - 2, yEnd, 0)    // 右上
      const p4 = iso(2, yEnd, 0)           // 左上

      // 平移到 SVG 坐标
      const offsetX = 80
      const offsetY = 60
      const T = (p: { sx: number; sy: number }) => ({
        x: p.sx + offsetX,
        y: -p.sy + offsetY,
      })

      const tp1 = T(p1), tp2 = T(p2), tp3 = T(p3), tp4 = T(p4)

      // 设备块的小厚度（凸出前面板 3 个单位）
      const thick = 3
      const f2 = iso(CAB_WIDTH - 2, yStart, -thick)
      const f3 = iso(CAB_WIDTH - 2, yEnd, -thick)
      const f4 = iso(2, yEnd, -thick)
      const tf2 = T(f2), tf3 = T(f3), tf4 = T(f4)

      return {
        id: d.id,
        name: d.name,
        type: d.type,
        startU: d.startU,
        endU: d.endU,
        power_watts: d.power_watts,
        frontFace: `${tp1.x},${tp1.y} ${tp2.x},${tp2.y} ${tp3.x},${tp3.y} ${tp4.x},${tp4.y}`,
        topFace: `${tf4.x},${tf4.y} ${tf3.x},${tf3.y} ${tp3.x},${tp3.y} ${tp4.x},${tp4.y}`,
        rightFace: `${tp2.x},${tp2.y} ${tp3.x},${tp3.y} ${tf3.x},${tf3.y} ${tf2.x},${tf2.y}`,
        color,
        labelPos: { x: (tp1.x + tp2.x) / 2, y: (tp1.y + tp4.y) / 2 },
        height: yEnd - yStart,
      }
    })
  }, [cabinet.devices])

  // 计算 U 位标尺位置（沿前面左边缘）
  const uRuler = useMemo(() => {
    const offsetX = 80
    const offsetY = 60
    const marks: { u: number; x: number; y: number }[] = []
    // 每 5 U 一个标记
    for (let u = 1; u <= cabinet.totalU; u += 5) {
      const y = (u - 1) * U_HEIGHT
      const p = iso(0, y, 0)
      marks.push({
        u,
        x: p.sx + offsetX - 6,
        y: -p.sy + offsetY,
      })
    }
    // 末尾标记
    if (cabinet.totalU % 5 !== 0) {
      const y = cabinet.totalU * U_HEIGHT
      const p = iso(0, y, 0)
      marks.push({
        u: cabinet.totalU,
        x: p.sx + offsetX - 6,
        y: -p.sy + offsetY,
      })
    }
    return marks
  }, [cabinet.totalU])

  // SVG 视口尺寸
  const svgWidth = 280
  const svgHeight = 80 + cabinet.totalU * U_HEIGHT * 0.5 + 60  // 顶部留白 + 机柜等距高度 + 底部留白

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-gray-200 dark:border-edge-subtle bg-gray-50 dark:bg-app/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Box size={13} className="text-purple-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {cabinet.name} · 3D 等距视图
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-2xs text-gray-500 dark:text-gray-400">
              <span>{cabinet.devices.length} 台设备</span>
              <span className="font-medium text-orange-600 dark:text-orange-400">
                {(totalPower / 1000).toFixed(2)} kW
              </span>
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
                    <button
                      onClick={handleExportSvg}
                      className="block w-full text-left px-3 py-1 text-2xs hover:bg-gray-50 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300"
                    >
                      导出 SVG
                    </button>
                    <button
                      onClick={handleExportPng}
                      className="block w-full text-left px-3 py-1 text-2xs hover:bg-gray-50 dark:hover:bg-app-hover text-gray-700 dark:text-gray-300"
                    >
                      导出 PNG
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
          {/* 机柜 3D 框架：右侧面 → 顶面 → 前面（绘制顺序保证遮挡正确） */}
          <polygon
            points={frame.right.points}
            fill={frame.right.fill}
            stroke={frame.right.stroke}
            strokeWidth={frame.right.strokeWidth}
          />
          <polygon
            points={frame.top.points}
            fill={frame.top.fill}
            stroke={frame.top.stroke}
            strokeWidth={frame.top.strokeWidth}
          />
          <polygon
            points={frame.front.points}
            fill={frame.front.fill}
            stroke={frame.front.stroke}
            strokeWidth={frame.front.strokeWidth}
          />

          {/* U 位标尺 */}
          {uRuler.map((mark) => (
            <g key={mark.u}>
              <line
                x1={mark.x}
                y1={mark.y}
                x2={mark.x + 4}
                y2={mark.y}
                stroke="#9ca3af"
                strokeWidth={0.5}
              />
              <text
                x={mark.x - 2}
                y={mark.y + 2}
                fontSize={7}
                fill="#6b7280"
                textAnchor="end"
              >
                U{mark.u}
              </text>
            </g>
          ))}

          {/* 设备块 */}
          {deviceBlocks.map((block) => (
            <g key={block.id}>
              {/* 顶面（设备凸出部分） */}
              <polygon
                points={block.topFace}
                fill={block.color.fill}
                opacity={0.7}
                stroke={block.color.stroke}
                strokeWidth={0.5}
              />
              {/* 右侧面（设备凸出部分） */}
              <polygon
                points={block.rightFace}
                fill={block.color.stroke}
                opacity={0.5}
                stroke={block.color.stroke}
                strokeWidth={0.5}
              />
              {/* 前面板 */}
              <polygon
                points={block.frontFace}
                fill={block.color.fill}
                stroke={block.color.stroke}
                strokeWidth={0.8}
                opacity={0.9}
              >
                <title>{`${block.name}\nU${block.startU}-U${block.endU}\n${block.power_watts}W`}</title>
              </polygon>
              {/* 设备名（仅高度足够的设备显示） */}
              {block.height >= 6 && (
                <text
                  x={block.labelPos.x}
                  y={block.labelPos.y + 2}
                  fontSize={5}
                  fill="#fff"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  {block.name.length > 10 ? block.name.slice(0, 9) + '…' : block.name}
                </text>
              )}
            </g>
          ))}

          {/* 机柜底部标签 */}
          <text
            x={frame.points.b0.x + (frame.points.b1.x - frame.points.b0.x) / 2}
            y={frame.points.b0.y + 14}
            fontSize={8}
            fill="#6b7280"
            textAnchor="middle"
            fontWeight="bold"
          >
            {cabinet.name} · {cabinet.totalU}U
          </text>
        </svg>
      </div>
    </div>
  )
}
