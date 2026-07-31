/**
 * AutoLink V2.4 — react-flow 自定义拓扑节点组件
 * 提供 Server / Switch 两类节点的渲染，支持选中高亮与暗色模式
 */
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Server, Network } from 'lucide-react'
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
}

export const EDGE_COLORS: Record<string, string> = {
  param: '#3B82F6',
  storage: '#10B981',
  oob: '#6B7280',
  biz: '#8B5CF6',
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
  [key: string]: unknown
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
      className="relative flex items-center gap-1.5 px-2 py-1 rounded border-2 bg-white dark:bg-gray-700 shadow-sm transition-shadow"
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
      className="relative flex items-center gap-1.5 px-2 py-1 rounded border-2 bg-white dark:bg-gray-700 shadow-sm transition-shadow"
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
    </div>
  )
}

export const ServerNode = memo(ServerNodeComponent)
export const SwitchNode = memo(SwitchNodeComponent)

export const topologyNodeTypes = {
  server: ServerNode,
  switch: SwitchNode,
}
