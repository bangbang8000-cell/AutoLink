/**
 * 4.4 F4-3（测试计划 E-3）：一键管线——「规划(AIDC)→设计(机房/机柜)→渲染→导出」一键编排
 *
 * 纯函数编排层（与 UI 解耦便于单测）：
 *  - runPipeline：按序执行 + 步骤状态（pending/running/success/error/skipped）+ 可中断 + 失败停止（单项目）
 *  - runTemplateBatch：模板批处理（每模板规划→渲染→导出，失败继续，不中断后续模板）
 *  - 执行器由调用方（pipeline.store）注入既有 IPC/后端编排，本模块不改后端。
 */

export type PipelineStepId = 'plan' | 'design' | 'render' | 'export'

export type PipelineStepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

export interface PipelineStepState {
  id: PipelineStepId
  label: string
  status: PipelineStepStatus
  message: string
}

/** 一键管线固定执行顺序：规划 → 设计 → 渲染 → 导出 */
export const PIPELINE_STEP_ORDER: PipelineStepId[] = ['plan', 'design', 'render', 'export']

/** 每个步骤的执行器（由调用方注入既有 IPC/后端编排，失败抛错即标记该步骤 error） */
export interface PipelineExecutors {
  plan?: (projectName: string, params?: Record<string, unknown>) => Promise<void>
  design?: (projectName: string) => Promise<void>
  render?: (projectName: string) => Promise<void>
  export?: (projectName: string) => Promise<void>
}

export interface PipelineRunOptions {
  /** 目标项目名 */
  projectName: string
  executors: PipelineExecutors
  /** 要执行的步骤子集（默认全 4 步，按 PIPELINE_STEP_ORDER 过滤） */
  steps?: PipelineStepId[]
  /** 初始步骤状态（重试场景复用：status==='success' 的步骤跳过不重跑） */
  initialSteps?: PipelineStepState[]
  /** 中断判定（true 即停止，后续步骤置 skipped） */
  isCancelled?: () => boolean
  /** 步骤状态变化回调（store/UI 订阅进度） */
  onStepChange?: (step: PipelineStepState) => void
}

export interface PipelineRunResult {
  steps: PipelineStepState[]
  ok: boolean
  /** 失败/中断的步骤（ok=false 时有值） */
  failedStep?: PipelineStepId
  /** 是否被中断（interrupted=true 表示用户取消） */
  interrupted: boolean
}

/** 初始步骤状态（全部 pending） */
export function createPipelineSteps(steps?: PipelineStepId[]): PipelineStepState[] {
  const ids = steps ?? PIPELINE_STEP_ORDER
  return PIPELINE_STEP_ORDER.filter((id) => ids.includes(id)).map((id) => ({
    id,
    label: id,
    status: 'pending' as const,
    message: '',
  }))
}

/** 按序执行一键管线；失败立即停止（单项目），中断则将剩余步骤置 skipped */
export async function runPipeline(opts: PipelineRunOptions): Promise<PipelineRunResult> {
  const { projectName, executors, isCancelled, onStepChange } = opts
  const steps = (opts.initialSteps ?? createPipelineSteps(opts.steps)).map((s) => ({ ...s }))

  const setStep = (id: PipelineStepId, patch: Partial<PipelineStepState>) => {
    const idx = steps.findIndex((s) => s.id === id)
    if (idx >= 0) {
      steps[idx] = { ...steps[idx], ...patch }
      onStepChange?.({ ...steps[idx] })
    }
  }

  const remaining = steps.filter((s) => s.status !== 'success')
  for (const step of remaining) {
    // 中断检查：停止并将尚未执行的步骤置 skipped
    if (isCancelled?.()) {
      for (const s of steps) {
        if (s.status === 'pending') {
          s.status = 'skipped'
          s.message = '已中断'
          onStepChange?.({ ...s })
        }
      }
      return { steps, ok: false, failedStep: step.id, interrupted: true }
    }

    const executor = executors[step.id]
    if (!executor) {
      setStep(step.id, { status: 'error', message: '缺少执行器' })
      return { steps, ok: false, failedStep: step.id, interrupted: false }
    }

    setStep(step.id, { status: 'running', message: '执行中…' })
    try {
      if (step.id === 'plan') {
        await executor(projectName, { projectName })
      } else {
        await executor(projectName)
      }
      setStep(step.id, { status: 'success', message: '完成' })
    } catch (err) {
      setStep(step.id, {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
      // 单项目模式：失败即停止，后续步骤保持 pending
      return { steps, ok: false, failedStep: step.id, interrupted: false }
    }
  }

  return { steps, ok: true, interrupted: false }
}

/** 模板批处理单模板结果 */
export interface TemplateBatchResult {
  template: string
  /** 基于模板创建的项目名（失败创建阶段为空） */
  projectName: string
  ok: boolean
  error?: string
  failedStep?: PipelineStepId
}

export interface TemplateBatchOptions {
  templates: string[]
  executors: PipelineExecutors
  /** 每模板创建的工厂（由调用方实现「基于模板创建项目」；抛错则该模板失败继续） */
  createProject: (template: string) => Promise<string>
  isCancelled?: () => boolean
  onProgress?: (result: TemplateBatchResult) => void
}

/** 模板批处理：对多模板逐一跑管线（plan→design→render→export），失败继续，不中断后续模板 */
export async function runTemplateBatch(opts: TemplateBatchOptions): Promise<TemplateBatchResult[]> {
  const { templates, executors, createProject, isCancelled, onProgress } = opts
  const results: TemplateBatchResult[] = []

  for (const template of templates) {
    if (isCancelled?.()) break
    try {
      const projectName = await createProject(template)
      const res = await runPipeline({
        projectName,
        executors,
        isCancelled,
        onStepChange: () => {
          // 批处理内部步骤进度由调用方 UI 单独呈现；此处无需透传
        },
      })
      const result: TemplateBatchResult = {
        template,
        projectName,
        ok: res.ok,
        error: res.interrupted
          ? '已中断'
          : res.failedStep
            ? `步骤 ${res.failedStep} 失败`
            : undefined,
        failedStep: res.failedStep,
      }
      results.push(result)
      onProgress?.(result)
    } catch (err) {
      const result: TemplateBatchResult = {
        template,
        projectName: '',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
      results.push(result)
      onProgress?.(result)
    }
  }

  return results
}
