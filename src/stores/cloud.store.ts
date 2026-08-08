/**
 * 云端平台 Store（渲染层）
 *
 * 数据流：组件 → cloud.store → api/cloud（window.electron.cloud.* IPC）→ 主进程 cloudService。
 * Token 不进入渲染层 localStorage，由主进程 safeStorage 保管；此处仅持久化
 * baseUrl / loggedIn / username / userId 等非敏感状态。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  auth,
  client,
  projects,
  templates,
  user,
  sync,
  share as cloudShare,
  config as cloudConfig,
  type RemoteProject,
  type RemoteTemplate,
  type SyncStatusResponse,
  type LoginPlatform,
  type UserProfile,
  type DashboardData,
  type ShareItem,
} from '@/api/cloud'

interface CloudState {
  // Config
  baseUrl: string
  // Auth
  loggedIn: boolean
  username: string | null
  userId: number | null
  // User profile
  userProfile: UserProfile | null
  // Login flow
  qrSessionId: string | null
  qrAuthUrl: string | null
  loginPlatform: LoginPlatform | null
  // Dashboard
  dashboard: DashboardData | null
  // Remote templates
  remoteTemplates: RemoteTemplate[]
  remoteLoading: boolean
  remoteError: string | null
  templatePage: number
  templateTotal: number
  templateLimit: number
  // Remote projects
  remoteProjects: RemoteProject[]
  remoteProjectsLoading: boolean
  // Public projects
  publicProjects: RemoteProject[]
  publicProjectsLoading: boolean
  publicProjectsTotal: number
  // Sync status
  syncStatuses: Record<string, SyncStatusResponse>
  // V3.3.2-T15-1: 分享链接
  myShares: ShareItem[]
  shareLoading: boolean
  // Connection health
  connected: boolean
  checkingConnection: boolean

  // Actions
  init: () => Promise<void>
  setBaseUrl: (url: string) => void
  checkConnection: () => Promise<void>
  startLogin: (platform: LoginPlatform) => Promise<{ authUrl: string; sessionId: string }>
  pollLogin: () => Promise<'pending' | 'confirmed' | 'expired'>
  cancelLogin: () => void
  logout: () => void
  fetchDashboard: () => Promise<void>
  fetchUserProfile: () => Promise<void>
  updateUserProfile: (data: { full_name?: string; bio?: string }) => Promise<void>
  fetchRemoteTemplates: (query?: string, category?: string, page?: number, sort?: string) => Promise<void>
  downloadTemplate: (owner: string, repo: string) => Promise<void>
  publishTemplate: (data: { name: string; description: string; category: string; public: boolean; files: { path: string; content: string }[] }) => Promise<{ owner: string; repo: string }>
  // V3.3.2-T15-3: 模板收藏 + 权限
  toggleTemplateFavorite: (owner: string, repo: string, current: boolean) => Promise<void>
  grantTemplatePermission: (owner: string, repo: string, username: string, role: string) => Promise<void>
  revokeTemplatePermission: (owner: string, repo: string, username: string) => Promise<void>
  fetchRemoteProjects: () => Promise<void>
  searchPublicProjects: (q: string, page?: number) => Promise<void>
  pushProject: (name: string, description: string, isPrivate: boolean) => Promise<RemoteProject>
  pullProject: (owner: string, repo: string, projectName: string, overwrite?: boolean) => Promise<void>
  checkSyncStatus: (projectList: { name: string; localSha?: string }[]) => Promise<void>
  deleteRemoteProject: (owner: string, repo: string) => Promise<void>
  // V3.3.2-T15-1: 分享链接
  createShare: (projectName: string, description?: string, expireDays?: number) => Promise<{
    token: string
    project_name: string
    url: string
    expires_at: string
    fullUrl: string
  }>
  fetchMyShares: () => Promise<void>
  deleteShare: (token: string) => Promise<void>
}

export const useCloudStore = create<CloudState>()(
  persist(
    (set, get) => ({
      baseUrl: '',
      loggedIn: false,
      username: null,
      userId: null,
      userProfile: null,
      qrSessionId: null,
      qrAuthUrl: null,
      loginPlatform: null,
      dashboard: null,
      remoteTemplates: [],
      remoteLoading: false,
      remoteError: null,
      templatePage: 1,
      templateTotal: 0,
      templateLimit: 20,
      remoteProjects: [],
      remoteProjectsLoading: false,
      publicProjects: [],
      publicProjectsLoading: false,
      publicProjectsTotal: 0,
      syncStatuses: {},
      myShares: [],
      shareLoading: false,
      connected: false,
      checkingConnection: false,

      /** 启动时同步 baseUrl 到主进程并恢复登录态 */
      init: async () => {
        const { baseUrl, loggedIn } = get()
        if (baseUrl) {
          try {
            await cloudConfig.setBaseUrl(baseUrl)
          } catch { /* IPC 未就绪时静默 */ }
        }
        // 主进程 token 存在且本地标记已登录 → 保持；否则校正为未登录
        try {
          const state = await cloudConfig.getLoginState()
          if (state.hasToken) {
            if (!loggedIn) set({ loggedIn: true })
          } else if (loggedIn) {
            set({ loggedIn: false, username: null, userId: null, userProfile: null })
          }
        } catch { /* 忽略 */ }
        void get().checkConnection()
      },

      setBaseUrl: (url: string) => {
        const normalized = (url || '').trim().replace(/\/+$/, '')
        set({ baseUrl: normalized })
        void cloudConfig.setBaseUrl(normalized).catch(() => {})
        void get().checkConnection()
      },

      checkConnection: async () => {
        if (!get().baseUrl) {
          set({ connected: false, checkingConnection: false })
          return
        }
        set({ checkingConnection: true })
        try {
          await client.health()
          set({ connected: true })
        } catch {
          set({ connected: false })
        } finally {
          set({ checkingConnection: false })
        }
      },

      startLogin: async (platform: LoginPlatform) => {
        const res = await auth.getQRCode(platform)
        set({ qrSessionId: res.session_id, qrAuthUrl: res.auth_url, loginPlatform: platform })
        return { authUrl: res.auth_url, sessionId: res.session_id }
      },

      pollLogin: async () => {
        const { qrSessionId } = get()
        if (!qrSessionId) return 'expired'
        const status = await auth.pollStatus(qrSessionId)
        if (status.status === 'confirmed' && status.user) {
          set({
            loggedIn: true,
            username: status.user.username,
            userId: status.user.id,
            qrSessionId: null,
            qrAuthUrl: null,
            loginPlatform: null,
          })
          void get().fetchUserProfile()
          return 'confirmed'
        }
        if (status.status === 'expired') {
          set({ qrSessionId: null, qrAuthUrl: null, loginPlatform: null })
          return 'expired'
        }
        return 'pending'
      },

      cancelLogin: () => {
        set({ qrSessionId: null, qrAuthUrl: null, loginPlatform: null })
      },

      logout: () => {
        void auth.logout().catch(() => {})
        set({ loggedIn: false, username: null, userId: null, userProfile: null, dashboard: null })
      },

      fetchDashboard: async () => {
        try {
          const data = await client.dashboard()
          set({ dashboard: data })
        } catch { /* 非关键，静默 */ }
      },

      fetchUserProfile: async () => {
        try {
          const profile = await user.profile()
          set({ userProfile: profile })
        } catch { /* 非关键，静默 */ }
      },

      updateUserProfile: async (data) => {
        const profile = await user.updateProfile(data)
        set({ userProfile: profile })
      },

      fetchRemoteTemplates: async (query?: string, category?: string, page?: number, sort?: string) => {
        set({ remoteLoading: true, remoteError: null })
        try {
          const p = page ?? 1
          const limit = get().templateLimit
          const res = await templates.list(query, category, p, limit, sort)
          set({
            remoteTemplates: res.templates,
            templatePage: res.page || p,
            templateTotal: res.total,
            remoteLoading: false,
          })
        } catch (err) {
          set({ remoteError: (err as Error).message, remoteLoading: false })
        }
      },

      downloadTemplate: async (owner: string, repo: string) => {
        const zipData = await templates.download(owner, repo)
        await sync.installRemoteTemplate({ name: repo, zipData, owner })
      },

      publishTemplate: async (data) => {
        return templates.publish(data)
      },

      // V3.3.2-T15-3: 模板收藏 + 权限
      toggleTemplateFavorite: async (owner: string, repo: string, current: boolean) => {
        if (current) {
          await templates.removeFavorite(owner, repo)
        } else {
          await templates.addFavorite(owner, repo)
        }
        // 同步当前列表中的收藏态
        const { remoteTemplates } = get()
        set({
          remoteTemplates: remoteTemplates.map((tp) =>
            tp.owner === owner && tp.name === repo ? { ...tp, is_favorite: !current } : tp,
          ),
        })
      },

      grantTemplatePermission: async (owner, repo, username, role) => {
        await templates.grantPermission(owner, repo, username, role)
      },

      revokeTemplatePermission: async (owner, repo, username) => {
        await templates.revokePermission(owner, repo, username)
      },

      // --- Project Sync ---

      fetchRemoteProjects: async () => {
        set({ remoteProjectsLoading: true })
        try {
          const res = await projects.list()
          set({ remoteProjects: res.projects, remoteProjectsLoading: false })
        } catch (err) {
          set({ remoteProjectsLoading: false })
          throw err
        }
      },

      searchPublicProjects: async (q: string, page = 1) => {
        set({ publicProjectsLoading: true })
        try {
          const res = await projects.searchPublic(q, page)
          set({
            publicProjects: res.projects,
            publicProjectsTotal: res.total,
            publicProjectsLoading: false,
          })
        } catch (err) {
          set({ publicProjectsLoading: false })
          throw err
        }
      },

      pushProject: async (name: string, description: string, isPrivate: boolean) => {
        const files = await sync.collectProjectFiles(name)
        const result = await projects.create({ name, description, private: isPrivate, files })
        return result
      },

      pullProject: async (owner: string, repo: string, projectName: string, overwrite = false) => {
    const zipData = await projects.download(owner, repo)
    await sync.installRemoteProject({ name: projectName, zipData, owner, overwrite })
  },

      checkSyncStatus: async (projectList) => {
        try {
          // 逐项目计算本地内容 SHA（对齐服务端 sync/check 语义）
          const withSha: { name: string; local_sha?: string }[] = []
          for (const p of projectList) {
            let sha: string | null = null
            try {
              sha = await sync.computeProjectSha(p.name)
            } catch { /* 忽略 */ }
            withSha.push({ name: p.name, local_sha: sha ?? undefined })
          }
          const res = await projects.syncCheck(withSha)
          set({ syncStatuses: res.results })
        } catch { /* 非关键，静默 */ }
      },

      deleteRemoteProject: async (owner: string, repo: string) => {
        await projects.delete(owner, repo)
        const { remoteProjects } = get()
        set({ remoteProjects: remoteProjects.filter((p) => p.owner !== owner || p.name !== repo) })
      },

      // V3.3.2-T15-1: 分享链接
      createShare: async (projectName, description, expireDays) => {
        return cloudShare.create({ projectName, description, expireDays })
      },

      fetchMyShares: async () => {
        set({ shareLoading: true })
        try {
          const res = await cloudShare.list()
          set({ myShares: res.shares, shareLoading: false })
        } catch (err) {
          set({ shareLoading: false })
          throw err
        }
      },

      deleteShare: async (token: string) => {
        await cloudShare.delete(token)
        const { myShares } = get()
        set({ myShares: myShares.filter((s) => s.token !== token) })
      },
    }),
    {
      name: 'autolink-cloud-state',
      partialize: (state) => ({
        baseUrl: state.baseUrl,
        // token 不进 localStorage（主进程 safeStorage 保管）
        loggedIn: state.loggedIn,
        username: state.username,
        userId: state.userId,
      }),
    },
  ),
)
