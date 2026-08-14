/**
 * D-9（H3）：plan:table → 整网拓扑图（react-flow Node/Edge）适配器。
 *
 * 逐设备节点 + 真实接线（作为准确性参照：设备数/接线/端口与 plan 一致）。
 * 兼容 TopologyNodes（SwitchNode）渲染；供 PlanTopologyView 使用。
 */
import type { Edge, Node } from '@xyflow/react'
import type { PlanSummary } from '@/components/aidc/aidcTypes'

// 角色 → 层级提示（TopologyTab 同款语义）
export const ROLE_LAYER: Record<string, string> = {
  SPINE: 'spine', LEAF: 'leaf', STO_SPINE: 'spine', STO_LEAF: 'leaf',
  BIZ_AGG: 'agg', BIZ_ACCESS: 'access', OOB_AGG: 'agg', OOB_ACCESS: 'access',
}

// 角色 → 网络域分组
export const ROLE_GROUP: Record<string, string> = {
  SPINE: '参数网', LEAF: '参数网', STO_SPINE: '存储网', STO_LEAF: '存储网',
  BIZ_AGG: '业务网', BIZ_ACCESS: '业务网', OOB_AGG: '带外网', OOB_ACCESS: '带外网',
}

const LAYER_ORDER = ['spine', 'leaf', 'agg', 'access', 'server']

export function planToTopology(plan: PlanSummary): { nodes: Node[]; edges: Edge[] } {
  const devices = plan.deviceList.filter((d) => d.name)
  const byName = new Map(devices.map((d) => [d.name!, d]))
  // 角色 → 设备 id 列表（接线 dst 为角色名时轮询到真实设备）
  const byRole: Record<string, string[]> = {}
  for (const d of devices) {
    (byRole[d.role] ??= []).push(d.name!)
  }

  // 逐设备节点
  const nodes: Node[] = devices.map((d) => ({
    id: d.name!,
    type: 'switch',
    position: { x: 0, y: 0 },
    data: {
      label: d.name,
      nodeType: 'switch',
      group: ROLE_GROUP[d.role] ?? '其他',
      podid: d.rack != null ? `R${String(d.rack).padStart(2, '0')}` : '',
      layerHint: ROLE_LAYER[d.role] ?? 'access',
      maxPorts: 128,
      hostname: d.name,
      model: d.model,
      asn: d.asn,
      gatewayCount: d.gateways?.length ?? 0,
    },
  }))

  // 接线 → 边（dst 角色名 → 真实设备轮询；保持每链路独立 = 准确性）
  const edges: Edge[] = []
  const counters: Record<string, number> = {}
  for (const c of plan.connections) {
    const src = c.src
    let target = c.dst
    if (!byName.has(target)) {
      // dst 为角色名 → 轮询该角色设备
      const pool = byRole[target]
      if (!pool || pool.length === 0) continue
      counters[target] = (counters[target] ?? 0) + 1
      target = pool[(counters[target] - 1) % pool.length]
    }
    if (!byName.has(src) || !byName.has(target)) continue
    edges.push({
      id: `e-${src}-${c.src_port}-${edges.length}`,
      source: src,
      target,
      sourceHandle: c.src_port,
      targetHandle: c.src_port,
      type: 'default',
      label: `${c.rate ?? ''} ${c.src_port}`,
      data: { networkType: ROLE_GROUP[byName.get(src)?.role ?? ''] ?? '参数网' },
    })
  }

  // 简易分层布局：按网络域分列，域内按层分行
  const groupIndex: Record<string, number> = {}
  const layerOffset: Record<string, Record<string, number>> = {}
  const groupW = 360
  const layerH = 120
  for (const n of nodes) {
    const g = n.data.group as string
    const layer = (n.data.layerHint as string) ?? 'access'
    if (groupIndex[g] === undefined) groupIndex[g] = Object.keys(groupIndex).length
    layerOffset[g] ??= {}
    const li = layerOffset[g][layer] ?? 0
    layerOffset[g][layer] = li + 1
    const gi = groupIndex[g]
    n.position = {
      x: gi * groupW + 40,
      y: (LAYER_ORDER.indexOf(layer) >= 0 ? LAYER_ORDER.indexOf(layer) : 4) * layerH + li * 90,
    }
  }

  return { nodes, edges }
}
