/**
 * 47-b（F7-2）：诊断中心服务（日志 / 审计 / 崩溃 / 性能快照 / 系统信息 一处可查）
 *
 * 聚合主进程可读的诊断数据：
 *  - 系统信息：platform / arch / electron / node / OS / 内存 / userData 磁盘可用
 *  - 主进程错误日志：userData/logs/errors.log（crash.ts 落盘，最近 N 行）
 *  - 命令审计：userData/audit/cli-audit.jsonl（backend cli.py audit_log 落盘）
 *  - 崩溃信息：userData/Crashpad 下 dump 文件清单
 *  - 遥测：userData/telemetry/telemetry.jsonl（47-d 本地遥测）
 *
 * 一键导出支持包：buildBundleFiles 把诊断数据组装为 zip 内容（diagnostics.json + 源文件），
 * 主进程用 adm-zip 打包并弹出保存对话框。
 */
import { app } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { telemetryService } from './telemetry.service.js'

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

/** 聚合诊断报告 */
export interface DiagnosticsReport {
  collectedAt: string
  system: SystemInfo
  errorsLog: { path: string; exists: boolean; entries: string[] }
  audit: { path: string; entries: Array<Record<string, unknown>> }
  crashes: CrashInfo
  telemetry: { path: string; entries: Array<Record<string, unknown>>; enabled: boolean }
}

/** 支持包文件项 */
export interface BundleFile {
  name: string
  content: string
}

/** 读取 JSONL 文件并解析最近 N 条（容错跳过损坏行） */
function readJsonl(file: string, limit: number): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean)
  const entries: Array<Record<string, unknown>> = []
  for (const l of lines.slice(-Math.max(1, limit))) {
    try {
      entries.push(JSON.parse(l) as Record<string, unknown>)
    } catch {
      /* 跳过损坏行 */
    }
  }
  return entries
}

export class DiagnosticsService {
  private userDataOverride: string | null = null

  /** 测试注入：覆盖 userData 目录 */
  setUserDataDir(dir: string): void {
    this.userDataOverride = dir
    telemetryService.setBaseDir(path.join(dir, 'telemetry'))
  }

  private getUserData(): string {
    if (this.userDataOverride) return this.userDataOverride
    return app.getPath('userData')
  }

  private get errorsLogPath(): string {
    return path.join(this.getUserData(), 'logs', 'errors.log')
  }

  private get auditPath(): string {
    return path.join(this.getUserData(), 'audit', 'cli-audit.jsonl')
  }

  private get crashpadDir(): string {
    return path.join(this.getUserData(), 'Crashpad')
  }

  /** 系统信息快照（platform/arch/electron/node/OS/内存/userData 磁盘） */
  collectSystemInfo(): SystemInfo {
    let freeDiskMB: number | undefined
    let totalDiskMB: number | undefined
    try {
      const stat = fs.statfsSync(this.getUserData())
      freeDiskMB = Math.round((stat.bavail * stat.bsize) / (1024 * 1024))
      totalDiskMB = Math.round((stat.blocks * stat.bsize) / (1024 * 1024))
    } catch {
      /* statfs 不可用时省略磁盘字段 */
    }

    const platformLabels: Record<string, string> = {
      win32: 'Windows',
      darwin: 'macOS',
      linux: 'Linux',
    }

    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      platformLabel: platformLabels[process.platform] || process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      osRelease: os.release(),
      cpus: os.cpus().length,
      totalMemMB: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemMB: Math.round(os.freemem() / (1024 * 1024)),
      userData: this.getUserData(),
      freeDiskMB,
      totalDiskMB,
    }
  }

  /** 聚合诊断报告 */
  collectDiagnostics(limit: number = 200): DiagnosticsReport {
    // 主进程错误日志（crash.ts 已脱敏落盘，原样读取）
    const errorsLogPath = this.errorsLogPath
    const errorsExists = fs.existsSync(errorsLogPath)
    const errorLines = errorsExists
      ? fs
          .readFileSync(errorsLogPath, 'utf-8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .slice(-Math.max(1, limit))
      : []

    // 崩溃 dump 文件清单
    let dumpFiles: string[] = []
    try {
      if (fs.existsSync(this.crashpadDir)) {
        dumpFiles = collectDumpFiles(this.crashpadDir)
      }
    } catch {
      /* 忽略 */
    }

    // render-process-gone 记录计数（errors.log 中以该 tag 标记）
    const rendererGoneCount = errorLines.filter((l) => l.includes('[render-process-gone]')).length

    return {
      collectedAt: new Date().toISOString(),
      system: this.collectSystemInfo(),
      errorsLog: {
        path: errorsLogPath,
        exists: errorsExists,
        entries: errorLines,
      },
      audit: {
        path: this.auditPath,
        entries: readJsonl(this.auditPath, limit),
      },
      crashes: {
        crashpadDir: this.crashpadDir,
        dumpFiles,
        rendererGoneCount,
      },
      telemetry: telemetryService.read(limit),
    }
  }

  /**
   * 组装支持包文件（zip 内容）。
   *  - diagnostics.json：系统信息 + 性能快照 + 审计/遥测条目汇总
   *  - logs/errors.log：主进程错误日志（若存在）
   *  - audit/cli-audit.jsonl：命令审计（若存在）
   *  - telemetry/telemetry.jsonl：本地遥测（若存在）
   */
  buildBundleFiles(
    report: DiagnosticsReport,
    perfSnapshot?: Record<string, unknown>,
  ): BundleFile[] {
    const files: BundleFile[] = []

    const diagPayload = {
      collectedAt: report.collectedAt,
      appVersion: report.system.appVersion,
      system: report.system,
      perfSnapshot: perfSnapshot ?? null,
      auditEntries: report.audit.entries,
      telemetryEntries: report.telemetry.entries,
      crashes: report.crashes,
      errorsLogPath: report.errorsLog.path,
      auditPath: report.audit.path,
      telemetryPath: report.telemetry.path,
    }
    files.push({
      name: 'diagnostics.json',
      content: JSON.stringify(diagPayload, null, 2),
    })

    if (report.errorsLog.exists) {
      files.push({
        name: 'logs/errors.log',
        content: fs.readFileSync(report.errorsLog.path, 'utf-8'),
      })
    }
    if (fs.existsSync(report.audit.path)) {
      files.push({
        name: 'audit/cli-audit.jsonl',
        content: fs.readFileSync(report.audit.path, 'utf-8'),
      })
    }
    if (fs.existsSync(report.telemetry.path)) {
      files.push({
        name: 'telemetry/telemetry.jsonl',
        content: fs.readFileSync(report.telemetry.path, 'utf-8'),
      })
    }
    return files
  }
}

/** 递归收集 Crashpad 目录下 *.dmp 文件（含 pending 子目录） */
function collectDumpFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...collectDumpFiles(full))
    } else if (e.name.endsWith('.dmp')) {
      out.push(path.relative(dir, full))
    }
  }
  return out
}

// 全局单例
export const diagnosticsService = new DiagnosticsService()
