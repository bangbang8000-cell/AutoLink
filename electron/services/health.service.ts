/**
 * 47-c（F7-3）：健康检查/自检服务
 *
 * 主进程健康检查，覆盖四类：
 *  - 环境（env.*）：OS / arch / node / electron / userData 磁盘可用
 *  - 引擎（engine.*）：AI Hub /api/chat/health + python engine cli:info
 *  - 网络（network.*）：cloud /api/v1/health 连通性（未配置时 skip，不误报失败）
 *  - 依赖（deps.*）：Python 版本 / 关键模块（经 cli:info 间接验证引擎依赖）
 *
 * 设计：依赖注入（HealthDeps），单测可注入 mock，避免真实子进程/网络。
 */
import { app } from 'electron'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { aiHubService } from './aiHub.service.js'
import { pythonService } from './python.service.js'
import { cloudService } from './cloud.service.js'

export type HealthStatus = 'ok' | 'warn' | 'fail' | 'skip'

export interface HealthItem {
  id: string
  label: string
  status: HealthStatus
  detail?: string
  durationMs?: number
}

export interface HealthSummary {
  total: number
  ok: number
  warn: number
  fail: number
  skip: number
}

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

/** 可注入依赖（默认接真实服务，单测注入 mock） */
export interface HealthDeps {
  aiHubHealth: () => Promise<boolean>
  pythonInfo: () => Promise<{ cliVersion?: string; actions?: string[] }>
  cloudHealth: () => Promise<{ status: string }>
  cloudBaseUrl: () => string
  pythonVersion: () => string
  diskFreeMB: (dir: string) => number | undefined
}

/** 探测 Python 版本（python → python3 → py，与 app:getStackVersions 一致） */
function detectPythonVersion(): string {
  const tryCmd = (cmd: string): string => {
    try {
      return execSync(`${cmd} --version`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
        .trim()
        .replace(/^Python\s+/i, '')
    } catch {
      return ''
    }
  }
  return tryCmd('python') || tryCmd('python3') || tryCmd('py')
}

function defaultDeps(): HealthDeps {
  return {
    aiHubHealth: () => aiHubService.healthCheck(),
    pythonInfo: async () => {
      const res = await pythonService.call('cli:info', {}, 10000)
      const r = (res ?? {}) as { cliVersion?: string; actions?: string[] }
      return { cliVersion: r.cliVersion, actions: r.actions }
    },
    cloudHealth: () => cloudService.health(),
    cloudBaseUrl: () => cloudService.getBaseUrl(),
    pythonVersion: () => detectPythonVersion(),
    diskFreeMB: (dir) => {
      try {
        const stat = fs.statfsSync(dir)
        return Math.round((stat.bavail * stat.bsize) / (1024 * 1024))
      } catch {
        return undefined
      }
    },
  }
}

function summarize(items: HealthItem[]): HealthSummary {
  const summary: HealthSummary = { total: items.length, ok: 0, warn: 0, fail: 0, skip: 0 }
  for (const i of items) summary[i.status]++
  return summary
}

export class HealthService {
  private deps: HealthDeps

  constructor(deps?: Partial<HealthDeps>) {
    this.deps = { ...defaultDeps(), ...(deps ?? {}) }
  }

  /** 运行健康检查并返回报告 */
  async runHealthCheck(): Promise<HealthReport> {
    const items: HealthItem[] = []

    // ---- 环境 ----
    const appVersion = app.getVersion()
    const userData = app.getPath('userData')
    items.push({
      id: 'env.os',
      label: '操作系统',
      status: 'ok',
      detail: `${process.platform} (${process.arch})`,
    })
    items.push({
      id: 'env.runtime',
      label: '运行时',
      status: 'ok',
      detail: `Node ${process.versions.node} · Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
    })

    const freeDisk = await this.measure('env.disk', '磁盘可用', async () => {
      const mb = this.deps.diskFreeMB(userData)
      if (mb === undefined) {
        return { status: 'ok' as HealthStatus, detail: `磁盘信息不可用（${userData}）` }
      }
      const status: HealthStatus = mb < 512 ? 'warn' : 'ok'
      return { status, detail: `${userData} 可用 ${mb} MB` }
    })
    items.push(freeDisk)

    // ---- 引擎 ----
    const aihub = await this.measure('engine.aihub', 'AI Hub 引擎', async () => {
      const healthy = await this.deps.aiHubHealth()
      return healthy
        ? { status: 'ok' as HealthStatus, detail: 'GET /api/chat/health 正常' }
        : { status: 'fail' as HealthStatus, detail: 'AI Hub /api/chat/health 不可用' }
    })
    items.push(aihub)

    const pyEngine = await this.measure('engine.python', 'Python 引擎', async () => {
      try {
        const info = await this.deps.pythonInfo()
        if (!info.cliVersion)
          return { status: 'fail' as HealthStatus, detail: 'cli:info 未返回版本' }
        return {
          status: 'ok' as HealthStatus,
          detail: `cli ${info.cliVersion} · ${info.actions?.length ?? 0} 个 action`,
        }
      } catch (err) {
        return {
          status: 'fail' as HealthStatus,
          detail: `python engine 不可用: ${(err as Error).message}`,
        }
      }
    })
    items.push(pyEngine)

    // ---- 网络 ----
    const cloud = await this.measure('network.cloud', '云平台连通', async () => {
      const baseUrl = this.deps.cloudBaseUrl()
      if (!baseUrl) {
        return { status: 'skip' as HealthStatus, detail: '未配置云平台服务器地址' }
      }
      try {
        const res = await this.deps.cloudHealth()
        return { status: 'ok' as HealthStatus, detail: `GET /api/v1/health → ${res.status}` }
      } catch (err) {
        return { status: 'fail' as HealthStatus, detail: `云平台不可达: ${(err as Error).message}` }
      }
    })
    items.push(cloud)

    // ---- 依赖 ----
    const pyVersion = this.deps.pythonVersion()
    items.push({
      id: 'deps.python',
      label: 'Python 依赖',
      status: pyVersion ? 'ok' : 'warn',
      detail: pyVersion ? `Python ${pyVersion}` : '未检测到系统 Python（引擎已打包时无需）',
    })

    return {
      checkedAt: new Date().toISOString(),
      env: {
        appVersion,
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron,
        userData,
      },
      items,
      summary: summarize(items),
    }
  }

  /** 导出为 JSON 文本（前端保存对话框 / 下载） */
  exportJson(report: HealthReport): string {
    return JSON.stringify(report, null, 2)
  }

  private async measure(
    id: string,
    label: string,
    fn: () => Promise<{ status: HealthStatus; detail?: string }>,
  ): Promise<HealthItem> {
    const start = Date.now()
    try {
      const r = await fn()
      return { id, label, status: r.status, detail: r.detail, durationMs: Date.now() - start }
    } catch (err) {
      return {
        id,
        label,
        status: 'fail',
        detail: (err as Error).message,
        durationMs: Date.now() - start,
      }
    }
  }
}

// 全局单例
export const healthService = new HealthService()
