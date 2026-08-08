/**
 * 云端平台 HTTP 客户端（主进程）
 *
 * 架构红线（PRD 五条红线 #1）：渲染层 CSP 生产为 connect-src 'self'，云端 HTTP
 * 一律走 Electron 主进程 → IPC → preload contextBridge，渲染层零网络。
 *
 * 本服务承载：
 *  - 服务器地址（baseUrl）持久化（userData/cloud-config.json）
 *  - JWT Token safeStorage 加密存储（回退明文 json，仅开发环境）
 *  - 统一请求：{code,data} 解包 + 401 自动刷新重试
 *  - AutoLink-Platform 全部 API（auth/client/projects/templates/user/search/health）
 *  - 项目同步工具（collectProjectFiles / installRemoteProject / computeProjectSha）
 */
import { app, safeStorage, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { getWorkspacePath, getUserTemplatePath } from '../config.js'

const API_PREFIX = '/api/v1'

/** 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 20_000

// ===== 类型定义（与服务端响应契约对齐） =====

export interface QRCodeResponse {
  session_id: string
  auth_url: string
  expires_in: number
}

export interface ScanStatus {
  status: 'pending' | 'confirmed' | 'expired'
  token: string | null
  user: { id: number; username: string } | null
}

export type LoginPlatform = 'feishu' | 'qq' | 'wechat'

export interface AuthHealth {
  feishu: { configured: boolean }
  qq: { configured: boolean }
  wechat: { configured: boolean }
}

export interface RemoteTemplate {
  id?: number
  name: string
  owner: string
  full_name?: string
  description: string
  category?: string
  public: boolean
  html_url: string
  clone_url: string
  updated_at: string
  created_at?: string
  topics?: string[]
  downloads?: number
  files?: { path: string; size: number }[]
}

export interface RemoteProject {
  id: number
  name: string
  owner: string
  full_name: string
  description: string
  private: boolean
  html_url: string
  clone_url: string
  ssh_url: string
  updated_at: string
  created_at: string
  topics: string[]
}

export interface SyncStatusResponse {
  synced: boolean
  local_sha: string | null
  remote_sha: string | null
  status: 'synced' | 'local_ahead' | 'remote_ahead' | 'conflict' | 'local_only' | 'remote_only'
}

export interface VersionInfo {
  latest_version: string
  latest_build: string
  download_url: string
  release_notes: string
  min_required_version: string
}

export interface Announcement {
  id: number
  title: string
  content: string
  level: 'info' | 'warning' | 'important'
  created_at: string
}

export interface DashboardData {
  template_count: number
  project_count: number
  recent_templates: RemoteTemplate[]
  recent_projects: RemoteProject[]
}

export interface UserProfile {
  user_id: number
  username: string
  full_name: string
  email: string
  avatar_url: string
  bio: string
  location: string
  website: string
  created_at: string
  bindings: SocialBinding[]
}

export interface SocialBinding {
  platform: string
  open_id: string
  nickname: string
  avatar_url: string
  created_at: string
}

export interface FileSearchResult {
  repo: string
  owner: string
  path: string
  size: number
}

export interface ContentSearchResult {
  repo: string
  owner: string
  path: string
  line: number
  snippet: string
}

class CloudService {
  private baseUrl = ''
  private token: string | null = null
  private configLoaded = false

  // ===== 配置 / Token 持久化 =====

  private get configFile(): string {
    return path.join(app.getPath('userData'), 'cloud-config.json')
  }

  private get tokenEncFile(): string {
    return path.join(app.getPath('userData'), 'cloud-token.enc')
  }

  private get tokenJsonFile(): string {
    return path.join(app.getPath('userData'), 'cloud-token.json')
  }

  /** 从磁盘加载 baseUrl + token（启动时调用一次） */
  async init(): Promise<void> {
    if (this.configLoaded) return
    this.configLoaded = true
    try {
      if (fs.existsSync(this.configFile)) {
        const cfg = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'))
        if (typeof cfg.baseUrl === 'string') this.baseUrl = cfg.baseUrl
      }
    } catch { /* 忽略损坏配置 */ }

    try {
      if (fs.existsSync(this.tokenEncFile) && safeStorage.isEncryptionAvailable()) {
        this.token = safeStorage.decryptString(fs.readFileSync(this.tokenEncFile))
      } else if (fs.existsSync(this.tokenJsonFile)) {
        const data = JSON.parse(fs.readFileSync(this.tokenJsonFile, 'utf-8'))
        if (typeof data.token === 'string') this.token = data.token
      }
    } catch { /* 忽略损坏 token */ }
  }

  setBaseUrl(url: string): void {
    this.baseUrl = (url || '').trim().replace(/\/+$/, '')
    try {
      fs.writeFileSync(this.configFile, JSON.stringify({ baseUrl: this.baseUrl }, null, 2), 'utf-8')
    } catch { /* 忽略写入失败 */ }
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  saveToken(token: string): void {
    this.token = token
    try {
      if (safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(this.tokenEncFile, safeStorage.encryptString(token))
        if (fs.existsSync(this.tokenJsonFile)) fs.unlinkSync(this.tokenJsonFile)
      } else {
        fs.writeFileSync(this.tokenJsonFile, JSON.stringify({ token }), 'utf-8')
      }
    } catch { /* 忽略存储失败 */ }
  }

  clearToken(): void {
    this.token = null
    try {
      if (fs.existsSync(this.tokenEncFile)) fs.unlinkSync(this.tokenEncFile)
      if (fs.existsSync(this.tokenJsonFile)) fs.unlinkSync(this.tokenJsonFile)
    } catch { /* 忽略清理失败 */ }
  }

  hasToken(): boolean {
    return !!this.token
  }

  // ===== 统一请求 =====

  private async request<T>(
    method: string,
    apiPath: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    if (!this.baseUrl) throw new Error('未配置云平台服务器地址，请在设置中配置')
    const doFetch = async (token: string | null): Promise<Response> => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...extraHeaders,
      }
      if (body !== undefined && !extraHeaders['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        return await net.fetch(`${this.baseUrl}${apiPath}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
    }

    let res = await doFetch(this.token)

    // 401 且非认证路径：自动刷新 token 后重试一次
    if (res.status === 401 && this.token && !apiPath.startsWith('/auth/')) {
      const newToken = await this.tryRefresh()
      if (newToken) {
        res = await doFetch(newToken)
      }
    }

    if (!res.ok) {
      let detail = res.statusText
      try {
        const err = (await res.json()) as Record<string, unknown>
        detail = String(err.detail ?? err.message ?? detail)
      } catch { /* 非 JSON 错误体 */ }
      throw new Error(detail || `请求失败: ${res.status}`)
    }

    const json = (await res.json()) as unknown
    // 解包服务端 success() 包装 {code, data, message}
    if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>
      if (typeof obj.code === 'number' && 'data' in obj) {
        if (obj.code !== 0) throw new Error(String(obj.message ?? `API 错误 ${obj.code}`))
        return obj.data as T
      }
    }
    return json as T
  }

  private async tryRefresh(): Promise<string | null> {
    try {
      const res = await this.request<{ token: string }>('POST', '/auth/token/refresh')
      if (res?.token) {
        this.saveToken(res.token)
        return res.token
      }
    } catch { /* 刷新失败静默 */ }
    return null
  }

  // ===== Health =====

  async health(): Promise<{ status: string; service: string }> {
    return this.request('GET', '/health')
  }

  // ===== Auth =====

  async authQrcode(platform: LoginPlatform): Promise<QRCodeResponse> {
    return this.request('POST', '/auth/qrcode', { platform })
  }

  async authPoll(sessionId: string): Promise<ScanStatus> {
    return this.request('GET', `/auth/scan/status/${encodeURIComponent(sessionId)}`)
  }

  async authHealth(): Promise<AuthHealth> {
    return this.request('GET', '/auth/health')
  }

  // ===== Client =====

  async clientDashboard(): Promise<DashboardData> {
    return this.request('GET', '/client/dashboard')
  }

  async clientVersion(): Promise<VersionInfo> {
    return this.request('GET', '/client/version')
  }

  async clientNotifications(): Promise<{ announcements: Announcement[] }> {
    return this.request('GET', '/client/notifications')
  }

  async publicStats(): Promise<{ total_users: number; total_templates: number; total_projects: number }> {
    return this.request('GET', '/public/stats')
  }

  // ===== Projects =====

  async projectList(): Promise<{ projects: RemoteProject[] }> {
    return this.request('GET', '/projects')
  }

  async projectSearch(q: string): Promise<{ projects: RemoteProject[] }> {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    const qs = params.toString()
    return this.request('GET', `/projects${qs ? '?' + qs : ''}`)
  }

  async projectSearchPublic(q: string = '', page: number = 1, limit: number = 20): Promise<{ projects: RemoteProject[]; total: number; page: number; limit: number }> {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    params.set('page', String(page))
    params.set('limit', String(limit))
    return this.request('GET', `/projects/public?${params.toString()}`)
  }

  async projectCreate(data: { name: string; description?: string; private: boolean; template_owner?: string; template_repo?: string; files?: { path: string; content: string }[] }): Promise<RemoteProject> {
    return this.request('POST', '/projects', data)
  }

  async projectDelete(owner: string, repo: string): Promise<void> {
    return this.request('DELETE', `/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
  }

  async projectSyncCheck(checks: { name: string; local_sha?: string }[]): Promise<{ results: Record<string, SyncStatusResponse> }> {
    return this.request('POST', '/client/sync/check', { projects: checks })
  }

  /** 下载项目 zip（base64），供拉取到本地 */
  async projectDownload(owner: string, repo: string): Promise<string> {
    const buffer = await this.downloadBuffer(`/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/download`)
    return buffer.toString('base64')
  }

  // ===== Templates =====

  async templateList(q?: string, category?: string, page?: number, limit?: number, sort?: string): Promise<{ templates: RemoteTemplate[]; total: number; page: number; limit: number }> {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (category) params.set('category', category)
    if (page !== undefined) params.set('page', String(page))
    if (limit !== undefined) params.set('limit', String(limit))
    if (sort) params.set('sort', sort)
    const qs = params.toString()
    return this.request('GET', `/templates${qs ? '?' + qs : ''}`)
  }

  async templateDetail(owner: string, repo: string): Promise<RemoteTemplate> {
    return this.request('GET', `/templates/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
  }

  async templateDownload(owner: string, repo: string): Promise<string> {
    const buffer = await this.downloadBuffer(`/templates/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/download`)
    return buffer.toString('base64')
  }

  async templateFileContent(owner: string, repo: string, filePath: string): Promise<{ content: string }> {
    return this.request('GET', `/templates/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/file/${encodeURIComponent(filePath)}`)
  }

  async templateMine(): Promise<{ templates: RemoteTemplate[] }> {
    return this.request('GET', '/templates/mine')
  }

  async templatePublish(data: { name: string; description: string; category: string; public: boolean; files: { path: string; content: string }[] }): Promise<{ owner: string; repo: string }> {
    return this.request('POST', '/templates', data)
  }

  // ===== User =====

  async userProfile(): Promise<UserProfile> {
    return this.request('GET', '/user/profile')
  }

  async updateUserProfile(data: { full_name?: string; bio?: string }): Promise<UserProfile> {
    return this.request('PUT', '/user/profile', data)
  }

  async giteaCredentials(): Promise<{ username: string; password: string; gitea_url: string }> {
    return this.request('POST', '/user/gitea-credentials')
  }

  // ===== Search =====

  async searchFiles(q: string, limit?: number): Promise<{ results: FileSearchResult[]; total: number }> {
    const params = new URLSearchParams()
    params.set('q', q)
    if (limit !== undefined) params.set('limit', String(limit))
    return this.request('GET', `/search/files?${params.toString()}`)
  }

  async searchContent(q: string, limit?: number): Promise<{ results: ContentSearchResult[]; total: number }> {
    const params = new URLSearchParams()
    params.set('q', q)
    if (limit !== undefined) params.set('limit', String(limit))
    return this.request('GET', `/search/content?${params.toString()}`)
  }

  // ===== Shares（V3.3.2-T15-1: 分享链接） =====

  async shareCreate(data: { project_name: string; description?: string; snapshot: unknown; expire_days?: number }): Promise<{ token: string; project_name: string; url: string; expires_at: string }> {
    return this.request('POST', '/shares', data)
  }

  async shareList(): Promise<{ shares: { token: string; project_name: string; description: string; expires_at: string; created_at: string; url: string }[] }> {
    return this.request('GET', '/shares')
  }

  async shareDelete(token: string): Promise<{ deleted: boolean }> {
    return this.request('DELETE', `/shares/${encodeURIComponent(token)}`)
  }

  // ===== 二进制下载（zip） =====

  private async downloadBuffer(apiPath: string): Promise<Buffer> {
    if (!this.baseUrl) throw new Error('未配置云平台服务器地址，请在设置中配置')
    const headers: Record<string, string> = { Accept: 'application/octet-stream' }
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let res: Response
    try {
      res = await net.fetch(`${this.baseUrl}${apiPath}`, { method: 'GET', headers, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }

    if (res.status === 401 && this.token) {
      const newToken = await this.tryRefresh()
      if (newToken) {
        const headers2 = { Accept: 'application/octet-stream', Authorization: `Bearer ${newToken}` }
        const c2 = new AbortController()
        const t2 = setTimeout(() => c2.abort(), REQUEST_TIMEOUT_MS)
        try {
          res = await net.fetch(`${this.baseUrl}${apiPath}`, { method: 'GET', headers: headers2, signal: c2.signal })
        } finally {
          clearTimeout(t2)
        }
      }
    }

    if (!res.ok) {
      let detail = res.statusText
      try {
        const err = (await res.json()) as Record<string, unknown>
        detail = String(err.detail ?? err.message ?? detail)
      } catch { /* 非 JSON */ }
      throw new Error(detail || `下载失败: ${res.status}`)
    }
    return Buffer.from(await res.arrayBuffer())
  }

  // ===== 项目同步工具 =====

  /** 收集项目文件（推送用），跳过输出目录与缓存 */
  collectProjectFiles(projectName: string): { path: string; content: string }[] {
    const projectDir = path.join(getWorkspacePath(), path.basename(projectName))
    if (!fs.existsSync(projectDir)) throw new Error(`项目不存在: ${projectName}`)
    return this.walkFiles(projectDir, projectDir)
  }

  /** 计算项目内容 SHA（同步状态用，等价于 MC 的 git SHA 语义） */
  computeProjectSha(projectName: string): string | null {
    const projectDir = path.join(getWorkspacePath(), path.basename(projectName))
    if (!fs.existsSync(projectDir)) return null
    const files = this.walkFiles(projectDir, projectDir)
    if (files.length === 0) return null
    const hash = crypto.createHash('sha1')
    for (const f of files) {
      hash.update(f.path)
      hash.update('\0')
      hash.update(crypto.createHash('sha1').update(f.content).digest('hex'))
      hash.update('\n')
    }
    return hash.digest('hex')
  }

  /** 安装远程项目 zip 到 workspace（overwrite=true 时先清空目标目录） */
  async installRemoteProject(data: { name: string; zipData: string; owner: string; overwrite?: boolean }): Promise<void> {
    const AdmZip = (await import('adm-zip')).default
    const safeName = path.basename(data.name)
    const targetPath = path.join(getWorkspacePath(), safeName)
    if (fs.existsSync(targetPath)) {
      if (!data.overwrite) {
        throw new Error(`项目已存在: ${safeName}`)
      }
      fs.rmSync(targetPath, { recursive: true, force: true })
    }
    const zip = new AdmZip(Buffer.from(data.zipData, 'base64'))
    zip.extractAllTo(targetPath, true)
    // 服务端打包若带单根目录（{repo}/...），做一次归一，避免嵌套
    this.normalizeZipRoot(targetPath)
    // 写入同步元数据
    fs.writeFileSync(
      path.join(targetPath, '.autolink-sync.json'),
      JSON.stringify({ source: 'remote', owner: data.owner, repo: safeName, installedAt: new Date().toISOString() }, null, 2),
      'utf-8',
    )
  }

  /** 安装远程模板 zip 到用户模板目录 */
  async installRemoteTemplate(data: { name: string; zipData: string; owner: string }): Promise<void> {
    const AdmZip = (await import('adm-zip')).default
    const safeName = path.basename(data.name)
    const targetPath = path.join(getUserTemplatePath(), safeName)
    if (fs.existsSync(targetPath)) {
      throw new Error(`模板已存在: ${safeName}`)
    }
    const zip = new AdmZip(Buffer.from(data.zipData, 'base64'))
    zip.extractAllTo(targetPath, true)
    this.normalizeZipRoot(targetPath)
  }

  /**
   * 解压归一：若目标目录下只有一个子目录且无顶层文件，则将子目录内容上移一层。
   * 服务端 zip 打包可能以仓库名作为根目录（如 magiccommander-platform 的 archive 行为）。
   */
  private normalizeZipRoot(targetPath: string): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(targetPath, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.length !== 1 || !entries[0].isDirectory()) return
    const inner = path.join(targetPath, entries[0].name)
    const innerEntries = fs.readdirSync(inner)
    if (innerEntries.length === 0) return
    // 若目录名与目标名一致且存在核心文件，判定为单根目录打包
    for (const f of innerEntries) {
      fs.renameSync(path.join(inner, f), path.join(targetPath, f))
    }
    fs.rmdirSync(inner)
  }

  private walkFiles(dir: string, baseDir: string): { path: string; content: string }[] {
    const skipDirs = ['output', 'output-sn', 'output-label', 'output-label-md', 'output-label-pdf', '__pycache__', '.git', 'node_modules']
    const skipExts = ['.pyc', '.DS_Store']
    const files: { path: string; content: string }[] = []

    const walk = (cur: string) => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(cur, entry.name)
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/')
        if (entry.isDirectory()) {
          if (!skipDirs.includes(entry.name)) walk(fullPath)
        } else {
          const ext = path.extname(entry.name).toLowerCase()
          if (skipExts.includes(ext)) continue
          try {
            files.push({ path: relativePath, content: fs.readFileSync(fullPath, 'utf-8') })
          } catch { /* 跳过二进制文件 */ }
        }
      }
    }
    walk(baseDir)
    return files
  }
}

/** 全局单例（主进程唯一） */
export const cloudService = new CloudService()
