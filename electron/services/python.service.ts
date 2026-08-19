import { spawn, ChildProcess } from 'child_process'
import type { StdioOptions } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import { getBackendPath } from '../config.js'
import { redactSensitive } from '../utils/redact.js'

interface NdjsonLine {
  type?: 'result' | 'event' | 'error'
  requestId?: string
  success?: boolean
  data?: unknown
  error?: string
  chunk?: string
}

/** 流式事件载荷（event 行 → webContents.send('ai:stream', ...)） */
export interface StreamEvent {
  requestId: string
  chunk: string
}

interface PendingRequest {
  requestId: string
  action: string
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  onEvent?: (ev: StreamEvent) => void
  timer: NodeJS.Timeout
}

/** 排队请求：保留 reject 引用，stop() 时可清算队列 Promise 避免悬挂 */
interface QueuedRequest {
  run: () => void
  reject: (e: Error) => void
}

const DEFAULT_TIMEOUT_MS = 180000 // 打磨轮（AL-B2）：默认超时提升到 3 分钟（大项目拓扑/规划计算常超 60s）
const MAX_CONCURRENT = 3         // V3.0.0-T0-6: 并发请求上限
const MAX_QUEUE = 50             // V3.4.1-L6: 排队上限（超出直接拒绝，防渲染层洪水）
const MAX_BUFFER = 1024 * 1024   // V3.4.1-L6: 单行 stdout 缓冲上限（超限重置该行）
const IDLE_TIMEOUT_MS = 5 * 60 * 1000   // 空闲 5 分钟关闭进程（下次请求自动重启）
const MAX_RESTARTS = 5           // 异常退出自动重启上限
const RESTART_BASE_MS = 1000     // 退避基数（1s,2s,4s... 上限 30s）

/**
 * V3.0.0-T0-6: Python 持久 Agent 进程服务
 *
 * 由"每请求 spawn 一次"重构为"单例长驻进程 + 请求队列"：
 *   - engine.py 逐行读 stdin NDJSON，逐行输出 NDJSON（{type:'result'|'event'|'error'}）
 *   - 请求队列并发上限 MAX_CONCURRENT，requestId 分发到各 Promise
 *   - 流式事件（{type:'event'}）经 onEvent 回调透传（主进程转 webContents.send('ai:stream')）
 *   - 空闲超时关闭进程；异常退出按指数退避自动重启（计数上限）
 *   - 保留 call(action, params, timeout) 旧签名，现有 IPC 零改动
 */
class PythonService {
  private pythonPath: string
  private proc: ChildProcess | null = null
  private nextRequestId = 1
  private pending = new Map<string, PendingRequest>()
  private activeCount = 0
  private queue: Array<QueuedRequest> = []
  private buffer = ''
  private stderrTail = ''
  private idleTimer: NodeJS.Timeout | null = null
  private restartCount = 0
  private stopped = false
  private idleClosed = false

  constructor() {
    this.pythonPath = 'python'
  }

  /**
   * 兼容旧签名：单次调用（内部走长驻 Agent 通道，行为与结果与旧实现一致）
   */
  async call(action: string, params: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    return this.callWithEvents(action, params, undefined, timeoutMs)
  }

  /**
   * V3.0.0-T0-6: 流式调用
   * @param onEvent 收到 {type:'event'} 行时回调（chunk 透传）
   */
  callWithEvents(
    action: string,
    params: Record<string, unknown>,
    onEvent?: (ev: StreamEvent) => void,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const requestId = String(this.nextRequestId++)
      const run = () => {
        if (this.stopped) {
          reject(new Error('Python 服务已停止'))
          return
        }
        this.clearIdleTimer()
        const timer = setTimeout(() => {
          // 打磨轮（v1.2 / 0 号）：超时说明 Python 进程卡死（如大项目设计/渲染），
          // 仅 settle 会导致旧任务继续占用进程、后续请求排队 → 一直转圈。
          // 改为杀掉并重置进程，下次调用自动拉起新进程恢复。
          const reason = `Python 请求超时 (${timeoutMs / 1000}s): ${action}，已重启引擎`
          this.killAndReset(reason)
          reject(new Error(reason))
        }, timeoutMs)
        this.pending.set(requestId, { requestId, action, resolve, reject, onEvent, timer })
        this.send({ action, params, requestId })
      }

      if (this.activeCount < MAX_CONCURRENT) {
        this.activeCount++
        this.ensureProcess().then(run).catch((err: Error) => {
          this.activeCount--
          reject(err)
        })
      } else {
        if (this.queue.length >= MAX_QUEUE) {
          reject(new Error('Python 请求队列已满，请稍后重试'))
          return
        }
        this.queue.push({ run, reject })
      }
    })
  }

  /** 停止服务（应用退出时调用） */
  stop(): void {
    this.stopped = true
    this.clearIdleTimer()
    const proc = this.proc
    this.proc = null
    if (proc) {
      try { proc.kill('SIGTERM') } catch { /* ignore */ }
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('Python 服务已停止'))
    }
    this.pending.clear()
    // V3.4.1-M1: 清算排队请求，避免其外层 Promise 永久悬挂
    for (const q of this.queue) {
      q.reject(new Error('Python 服务已停止'))
    }
    this.queue = []
  }

  // ------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------

  private ensureProcess(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      const proc = this.spawnEngine()
      this.proc = proc
      this.buffer = ''
      this.stderrTail = ''

      proc.stdout?.setEncoding('utf-8')
      proc.stdout?.on('data', (data: string) => this.onStdout(data))
      proc.stderr?.setEncoding('utf-8')
      proc.stderr?.on('data', (data: string) => {
        // V3.2.2-R11.1: 边收边脱敏，防止 stderr 尾部（可能含 apiKey/token）泄漏到错误信息
        this.stderrTail = redactSensitive((this.stderrTail + data)).slice(-4000)
      })

      proc.on('error', (err: Error) => {
        // spawn 失败（如 python 不存在）：拒绝所有等待的请求
        this.onProcessGone(`Failed to start Python: ${err.message}`)
      })

      proc.on('close', (code: number | null) => {
        this.onProcessGone(`Python 进程异常退出 (code=${code})`)
      })

      // stdin 可写即视为可派发请求（引擎 import 完成后进入 stdin 循环）
      setImmediate(() => resolve())
    })
  }

  /** V3.0.0-T0-7: 启动引擎 — 优先打包产物 backend-dist/engine(.exe)，回退 python engine.py */
  private spawnEngine(): ChildProcess {
    const exeName = process.platform === 'win32' ? 'engine.exe' : 'engine'
    const bundled = path.join(getBackendPath(), '..', 'backend-dist', exeName)
    const stdio: StdioOptions = ['pipe', 'pipe', 'pipe']
    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      // V3.1.0-T4-3: 注入用户数据目录，供 cli 审计日志（userData/audit/cli-audit.jsonl）落位
      AUTOLINK_USER_DATA: app.getPath('userData'),
    }
    try {
      if (fs.existsSync(bundled)) {
        return spawn(bundled, [], { stdio, env })
      }
    } catch {
      // 探测失败回退
    }
    const enginePath = path.join(getBackendPath(), 'engine.py')
    return spawn(this.pythonPath, [enginePath], { stdio, env })
  }

  private onProcessGone(reason: string): void {
    this.clearIdleTimer()
    this.proc = null
    const pendingSize = this.pending.size
    if (pendingSize > 0) {
      const safeReason = redactSensitive(reason)
      for (const [, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new Error(`${safeReason}: ${this.stderrTail.slice(-200)}`))
      }
      this.pending.clear()
      this.activeCount = Math.max(0, this.activeCount - pendingSize)
    }
    if (this.stopped || this.idleClosed) {
      // 空闲超时主动关闭（正常行为）：不计数、不自动重启，下次请求惰性拉起
      this.idleClosed = false
      return
    }
    // 异常退出：指数退避自动重启
    this.restartCount++
    if (this.restartCount <= MAX_RESTARTS) {
      const delay = Math.min(RESTART_BASE_MS * 2 ** (this.restartCount - 1), 30000)
      setTimeout(() => {
        if (!this.stopped) {
          this.ensureProcess().catch(() => { /* 失败留待下次请求再试 */ })
        }
      }, delay)
    }
  }

  private onStdout(data: string): void {
    this.buffer += data
    if (this.buffer.length > MAX_BUFFER) {
      // V3.4.1-L6: 单行超长保护——重置缓冲（引擎异常打印大块内容时避免无界内存增长）
      this.buffer = ''
    }
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line) {
        this.handleLine(line)
      }
    }
  }

  private handleLine(line: string): void {
    let msg: NdjsonLine
    try {
      msg = JSON.parse(line) as NdjsonLine
    } catch {
      return // 忽略非 JSON 行
    }
    const rid = msg.requestId ?? ''
    if (msg.type === 'event') {
      const p = this.pending.get(rid)
      if (p && p.onEvent && msg.chunk != null) {
        p.onEvent({ requestId: rid, chunk: msg.chunk })
      }
      return
    }
    if (msg.type === 'error') {
      this.settleAndRun(rid, (p) => p.reject(new Error(msg.error || 'Python 协议错误')))
      return
    }
    // type === 'result'
    this.settleAndRun(rid, (p) => {
      if (msg.success) {
        p.resolve(msg.data)
      } else {
        p.reject(new Error(msg.error || 'Unknown Python error'))
      }
    })
  }

  /** 结算单个请求（清 timer + 移除 pending + 释放并发槽 + 调度队列），再执行结果回调 */
  /** 打磨轮（v1.2 / 0 号）：进程疑似卡死（超时）→ 杀掉并重置，拒绝其余在途请求，下次调用拉新进程 */
  private killAndReset(reason: string): void {
    const proc = this.proc
    this.proc = null
    if (proc) {
      try { proc.kill('SIGKILL') } catch { /* ignore */ }
    }
    this.buffer = ''
    this.stderrTail = ''
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()
    this.activeCount = 0
    this.resetIdleTimer()
  }

  private settle(requestId: string): void {
    const p = this.pending.get(requestId)
    if (!p) {
      return
    }
    clearTimeout(p.timer)
    this.pending.delete(requestId)
    this.activeCount = Math.max(0, this.activeCount - 1)
    this.restartCount = 0 // 进程健康工作，重置重启计数
    this.resetIdleTimer()
    this.drainQueue()
  }

  private settleAndRun(requestId: string, act: (p: PendingRequest) => void): void {
    const p = this.pending.get(requestId)
    if (!p) {
      return
    }
    clearTimeout(p.timer)
    this.pending.delete(requestId)
    this.activeCount = Math.max(0, this.activeCount - 1)
    this.restartCount = 0
    this.resetIdleTimer()
    act(p)
    this.drainQueue()
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.activeCount < MAX_CONCURRENT) {
      const next = this.queue.shift()
      if (next) {
        this.activeCount++
        next.run()
      }
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      // 空闲超时：无激活请求且无排队 → 关闭进程释放资源（下次请求自动重启）
      if (this.activeCount === 0 && this.queue.length === 0 && this.proc && !this.stopped) {
        this.idleClosed = true
        // V3.4.1-M2: 立即置空 proc 并设置 idleClosed，消除 kill→close 窗口期新请求误用半死进程的竞态
        const proc = this.proc
        this.proc = null
        try { proc.kill('SIGTERM') } catch { /* ignore */ }
      }
    }, IDLE_TIMEOUT_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private send(request: { action: string; params: Record<string, unknown>; requestId: string }): void {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      this.settleAndRun(request.requestId, (p) => p.reject(new Error('Python 进程未就绪')))
      return
    }
    try {
      this.proc.stdin.write(`${JSON.stringify(request)}\n`)
    } catch (err) {
      this.settleAndRun(request.requestId, (p) => p.reject(new Error(`写入 Python 进程失败: ${redactSensitive((err as Error).message)}`)))
    }
  }
}

export const pythonService = new PythonService()
