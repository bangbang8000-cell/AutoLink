/**
 * AIDC 规划交付工具（导出收敛 T1）
 *
 * - macroToInput：plan.macro(camelCase) → 后端输入(snake_case)，供导出/重放复用
 * - exportDeliveryZip：从项目已保存的 plan.json 直接导出「MC 交付包 ZIP」
 *   （含 plan.json + README + 可选拓扑图），供导出视图「导出 MC 交付包」使用。
 */
import type { PlanMacro, PlanSummary } from '@/components/aidc/aidcTypes'

/** 契约 v1.2（P1 A-4）：plan.macro(camelCase) → 输入 snake_case（重开回填完整宏观，含高级参数）。 */
export function macroToInput(m: Partial<PlanMacro> | Record<string, unknown>): Record<string, unknown> {
  const M = (m ?? {}) as Record<string, unknown>
  const naming = M.naming as PlanMacro['naming'] | undefined
  return {
    site: M.site,
    gpu_count: M.gpuCount,
    pfc_queue: M.pfcQueue,
    cnp_queue: M.cnpQueue,
    bgp_max_paths: M.bgpMaxPaths,
    convergence: M.convergence,
    rails: M.rails,
    naming_format: naming?.format,
    ip_segments: M.ipSegments,
    vlan_ranges: M.vlanRanges,
    as_range: M.asRange,
    ospf: M.ospf,
    device_models: M.deviceModels,
  }
}

export interface DeliveryExportResult {
  canceled?: boolean
  ok?: boolean
  path?: string
  error?: string
  /** 项目未生成 AIDC 规划（无 plan.json） */
  noPlan?: boolean
}

/**
 * 导出 MC 交付包 ZIP（读项目已保存 plan.json → plan:aidc:export zip）。
 * 无 plan 时返回 { noPlan: true }，调用方引导用户先去「AIDC 规划」生成。
 */
export async function exportDeliveryZip(projectName: string): Promise<DeliveryExportResult> {
  const loaded = (await window.electron.aidc.project.load(projectName)) as {
    error?: string
    plan?: PlanSummary | null
  }
  if (loaded.error) return { error: loaded.error }
  const plan = loaded.plan
  if (!plan) return { noPlan: true }

  const params: Record<string, unknown> = {
    project_id: plan.meta?.projectId,
    ...(plan.meta?.projectName ? { project_name: plan.meta.projectName } : {}),
    ...macroToInput(plan.macro),
    // M5: 透传 plan_version——交付包版本戳与项目一致（不再恒为 1）
    plan_version: plan.meta?.planVersion,
  }

  // 交付包附带拓扑 PNG（失败不阻塞）：设计拓扑优先（topology.json 渲染），缺失/失败回退 plan 渲染
  let pngBase64: string | undefined
  try {
    const { renderDeliveryTopologyPng, parseProjectTopology } = await import('./deliveryTopologyRenderer')
    const { exportPlanTopologyPng } = await import('./exportPlanTopologyPng')
    const rawTopology = await window.electron.project.getFile(projectName, 'topology.json')
    const projectTopology = rawTopology ? parseProjectTopology(rawTopology) : null
    pngBase64 = await renderDeliveryTopologyPng(projectTopology, plan, {
      // 设计渲染（exportTopologyView 依赖 DOM，惰性加载）；失败时由 renderDeliveryTopologyPng 回退 plan
      renderDesign: async (pt) => {
        const { exportTopologyViewPng } = await import('./exportTopologyView')
        return exportTopologyViewPng(pt.topology?.nodes ?? [], pt.topology?.edges ?? [], pt.layout ?? null)
      },
      renderPlan: (p) => exportPlanTopologyPng(p),
    })
  } catch { /* 拓扑图生成失败不阻塞交付包 */ }

  // M5: 设计级交付包——附带 topology.json / rack_layout.json（MC 可还原完整 AL 设计）
  const extraFiles: Record<string, string> = {}
  try {
    const topology = await window.electron.project.getFile(projectName, 'topology.json')
    if (topology) extraFiles['topology.json'] = topology
    const rackLayout = await window.electron.project.getFile(projectName, 'rack_layout.json')
    if (rackLayout) extraFiles['rack_layout.json'] = rackLayout
  } catch { /* 设计文件缺失不阻塞交付包 */ }

  const res = await window.electron.aidc.exportPlan(
    { ...params, ...(pngBase64 ? { pngBase64 } : {}), extraFiles },
    'zip',
  )
  return res
}
