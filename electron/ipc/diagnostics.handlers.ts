/**
 * 47-b/47-c/47-d（F7-2~F7-4）：部署运维 IPC 分包
 *
 * 通道一览：
 *  - diag:collect       聚合诊断报告（系统/日志/审计/崩溃/遥测）
 *  - diag:exportBundle  一键导出支持包（zip，保存对话框）
 *  - health:run         健康检查/自检报告
 *  - health:export      导出健康报告 JSON（保存对话框）
 *  - telemetry:get      读取本地遥测
 *  - telemetry:setEnabled  开启/关闭遥测（默认关）
 *  - telemetry:clear    清空遥测
 *  - telemetry:export   导出遥测 JSON（保存对话框）
 */
import { ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import { diagnosticsService } from '../services/diagnostics.service.js'
import { healthService, type HealthReport } from '../services/health.service.js'
import { telemetryService } from '../services/telemetry.service.js'
import { redactSensitive } from '../utils/redact.js'

/** 通用包装：解析 + 调用 + 错误脱敏（与 cloud.handlers.ts handler 一致） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handler<T>(fn: (...args: any[]) => Promise<T> | T) {
  return async (...args: unknown[]): Promise<T> => {
    try {
      return await fn(...args)
    } catch (err) {
      console.error(
        '[IPC Error]',
        redactSensitive(err instanceof Error ? err.message : String(err)),
      )
      throw err
    }
  }
}

function toInt(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.max(1, Math.min(Math.floor(v), 1000))
}

function readPerfSnapshot(params: unknown): Record<string, unknown> | undefined {
  if (!params || typeof params !== 'object') return undefined
  const p = params as { perfSnapshot?: unknown }
  if (p.perfSnapshot && typeof p.perfSnapshot === 'object') {
    return p.perfSnapshot as Record<string, unknown>
  }
  return undefined
}

/** 注册部署运维 IPC（由 setupIpcHandlers 调用一次） */
export function registerDiagnosticsIpcHandlers(): void {
  // ===== 47-b 诊断中心 =====
  ipcMain.handle(
    'diag:collect',
    handler(async (limit?: unknown) => {
      return diagnosticsService.collectDiagnostics(toInt(limit, 200))
    }),
  )

  // 一键导出支持包：诊断数据 + 前端性能快照 → zip → 保存对话框
  ipcMain.handle(
    'diag:exportBundle',
    handler(async (params?: unknown) => {
      const perfSnapshot = readPerfSnapshot(params)
      const report = diagnosticsService.collectDiagnostics(500)
      const files = diagnosticsService.buildBundleFiles(report, perfSnapshot)
      const result = await dialog.showSaveDialog({
        title: '导出诊断支持包',
        defaultPath: `autolink-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true, path: '' }
      }
      const AdmZip = (await import('adm-zip')).default
      const zip = new AdmZip()
      for (const f of files) {
        zip.addFile(f.name, Buffer.from(f.content, 'utf-8'))
      }
      zip.writeZip(result.filePath)
      return { canceled: false, path: result.filePath }
    }),
  )

  // ===== 47-c 健康检查 =====
  ipcMain.handle(
    'health:run',
    handler(async () => {
      return healthService.runHealthCheck()
    }),
  )

  ipcMain.handle(
    'health:export',
    handler(async (report?: unknown) => {
      if (!report || typeof report !== 'object') {
        throw new Error('缺少健康报告')
      }
      const json = healthService.exportJson(report as HealthReport)
      const result = await dialog.showSaveDialog({
        title: '导出健康检查报告',
        defaultPath: `autolink-health-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true, path: '' }
      }
      fs.writeFileSync(result.filePath, json, 'utf-8')
      return { canceled: false, path: result.filePath }
    }),
  )

  // ===== 47-d 本地遥测 =====
  ipcMain.handle(
    'telemetry:get',
    handler(async () => {
      return telemetryService.read(200)
    }),
  )

  ipcMain.handle(
    'telemetry:setEnabled',
    handler(async (enabled?: unknown) => {
      telemetryService.setEnabled(enabled === true)
      return { enabled: telemetryService.isEnabled() }
    }),
  )

  ipcMain.handle(
    'telemetry:clear',
    handler(async () => {
      telemetryService.clear()
      return { cleared: true }
    }),
  )

  ipcMain.handle(
    'telemetry:export',
    handler(async () => {
      const json = telemetryService.exportJson()
      const result = await dialog.showSaveDialog({
        title: '导出本地遥测数据',
        defaultPath: `autolink-telemetry-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true, path: '' }
      }
      fs.writeFileSync(result.filePath, json, 'utf-8')
      return { canceled: false, path: result.filePath }
    }),
  )
}
