/**
 * AutoLink AI Hub 服务（M3b：复制改造 MC aiHub.service.ts）
 *
 * 管理 al_ai_hub 独立 Python 子进程的生命周期、健康检查与 HTTP 通信。
 * - 端口 18722（区别于 MC 18721），鉴权头 X-AL-Auth-Token
 * - M2 同构修复：端口回收（reclaimPort）/ 运行守卫（ensureRunning）/ 401·连接失败重启重试（withRetry）
 */
import { spawn, execSync, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as net from 'net'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import { app } from 'electron'
import { getBackendPath } from '../config.js'

/** 本地日志（AL electron 无 logger 工具，与其他 service 一致用 console 前缀） */
const logger = {
  info: (msg: string) => console.log(`[AL AIHub] ${msg}`),
  warn: (msg: string) => console.warn(`[AL AIHub] ${msg}`),
  error: (msg: string) => console.error(`[AL AIHub] ${msg}`),
}

export interface AIHubStatus {
  running: boolean
  port: number
  lastError?: string
  startTime?: number
}

export class AIHubService extends EventEmitter {
  private process: ChildProcess | null = null
  private port: number = 18722
  private host: string = '127.0.0.1'
  private status: AIHubStatus = { running: false, port: 18722 }
  private restartAttempts: number = 0
  private maxRestarts: number = 3
  private restartDelay: number = 3000
  private healthCheckTimer: NodeJS.Timeout | null = null
  private authToken: string = ''
  private startingPromise: Promise<void> | null = null
  private restartTimer: NodeJS.Timeout | null = null

  /** 生成/复用本地鉴权 token，防止本机任意网页调用 AI Hub 服务 */
  private ensureAuthToken(): string {
    if (!this.authToken) {
      this.authToken = crypto.randomBytes(24).toString('hex')
    }
    return this.authToken
  }

  authHeaders(): Record<string, string> {
    return { 'X-AL-Auth-Token': this.ensureAuthToken() }
  }

  get baseUrl(): string {
    return `http://${this.host}:${this.port}`
  }

  getStatus(): AIHubStatus {
    return { ...this.status }
  }

  /** M2 同构：回收被旧 AI Hub 进程占用的端口（401 根因——旧进程持旧 token） */
  private async reclaimPort(): Promise<void> {
    try {
      const occupied = await new Promise<boolean>((resolve) => {
        const sock = new net.Socket()
        sock.setTimeout(1500)
        sock.once('connect', () => { sock.destroy(); resolve(true) })
        sock.once('error', () => resolve(false))
        sock.once('timeout', () => { sock.destroy(); resolve(false) })
        sock.connect(this.port, this.host)
      })
      if (!occupied) return
      logger.warn(`[AL AIHub] Port ${this.port} occupied by stale process, reclaiming...`)
      const isWin = process.platform === 'win32'
      const cmd = isWin ? `netstat -ano | findstr :${this.port}` : `lsof -ti :${this.port}`
      const out = execSync(cmd, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
      const pids = new Set<number>()
      for (const line of out.split('\n')) {
        const m = line.match(/(\d+)\s*$/)
        if (m && m[1] !== String(process.pid)) pids.add(Number(m[1]))
      }
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL')
          logger.info(`[AL AIHub] Killed stale process ${pid}`)
        } catch { /* 已退出 */ }
      }
      await new Promise((r) => setTimeout(r, 800))
    } catch {
      /* 无占用或命令不可用，忽略 */
    }
  }

  /** M2 同构：确保 AI Hub 已运行（所有 /api/chat/* 调用前调用） */
  async ensureRunning(): Promise<void> {
    if (this.status.running) return
    await this.reclaimPort()
    await this.start()
  }

  /** M2 同构：401/连接失败 → 重启 hub 重试一次 */
  async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      const msg = (err as Error).message || ''
      const isAuthOrConn =
        msg.includes('401') || msg.includes('Unauthorized') ||
        msg.includes('ECONNREFUSED') || msg.includes('fetch failed') ||
        msg.includes('Failed to fetch') || msg.includes('Connection reset')
      if (!isAuthOrConn) throw err
      logger.warn('[AL AIHub] Auth/connection failure, restarting hub and retrying once')
      await this.stop()
      await this.ensureRunning()
      return await fn()
    }
  }

  /** 启动 AI Hub 子进程（并发去重：重复调用复用同一启动流程） */
  async start(): Promise<void> {
    if (this.process) {
      logger.info('[AL AIHub] Already running')
      return
    }
    if (this.startingPromise) {
      return this.startingPromise
    }
    this.startingPromise = this.doStart().finally(() => {
      this.startingPromise = null
    })
    return this.startingPromise
  }

  /** M3b: 启动入口——优先打包产物 backend-dist/al_ai_hub(.exe)，回退 python backend/al_ai_hub/main.py */
  private async doStart(): Promise<void> {
    const pythonPath = 'python'
    const userData = app.getPath('userData')

    const exeName = process.platform === 'win32' ? 'al_ai_hub.exe' : 'al_ai_hub'
    const bundled = path.join(getBackendPath(), '..', 'backend-dist', exeName)
    const args: string[] = ['--port', String(this.port), '--host', this.host,
      '--user-data', userData, '--auth-token', this.ensureAuthToken()]

    let cmd: string
    let cwd: string
    let spawnArgs: string[]
    let env: NodeJS.ProcessEnv

    if (fs.existsSync(bundled)) {
      cmd = bundled
      spawnArgs = args
      cwd = path.dirname(bundled)
      env = { ...process.env, PYTHONUNBUFFERED: '1' }
    } else {
      // 开发模式：backend 目录下 `python -m al_ai_hub.main`
      cmd = pythonPath
      spawnArgs = ['-m', 'al_ai_hub.main', ...args]
      cwd = getBackendPath()
      env = {
        ...process.env,
        PYTHONPATH: getBackendPath(),
        PYTHONUNBUFFERED: '1',
      }
    }

    logger.info(`[AL AIHub] Starting: ${cmd} ${spawnArgs.join(' ')}`)

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, spawnArgs, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })

      let started = false
      const timeout = setTimeout(() => {
        if (!started) {
          reject(new Error('AI Hub 启动超时'))
          proc.kill()
        }
      }, 30000)

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        if (text.includes('AL_AI_HUB_READY')) {
          started = true
          clearTimeout(timeout)
          this.process = proc
          this.status = { ...this.status, running: true, startTime: Date.now() }
          this.restartAttempts = 0
          logger.info(`[AL AIHub] Started on port ${this.port}`)
          this.startHealthCheck()
          this.emit('started', this.port)
          resolve()
        }
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        if (text) logger.info(`[AL AIHub] ${text}`)
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        logger.error(`[AL AIHub] Process error: ${err.message}`)
        this.status = { ...this.status, running: false, lastError: err.message }
        this.emit('error', err)
        if (!started) reject(err)
      })

      proc.on('exit', (code, signal) => {
        clearTimeout(timeout)
        logger.info(`[AL AIHub] Process exited: code=${code} signal=${signal}`)
        if (this.process !== proc) {
          logger.info('[AL AIHub] Exit from stale process, ignoring')
          return
        }
        this.process = null
        this.status = { ...this.status, running: false }
        this.stopHealthCheck()
        this.emit('stopped', { code, signal })
        if (started) {
          this.scheduleRestart()
        }
      })
    })
  }

  /** 调度重启：指数退避 + 上限控制 */
  private scheduleRestart(): void {
    if (this.restartAttempts >= this.maxRestarts) {
      logger.error('[AL AIHub] 达到最大重启次数，停止自动重启')
      return
    }
    this.restartAttempts++
    const delay = Math.min(this.restartDelay * Math.pow(2, this.restartAttempts - 1), 30000)
    logger.info(`[AL AIHub] Auto-restart attempt ${this.restartAttempts}/${this.maxRestarts} in ${delay}ms`)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start().catch((e) => logger.error(`[AL AIHub] Restart failed: ${e.message}`))
    }, delay)
  }

  /** 停止 AI Hub 子进程 */
  async stop(): Promise<void> {
    this.stopHealthCheck()
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (!this.process) return

    return new Promise((resolve) => {
      const proc = this.process!
      const timeout = setTimeout(() => {
        logger.warn('[AL AIHub] Force killing process')
        proc.kill('SIGKILL')
      }, 5000)
      proc.on('exit', () => {
        clearTimeout(timeout)
        this.process = null
        this.status = { ...this.status, running: false }
        logger.info('[AL AIHub] Stopped')
        resolve()
      })
      proc.kill('SIGTERM')
    })
  }

  /** 健康检查 */
  async healthCheck(): Promise<boolean> {
    if (!this.status.running) return false
    try {
      const response = await fetch(`${this.baseUrl}/api/chat/health`, {
        signal: AbortSignal.timeout(5000),
        headers: this.authHeaders(),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck()
    this.healthCheckTimer = setInterval(async () => {
      const healthy = await this.healthCheck()
      if (!healthy && this.status.running) {
        logger.warn('[AL AIHub] Health check failed, restarting...')
        await this.stop()
      }
    }, 30000)
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /** 发送聊天消息（SSE 流式；M2 同构：确保运行 + 401 重启重试） */
  async sendChatMessage(
    sessionId: string,
    message: string,
    mode: string = 'general',
    provider?: string,
    attachments?: Array<{ id: string; name: string; type: string; path: string; size: number }>,
    autonomyMode: string = 'semi_auto',
    projectName?: string,
    onChunk?: (text: string) => void,
    engine?: string,
  ): Promise<string> {
    await this.ensureRunning()
    return this.withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({
          session_id: sessionId,
          message,
          mode,
          provider,
          attachments,
          autonomy_mode: autonomyMode,
          project_name: projectName,
          engine,
        }),
      })
      if (!response.ok) {
        const err = await response.text()
        throw new Error(`AI Hub 请求失败: ${response.status} ${err}`)
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法读取流式响应')
      const decoder = new TextDecoder()
      let fullContent = ''
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.content) {
                fullContent += data.content
                onChunk?.(data.content)
              }
            } catch { /* 忽略解析错误 */ }
          }
        }
      }
      return fullContent
    })
  }

  /** 清除会话（5.0.2-502-b：按引擎命名空间，engine 缺省用后端配置） */
  async clearSession(sessionId: string, engine?: string): Promise<void> {
    await this.ensureRunning()
    const qs = `session_id=${encodeURIComponent(sessionId)}` + (engine ? `&engine=${encodeURIComponent(engine)}` : '')
    await fetch(`${this.baseUrl}/api/chat/clear?${qs}`, {
      method: 'POST',
      headers: this.authHeaders(),
    })
  }

  /** 获取 Provider 列表 */
  async getProviders(): Promise<Array<{ name: string; model: string; enabled: boolean; is_default: boolean }>> {
    await this.ensureRunning()
    const response = await fetch(`${this.baseUrl}/api/chat/providers`, { headers: this.authHeaders() })
    const data = (await response.json()) as { providers?: Array<{ name: string; model: string; enabled: boolean; is_default: boolean }> }
    return data.providers || []
  }

  /** 配置 Provider API Key */
  async configureProvider(provider: string, apiKey: string, model?: string, baseUrl?: string, models?: string[]): Promise<void> {
    await this.ensureRunning()
    await fetch(`${this.baseUrl}/api/chat/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ provider, api_key: apiKey, model, base_url: baseUrl, models }),
    })
  }

  /** 设置默认 Provider */
  async setDefaultProvider(provider: string): Promise<void> {
    await this.ensureRunning()
    await fetch(`${this.baseUrl}/api/chat/config/default`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ provider }),
    })
  }

  /** 测试 Provider 连接 */
  async testConnection(
    provider: string,
    apiKey: string,
    baseUrl: string,
    model: string,
  ): Promise<{ status: string; message: string }> {
    await this.ensureRunning()
    const response = await fetch(`${this.baseUrl}/api/chat/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl, model }),
    })
    return (await response.json()) as { status: string; message: string }
  }

  /** 同步 Provider 配置到 AI Hub（批量） */
  async syncProviders(
    configs: Array<{ provider: string; apiKey: string; model: string; baseUrl: string }>,
    defaultProvider: string,
  ): Promise<void> {
    for (const cfg of configs) {
      if (cfg.apiKey) {
        await this.configureProvider(cfg.provider, cfg.apiKey, cfg.model, cfg.baseUrl)
      }
    }
    if (defaultProvider) {
      await this.setDefaultProvider(defaultProvider)
    }
  }

  /** 保存 Skill */
  async saveSkill(name: string, content: string): Promise<{ status: string; name: string }> {
    await this.ensureRunning()
    const response = await fetch(`${this.baseUrl}/api/chat/skill/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ name, content }),
    })
    return (await response.json()) as { status: string; name: string }
  }

  /** 获取可用模型列表 */
  async fetchModels(baseUrl: string, apiKey: string): Promise<{ status: string; models: string[]; message?: string }> {
    await this.ensureRunning()
    return this.withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/api/chat/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
      })
      return (await response.json()) as { status: string; models: string[]; message?: string }
    })
  }

  /** 5.0.2-502-b: 获取 AI 引擎配置与可用性（own/hermes/auto + hermes 是否安装 + 安装指引） */
  async getEngine(): Promise<{
    engine: string
    resolved: string
    hermes_installed: boolean
    install_hint: string
  }> {
    await this.ensureRunning()
    const response = await fetch(`${this.baseUrl}/api/chat/engine`, { headers: this.authHeaders() })
    return (await response.json()) as {
      engine: string
      resolved: string
      hermes_installed: boolean
      install_hint: string
    }
  }

  /** 5.0.2-502-b: 设置 AI 引擎模式（own/hermes/auto） */
  async setEngine(engine: string): Promise<{ status: string; ai_engine: string; changed: boolean }> {
    await this.ensureRunning()
    const response = await fetch(`${this.baseUrl}/api/chat/engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ engine }),
    })
    if (!response.ok) {
      const err = await response.text()
      throw new Error(`AI Hub 设置引擎失败: ${response.status} ${err}`)
    }
    return (await response.json()) as { status: string; ai_engine: string; changed: boolean }
  }
}

// 全局单例
export const aiHubService = new AIHubService()
