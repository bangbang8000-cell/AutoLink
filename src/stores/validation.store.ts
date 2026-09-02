/**
 * 4.5 数据准确性与校验体系（AL 4.5.0，F5-5 校验 store）
 *
 * 校验面板状态：收集当前项目数据（plan:table / 设计快照 / 输出批次），
 * 调用 validateProject 一键校验，产出结构化校验报告（问题按严重度/类别分组）。
 */
import { create } from 'zustand'
import { useProjectStore } from '@/stores/project.store'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { serializeDesignState } from '@/utils/designSnapshot'
import { validateProject, type ValidationReport } from '@/utils/validationReport'

interface ValidationState {
  /** 最近一次校验报告（null=未执行） */
  report: ValidationReport | null
  running: boolean
  error: string | null
  lastRunAt: string | null
  /** 一键校验当前项目（T1 一致性 / T2 导出核对 / T3 IP 规划） */
  runValidation: () => Promise<ValidationReport | null>
  reset: () => void
}

async function loadPlan(projectName: string): Promise<unknown> {
  try {
    const res = (await window.electron?.aidc?.project?.load?.(projectName)) as
      | { plan?: unknown }
      | undefined
    return res?.plan ?? null
  } catch {
    return null
  }
}

async function loadBatches(projectName: string): Promise<unknown[]> {
  try {
    return (await window.electron?.project?.listOutputBatches?.(projectName)) ?? []
  } catch {
    return []
  }
}

export const useValidationStore = create<ValidationState>()((set) => ({
  report: null,
  running: false,
  error: null,
  lastRunAt: null,

  runValidation: async () => {
    const projectName = useProjectStore.getState().selectedProjectName
    if (!projectName) {
      set({ error: '请先选择项目', report: null, running: false })
      return null
    }
    set({ running: true, error: null })
    try {
      const [plan, batches] = await Promise.all([
        loadPlan(projectName),
        loadBatches(projectName),
      ])
      const design = serializeDesignState(useRoomStore.getState(), useRackStore.getState())
      const report = validateProject({ projectName, plan: plan as never, design, batches: batches as never })
      set({
        report,
        running: false,
        lastRunAt: new Date().toISOString(),
      })
      return report
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      set({ running: false, error: message })
      return null
    }
  },

  reset: () => set({ report: null, running: false, error: null, lastRunAt: null }),
}))
