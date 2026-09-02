/**
 * 4.7.0（47-b/47-c/47-d）：部署运维类型定义
 * 与 electron/services/diagnostics.service.ts / health.service.ts 结构对齐，
 * 供渲染层（DiagnosticsPanel / HealthPanel）与 electron.d.ts 使用。
 */

/** 系统信息快照 */
export interface SystemInfo {
  appVersion: string
  platform: string
  platformLabel: string
  arch: string
  node: string
  electron: string
  chromium: string
  osRelease: string
  cpus: number
  totalMemMB: number
  freeMemMB: number
  userData: string
  freeDiskMB?: number
  totalDiskMB?: number
}

/** 崩溃信息 */
export interface CrashInfo {
  crashpadDir: string
  dumpFiles: string[]
  rendererGoneCount: number
}

/** 聚合诊断报告（diag:collect 返回） */
export interface DiagnosticsReport {
  collectedAt: string
  system: SystemInfo
  errorsLog: { path: string; exists: boolean; entries: string[] }
  audit: { path: string; entries: Array<Record<string, unknown>> }
  crashes: CrashInfo
  telemetry: { path: string; entries: Array<Record<string, unknown>>; enabled: boolean }
}

/** 健康检查项 */
export interface HealthItem {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail' | 'skip'
  detail?: string
  durationMs?: number
}

/** 健康检查汇总 */
export interface HealthSummary {
  total: number
  ok: number
  warn: number
  fail: number
  skip: number
}

/** 健康检查报告（health:run 返回） */
export interface HealthReport {
  checkedAt: string
  env: {
    appVersion: string
    platform: string
    arch: string
    node: string
    electron: string
    userData: string
  }
  items: HealthItem[]
  summary: HealthSummary
}
