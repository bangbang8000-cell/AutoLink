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
  }

  // 交付包附带拓扑 PNG（失败不阻塞）
  let pngBase64: string | undefined
  try {
    const { exportPlanTopologyPng } = await import('./exportPlanTopologyPng')
    pngBase64 = await exportPlanTopologyPng(plan)
  } catch { /* 拓扑图生成失败不阻塞交付包 */ }

  const res = await window.electron.aidc.exportPlan(
    { ...params, ...(pngBase64 ? { pngBase64 } : {}) },
    'zip',
  )
  return res
}
