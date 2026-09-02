/**
 * 47-d（F7-4）：本地遥测服务（本地化 / 脱敏 / 默认关闭 / 可配置 / 可导出）
 *
 * 隐私与安全基线：
 *  - 默认关闭：仅当用户显式开启（SettingsPanel network 分类 autolink-telemetry-enabled）才采集
 *  - 仅本地落盘：写入 userData/telemetry/telemetry.jsonl，绝不联网上报
 *  - 落盘前脱敏：message 经 redactSensitive 过滤 apiKey/token/密码等凭据
 *  - 可导出/可清空：IPC 暴露 read/export/clear，用户可随时取回或清除
 *
 * 采集事件：
 *  - app:start（启动/版本/平台/架构）
 *  - crash（未捕获异常/未处理拒绝/渲染进程崩溃）
 *  - action（动作耗时，IPC 长任务通道）
 *  - error（IPC 调用失败，脱敏 message）
 */
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { redactSensitive } from '../utils/redact.js'

/** 遥测事件（统一结构：ts + type + 扩展字段） */
export interface TelemetryEvent {
  ts: string
  type: string
  [key: string]: unknown
}

/** 单行体积上限（写入前裁剪 padding 防异常大字段） */
const MAX_LINE_BYTES = 4096
/** 文件总体积上限：超出后裁剪为最近 N 行 */
const MAX_FILE_BYTES = 5 * 1024 * 1024
/** 裁剪时保留的最近行数 */
const TRIM_KEEP_LINES = 2000

export class TelemetryService {
  private enabled: boolean | null = null
  private baseDirOverride: string | null = null

  /** 测试注入：覆盖 userData 基础目录 */
  setBaseDir(dir: string): void {
    this.baseDirOverride = dir
    this.enabled = null
  }

  private getBaseDir(): string {
    if (this.baseDirOverride) return this.baseDirOverride
    return path.join(app.getPath('userData'), 'telemetry')
  }

  get configPath(): string {
    return path.join(this.getBaseDir(), 'config.json')
  }

  get filePath(): string {
    return path.join(this.getBaseDir(), 'telemetry.jsonl')
  }

  /** 开启/关闭遥测（持久化到 config.json，重启后仍生效） */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    try {
      fs.mkdirSync(this.getBaseDir(), { recursive: true })
      fs.writeFileSync(
        this.configPath,
        JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2),
        'utf-8',
      )
    } catch {
      /* 配置写入失败不阻断应用 */
    }
  }

  /** 当前是否开启（会话内缓存 + config.json 持久化） */
  isEnabled(): boolean {
    if (this.enabled !== null) return this.enabled
    try {
      if (!fs.existsSync(this.configPath)) {
        this.enabled = false
        return false
      }
      const cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as { enabled?: unknown }
      this.enabled = cfg.enabled === true
    } catch {
      this.enabled = false
    }
    return this.enabled
  }

  /** 核心采集：启用时脱敏后追加一行 JSONL（失败静默） */
  record(event: TelemetryEvent): void {
    if (!this.isEnabled()) return
    try {
      fs.mkdirSync(this.getBaseDir(), { recursive: true })
      const safe: TelemetryEvent = { ...event }
      if (typeof safe.message === 'string') {
        safe.message = redactSensitive(safe.message)
      }
      const line = this.serializeLine(safe)
      const file = this.filePath
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0
      if (size > MAX_FILE_BYTES) {
        this.trimFile()
      }
      fs.appendFileSync(file, line + '\n')
    } catch {
      /* 遥测写入失败不阻断主流程 */
    }
  }

  /** 记录动作耗时 */
  recordAction(name: string, durationMs: number, ok: boolean, detail?: string): void {
    this.record({
      ts: new Date().toISOString(),
      type: 'action',
      name,
      durationMs: Math.max(0, Math.round(durationMs)),
      ok: !!ok,
      ...(detail ? { message: detail } : {}),
    })
  }

  /** 记录错误（IPC 调用失败，message 脱敏） */
  recordError(source: string, message: string): void {
    this.record({
      ts: new Date().toISOString(),
      type: 'error',
      source,
      message,
    })
  }

  /** 应用启动事件（版本/平台/架构） */
  onAppStart(version: string, platform: string, arch: string): void {
    this.record({
      ts: new Date().toISOString(),
      type: 'app:start',
      version,
      platform,
      arch,
    })
  }

  /** 读取条目（可选 limit 取最近 N 条） */
  read(limit?: number): {
    entries: Array<Record<string, unknown>>
    path: string
    enabled: boolean
  } {
    const entries: Array<Record<string, unknown>> = []
    if (fs.existsSync(this.filePath)) {
      const lines = fs.readFileSync(this.filePath, 'utf-8').trim().split('\n').filter(Boolean)
      const picked = lines.slice(-Math.max(1, Number(limit) || lines.length || 1))
      for (const l of picked) {
        try {
          entries.push(JSON.parse(l) as Record<string, unknown>)
        } catch {
          /* 跳过损坏行 */
        }
      }
    }
    return { entries, path: this.filePath, enabled: this.isEnabled() }
  }

  /** 清空遥测文件 */
  clear(): void {
    try {
      fs.mkdirSync(this.getBaseDir(), { recursive: true })
      fs.writeFileSync(this.filePath, '', 'utf-8')
    } catch {
      /* ignore */
    }
  }

  /** 导出为 JSON 文本（含 summary，供保存对话框/前端下载） */
  exportJson(): string {
    const { entries, path: filePath, enabled } = this.read()
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        enabled,
        source: filePath,
        entryCount: entries.length,
        entries,
      },
      null,
      2,
    )
  }

  /** 文件超限时裁剪为最近 TRIM_KEEP_LINES 行 */
  private trimFile(): void {
    try {
      const lines = fs.readFileSync(this.filePath, 'utf-8').trim().split('\n').filter(Boolean)
      const kept = lines.slice(-TRIM_KEEP_LINES)
      fs.writeFileSync(this.filePath, kept.join('\n') + (kept.length ? '\n' : ''), 'utf-8')
    } catch {
      /* ignore */
    }
  }

  private serializeLine(event: TelemetryEvent): string {
    let line = JSON.stringify(event)
    if (line.length > MAX_LINE_BYTES) {
      // 裁剪扩展字段到单行上限内（保留 ts/type 与核心字段）
      const core: TelemetryEvent = { ts: event.ts, type: event.type }
      if (typeof event.name === 'string') core.name = event.name
      if (typeof event.durationMs === 'number') core.durationMs = event.durationMs
      if (typeof event.ok === 'boolean') core.ok = event.ok
      if (typeof event.version === 'string') core.version = event.version
      if (typeof event.message === 'string') core.message = event.message.slice(0, 500)
      line = JSON.stringify(core)
    }
    return line
  }
}

// 全局单例
export const telemetryService = new TelemetryService()
