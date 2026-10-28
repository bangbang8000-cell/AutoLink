/**
 * 5.5.2 / A12：工作台完成状态机（单一真值源）
 * - stepDone：按项目 + 子视图记录完成标记与失效来源（唯一完成判据）
 * - stale：级联失效置"待调整"的子视图集合（downstreamOf 落 store，按项目隔离）
 * - 变更指纹检测：designConfig/planHash 变化 → 返回 true（调用方据此触发下游失效）
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { downstreamOf } from '@/utils/workbenchState'
import type { WorkbenchSubview } from '@/stores/ui.store'

/** 单个子视图的完成记录 */
export interface StepDoneRecord {
  done: boolean
  /** ISO 时间戳 */
  doneAt: string
  /** 上游变更来源（子视图 id）；存在即表示"待重新确认" */
  invalidatedBy?: string
}

type ProjectSteps = Partial<Record<WorkbenchSubview, StepDoneRecord>>
type DoneMap = Record<string, ProjectSteps>

interface WorkbenchStoreState {
  /** 按项目名 + 子视图记录完成状态（唯一真值源） */
  stepDone: DoneMap
  /** 按项目名记录被级联失效置为"待调整"的子视图 */
  stale: Record<string, WorkbenchSubview[]>
  /** 按项目名记录最近一次设计配置指纹（变更检测） */
  configFingerprint: Record<string, string>
  /** 按项目名记录最近一次 plan hash（变更检测） */
  planHash: Record<string, string>

  /** 标记某步完成（清空其失效来源与 stale 标记） */
  markStepDone: (project: string, subview: WorkbenchSubview) => void
  /** 撤销某步完成标记 */
  unmarkStepDone: (project: string, subview: WorkbenchSubview) => void
  getStepDone: (project: string, subview: WorkbenchSubview) => StepDoneRecord | undefined
  /** 某子视图变更 → 其全部下游置"待调整"（与既有 stale 合并去重，并给已完成步骤写 invalidatedBy） */
  invalidateDownstream: (project: string, changed: WorkbenchSubview[]) => void
  /** 重跑依赖链后清除指定子视图的待调整标记 */
  resolveStale: (project: string, subviews: WorkbenchSubview[]) => void
  /** 一键重跑依赖链：清除该项目全部"待调整"标记 */
  resolveAllStale: (project: string) => void
  getStale: (project: string) => WorkbenchSubview[]
  /** 记录指纹并检测是否较上次变化（首次记录返回 false） */
  detectConfigChange: (project: string, fingerprint: string) => boolean
  detectPlanChange: (project: string, hash: string) => boolean
}

export const useWorkbenchStore = create<WorkbenchStoreState>()(
  persist(
    (set, get) => ({
      stepDone: {},
      stale: {},
      configFingerprint: {},
      planHash: {},

      markStepDone: (project, subview) =>
        set((s) => {
          const projectSteps = s.stepDone[project] ?? {}
          const stale = s.stale[project] ?? []
          return {
            stepDone: {
              ...s.stepDone,
              [project]: {
                ...projectSteps,
                [subview]: { done: true, doneAt: new Date().toISOString() },
              },
            },
            stale: { ...s.stale, [project]: stale.filter((v) => v !== subview) },
          }
        }),

      unmarkStepDone: (project, subview) =>
        set((s) => {
          const projectSteps = { ...(s.stepDone[project] ?? {}) }
          delete projectSteps[subview]
          return { stepDone: { ...s.stepDone, [project]: projectSteps } }
        }),

      getStepDone: (project, subview) => get().stepDone[project]?.[subview],

      invalidateDownstream: (project, changed) =>
        set((s) => {
          const affected = downstreamOf(changed)
          const current = s.stale[project] ?? []
          const merged = [...new Set([...current, ...affected])]
          const projectSteps = { ...(s.stepDone[project] ?? {}) }
          for (const v of affected) {
            const rec = projectSteps[v]
            if (rec?.done) {
              projectSteps[v] = { ...rec, invalidatedBy: changed[0] }
            }
          }
          return {
            stale: { ...s.stale, [project]: merged },
            stepDone: { ...s.stepDone, [project]: projectSteps },
          }
        }),

      resolveStale: (project, subviews) =>
        set((s) => {
          const current = s.stale[project] ?? []
          const next = current.filter((v) => !subviews.includes(v))
          const projectSteps = { ...(s.stepDone[project] ?? {}) }
          for (const v of subviews) {
            const rec = projectSteps[v]
            if (rec?.invalidatedBy) {
              projectSteps[v] = { done: rec.done, doneAt: rec.doneAt }
            }
          }
          return {
            stale: { ...s.stale, [project]: next },
            stepDone: { ...s.stepDone, [project]: projectSteps },
          }
        }),

      resolveAllStale: (project) =>
        set((s) => {
          const stale = { ...s.stale }
          delete stale[project]
          const projectSteps = { ...(s.stepDone[project] ?? {}) }
          for (const [v, rec] of Object.entries(projectSteps) as [WorkbenchSubview, StepDoneRecord][]) {
            if (rec.invalidatedBy) projectSteps[v] = { done: rec.done, doneAt: rec.doneAt }
          }
          return { stale, stepDone: { ...s.stepDone, [project]: projectSteps } }
        }),

      getStale: (project) => get().stale[project] ?? [],

      detectConfigChange: (project, fingerprint) => {
        const prev = get().configFingerprint[project]
        if (prev === fingerprint) return false
        set((s) => ({ configFingerprint: { ...s.configFingerprint, [project]: fingerprint } }))
        return prev !== undefined
      },

      detectPlanChange: (project, hash) => {
        const prev = get().planHash[project]
        if (prev === hash) return false
        set((s) => ({ planHash: { ...s.planHash, [project]: hash } }))
        return prev !== undefined
      },
    }),
    {
      name: 'autolink-workbench-state',
      partialize: (state) => ({
        stepDone: state.stepDone,
        stale: state.stale,
        configFingerprint: state.configFingerprint,
        planHash: state.planHash,
      }),
    },
  ),
)
