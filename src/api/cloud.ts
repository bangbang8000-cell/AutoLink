/**
 * 云端平台 API（渲染层薄封装）
 *
 * V3.3.0 架构红线：渲染层零网络（CSP 生产 connect-src 'self'）。
 * 本模块不发起任何 fetch，仅把主进程 cloudService（经 preload contextBridge 暴露的
 * window.electron.cloud.*）包装为类型化的领域 API，语义对齐 MC platform.ts。
 */

// ===== 类型定义 =====

export type LoginPlatform = 'feishu' | 'qq' | 'wechat'

export interface QRCodeResponse {
  session_id: string
  auth_url: string
  expires_in: number
}

export interface ScanStatus {
  status: 'pending' | 'confirmed' | 'expired'
  user: { id: number; username: string } | null
}

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
  // V4-2: 安装计数（列表展示）
  usages?: number
  files?: { path: string; size: number }[]
  // V3.3.2-T15-3: 收藏态 / 我的角色（所有者/可编辑/只读）
  is_favorite?: boolean
  my_role?: string | null
}

// V3.3.2-T15-3: 模板权限
export interface TemplatePermission {
  username: string
  role: string
  created_at?: string
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

// V3.3.2-T15-1: 分享链接（只读快照 → 免登录预览页）
export interface ShareItem {
  token: string
  project_name: string
  description: string
  expires_at: string
  created_at: string
  url: string
}

// ===== 领域 API =====

const cloud = () => window.electron?.cloud

export const auth = {
  getQRCode: (platform: LoginPlatform = 'feishu') => cloud()!.authQrcode(platform),
  pollStatus: (sessionId: string) => cloud()!.authPoll(sessionId),
  health: () => cloud()!.authHealth(),
  logout: () => cloud()!.logout(),
}

export const client = {
  dashboard: () => cloud()!.clientDashboard(),
  version: () => cloud()!.clientVersion(),
  notifications: () => cloud()!.clientNotifications(),
  publicStats: () => cloud()!.publicStats(),
  health: () => cloud()!.health(),
}

export const projects = {
  list: () => cloud()!.projectList(),
  search: (q: string) => cloud()!.projectSearch(q),
  searchPublic: (q = '', page = 1, limit = 20) => cloud()!.projectSearchPublic({ q, page, limit }),
  create: (data: { name: string; description?: string; private: boolean; files?: { path: string; content: string }[] }) =>
    cloud()!.projectCreate(data),
  delete: (owner: string, repo: string) => cloud()!.projectDelete(owner, repo),
  syncCheck: (checks: { name: string; local_sha?: string }[]) => cloud()!.projectSyncCheck(checks),
  download: (owner: string, repo: string) => cloud()!.projectDownload(owner, repo),
  // V4-1: 项目 Fork
  fork: (owner: string, repo: string) => cloud()!.projectFork(owner, repo),
}

export const templates = {
  list: (q?: string, category?: string, page?: number, limit?: number, sort?: string) =>
    cloud()!.templateList({ q, category, page, limit, sort }),
  detail: (owner: string, repo: string) => cloud()!.templateDetail(owner, repo),
  download: (owner: string, repo: string) => cloud()!.templateDownload(owner, repo),
  // V4-2: 模板统计
  stats: (owner: string, repo: string) => cloud()!.templateStats(owner, repo),
  mine: () => cloud()!.templateMine(),
  publish: (data: { name: string; description: string; category: string; public: boolean; files: { path: string; content: string }[] }) =>
    cloud()!.templatePublish(data),
  // V3.3.2-T15-3: 收藏 + 权限
  addFavorite: (owner: string, repo: string) => cloud()!.templateFavoriteAdd(owner, repo),
  removeFavorite: (owner: string, repo: string) => cloud()!.templateFavoriteRemove(owner, repo),
  favorites: () => cloud()!.templateFavorites(),
  permissions: (owner: string, repo: string) => cloud()!.templatePermissions(owner, repo),
  grantPermission: (owner: string, repo: string, username: string, role: string) =>
    cloud()!.templateGrantPermission(owner, repo, username, role),
  revokePermission: (owner: string, repo: string, username: string) =>
    cloud()!.templateRevokePermission(owner, repo, username),
}

export const user = {
  profile: () => cloud()!.userProfile(),
  updateProfile: (data: { full_name?: string; bio?: string }) => cloud()!.updateUserProfile(data),
  giteaCredentials: () => cloud()!.giteaCredentials(),
}

export const search = {
  files: (q: string, limit?: number) => cloud()!.searchFiles(q, limit),
  content: (q: string, limit?: number) => cloud()!.searchContent(q, limit),
}

export const sync = {
  collectProjectFiles: (name: string) => cloud()!.collectProjectFiles(name),
  computeProjectSha: (name: string) => cloud()!.computeProjectSha(name),
  installRemoteProject: (data: { name: string; zipData: string; owner: string; overwrite?: boolean }) =>
    cloud()!.installRemoteProject(data),
  installRemoteTemplate: (data: { name: string; zipData: string; owner: string }) =>
    cloud()!.installRemoteTemplate(data),
}

export const config = {
  setBaseUrl: (url: string) => cloud()!.setBaseUrl(url),
  getBaseUrl: () => cloud()!.getBaseUrl(),
  getLoginState: () => cloud()!.getLoginState(),
}

// V3.3.2-T15-1: 分享链接
export const share = {
  create: (data: { projectName: string; description?: string; expireDays?: number }) => cloud()!.shareCreate(data),
  list: () => cloud()!.shareList(),
  delete: (token: string) => cloud()!.shareDelete(token),
}
