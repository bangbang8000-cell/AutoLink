/**
 * V3.1.1-T5-5: AI 执行计划展示（解析 📋 执行计划 块）
 */
import { useMemo } from 'react'
import { CheckCircle2, Loader2, XCircle, Circle } from 'lucide-react'

export interface PlanStep {
  step: number
  description: string
  tool?: string
  status: 'pending' | 'running' | 'done' | 'error'
}

/** 从 AI 回复中解析执行计划块（📋 执行计划 / 1. xxx — 使用工具: y） */
export function parsePlanSteps(content: string): PlanStep[] {
  const steps: PlanStep[] = []
  const m = content.match(/📋\s*执行计划[：:]\s*\n([\s\S]*?)(?:\n\n|\n> |$)/)
  const block = m ? m[1] : content
  const lines = block.split('\n')
  for (const line of lines) {
    const mm = line.match(/^\s*(\d+)[.、]\s*(.*?)(?:—|——|-)\s*(?:使用工具[：:]?\s*)?([a-z_]+)\s*$/)
    if (mm) {
      steps.push({ step: Number(mm[1]), description: mm[2].trim(), tool: mm[3].trim(), status: 'pending' })
    }
  }
  return steps
}

const STATUS_ICONS: Record<PlanStep['status'], React.ReactNode> = {
  pending: <Circle size={14} className="text-gray-400" />,
  running: <Loader2 size={14} className="text-primary-500 animate-spin" />,
  done: <CheckCircle2 size={14} className="text-success-500" />,
  error: <XCircle size={14} className="text-danger-500" />,
}

export function PlanDisplay({ steps }: { steps: PlanStep[] }) {
  if (!steps.length) return null
  return (
    <div className="mt-2 rounded-md border border-edge-subtle bg-gray-50 dark:bg-app-hover p-2.5 space-y-1">
      {steps.map((s) => (
        <div key={s.step} className="flex items-center gap-2 text-xs">
          {STATUS_ICONS[s.status]}
          <span className="text-gray-700 dark:text-gray-300 flex-1">{s.description}</span>
          {s.tool && <code className="text-[10px] text-primary-600 dark:text-primary-400">{s.tool}</code>}
        </div>
      ))}
    </div>
  )
}

/** 从工具调用回显推导计划状态（简化：仅展示解析结果，状态由 AI 文本中的 ✅/❌ 推导） */
export function usePlanStatus(content: string, steps: PlanStep[]): PlanStep[] {
  return useMemo(() => {
    return steps.map((s) => {
      const doneMark = content.match(new RegExp(`✅.*${s.step}\\s*[.、]`))
      const failMark = content.match(new RegExp(`❌.*${s.step}\\s*[.、]`))
      if (failMark) return { ...s, status: 'error' }
      if (doneMark) return { ...s, status: 'done' }
      return s
    })
  }, [content, steps])
}
