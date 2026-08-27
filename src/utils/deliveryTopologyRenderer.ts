/**
 * AL-P2：交付包「拓扑图.png」渲染源选择（设计优先、plan 兜底）。
 *
 * - parseProjectTopology：topology.json 字符串 → 结构化对象（非法 JSON 返回 null，触发 plan 兜底）。
 * - pickDeliveryTopologyRenderer：有设计拓扑（topology.json 的 nodes 非空）→ 'design'，缺失/为空 → 'plan'。
 * - renderDeliveryTopologyPng：薄壳——design 渲染失败自动回退 plan；渲染器由调用方注入，便于单测（不依赖 DOM）。
 */
import type { PlanSummary } from '@/components/aidc/aidcTypes'
import type { TopologyEdge, TopologyLayout, TopologyNode } from '@/stores/design.store'

/** 项目 topology.json 结构（与 design.store 落盘/读取一致） */
export interface ProjectTopologyJson {
  topology?: { nodes?: TopologyNode[]; edges?: TopologyEdge[] } | null
  layout?: TopologyLayout | null
}

export type DeliveryTopologySource = 'design' | 'plan'

/** 解析 topology.json 字符串 → 结构化对象；非法 JSON 返回 null（触发 plan 兜底） */
export function parseProjectTopology(jsonStr: string): ProjectTopologyJson | null {
  try {
    const data = JSON.parse(jsonStr) as ProjectTopologyJson
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

/** 渲染源选择：设计拓扑存在（nodes 非空）→ 'design'，否则 'plan' 兜底 */
export function pickDeliveryTopologyRenderer(
  projectTopology: ProjectTopologyJson | null | undefined,
  _plan: PlanSummary,
): DeliveryTopologySource {
  const nodes = projectTopology?.topology?.nodes
  return nodes && nodes.length > 0 ? 'design' : 'plan'
}

export interface DeliveryTopologyRenderers {
  renderDesign: (projectTopology: ProjectTopologyJson) => Promise<string>
  renderPlan: (plan: PlanSummary) => Promise<string>
}

/** 渲染薄壳：design 优先；design 缺失或渲染失败 → plan 兜底（不抛错） */
export async function renderDeliveryTopologyPng(
  projectTopology: ProjectTopologyJson | null | undefined,
  plan: PlanSummary,
  renderers: DeliveryTopologyRenderers,
): Promise<string> {
  if (pickDeliveryTopologyRenderer(projectTopology, plan) === 'design' && projectTopology) {
    try {
      return await renderers.renderDesign(projectTopology)
    } catch {
      // 设计渲染失败 → plan 兜底
    }
  }
  return renderers.renderPlan(plan)
}