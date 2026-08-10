/**
 * 云端 IPC handlers（主进程）
 *
 * 将 cloudService 的全部能力暴露给渲染层（window.electron.cloud.*）。
 * 通道名统一 `cloud:*`，载荷边界在 preload 层收窄，错误经 wrapHandler 脱敏。
 */
import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { cloudService, type LoginPlatform } from '../services/cloud.service.js'
import { pythonService } from '../services/python.service.js'
import { getWorkspacePath } from '../config.js'
import { redactSensitive } from '../utils/redact.js'
import { assertParsed, projectNameSchema } from './schemas.js'
import { z } from 'zod'

// ===== 载荷校验 schema =====

const baseUrlSchema = z.string().trim().min(1).max(500).refine(
  (v) => {
    // 打包环境强制 https（防本地/中间人窃取凭据）；开发环境允许 http（本地服务调试）
    if (app.isPackaged) return v.startsWith('https://')
    return v.startsWith('http://') || v.startsWith('https://')
  },
  '服务器地址必须以 https:// 开头',
)

const platformSchema = z.enum(['feishu', 'qq', 'wechat'])

const qrcodeSchema = z.object({ platform: platformSchema })

const pollSchema = z.object({ sessionId: z.string().min(1).max(128) })

const projectFilesSchema = z.object({
  name: projectNameSchema,
  description: z.string().max(2000).optional(),
  private: z.boolean(),
  template_owner: z.string().max(120).optional(),
  template_repo: z.string().max(120).optional(),
  files: z.array(z.object({ path: z.string().max(500), content: z.string().max(5_000_000) })).max(2000).optional(),
})

const projectRefSchema = z.object({ owner: z.string().min(1).max(120), repo: projectNameSchema })

// V4-4: 大文件分片上传载荷（content 为 UTF-8 原始文本，分片由主进程完成）
const uploadChunkedSchema = z.object({
  owner: z.string().min(1).max(120),
  repo: projectNameSchema,
  path: z.string().max(500),
  content: z.string().max(100 * 1024 * 1024),
})

const syncCheckSchema = z.object({
  projects: z.array(z.object({ name: projectNameSchema, local_sha: z.string().max(64).optional() })).max(500),
})

const searchSchema = z.object({ q: z.string().max(200), limit: z.number().int().min(1).max(100).optional() })

const updateProfileSchema = z.object({ full_name: z.string().max(200).optional(), bio: z.string().max(2000).optional() })

const templateListSchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(64).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sort: z.string().max(32).optional(),
})

const templatePublishSchema = z.object({
  name: projectNameSchema,
  description: z.string().max(2000),
  category: z.string().max(64),
  public: z.boolean(),
  files: z.array(z.object({ path: z.string().max(500), content: z.string().max(5_000_000) })).max(2000),
})

const installRemoteSchema = z.object({
  name: projectNameSchema,
  zipData: z.string().min(1).max(50_000_000, '安装包过大'),
  owner: z.string().min(1).max(120),
  overwrite: z.boolean().optional(),
})

// V3.3.2-T15-1: 分享删除 / 公开项目搜索载荷
const shareTokenSchema = z.string().trim().min(1).max(128)
const projectSearchPublicSchema = z.object({
  q: z.string().max(200).optional(),
  page: z.number().int().min(1).max(10000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

// V3.3.2-T15-1: 分享链接载荷
const shareCreateSchema = z.object({
  projectName: projectNameSchema,
  description: z.string().max(2000).optional(),
  expireDays: z.number().int().min(1).max(365).optional(),
})

// V3.3.2-T15-3: 模板收藏 / 权限载荷
const templateRepoSchema = z.object({
  owner: z.string().min(1).max(120),
  repo: projectNameSchema,
})
const permissionGrantSchema = z.object({
  owner: z.string().min(1).max(120),
  repo: projectNameSchema,
  username: z.string().min(1).max(120),
  role: z.enum(['editor', 'reader']),
})
const permissionTargetSchema = z.object({
  owner: z.string().min(1).max(120),
  repo: projectNameSchema,
  username: z.string().min(1).max(120),
})

/** 通用包装：解析 + 调用 + 错误脱敏（与 handlers.ts wrapHandler 一致） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handler<T>(fn: (args: any) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, payload: unknown): Promise<T> => {
    try {
      return await fn(payload)
    } catch (err) {
      // 云端错误同样脱敏落日志（apiKey/token 等），与主 handlers 的加固策略保持一致
      console.error('[IPC Error]', redactSensitive(err instanceof Error ? err.message : String(err)))
      throw err
    }
  }
}

/**
 * 注册云端 IPC（由 setupIpcHandlers 调用一次）
 */
export function registerCloudIpcHandlers(): void {
  void cloudService.init()

  // ===== 配置 / Token =====
  ipcMain.handle('cloud:setBaseUrl', handler(async (url: unknown) => {
    cloudService.setBaseUrl(assertParsed(baseUrlSchema, url, 'baseUrl'))
  }))

  ipcMain.handle('cloud:getBaseUrl', handler(async () => cloudService.getBaseUrl()))

  ipcMain.handle('cloud:getLoginState', handler(async () => ({
    baseUrl: cloudService.getBaseUrl(),
    hasToken: !!cloudService.getBaseUrl() && (await cloudService.hasToken()),
  })))

  // ===== Health =====
  ipcMain.handle('cloud:health', handler(async () => cloudService.health()))

  // ===== Auth =====
  ipcMain.handle('cloud:authQrcode', handler(async (payload: unknown) => {
    const { platform } = assertParsed(qrcodeSchema, payload, 'authQrcode')
    return cloudService.authQrcode(platform as LoginPlatform)
  }))

  ipcMain.handle('cloud:authPoll', handler(async (payload: unknown) => {
    const { sessionId } = assertParsed(pollSchema, payload, 'authPoll')
    // 确认后 token 直接落入主进程 safeStorage，返回去除 token 的用户信息
    const result = await cloudService.authPoll(sessionId)
    if (result.status === 'confirmed' && result.token) {
      cloudService.saveToken(result.token)
      return { status: result.status, user: result.user }
    }
    return { status: result.status, user: result.user }
  }))

  ipcMain.handle('cloud:authHealth', handler(async () => cloudService.authHealth()))

  ipcMain.handle('cloud:logout', handler(async () => {
    cloudService.clearToken()
  }))

  // ===== Client =====
  ipcMain.handle('cloud:clientDashboard', handler(async () => cloudService.clientDashboard()))
  ipcMain.handle('cloud:clientVersion', handler(async () => cloudService.clientVersion()))
  ipcMain.handle('cloud:clientNotifications', handler(async () => cloudService.clientNotifications()))
  ipcMain.handle('cloud:publicStats', handler(async () => cloudService.publicStats()))

  // ===== Projects =====
  ipcMain.handle('cloud:projectList', handler(async () => cloudService.projectList()))

  ipcMain.handle('cloud:projectSearch', handler(async (q: unknown) =>
    cloudService.projectSearch(typeof q === 'string' ? q : '')))

  ipcMain.handle('cloud:projectSearchPublic', handler(async (payload: unknown) => {
    const p = assertParsed(projectSearchPublicSchema, payload ?? {}, 'projectSearchPublic')
    return cloudService.projectSearchPublic(p.q ?? '', p.page ?? 1, p.limit ?? 20)
  }))

  ipcMain.handle('cloud:projectCreate', handler(async (payload: unknown) => {
    const data = assertParsed(projectFilesSchema, payload, 'projectCreate')
    return cloudService.projectCreate(data)
  }))

  ipcMain.handle('cloud:projectDelete', handler(async (payload: unknown) => {
    const { owner, repo } = assertParsed(projectRefSchema, payload, 'projectDelete')
    await cloudService.projectDelete(owner, repo)
  }))

  ipcMain.handle('cloud:projectSyncCheck', handler(async (payload: unknown) => {
    const { projects } = assertParsed(syncCheckSchema, payload, 'projectSyncCheck')
    return cloudService.projectSyncCheck(projects)
  }))

  ipcMain.handle('cloud:projectDownload', handler(async (payload: unknown) => {
    const { owner, repo } = assertParsed(projectRefSchema, payload, 'projectDownload')
    return cloudService.projectDownload(owner, repo)
  }))

  // V4-1: 项目 Fork
  ipcMain.handle('cloud:projectFork', handler(async (payload: unknown) => {
    const { owner, repo } = assertParsed(projectRefSchema, payload, 'projectFork')
    return cloudService.projectFork(owner, repo)
  }))

  // V4-4: 大文件分片上传
  ipcMain.handle('cloud:uploadFileChunked', handler(async (payload: unknown) => {
    const { owner, repo, path, content } = assertParsed(uploadChunkedSchema, payload, 'uploadFileChunked')
    await cloudService.uploadFileChunked(owner, repo, path, content)
  }))

  // ===== Templates =====
  ipcMain.handle('cloud:templateList', handler(async (payload: unknown) => {
    const p = assertParsed(templateListSchema, payload ?? {}, 'templateList')
    return cloudService.templateList(p.q, p.category, p.page, p.limit, p.sort)
  }))

  ipcMain.handle('cloud:templateDetail', handler(async (payload: unknown) => {
    const { owner, repo } = assertParsed(projectRefSchema, payload, 'templateDetail')
    return cloudService.templateDetail(owner, repo)
  }))

  // V4-2: 模板统计
  ipcMain.handle('cloud:templateStats', handler(async (payload: unknown) => {
    const { owner, repo } = assertParsed(projectRefSchema, payload, 'templateStats')
    return cloudService.templateStats(owner, repo)
  }))

  ipcMain.handle('cloud:templateDownload', handler(async (payload: unknown) => {
    const { owner, repo } = assertParsed(projectRefSchema, payload, 'templateDownload')
    return cloudService.templateDownload(owner, repo)
  }))

  ipcMain.handle('cloud:templateMine', handler(async () => cloudService.templateMine()))

  ipcMain.handle('cloud:templatePublish', handler(async (payload: unknown) => {
    const data = assertParsed(templatePublishSchema, payload, 'templatePublish')
    return cloudService.templatePublish(data)
  }))

  // V3.3.2-T15-3: 模板收藏 + 权限
  ipcMain.handle('cloud:templateFavoriteAdd', handler(async (payload: unknown) => {
    const { owner, repo } = assertParsed(templateRepoSchema, payload, 'templateFavoriteAdd')
    return cloudService.templateFavoriteAdd(owner, repo)
  }))

  ipcMain.handle('cloud:templateFavoriteRemove', handler(async (payload: unknown) => {
    const { owner, repo } = assertParsed(templateRepoSchema, payload, 'templateFavoriteRemove')
    return cloudService.templateFavoriteRemove(owner, repo)
  }))

  ipcMain.handle('cloud:templateFavorites', handler(async () => cloudService.templateFavorites()))

  ipcMain.handle('cloud:templatePermissions', handler(async (payload: unknown) => {
    const { owner, repo } = assertParsed(templateRepoSchema, payload, 'templatePermissions')
    return cloudService.templatePermissions(owner, repo)
  }))

  ipcMain.handle('cloud:templateGrantPermission', handler(async (payload: unknown) => {
    const data = assertParsed(permissionGrantSchema, payload, 'templateGrantPermission')
    return cloudService.templateGrantPermission(data.owner, data.repo, data.username, data.role)
  }))

  ipcMain.handle('cloud:templateRevokePermission', handler(async (payload: unknown) => {
    const { owner, repo, username } = assertParsed(permissionTargetSchema, payload, 'templateRevokePermission')
    return cloudService.templateRevokePermission(owner, repo, username)
  }))

  // ===== User =====
  ipcMain.handle('cloud:userProfile', handler(async () => cloudService.userProfile()))

  ipcMain.handle('cloud:updateUserProfile', handler(async (payload: unknown) => {
    const data = assertParsed(updateProfileSchema, payload, 'updateUserProfile')
    return cloudService.updateUserProfile(data)
  }))

  ipcMain.handle('cloud:giteaCredentials', handler(async () => cloudService.giteaCredentials()))

  // ===== Search =====
  ipcMain.handle('cloud:searchFiles', handler(async (payload: unknown) => {
    const { q, limit } = assertParsed(searchSchema, payload, 'searchFiles')
    return cloudService.searchFiles(q, limit)
  }))

  ipcMain.handle('cloud:searchContent', handler(async (payload: unknown) => {
    const { q, limit } = assertParsed(searchSchema, payload, 'searchContent')
    return cloudService.searchContent(q, limit)
  }))

  // ===== 项目同步工具 =====
  ipcMain.handle('cloud:collectProjectFiles', handler(async (name: unknown) =>
    cloudService.collectProjectFiles(assertParsed(projectNameSchema, name, 'collectProjectFiles'))))

  ipcMain.handle('cloud:computeProjectSha', handler(async (name: unknown) =>
    cloudService.computeProjectSha(assertParsed(projectNameSchema, name, 'computeProjectSha'))))

  ipcMain.handle('cloud:installRemoteProject', handler(async (payload: unknown) => {
    const data = assertParsed(installRemoteSchema, payload, 'installRemoteProject')
    await cloudService.installRemoteProject(data)
  }))

  ipcMain.handle('cloud:installRemoteTemplate', handler(async (payload: unknown) => {
    const data = assertParsed(installRemoteSchema, payload, 'installRemoteTemplate')
    await cloudService.installRemoteTemplate(data)
  }))

  // ===== Shares（V3.3.2-T15-1: 分享链接） =====

  /**
   * 创建分享链接：
   * 1. 调用 Python 引擎生成只读方案快照（share:snapshot，不落盘）
   * 2. 上传到平台 POST /shares
   * 3. 返回完整预览 URL（baseUrl + /share/<token>）
   */
  ipcMain.handle('cloud:shareCreate', handler(async (payload: unknown) => {
    const { projectName, description, expireDays } = assertParsed(shareCreateSchema, payload, 'shareCreate')
    const projectDir = path.join(getWorkspacePath(), projectName)
    const configFile = path.join(projectDir, 'project_config.json')
    if (!fs.existsSync(configFile)) {
      throw new Error(`项目缺少 project_config.json: ${projectName}`)
    }
    // 1. 生成只读快照
    const res = await pythonService.call('share:snapshot', { configFile })
    const snapshot = (res as { snapshot?: unknown })?.snapshot
    if (!snapshot) {
      throw new Error('生成方案快照失败' + (typeof res === 'object' && res && 'error' in res ? `: ${(res as { error: string }).error}` : ''))
    }
    // 2. 上传创建分享
    const created = await cloudService.shareCreate({
      project_name: projectName,
      description: description ?? '',
      snapshot,
      expire_days: expireDays,
    })
    // 3. 完整 URL（预览页为根路径 /share/<token>）
    return {
      ...created,
      fullUrl: `${cloudService.getBaseUrl()}${created.url}`,
    }
  }))

  ipcMain.handle('cloud:shareList', handler(async () => cloudService.shareList()))

  ipcMain.handle('cloud:shareDelete', handler(async (token: unknown) => {
    await cloudService.shareDelete(assertParsed(shareTokenSchema, token, 'shareDelete'))
  }))
}
