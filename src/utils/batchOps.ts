/**
 * 4.4 F4-2: 批量操作工具（批量渲染/导出失败汇总）
 *
 * 批量操作「进度可查」的纯函数集合：多项目执行结果 → 成功/失败汇总，
 * 供 render.store / WorkbenchActionCard 等消费；与 UI 解耦便于单测。
 */

export interface BatchItemResult {
  project: string
  ok: boolean
  error?: string
}

export interface BatchSummary {
  total: number
  succeeded: number
  failed: number
  failures: Array<{ project: string; error: string }>
}

/** 多项目批量操作结果汇总：成功数 / 失败数 / 失败明细（失败汇总可查） */
export function summarizeBatch(results: BatchItemResult[]): BatchSummary {
  const failures = results
    .filter((r) => !r.ok)
    .map((r) => ({ project: r.project, error: r.error || '未知错误' }))
  return {
    total: results.length,
    succeeded: results.length - failures.length,
    failed: failures.length,
    failures,
  }
}
