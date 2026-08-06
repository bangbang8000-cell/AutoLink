/**
 * V3.2.2-R11.2: 崩溃上报（脱敏）
 *
 * 无自有崩溃收集服务，采用"本地可回收 + 脱敏留痕"策略：
 *  - crashReporter 本地收集崩溃转储（不自动上传，开发者可从 userData/Crashpad 取回）
 *  - 主进程未捕获异常/未处理拒绝：脱敏后追加写入 userData/logs/errors.log
 *  - 渲染进程崩溃：脱敏记录 + 自动 reload 恢复（主窗口）
 */
import { app, BrowserWindow, crashReporter } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { redactForLog } from './redact.js'

function getLogPath(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  return path.join(dir, 'errors.log')
}

function appendErrorLog(tag: string, message: string): void {
  try {
    const line = `[${new Date().toISOString()}] [${tag}] ${redactForLog(message)}\n`
    fs.appendFileSync(getLogPath(), line)
  } catch {
    /* 日志写入失败不阻断应用 */
  }
}

/** 初始化崩溃收集：本地转储，不上传 */
export function initCrashReporting(): void {
  crashReporter.start({
    uploadToServer: false,
    compress: true,
    extra: {
      appVersion: app.getVersion(),
      platform: process.platform,
    },
  })
}

/** 主进程异常兜底：脱敏留痕（不吞异常，由 Electron 默认退出策略接管） */
export function registerProcessGuards(): void {
  process.on('uncaughtException', (err) => {
    appendErrorLog('uncaughtException', err instanceof Error ? err.stack || err.message : String(err))
  })
  process.on('unhandledRejection', (reason) => {
    appendErrorLog('unhandledRejection', reason instanceof Error ? reason.stack || reason.message : String(reason))
  })
}

/** 渲染进程崩溃监控：记录 + 自动 reload 恢复主窗口 */
export function watchRendererCrashes(win: BrowserWindow): void {
  win.webContents.on('render-process-gone', (_event, details) => {
    const summary = `reason=${details.reason} exitCode=${details.exitCode}`
    appendErrorLog('render-process-gone', summary)
    // 非正常退出（非 cleanExit）时自动恢复
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
      try {
        win.reload()
      } catch {
        /* ignore */
      }
    }
  })
}
