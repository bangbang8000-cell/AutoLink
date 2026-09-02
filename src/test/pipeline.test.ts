/**
 * 4.4 E-3（测试计划）：一键管线——规划→设计→渲染→导出
 * 断言 runPipeline 按序执行/步骤状态/可中断/失败停止/重试（initialSteps），
 * runTemplateBatch 失败继续（模板批处理）。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  PIPELINE_STEP_ORDER,
  createPipelineSteps,
  runPipeline,
  runTemplateBatch,
  type PipelineExecutors,
  type PipelineStepState,
} from '@/utils/pipeline'

function trackExecutors(): { executors: PipelineExecutors; order: string[] } {
  const order: string[] = []
  return {
    executors: {
      plan: async () => {
        order.push('plan')
      },
      design: async () => {
        order.push('design')
      },
      render: async () => {
        order.push('render')
      },
      export: async () => {
        order.push('export')
      },
    },
    order,
  }
}

describe('E-3 一键管线（F4-3）', () => {
  it('createPipelineSteps 生成固定顺序的 4 步初始状态（全 pending）', () => {
    const steps = createPipelineSteps()
    expect(steps.map((s) => s.id)).toEqual(PIPELINE_STEP_ORDER)
    expect(steps.every((s) => s.status === 'pending')).toBe(true)
  })

  it('runPipeline 按序执行 规划→设计→渲染→导出，全部 success', async () => {
    const { executors, order } = trackExecutors()
    const res = await runPipeline({ projectName: 'P', executors })
    expect(order).toEqual(['plan', 'design', 'render', 'export'])
    expect(res.ok).toBe(true)
    expect(res.interrupted).toBe(false)
    expect(res.steps.every((s) => s.status === 'success')).toBe(true)
  })

  it('步骤状态流转：running → success（onStepChange 回调）', async () => {
    const seen: Record<string, PipelineStepState[]> = {}
    const { executors } = trackExecutors()
    await runPipeline({
      projectName: 'P',
      executors,
      onStepChange: (step) => {
        ;(seen[step.id] ??= []).push({ ...step })
      },
    })
    for (const id of PIPELINE_STEP_ORDER) {
      const seq = seen[id] ?? []
      expect(seq[0].status).toBe('running')
      expect(seq[seq.length - 1].status).toBe('success')
    }
  })

  it('单项目失败立即停止：render 失败 → 后续 export 不执行且保持 pending', async () => {
    const order: string[] = []
    const res = await runPipeline({
      projectName: 'P',
      executors: {
        plan: async () => {
          order.push('plan')
        },
        design: async () => {
          order.push('design')
        },
        render: async () => {
          order.push('render')
          throw new Error('渲染失败')
        },
        export: async () => {
          order.push('export')
        },
      },
    })
    expect(order).toEqual(['plan', 'design', 'render'])
    expect(res.ok).toBe(false)
    expect(res.failedStep).toBe('render')
    const render = res.steps.find((s) => s.id === 'render')!
    expect(render.status).toBe('error')
    expect(render.message).toContain('渲染失败')
    const exportStep = res.steps.find((s) => s.id === 'export')!
    expect(exportStep.status).toBe('pending')
  })

  it('可中断：isCancelled 后剩余步骤置 skipped，interrupted=true', async () => {
    const order: string[] = []
    let call = 0
    const res = await runPipeline({
      projectName: 'P',
      executors: {
        plan: async () => {
          order.push('plan')
        },
        design: async () => {
          order.push('design')
        },
        render: async () => {
          order.push('render')
        },
        export: async () => {
          order.push('export')
        },
      },
      isCancelled: () => ++call >= 2, // design 之后取消
    })
    // 仅执行到 design 前的中断检查
    expect(order.length).toBeLessThanOrEqual(2)
    expect(res.ok).toBe(false)
    expect(res.interrupted).toBe(true)
    const skipped = res.steps.filter((s) => s.status === 'skipped')
    expect(skipped.length).toBeGreaterThan(0)
    expect(res.steps.some((s) => s.status === 'running')).toBe(false)
  })

  it('缺失执行器：对应步骤报 error', async () => {
    const res = await runPipeline({
      projectName: 'P',
      executors: { plan: async () => {}, design: async () => {} },
    })
    expect(res.ok).toBe(false)
    expect(res.failedStep).toBe('render')
  })

  it('重试（initialSteps）：成功步骤不重跑，从失败步骤起重跑', async () => {
    const order: string[] = []
    let renderFail = true
    const executors: PipelineExecutors = {
      plan: async () => {
        order.push('plan')
      },
      design: async () => {
        order.push('design')
      },
      render: async () => {
        order.push('render')
        if (renderFail) {
          renderFail = false
          throw new Error('首次失败')
        }
      },
      export: async () => {
        order.push('export')
      },
    }
    // 首次：render 失败
    const first = await runPipeline({ projectName: 'P', executors })
    expect(first.ok).toBe(false)
    // 重试：传入 initialSteps（成功步骤保留），仅重跑失败/未执行步骤
    const retry = await runPipeline({
      projectName: 'P',
      executors,
      initialSteps: first.steps.map((s) =>
        s.status === 'success' ? s : { ...s, status: 'pending' as const, message: '' },
      ),
    })
    expect(retry.ok).toBe(true)
    // 重试只执行 render + export（plan/design 已 success 跳过）
    expect(order).toEqual(['plan', 'design', 'render', 'render', 'export'])
    expect(retry.steps.every((s) => s.status === 'success')).toBe(true)
  })

  it('runTemplateBatch：失败继续，不中断后续模板（失败模板有 error 记录）', async () => {
    const created: string[] = []
    const res = await runTemplateBatch({
      templates: ['T1', 'T2', 'T3'],
      executors: {
        plan: async () => {},
        design: async () => {},
        render: async () => {},
        export: async () => {},
      },
      createProject: async (template) => {
        const name = `${template}-p`
        created.push(name)
        if (template === 'T2') throw new Error('T2 创建失败')
        return name
      },
    })
    expect(res).toHaveLength(3)
    expect(created).toEqual(['T1-p', 'T2-p', 'T3-p']) // T2 失败后 T3 仍执行
    expect(res[0].ok).toBe(true)
    expect(res[1].ok).toBe(false)
    expect(res[1].error).toContain('T2 创建失败')
    expect(res[2].ok).toBe(true)
  })

  it('runTemplateBatch：管线内失败也继续（记录 failedStep）', async () => {
    const res = await runTemplateBatch({
      templates: ['T1', 'T2'],
      executors: {
        plan: async () => {},
        design: async () => {},
        render: async (_p) => {
          if (_p?.includes?.('T1')) throw new Error('T1 渲染失败')
        },
        export: async () => {},
      },
      createProject: async (t) => t,
    })
    expect(res).toHaveLength(2)
    expect(res[0].ok).toBe(false)
    expect(res[0].failedStep).toBe('render')
    expect(res[1].ok).toBe(true)
  })

  it('runTemplateBatch：可中断（isCancelled 停止后续模板）', async () => {
    let cancelled = false
    const res = await runTemplateBatch({
      templates: ['T1', 'T2', 'T3'],
      executors: {
        plan: async () => {},
        design: async () => {},
        render: async () => {},
        export: async () => {},
      },
      createProject: async (t) => {
        cancelled = t === 'T2'
        return t
      },
      isCancelled: () => cancelled,
    })
    expect(res).toHaveLength(2)
    expect(res[0].ok).toBe(true)
    // T2 在 createProject 后触发中断 → 管线未执行，剩余模板（T3）不再处理
    expect(res[1].ok).toBe(false)
    expect(res[1].error).toContain('中断')
  })
})

describe('E-3 pipeline.store（一键管线状态）', () => {
  function mockPipelineElectron(): void {
    const electron = (window as unknown as { electron: Record<string, unknown> })
      .electron as Record<string, unknown>
    electron.aidc = {
      plan: vi.fn().mockResolvedValue({}),
      project: {
        save: vi.fn().mockResolvedValue({}),
        load: vi.fn().mockResolvedValue({
          plan: { meta: { projectId: 'pid', planVersion: 1, projectName: 'P' }, macro: {} },
        }),
        list: vi.fn().mockResolvedValue({ ok: true, projects: [] }),
      },
      exportPlan: vi.fn().mockResolvedValue({ ok: true, path: '/x/delivery.zip' }),
    }
    electron.design = {
      ...(electron.design as Record<string, unknown>),
      generate: vi.fn().mockResolvedValue({
        summary: { mode: 'auto', totalServers: 64 },
        topology: { nodes: [{ id: 'n1' }], edges: [] },
        valid: true,
      }),
    }
    electron.render = {
      ...(electron.render as Record<string, unknown>),
      exportConnections: vi.fn().mockResolvedValue({ results: [{ status: 'success' }] }),
    }
    electron.project = {
      ...(electron.project as Record<string, unknown>),
      saveFile: vi.fn().mockResolvedValue('/p/topology.json'),
      getFile: vi.fn().mockResolvedValue(null),
      getConfigFile: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
    }
  }

  it('runProjectPipeline 全绿：steps 4 步全 success、running 复位、lastResult.ok=true', async () => {
    mockPipelineElectron()
    const { usePipelineStore } = await import('@/stores/pipeline.store')
    usePipelineStore.getState().reset()
    await usePipelineStore.getState().runProjectPipeline('P')
    const s = usePipelineStore.getState()
    expect(s.running).toBe(false)
    expect(s.steps).toHaveLength(4)
    expect(s.steps.every((x) => x.status === 'success')).toBe(true)
    expect(s.lastResult?.ok).toBe(true)
  })

  it('stop 设置 cancelled（可中断入口），reset 复位', async () => {
    const { usePipelineStore } = await import('@/stores/pipeline.store')
    usePipelineStore.getState().stop()
    expect(usePipelineStore.getState().cancelled).toBe(true)
    usePipelineStore.getState().reset()
    expect(usePipelineStore.getState().cancelled).toBe(false)
    expect(usePipelineStore.getState().running).toBe(false)
    expect(usePipelineStore.getState().steps.every((x) => x.status === 'pending')).toBe(true)
  })
})
