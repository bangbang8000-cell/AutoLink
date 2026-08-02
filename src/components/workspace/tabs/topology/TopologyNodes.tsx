/**
 * AutoLink V2.4 — react-flow 自定义拓扑节点组件
 * 提供 Server / Switch / GPU 三类节点的渲染，支持选中高亮与暗色模式
 * V2.7.6-T5: 新增 GPU/NPU 节点类型用于 Scale-Up 双栈联合视图
 */
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { Server, Network, Cpu } from 'lucide-react'
import {
  TOPOLOGY_NODE_STYLES,
  TOPOLOGY_NODE_DEFAULT_COLOR,
} from '@/constants/topology-colors'

/* ---------- 节点颜色 / 标签常量 ---------- */

// U5: 节点颜色统一引用 @/constants/topology-colors,保留导出名 NODE_COLORS
export const NODE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(TOPOLOGY_NODE_STYLES).map(([type, style]) => [type, style.color]),
)

export const NODE_LABELS: Record<string, string> = {
  server: '服务器',
  param_leaf: '参数Leaf',
  param_spine: '参数Spine',
  param_core: '参数Core',
  storage_leaf: '存储Leaf',
  storage_spine: '存储Spine',
  storage_core: '存储Core',
  oob_access: 'OOB接入',
  oob_agg: 'OOB汇聚',
  biz_access: '业务接入',
  biz_agg: '业务汇聚',
  // V2.7.6-T5: Scale-Up 双栈联合视图 GPU 节点
  gpu: 'GPU/NPU',
  // V2.9.3-T4: Scale-Up 生成层 GPU 节点
  scaleup_gpu: 'Scale-Up GPU',
}

export const EDGE_COLORS: Record<string, string> = {
  param: '#3B82F6',
  storage: '#10B981',
  oob: '#6B7280',
  biz: '#8B5CF6',
  // V2.7.6-T5: Scale-Up 双栈联合视图
  scale_up: '#F59E0B',
}

/* ---------- 节点数据接口 ---------- */

export interface TopologyNodeData {
  label: string
  nodeType: string
  group?: string
  podid?: string
  cabinetName?: string
  cabinetId?: number
  startU?: number
  endU?: number
  powerWatts?: number
  connectionCount?: number
  // v2.8.2-T1: hover 悬浮卡片可见标记(由 TopologyTab 控制)
  hovered?: boolean
  [key: string]: unknown
}

/**
 * v2.8.2-T1: 节点 hover 悬浮卡片(NodeToolbar 自动跟随节点位置,随画布缩放/平移)
 * 仅当 d.hovered 为 true 时显示;内容与"节点详情"面板一致
 */
export function NodeHoverCard({ d }: { d: TopologyNodeData }) {
  const { t } = useTranslation('topology')
  return (
    <NodeToolbar
      isVisible={!!d.hovered}
      position={Position.Top}
      offset={10}
      className="!rounded-lg !shadow-lg !bg-white dark:!bg-app-surface !border !border-gray-200 dark:!border-edge-subtle"
    >
      <div className="min-w-[210px] max-w-[280px] p-3 text-2xs">
        <div className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100 mb-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: NODE_COLORS[d.nodeType] || '#9ca3af' }} />
          <span className="truncate">{d.label}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-gray-500 dark:text-gray-400">
          <span>{t('type')}</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{NODE_LABELS[d.nodeType] || d.nodeType}</span>
          {d.group ? (
            <>
              <span>{t('group')}</span><span className="font-medium text-gray-700 dark:text-gray-300">{d.group}</span>
            </>
          ) : null}
          {d.podid ? (
            <>
              <span>{t('pod')}</span><span className="font-medium text-gray-700 dark:text-gray-300">{d.podid}</span>
            </>
          ) : null}
          {d.cabinetName ? (
            <>
              <span>{t('cabinet')}</span><span className="font-medium text-gray-700 dark:text-gray-300">{d.cabinetName}</span>
            </>
          ) : null}
          {d.startU !== undefined ? (
            <>
              <span>{t('uPosition')}</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {d.startU}{d.endU !== undefined ? ` - ${d.endU}` : ''}
              </span>
            </>
          ) : null}
          {d.powerWatts !== undefined ? (
            <>
              <span>{t('power')}</span><span className="font-medium text-gray-700 dark:text-gray-300">{d.powerWatts}W</span>
            </>
          ) : null}
          <span>{t('connectionsCount')}</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{d.connectionCount ?? 0}</span>
        </div>
      </div>
    </NodeToolbar>
  )
}

/* ---------- 服务器节点 ----------
 * V2.4.3: Handle 上下分开
 *   - 顶部 "up" Handle：接 Access/OOB（业务/带外接入交换机，在服务器上方）
 *   - 底部 "down" Handle：接 Leaf（参数/存储 Leaf，在服务器下方）
 */

function ServerNodeComponent({ data, selected }: NodeProps) {
  const d = data as TopologyNodeData
  const color = NODE_COLORS[d.nodeType] || TOPOLOGY_NODE_DEFAULT_COLOR
  return (
    <div
      className="relative flex items-center gap-1.5 px-2 py-1 rounded border-2 bg-white dark:bg-app-elevated shadow-sm transition-shadow"
      style={{
        borderColor: selected ? '#f59e0b' : color,
        boxShadow: selected ? '0 0 0 2px rgba(245,158,11,0.3)' : undefined,
        minWidth: 90,
        maxWidth: 160,
      }}
    >
      <Handle id="up" type="target" position={Position.Top} style={{ background: color, width: 6, height: 6 }} />
      <Handle id="left" type="target" position={Position.Left} style={{ background: color, width: 5, height: 5 }} />
      <Server size={11} className="shrink-0" style={{ color }} />
      <div className="flex flex-col min-w-0">
        <span className="text-3xs font-medium text-gray-700 dark:text-gray-200 truncate leading-tight">
          {d.label}
        </span>
        {(d.cabinetName || d.startU !== undefined) && (
          <span className="text-3xs text-gray-400 dark:text-gray-500 leading-tight">
            {d.cabinetName || ''}{d.startU !== undefined ? ` U${d.startU}` : ''}
          </span>
        )}
      </div>
      <Handle id="right" type="source" position={Position.Right} style={{ background: color, width: 5, height: 5 }} />
      <Handle id="down" type="source" position={Position.Bottom} style={{ background: color, width: 6, height: 6 }} />
      {/* v2.8.2-T1: hover 悬浮卡片 */}
      <NodeHoverCard d={d} />
    </div>
  )
}

/* ---------- 交换机节点 ----------
 * V2.4.3: Handle 上下分开
 *   - 顶部 "up" Handle：接上层交换机（如 Spine 接 Leaf 的上方，或 Agg 接 Access 的上方）
 *   - 底部 "down" Handle：接下层设备（如 Leaf 接服务器的下方，或 Access 接服务器的下方）
 */

function SwitchNodeComponent({ data, selected }: NodeProps) {
  const d = data as TopologyNodeData
  const color = NODE_COLORS[d.nodeType] || TOPOLOGY_NODE_DEFAULT_COLOR
  return (
    <div
      className="relative flex items-center gap-1.5 px-2 py-1 rounded border-2 bg-white dark:bg-app-elevated shadow-sm transition-shadow"
      style={{
        borderColor: selected ? '#f59e0b' : color,
        boxShadow: selected ? '0 0 0 2px rgba(245,158,11,0.3)' : undefined,
        minWidth: 80,
        maxWidth: 140,
      }}
    >
      <Handle id="up" type="target" position={Position.Top} style={{ background: color, width: 6, height: 6 }} />
      <Handle id="left" type="target" position={Position.Left} style={{ background: color, width: 5, height: 5 }} />
      <Network size={11} className="shrink-0" style={{ color }} />
      <div className="flex flex-col min-w-0">
        <span className="text-3xs font-medium text-gray-700 dark:text-gray-200 truncate leading-tight">
          {d.label}
        </span>
        <span className="text-3xs text-gray-400 dark:text-gray-500 leading-tight">
          {NODE_LABELS[d.nodeType] || d.nodeType}
        </span>
      </div>
      <Handle id="right" type="source" position={Position.Right} style={{ background: color, width: 5, height: 5 }} />
      <Handle id="down" type="source" position={Position.Bottom} style={{ background: color, width: 6, height: 6 }} />
      {/* v2.8.2-T1: hover 悬浮卡片 */}
      <NodeHoverCard d={d} />
    </div>
  )
}

export const ServerNode = memo(ServerNodeComponent)
export const SwitchNode = memo(SwitchNodeComponent)

/* ---------- GPU/NPU 节点 ----------
 * V2.7.6-T5: Scale-Up 双栈联合视图专用 GPU/NPU 节点
 *   - 用于显示 Scale-Up 域内的 GPU/NPU 节点
 *   - 全四方向 Handle 支持全对等 (Full-Mesh) 互联
 *   - 使用琥珀色 (amber) 边框以区别于普通服务器
 */

function GpuNodeComponent({ data, selected }: NodeProps) {
  const d = data as TopologyNodeData
  // GPU 节点使用 scale_up 网络色 (琥珀色)
  const color = EDGE_COLORS.scale_up || TOPOLOGY_NODE_DEFAULT_COLOR
  return (
    <div
      className="relative flex items-center gap-1.5 px-2 py-1 rounded border-2 bg-white dark:bg-app-elevated shadow-sm transition-shadow"
      style={{
        borderColor: selected ? '#f59e0b' : color,
        boxShadow: selected ? '0 0 0 2px rgba(245,158,11,0.3)' : undefined,
        minWidth: 70,
        maxWidth: 120,
      }}
    >
      <Handle id="up" type="target" position={Position.Top} style={{ background: color, width: 6, height: 6 }} />
      <Handle id="left" type="target" position={Position.Left} style={{ background: color, width: 5, height: 5 }} />
      <Cpu size={11} className="shrink-0" style={{ color }} />
      <div className="flex flex-col min-w-0">
        <span className="text-3xs font-medium text-gray-700 dark:text-gray-200 truncate leading-tight">
          {d.label}
        </span>
        <span className="text-3xs text-gray-400 dark:text-gray-500 leading-tight">
          {NODE_LABELS[d.nodeType] || NODE_LABELS.gpu || 'GPU/NPU'}
        </span>
      </div>
      <Handle id="right" type="source" position={Position.Right} style={{ background: color, width: 5, height: 5 }} />
      <Handle id="down" type="source" position={Position.Bottom} style={{ background: color, width: 6, height: 6 }} />
      {/* v2.8.2-T1: hover 悬浮卡片 */}
      <NodeHoverCard d={d} />
    </div>
  )
}

export const GpuNode = memo(GpuNodeComponent)

export const topologyNodeTypes = {
  server: ServerNode,
  switch: SwitchNode,
  gpu: GpuNode,
}
