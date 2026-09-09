/**
 * 5.2.1-521-a/c：工作台状态机核心纯逻辑
 * - WORKBENCH_DEPENDENCIES：子视图声明式依赖图（前置条件），单一事实源
 * - downstreamOf：变更指纹触发级联失效的传递闭包（下游置"待调整"）
 * - deriveWorkbenchState：状态推导（needs_update/in_progress/done/pending）
 * - fingerprintConfig：设计配置变更指纹（canonical 序列化 + 确定性哈希）
 */
import type { WorkbenchSubview } from '@/stores/ui.store'

export type WorkbenchStatus = 'pending' | 'in_progress' | 'needs_update' | 'done'

/** 依赖图：每个子视图的直接前置条件（单向边，无环） */
export const WORKBENCH_DEPENDENCIES: Record<WorkbenchSubview, WorkbenchSubview[]> = {
  aidc: [],
  design: ['aidc'],
  roomdesign: ['aidc'],
  rackdesign: ['roomdesign', 'aidc'],
  main: ['design', 'roomdesign', 'rackdesign'],
  visualization: ['design'],
  results: ['main'],
  export: ['main'],
  docs: [],
  knowledge: [],
}

/** 变更指纹：某子视图变更后，其全部下游（传递闭包）应置"待调整" */
export function downstreamOf(changed: WorkbenchSubview[]): WorkbenchSubview[] {
  const affected = new Set<WorkbenchSubview>()
  const queue = [...changed]
  while (queue.length) {
    const cur = queue.shift()!
    for (const [v, deps] of Object.entries(WORKBENCH_DEPENDENCIES) as [WorkbenchSubview, WorkbenchSubview[]][]) {
      if (deps.includes(cur) && !affected.has(v)) {
        affected.add(v)
        queue.push(v)
      }
    }
  }
  return [...affected]
}

export interface WorkbenchStateDeps {
  /** design.store.valid：组网设计是否生成并通过校验（null=未生成） */
  designValid: boolean | null
  /** room.store.matrix.finalized：机房矩阵是否已定稿 */
  roomMatrixFinalized: boolean
  /** rack.store.cabinets.length > 0：是否已有柜 */
  rackHasCabinets: boolean
  /** listOutputBatches 非空：是否存在输出批次 */
  hasOutputBatches: boolean
  /** render.store.selectedOutputTypes 非空：是否已勾选输出类型 */
  hasSelectedOutputTypes: boolean
  /** 当前 active 子视图（ui.store.workbenchSubview）；不参与判断时传 null */
  activeSubview: WorkbenchSubview | null
  /** 可选读取中标记（如 design generating / render rendering） */
  reading?: boolean
  /** 级联失效集合：被上游变更置为"待调整"的子视图 */
  stale?: WorkbenchSubview[]
  /** AIDC 规划是否已手动标记完成（D5） */
  aidcDone?: boolean
}

/** 状态推导：reading > stale > active > done > pending */
export function deriveWorkbenchState(subview: WorkbenchSubview, deps: WorkbenchStateDeps): WorkbenchStatus {
  if (deps.reading) return 'in_progress'
  if (deps.stale?.includes(subview)) return 'needs_update'
  if (subview === deps.activeSubview) return 'in_progress'
  return isDone(subview, deps) ? 'done' : 'pending'
}

function isDone(subview: WorkbenchSubview, deps: WorkbenchStateDeps): boolean {
  switch (subview) {
    case 'aidc':
      return deps.aidcDone === true
    case 'design':
      return deps.designValid === true
    case 'roomdesign':
      return deps.roomMatrixFinalized
    case 'rackdesign':
      return deps.roomMatrixFinalized && deps.rackHasCabinets
    case 'main':
      return deps.designValid === true && deps.hasSelectedOutputTypes
    case 'visualization':
      return deps.designValid === true
    case 'results':
    case 'export':
      return deps.hasOutputBatches
    default:
      return false
  }
}

/** 配置变更指纹：canonical（键排序）序列化 + FNV-1a 确定性哈希 */
export function fingerprintConfig(config: Record<string, unknown>): string {
  const canonical = JSON.stringify(sortKeys(config))
  let h = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16)
}

export interface RenderGateDeps {
  designValid: boolean | null
  hasTopology: boolean
  stale?: WorkbenchSubview[]
}

/** 渲染门禁（521-f 收敛）：组网设计就绪（valid 或有拓扑）且 design/main 链路未被级联失效 */
export function renderGateReady(deps: RenderGateDeps): boolean {
  const designReady = deps.designValid === true || deps.hasTopology
  if (!designReady) return false
  const s = deps.stale ?? []
  return !s.includes('design') && !s.includes('main')
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}
