/**
 * 4.4 F4-3（测试计划 E-3）：一键管线状态（zustand）
 *
 * 编排「规划(AIDC)→设计(机房/机柜)→渲染→导出」：状态机 + 步骤进度 + 可中断/重试 + 模板批处理。
 * 执行器全部走既有 IPC/后端编排（plan/design.generate/render.exportConnections/exportDeliveryZip），
 * 本 store 只做前端编排与状态，不改后端。
 */
import { create } from 'zustand'
import {
  runPipeline,
  runTemplateBatch,
  createPipelineSteps,
  type PipelineExecutors,
  type PipelineRunResult,
  type PipelineStepState,
  type TemplateBatchResult,
} from '@/utils/pipeline'
import { useDesignStore } from '@/stores/design.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { ensureMatrixRacks } from '@/utils/ensureMatrixRacks'
import { exportDeliveryZip } from '@/utils/aidcDelivery'
import { buildPlanDesignPatch } from '@/utils/planToDesign'
import type { PlanSummary } from '@/components/aidc/aidcTypes'

export type PipelineMode = 'project' | 'template'

interface PipelineState {
  running: boolean
  cancelled: boolean
  mode: PipelineMode
  steps: PipelineStepState[]
  lastResult: PipelineRunResult | null
  templateResults: TemplateBatchResult[]

  runProjectPipeline: (projectName: string) => Promise<void>
  runTemplateBatch: (templates: string[]) => Promise<void>
  stop: () => void
  retry: () => Promise<void>
  reset: () => void
}

/** 基于当前设计配置构建 AIDC 规划参数（gpu_count 取设计配置，缺省 64） */
function buildPlanParams(projectName: string): Record<string, unknown> {
  const config = useDesignStore.getState().config
  const gpu = Number(config.num_servers) || 64
  return {
    project_name: projectName,
    site: 'BJ01',
    gpu_count: gpu,
    pfc_queue: 3,
    cnp_queue: 6,
    convergence: 1,
    rails: Number(config.rail_count ?? 8) || 8,
    as_range: [65001, 65500],
    vlan_ranges: {
      compute: [100, 199],
      storage: [200, 299],
      biz: [300, 399],
      oob: [400, 499],
    },
  }
}

/** 一键管线执行器：规划 → 设计 → 渲染 → 导出（全部走既有 IPC/后端编排） */
function buildExecutors(): PipelineExecutors {
  return {
    plan: async (projectName, params) => {
      if (!window.electron?.aidc?.plan || !window.electron?.aidc?.project?.save) {
        throw new Error('AIDC 规划桥接未就绪')
      }
      const input =
        params && typeof params === 'object'
          ? (params as Record<string, unknown>)
          : buildPlanParams(projectName)
      const res = (await window.electron.aidc.plan({ ...input, project_name: projectName })) as {
        error?: string
      }
      if (res?.error) throw new Error(res.error)
      // 保存规划到 AIDC 项目（plan.json 持久化，供交付包导出）
      const saved = (await window.electron.aidc.project.save(projectName, {
        ...input,
        project_name: projectName,
      })) as { error?: string }
      if (saved?.error) throw new Error(saved.error)
    },

    design: async (projectName) => {
      const ds = useDesignStore.getState()
      await ds.loadConfig(projectName)
      // 若项目已有 AIDC 规划，将 plan 映射到设计配置（协议/速率/端口数/收敛比）
      try {
        const loaded = (await window.electron?.aidc?.project?.load(projectName)) as {
          plan?: PlanSummary | null
        } | null
        const plan = loaded?.plan
        if (plan && plan.macro) {
          ds.updateConfig(buildPlanDesignPatch(plan) as never)
        }
      } catch {
        // 无规划/读取失败：按现有配置生成，不阻塞
      }
      await ds.generate(projectName)
      const topology = useDesignStore.getState().topology
      if (topology?.nodes?.length) {
        // 机房/机柜设计：矩阵落位（有矩阵用矩阵，无矩阵按拓扑生成机柜）
        const res = await ensureMatrixRacks(projectName, topology.nodes)
        if (res.error) throw new Error(res.error)
      }
    },

    render: async (projectName) => {
      if (!window.electron?.render?.exportConnections) {
        throw new Error('渲染桥接未就绪')
      }
      const pythonTypes = ['connections', 'deviceList', 'cablingGuide', 'bom', 'pdfReport']
      const result = (await window.electron.render.exportConnections(projectName, pythonTypes)) as {
        results?: Array<{ status?: string }>
        error?: string
      }
      if (result?.error) throw new Error(result.error)
      const items = result?.results ?? []
      if (items.length > 0 && items.some((r) => r.status === 'error')) {
        throw new Error('部分渲染材料生成失败')
      }
    },

    export: async (projectName) => {
      const res = await exportDeliveryZip(projectName)
      if (res.error) throw new Error(res.error)
      if (res.noPlan) throw new Error('当前项目未生成 AIDC 规划，无法导出交付包')
    },
  }
}

export const usePipelineStore = create<PipelineState>()((set, get) => ({
  running: false,
  cancelled: false,
  mode: 'project',
  steps: createPipelineSteps(),
  lastResult: null,
  templateResults: [],

  runProjectPipeline: async (projectName) => {
    if (get().running) return
    set({
      running: true,
      cancelled: false,
      mode: 'project',
      steps: createPipelineSteps(),
      templateResults: [],
      lastResult: null,
    })
    const executors = buildExecutors()
    const result = await runPipeline({
      projectName,
      executors,
      isCancelled: () => get().cancelled,
      onStepChange: (step) => {
        set((s) => ({
          steps: s.steps.map((x) => (x.id === step.id ? step : x)),
        }))
      },
    })
    set({ running: false, steps: result.steps, lastResult: result })
    useProjectStore
      .getState()
      .fetchProjects()
      .catch(() => {})
    if (result.ok) {
      useToastStore.getState().addToast('success', '一键管线完成：规划→设计→渲染→导出', 5000)
    } else if (result.interrupted) {
      useToastStore.getState().addToast('warning', '一键管线已中断', 4000)
    } else {
      useToastStore
        .getState()
        .addToast('error', `一键管线失败：步骤 ${result.failedStep} 出错`, 5000)
    }
  },

  runTemplateBatch: async (templates) => {
    if (get().running) return
    set({
      running: true,
      cancelled: false,
      mode: 'template',
      steps: createPipelineSteps(),
      templateResults: [],
      lastResult: null,
    })
    const executors = buildExecutors()
    const results = await runTemplateBatch({
      templates,
      executors,
      createProject: async (template) => {
        const name = `${template}-管线-${Date.now().toString(36).slice(-4)}`
        await useProjectStore.getState().createProject(name, { template })
        return name
      },
      isCancelled: () => get().cancelled,
      onProgress: (result) => {
        set((s) => ({ templateResults: [...s.templateResults, result] }))
      },
    })
    set({ running: false, templateResults: results })
    useProjectStore
      .getState()
      .fetchProjects()
      .catch(() => {})
    const ok = results.filter((r) => r.ok).length
    const failed = results.length - ok
    if (failed === 0) {
      useToastStore.getState().addToast('success', `模板批处理完成：${ok} 个模板全部成功`, 5000)
    } else {
      useToastStore
        .getState()
        .addToast('warning', `模板批处理完成：成功 ${ok}，失败 ${failed}（失败已跳过继续）`, 5000)
    }
  },

  stop: () => set({ cancelled: true }),

  retry: async () => {
    const { mode, steps, cancelled } = get()
    if (cancelled) return
    // 将失败/未执行步骤重置为 pending，成功步骤保留（不重跑）
    const nextSteps = steps.map((s) =>
      s.status === 'success' ? s : { ...s, status: 'pending' as const, message: '' },
    )
    set({ running: true, steps: nextSteps })
    const executors = buildExecutors()
    if (mode === 'project') {
      const projectName = useProjectStore.getState().selectedProjectName
      if (!projectName) {
        set({ running: false })
        return
      }
      const result = await runPipeline({
        projectName,
        executors,
        initialSteps: nextSteps,
        isCancelled: () => get().cancelled,
        onStepChange: (step) => {
          set((s) => ({
            steps: s.steps.map((x) => (x.id === step.id ? step : x)),
          }))
        },
      })
      set({ running: false, steps: result.steps, lastResult: result })
      if (result.ok) {
        useToastStore.getState().addToast('success', '重试成功：一键管线完成', 5000)
      } else {
        useToastStore.getState().addToast('error', `重试失败：步骤 ${result.failedStep} 出错`, 5000)
      }
    }
  },

  reset: () =>
    set({
      running: false,
      cancelled: false,
      mode: 'project',
      steps: createPipelineSteps(),
      lastResult: null,
      templateResults: [],
    }),
}))
