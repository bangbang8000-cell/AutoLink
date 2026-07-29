/**
 * AutoLink V2.4.5 — POD 分组背景框节点（轻量细线样式）
 *
 * V2.4.5 改进：背景框改为轻量细虚线，减少视觉干扰
 * 服务器区整体形成矩形，POD 之间用细虚线分隔
 */
import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'

export interface PodGroupNodeData {
  podid: string
  podIndex: number
  serverCount: number
  accessCount: number
  leafCount: number
  width: number
  height: number
  fillColor: { fill: string; fillDark: string; border: string }
  [key: string]: unknown
}

/** POD 背景色配置 */
const POD_BG_COLORS = [
  { fill: 'rgba(59,130,246,0.04)', fillDark: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.25)' },
  { fill: 'rgba(16,185,129,0.04)', fillDark: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.25)' },
  { fill: 'rgba(139,92,246,0.04)', fillDark: 'rgba(139,92,246,0.06)', border: 'rgba(139,92,246,0.25)' },
  { fill: 'rgba(245,158,11,0.04)', fillDark: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.25)' },
  { fill: 'rgba(236,72,153,0.04)', fillDark: 'rgba(236,72,153,0.06)', border: 'rgba(236,72,153,0.25)' },
  { fill: 'rgba(14,165,233,0.04)', fillDark: 'rgba(14,165,233,0.06)', border: 'rgba(14,165,233,0.25)' },
  { fill: 'rgba(168,85,247,0.04)', fillDark: 'rgba(168,85,247,0.06)', border: 'rgba(168,85,247,0.25)' },
  { fill: 'rgba(34,197,94,0.04)', fillDark: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.25)' },
]

export function getPodColor(index: number) {
  return POD_BG_COLORS[index % POD_BG_COLORS.length]
}

/** 检测暗色模式 */
function useIsDark(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

function PodGroupNodeImpl({ data }: NodeProps) {
  const podData = data as unknown as PodGroupNodeData
  const isDark = useIsDark()
  const color = podData.fillColor || getPodColor(podData.podIndex || 0)

  // V2.4.5: 轻量细虚线样式
  const style: React.CSSProperties = {
    width: podData.width,
    height: podData.height,
    background: isDark ? color.fillDark : color.fill,
    border: `1px dashed ${color.border}`,
    borderRadius: 6,
  }

  // POD 标题
  const podLabel = podData.podid?.startsWith('pod-gpu-')
    ? `POD ${podData.podid.replace('pod-gpu-', '')}`
    : podData.podid?.startsWith('pod-storage-')
      ? `存储POD ${podData.podid.replace('pod-storage-', '')}`
      : podData.podid?.startsWith('pod-')
        ? `POD ${podData.podid.replace('pod-', '')}`
        : podData.podid || 'POD'

  return (
    <div style={style} className="flex flex-col">
      {/* POD 标题栏 */}
      <div
        className="flex items-center justify-between px-2 py-0.5 text-[10px] font-medium select-none"
        style={{ color: color.border.replace('0.25', '0.75') }}
      >
        <span className="truncate">{podLabel}</span>
        <span className="text-[9px] opacity-60 shrink-0 ml-1">
          {podData.serverCount > 0 && `${podData.serverCount}台`}
        </span>
      </div>
    </div>
  )
}

export const PodGroupNode = memo(PodGroupNodeImpl)
