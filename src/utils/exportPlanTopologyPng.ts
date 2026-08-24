/**
 * P1（V-AL4）：AIDC 规划整网拓扑 → PNG 评审材料（真实渲染截图，复用 exportTopologyView）。
 *
 * plan.deviceList/connections → TopologyNode/Edge（角色→节点类型）→ exportTopologyViewPng。
 */
import type { PlanSummary } from '@/components/aidc/aidcTypes'
import type { TopologyEdge, TopologyNode } from '@/stores/design.store'
import { exportTopologyViewPng } from './exportTopologyView'

/** AIDC 角色 → ECharts 节点类型（对应 TOPOLOGY_NODE_STYLES 分类） */
const ROLE_TYPE: Record<string, string> = {
  SPINE: 'param_spine', LEAF: 'param_leaf',
  STO_SPINE: 'storage_spine', STO_LEAF: 'storage_leaf',
  BIZ_AGG: 'biz_agg', BIZ_ACCESS: 'biz_access',
  OOB_AGG: 'oob_agg', OOB_ACCESS: 'oob_access',
}

export async function exportPlanTopologyPng(plan: PlanSummary): Promise<string> {
  const devices = plan.deviceList.filter((d) => d.name)
  const byName = new Map(devices.map((d) => [d.name!, d]))
  const byRole: Record<string, string[]> = {}
  for (const d of devices) {
    (byRole[d.role] ??= []).push(d.name!)
  }

  const nodes: TopologyNode[] = devices.map((d) => ({
    id: d.name!,
    type: ROLE_TYPE[d.role] ?? 'param_leaf',
    group: d.role,
    podid: d.rack != null ? `R${String(d.rack).padStart(2, '0')}` : '',
  }))

  // 接线 → 边（dst 角色名 → 真实设备轮询；与 PlanTopologyView 同语义）
  const edges: TopologyEdge[] = []
  const counters: Record<string, number> = {}
  for (const c of plan.connections) {
    let target = c.dst
    if (!byName.has(target)) {
      const pool = byRole[target]
      if (!pool || pool.length === 0) continue
      counters[target] = (counters[target] ?? 0) + 1
      target = pool[(counters[target] - 1) % pool.length]
    }
    if (!byName.has(c.src) || !byName.has(target)) continue
    edges.push({
      source: c.src,
      target,
      speed: c.rate ?? '',
      cableType: '',
      description: c.desc ?? '',
    })
  }

  return exportTopologyViewPng(nodes, edges)
}
