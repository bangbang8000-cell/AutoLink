/**
 * 5.2.1-521-b/c/d：工作台状态 store
 * - aidcDone：AIDC 规划手动完成标记（D5）
 * - stale：级联失效置"待调整"的子视图集合（downstreamOf 落 store，按项目隔离）
 * - 变更指纹检测：designConfig/planHash 变化 → 返回 true（调用方据此触发下游失效）
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { downstreamOf } from '@/utils/workbenchState'
import type { WorkbenchSubview } from '@/stores/ui.store'

interface WorkbenchStoreState {
  /** 按项目名记录 AIDC 规划手动完成标记（true=已"标记完成"） */
  aidcDone: Record<string, boolean>
  /** 按项目名记录被级联失效置为"待调整"的子视图 */
  stale: Record<string, WorkbenchSubview[]>
  /** 按项目名记录最近一次设计配置指纹（变更检测） */
  configFingerprint: Record<string, string>
  /** 按项目名记录最近一次 plan hash（变更检测） */
  planHash: Record<string, string>

  markAidcDone: (project: string) => void
  unmarkAidcDone: (project: string) => void
  /** 某子视图变更 → 其全部下游置"待调整"（与既有 stale 合并去重） */
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
      aidcDone: {},
      stale: {},
      configFingerprint: {},
      planHash: {},

      markAidcDone: (project) =>
        set((s) => ({ aidcDone: { ...s.aidcDone, [project]: true } })),

      unmarkAidcDone: (project) =>
        set((s) => {
          const aidcDone = { ...s.aidcDone }
          delete aidcDone[project]
          return { aidcDone }
        }),

      invalidateDownstream: (project, changed) =>
        set((s) => {
          const affected = downstreamOf(changed)
          const current = s.stale[project] ?? []
          const merged = [...new Set([...current, ...affected])]
          return { stale: { ...s.stale, [project]: merged } }
        }),

      resolveStale: (project, subviews) =>
        set((s) => {
          const current = s.stale[project] ?? []
          const next = current.filter((v) => !subviews.includes(v))
          return { stale: { ...s.stale, [project]: next } }
        }),

      resolveAllStale: (project) =>
        set((s) => {
          const stale = { ...s.stale }
          delete stale[project]
          return { stale }
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
        aidcDone: state.aidcDone,
        stale: state.stale,
        configFingerprint: state.configFingerprint,
        planHash: state.planHash,
      }),
    },
  ),
)
