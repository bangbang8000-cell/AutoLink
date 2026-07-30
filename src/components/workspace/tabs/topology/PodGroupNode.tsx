/**
 * AutoLink V2.4.5 — POD 分组背景框节点（轻量细线样式）
 *
 * V2.4.5 改进：背景框改为轻量细虚线，减少视觉干扰
 * V2.4.7 改进：支持折叠/展开，折叠时仅显示标题栏
 * 服务器区整体形成矩形，POD 之间用细虚线分隔
 */
import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export interface PodGroupNodeData {
  podid: string
  podIndex: number
  serverCount: number
  accessCount: number
  leafCount: number
  width: number
  height: number
  fillColor: { fill: string; fillDark: string; border: string }
  collapsed?: boolean
  onToggleCollapse?: (podid: string) => void
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
  const collapsed = podData.collapsed || false

  // V2.4.5: 轻量细虚线样式；V2.4.7: 折叠时高度自适应
  const style: React.CSSProperties = {
    width: podData.width,
    height: collapsed ? 'auto' : podData.height,
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
        <div className="flex items-center gap-0.5 min-w-0">
          {/* V2.4.7: 折叠/展开按钮 */}
          {podData.onToggleCollapse && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                podData.onToggleCollapse!(podData.podid)
              }}
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0"
              title={collapsed ? '展开 POD' : '折叠 POD'}
            >
              {collapsed
                ? <ChevronRight size={10} />
                : <ChevronDown size={10} />
              }
            </button>
          )}
          <span className="truncate">{podLabel}</span>
        </div>
        <span className="text-[9px] opacity-60 shrink-0 ml-1">
          {podData.serverCount > 0 && `${podData.serverCount}台`}
        </span>
      </div>
      {/* V2.4.7: 折叠时显示摘要 */}
      {collapsed && (
        <div className="px-2 py-1 text-[9px] opacity-50 italic">
          已折叠 · {podData.serverCount}服务器 / {podData.accessCount + podData.leafCount}交换机
        </div>
      )}
    </div>
  )
}

export const PodGroupNode = memo(PodGroupNodeImpl)
