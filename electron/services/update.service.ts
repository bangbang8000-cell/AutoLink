import { BrowserWindow, app, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'
import * as https from 'https'
import * as nodeNet from 'net'
import { isVersionNewer } from '../utils/version.js'
// 5.0.9（509-a 升级体验增强 / 509-b 企业部署基座）：更新交付纯函数
import {
  partFileFor,
  resumeOffset,
  parseContentRange,
  parseSha512FromYml,
  sha512Matches,
  computeSha512,
  RollbackManager,
  isBelowMinRequired,
  resolveYmlNameForChannel,
  readUpdateSettings,
  type UpdateSettings,
} from './update-delivery.js'

let autoUpdater: typeof import('electron-updater').autoUpdater | null = null

async function getAutoUpdater() {
  if (!autoUpdater) {
    try {
      const updater = await import('electron-updater')
      autoUpdater = updater.autoUpdater
      // T1: dev 模式下启用 forceDevRunConfig,允许在开发环境测试更新流程
      // 需要项目根目录存在 dev-app-update.yml
      // forceDevRunConfig 是 electron-updater 的非公开 API,类型定义中缺失,用类型断言绕过
      if (!app.isPackaged) {
        ;(autoUpdater as unknown as { forceDevRunConfig: boolean }).forceDevRunConfig = true
      }
    } catch (err) {
      // electron-updater not available (missing dep)
      console.error('[UpdateService] Failed to load electron-updater:', err)
      return null
    }
  }
  return autoUpdater
}

const PUBLISH_OWNER = 'bangbang8000-cell'
const PUBLISH_REPO = 'AutoLink'
const RELEASES_PAGE_URL = `https://github.com/${PUBLISH_OWNER}/${PUBLISH_REPO}/releases/latest`

/** 当前平台对应的 latest yml 文件名 */
function getPlatformYmlName(): string {
  switch (process.platform) {
    case 'darwin': return 'latest-mac.yml'
    case 'linux': return 'latest-linux.yml'
    default: return 'latest.yml'
  }
}

/** 缓存 fallback 通道检测到的下载信息,供 downloadUpdate 使用 */
interface FallbackDownloadInfo {
  version: string
  downloadUrl: string
  fileName: string
  /** 509-a：平台响应 / latest.yml 提供的 sha512（hex 或 base64），缺失则退化为 Content-Length */
  sha512?: string
}
let cachedFallbackInfo: FallbackDownloadInfo | null = null

/** 509-b：本地版本低于平台最低要求（版本锁定，需提示升级） */
let lockBelowRequired = false

interface CheckResult {
  updateAvailable: boolean
  version?: string
  releaseNotes?: string | unknown
  error?: string
  /** 509-b：本地版本低于平台最低要求，需提示升级 */
  lockRequired?: boolean
}

/** 平台版本响应（flat 字段 + additive channels），字段均可缺省，不阻塞主流程 */
interface PlatformVersionInfo {
  latest_version?: string
  download_url?: string
  sha512?: string
  min_required_version?: string
  release_notes?: string
  channels?: Array<{
    name?: string
    sha512?: string
    mirrors?: string[]
    min_required_version?: string
  }>
}

/**
 * 调用平台 /api/v1/client/version?channel= 读取版本信息（灰度通道 sha512 + 版本锁定）。
 * 仅在配置了 platformBaseUrl 时启用，任何失败返回 null 并回退默认链路（不阻塞）。
 */
async function fetchPlatformVersionInfo(settings: UpdateSettings, channel: string): Promise<PlatformVersionInfo | null> {
  if (!settings.platformBaseUrl) return null
  try {
    const url = `${settings.platformBaseUrl}/api/v1/client/version?channel=${encodeURIComponent(channel || 'stable')}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = (await res.json()) as unknown
    // 解包服务端 success() 包装 {code,data}
    if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>
      if (typeof obj.code === 'number' && 'data' in obj) return (obj.data as PlatformVersionInfo) || null
      return obj as PlatformVersionInfo
    }
    return json as PlatformVersionInfo
  } catch {
    return null
  }
}

/**
 * 备用更新检查:直接用 Electron net 模块请求 latest.yml 并解析版本号 + 下载路径。
 * 当 electron-updater 模块加载失败或 checkForUpdates 网络异常时启用。
 * 相比 electron-updater,net 模块走 Chromium 网络栈,对国内网络更友好。
 *
 * v2.6.9: 除版本号外,额外解析 path 字段构造下载 URL,缓存到 cachedFallbackInfo,
 * 使 downloadUpdate 能直接下载安装包(正向解决下载失败问题)。
 */
async function checkLatestYmlFallback(timeoutMs = 15000): Promise<CheckResult> {
  // 509-a：灰度通道按配置 updateChannel 选择 latest*-<channel>.yml；509-b：企业部署自定义内网镜像
  const settings = readUpdateSettings(path.join(app.getPath('userData'), 'update.config.json'))
  const ymlName = resolveYmlNameForChannel(settings.updateChannel, getPlatformYmlName())
  const enterpriseUpdateUrl = settings.enableEnterpriseDeploy && settings.updateUrl ? settings.updateUrl.trim() : ''
  const isInternalYml = enterpriseUpdateUrl && /\.ya?ml$/i.test(enterpriseUpdateUrl)
  const ymlUrl = isInternalYml ? enterpriseUpdateUrl : `https://github.com/${PUBLISH_OWNER}/${PUBLISH_REPO}/releases/latest/download/${ymlName}`

  // 509-b：平台版本信息（灰度通道 sha512 + 版本锁定），失败不阻塞，回退默认链路
  const platformInfo = await fetchPlatformVersionInfo(settings, settings.updateChannel)
  let lockRequired = false
  if (platformInfo) {
    const current = app.getVersion()
    lockRequired = isBelowMinRequired(current, platformInfo.min_required_version)
    const chObj = (platformInfo.channels || []).find(
      (c) => (c.name || '').toLowerCase() === settings.updateChannel.toLowerCase(),
    )
    if (chObj && typeof chObj.min_required_version === 'string') {
      lockRequired = lockRequired || isBelowMinRequired(current, chObj.min_required_version)
    }
  }
  lockBelowRequired = lockRequired

  return new Promise((resolve) => {
    const request = net.request(ymlUrl)
    const timeout = setTimeout(() => {
      request.abort()
      resolve({ updateAvailable: false, error: 'Request timeout' })
    }, timeoutMs)

    request.on('response', (response) => {
      let body = ''
      response.on('data', (chunk: Buffer) => { body += chunk.toString() })
      response.on('end', () => {
        clearTimeout(timeout)
        if (response.statusCode !== 200) {
          resolve({ updateAvailable: false, error: `HTTP ${response.statusCode}` })
          return
        }
        // 解析 latest.yml 中的 version 字段
        const versionMatch = body.match(/^version:\s*(.+)$/m)
        if (!versionMatch) {
          resolve({ updateAvailable: false, error: 'Failed to parse latest.yml' })
          return
        }
        const latestVersion = versionMatch[1].trim()
        const currentVersion = app.getVersion()
        // V2.7.7: 统一使用 isVersionNewer, 线上版本 = 当前版本 或 当前版本无效时均不触发更新
        const isNewer = isVersionNewer(latestVersion, currentVersion)
        console.log(`[UpdateService] Fallback check: latest=${latestVersion}, current=${currentVersion}, newer=${isNewer}`)

        // 解析 path 字段(当前平台安装包文件名),构造下载 URL 并缓存
        // V2.7.7: 仅在有新版本时缓存下载信息, 避免相等/无效版本时污染 downloadUpdate 路径
        const pathMatch = body.match(/^path:\s*(.+)$/m)
        // 509-a：sha512 优先平台响应（additive channels / flat），缺失则取 latest.yml 内 sha512
        let sha512 = parseSha512FromYml(body)
        if (!sha512 && platformInfo) {
          const chObj = (platformInfo.channels || []).find(
            (c) => (c.name || '').toLowerCase() === settings.updateChannel.toLowerCase(),
          )
          sha512 = chObj?.sha512 || platformInfo.sha512
        }
        const shouldNotify = isNewer || lockRequired
        if (shouldNotify && pathMatch) {
          const fileName = pathMatch[1].trim()
          // 企业内网镜像：下载地址从镜像源推导；否则走 GitHub Releases
          const downloadUrl = isInternalYml
            ? new URL(path.basename(fileName), enterpriseUpdateUrl).toString()
            : `https://github.com/${PUBLISH_OWNER}/${PUBLISH_REPO}/releases/latest/download/${encodeURIComponent(fileName)}`
          cachedFallbackInfo = { version: latestVersion, downloadUrl, fileName, sha512 }
          console.log(`[UpdateService] Fallback cached download info: ${fileName}`)
        }

        resolve({
          updateAvailable: shouldNotify,
          version: shouldNotify ? latestVersion : undefined,
          lockRequired: lockRequired || undefined,
        })
      })
    })

    request.on('error', (err) => {
      clearTimeout(timeout)
      console.error('[UpdateService] Fallback request error:', err.message)
      resolve({ updateAvailable: false, error: err.message })
    })

    request.end()
  })
}

/** 简单的 semver 比较已移至 electron/utils/version.ts (isVersionNewer) */

/**
 * 断点续传式直接下载安装包到本地文件（509-a）。
 *  - 写临时文件 xxx.part；失败/中断后按 .part 文件大小续传，对支持 Range 的服务器发 Range: bytes=<offset>-。
 *  - 服务器返回 200（不支持 Range）时从 0 重下。
 *  - 完成后从 .part 改名，并做完整性校验：优先 sha512，缺失退化为 Content-Length。
 *  - 支持企业部署自定义代理 proxy（走 Node http/https CONNECT）。
 */
function downloadInstallerFile(
  url: string,
  localPath: string,
  onProgress: (percent: number) => void,
  opts: { sha512?: string; proxy?: string } = {},
): Promise<void> {
  const partPath = partFileFor(localPath)
  const startOffset = resumeOffset(partPath)
  if (opts.proxy) {
    return streamViaNodeProxy(url, opts.proxy, partPath, startOffset, onProgress)
      .then(() => finalizeDownload(partPath, localPath, opts.sha512))
  }
  return streamViaNet(url, partPath, startOffset, onProgress)
    .then(() => finalizeDownload(partPath, localPath, opts.sha512))
}

/** 下载完成后：sha512 强校验（缺失退化为流内 Content-Length 校验）+ .part 改名 */
async function finalizeDownload(partPath: string, localPath: string, sha512?: string): Promise<void> {
  if (sha512) {
    const actualHex = await computeSha512(partPath)
    if (!sha512Matches(sha512, actualHex)) {
      try {
        fs.unlinkSync(partPath)
      } catch {
        /* ignore */
      }
      throw new Error('sha512 integrity check failed')
    }
  }
  // 改名 .part -> 目标文件（断点续传完成）
  fs.renameSync(partPath, localPath)
}

/** 使用 Electron net 模块流式下载（支持 Range 续传 + 3xx 重定向 + Content-Length 校验） */
function streamViaNet(url: string, partPath: string, startOffset: number, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl: string, redirectCount: number, offset: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }
      let fileStream: fs.WriteStream | null = null
      let totalBytes = 0
      let receivedBytes = 0
      let settled = false

      const finishStream = (fileStream: fs.WriteStream): Promise<void> =>
        new Promise((res) => fileStream.end(res))

      const reqOpts: string | Electron.ClientRequestConstructorOptions =
        offset > 0 ? { url: requestUrl, method: 'GET', headers: { Range: `bytes=${offset}-` } } : requestUrl
      const request = net.request(reqOpts)

      request.on('response', (response) => {
        const statusCode = response.statusCode || 0
        // 处理重定向
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const location = response.headers.location
          if (location) {
            ;(response as unknown as { destroy: () => void }).destroy()
            doRequest(Array.isArray(location) ? location[0] : location, redirectCount + 1, offset)
            return
          }
        }
        if (fileStream) {
          fileStream.destroy()
          fileStream = null
        }
        if (statusCode === 206) {
          // 断点续传：追加写
          const cr = parseContentRange(response.headers['content-range'])
          totalBytes = cr && cr.total > 0 ? cr.total : 0
          receivedBytes = cr && cr.start >= 0 ? cr.start : offset
          fileStream = fs.createWriteStream(partPath, { flags: 'a' })
        } else if (statusCode === 200) {
          if (offset > 0) {
            // 服务器不支持 Range，从 0 重下
            try {
              fs.truncateSync(partPath, 0)
            } catch {
              /* ignore */
            }
            receivedBytes = 0
          }
          const contentLength = response.headers['content-length']
          totalBytes = parseInt(Array.isArray(contentLength) ? contentLength[0] : contentLength || '0', 10)
          fileStream = fs.createWriteStream(partPath, { flags: 'w' })
        } else {
          if (!settled) {
            settled = true
            reject(new Error(`HTTP ${statusCode}`))
          }
          return
        }

        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length
          fileStream?.write(chunk)
          if (totalBytes > 0) {
            onProgress(Math.min(100, (receivedBytes / totalBytes) * 100))
          }
        })
        response.on('end', () => {
          if (fileStream) {
            finishStream(fileStream).then(() => {
              if (!settled) {
                if (totalBytes > 0 && receivedBytes !== totalBytes) {
                  settled = true
                  try {
                    fs.unlinkSync(partPath)
                  } catch {
                    /* ignore */
                  }
                  reject(new Error(`Download incomplete: ${receivedBytes}/${totalBytes} bytes`))
                  return
                }
                settled = true
                resolve()
              }
            })
          } else if (!settled) {
            settled = true
            resolve()
          }
        })
      })

      request.on('error', (err) => {
        if (fileStream) fileStream.destroy()
        // 网络错误保留 .part，便于下次续传
        if (!settled) {
          settled = true
          reject(err)
        }
      })

      request.end()
    }
    doRequest(url, 0, startOffset)
  })
}

/** 企业部署自定义代理下载（Node http/https）。http 目标绝对 URL 转发；https 目标 CONNECT 隧道。 */
function streamViaNodeProxy(
  targetUrl: string,
  proxyUrl: string,
  partPath: string,
  startOffset: number,
  onProgress: (percent: number) => void,
): Promise<void> {
  const proxy = new URL(proxyUrl)
  const proxyHost = proxy.hostname || '127.0.0.1'
  const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80)

  /** 建立 https 目标的 CONNECT 隧道，返回可复用的 socket */
  const openTunnel = (host: string, port: number): Promise<nodeNet.Socket> =>
    new Promise((res, rej) => {
      const socket = nodeNet.connect(proxyPort, proxyHost)
      socket.once('error', rej)
      socket.setTimeout(15000, () => socket.destroy(new Error('proxy tunnel timeout')))
      socket.once('connect', () => {
        socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`)
      })
      let buffered = ''
      socket.on('data', (chunk: Buffer) => {
        buffered += chunk.toString()
        const idx = buffered.indexOf('\r\n\r\n')
        if (idx === -1) return
        socket.removeAllListeners('data')
        if (!/^HTTP\/1\.[01] 200/.test(buffered.slice(0, idx))) {
          socket.destroy(new Error('proxy CONNECT refused'))
          return
        }
        if (buffered.length > idx + 4) socket.unshift(Buffer.from(buffered.slice(idx + 4)))
        socket.setTimeout(0)
        res(socket)
      })
    })

  return new Promise((resolve, reject) => {
    const doRequest = (url: string, redirectCount: number, offset: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }
      const target = new URL(url)
      const handleResponse = (res: http.IncomingMessage): void => {
        const statusCode = res.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const location = res.headers.location
          res.destroy()
          if (location) {
            doRequest(new URL(location, url).toString(), redirectCount + 1, offset)
            return
          }
        }
        let fileStream: fs.WriteStream | null = null
        let totalBytes = 0
        let receivedBytes = 0
        let settled = false

        if (statusCode === 206) {
          const cr = parseContentRange(res.headers['content-range'])
          totalBytes = cr && cr.total > 0 ? cr.total : 0
          receivedBytes = cr && cr.start >= 0 ? cr.start : offset
          fileStream = fs.createWriteStream(partPath, { flags: 'a' })
        } else if (statusCode === 200) {
          if (offset > 0) {
            try {
              fs.truncateSync(partPath, 0)
            } catch {
              /* ignore */
            }
            receivedBytes = 0
          }
          const cl = res.headers['content-length']
          totalBytes = parseInt(Array.isArray(cl) ? cl[0] : cl || '0', 10)
          fileStream = fs.createWriteStream(partPath, { flags: 'w' })
        } else {
          res.destroy()
          reject(new Error(`HTTP ${statusCode}`))
          return
        }

        res.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length
          fileStream?.write(chunk)
          if (totalBytes > 0) onProgress(Math.min(100, (receivedBytes / totalBytes) * 100))
        })
        res.on('end', () => {
          if (fileStream) {
            fileStream.end(() => {
              if (!settled) {
                if (totalBytes > 0 && receivedBytes !== totalBytes) {
                  settled = true
                  try {
                    fs.unlinkSync(partPath)
                  } catch {
                    /* ignore */
                  }
                  reject(new Error(`Download incomplete: ${receivedBytes}/${totalBytes} bytes`))
                  return
                }
                settled = true
                resolve()
              }
            })
          } else if (!settled) {
            settled = true
            resolve()
          }
        })
      }

      const settleError = (err: Error): void => {
        reject(err)
      }
      const endRequest = (req: http.ClientRequest): void => {
        req.on('error', settleError)
        req.end()
      }

      if (target.protocol === 'https:') {
        void openTunnel(target.hostname, Number(target.port) || 443).then((socket) => {
          const secure = https.request(
            {
              host: target.hostname,
              port: Number(target.port) || 443,
              path: target.pathname + target.search,
              method: 'GET',
              agent: false,
              headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
            },
            handleResponse,
          )
          // 复用 CONNECT 隧道 socket，跳过 TCP+TLS 握手
          ;(secure as unknown as { createConnection?: () => nodeNet.Socket }).createConnection = () => socket
          endRequest(secure)
        }, settleError)
        return
      }
      // http 目标经 http 代理：请求行带完整绝对 URL（代理转发）
      endRequest(
        http.request(
          {
            host: proxyHost,
            port: proxyPort,
            method: 'GET',
            path: url,
            headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
          },
          handleResponse,
        ),
      )
    }
    doRequest(targetUrl, 0, startOffset)
  })
}

class UpdateService {
  private mainWindow: BrowserWindow | null = null
  /** 上次检查更新是否走了 fallback 通道(fallback 通道需要用直接下载) */
  private lastCheckUsedFallback = false
  /** V3.4.1-L4: 进行中的检查去重（启动自动检查 + app:check-update 并发时只跑一次） */
  private checkInFlight: Promise<CheckResult> | null = null
  /** 509-a：回滚安装包管理（保守，仅保存/列出/清除，不自动反复安装） */
  private rollback = new RollbackManager(path.join(app.getPath('userData'), 'rollback'))

  setWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async checkForUpdates(): Promise<CheckResult> {
    if (this.checkInFlight) return this.checkInFlight
    this.checkInFlight = this.doCheckForUpdates()
    try {
      return await this.checkInFlight
    } finally {
      this.checkInFlight = null
    }
  }

  private async doCheckForUpdates(): Promise<CheckResult> {
    const updater = await getAutoUpdater()

    // 主路径:使用 electron-updater
    if (updater) {
      try {
        updater.autoDownload = false
        updater.autoInstallOnAppQuit = true

        const result = await updater.checkForUpdates()
        if (result?.updateInfo?.version) {
          // V2.7.7: 统一使用 isVersionNewer, 线上版本 = 当前版本 时 (compareVersions=0) 不触发更新
          const isNewer = isVersionNewer(result.updateInfo.version, app.getVersion())
          if (isNewer) {
            this.lastCheckUsedFallback = false
            this.mainWindow?.webContents.send('update:available', {
              version: result.updateInfo.version,
              releaseNotes: result.updateInfo.releaseNotes,
            })
            return { updateAvailable: true, version: result.updateInfo.version, releaseNotes: result.updateInfo.releaseNotes }
          }
          return { updateAvailable: false }
        }
        return { updateAvailable: false }
      } catch (err) {
        console.error('[UpdateService] electron-updater checkForUpdates failed, trying fallback:', err)
        // 主路径失败,尝试备用方案
        const fallback = await checkLatestYmlFallback()
        if (fallback.updateAvailable) {
          this.lastCheckUsedFallback = true
          // fallback 成功检测到新版本后,后台异步重试 electron-updater 的 checkForUpdates
          // 目的:填充 electron-updater 内部的 updateInfo 缓存,使后续 downloadUpdate 可用
          // 不阻塞返回,即使重试失败也不影响已检测到的版本信息
          this.refillUpdaterInfoInBackground(updater)
          this.mainWindow?.webContents.send('update:available', {
            version: fallback.version,
            releaseNotes: '',
            lockRequired: fallback.lockRequired,
          })
        }
        return fallback
      }
    }

    // electron-updater 模块不可用,直接用备用方案
    console.log('[UpdateService] electron-updater not available, using fallback')
    const fallback = await checkLatestYmlFallback()
    if (fallback.updateAvailable) {
      this.lastCheckUsedFallback = true
      this.mainWindow?.webContents.send('update:available', {
        version: fallback.version,
        releaseNotes: '',
        lockRequired: fallback.lockRequired,
      })
    }
    return fallback
  }

  /**
   * 后台异步重试 electron-updater 的 checkForUpdates,填充内部 updateInfo 缓存。
   * 用于 fallback 通道检测到新版本后,为后续 downloadUpdate 做准备。
   * 设置 20 秒超时,超时后放弃(用户可走直接下载 fallback)。
   */
  private refillUpdaterInfoInBackground(updater: typeof import('electron-updater').autoUpdater): void {
    const originalAutoDownload = updater.autoDownload
    updater.autoDownload = false
    // 包装 Promise.race 添加超时,避免后台重试无限挂起
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('refill timeout')), 20000)
    })
    Promise.race([
      updater.checkForUpdates(),
      timeoutPromise,
    ])
      .then((result) => {
        if (result?.updateInfo?.version) {
          console.log('[UpdateService] Background refill succeeded, updateInfo cached:', result.updateInfo.version)
        } else {
          console.log('[UpdateService] Background refill completed but no updateInfo')
        }
      })
      .catch((err) => {
        console.warn('[UpdateService] Background refill failed (download may use direct fallback):', err.message)
      })
      .finally(() => {
        updater.autoDownload = originalAutoDownload
      })
  }

  async downloadUpdate(): Promise<void> {
    const updater = await getAutoUpdater()

    // 如果上次检查走了 fallback 通道,优先用直接下载
    // (electron-updater 内部无 updateInfo 缓存,downloadUpdate() 会抛错)
    if (this.lastCheckUsedFallback && cachedFallbackInfo?.downloadUrl) {
      console.log('[UpdateService] Using direct download (fallback mode)')
      await this.downloadInstallerDirectly()
      return
    }

    if (!updater) {
      // electron-updater 不可用,尝试直接下载
      if (cachedFallbackInfo?.downloadUrl) {
        await this.downloadInstallerDirectly()
        return
      }
      throw new Error('electron-updater not available and no fallback info')
    }

    // 注册前先清理监听器，避免多次下载时监听器累积导致回调重复执行与内存泄漏
    updater.removeAllListeners('download-progress')
    updater.removeAllListeners('update-downloaded')
    updater.removeAllListeners('error')

    return new Promise<void>((resolve) => {
      let settled = false

      updater.on('download-progress', (progress: import('electron-updater').ProgressInfo) => {
        this.mainWindow?.webContents.send('update:downloadProgress', {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        })
      })

      updater.on('update-downloaded', () => {
        this.mainWindow?.webContents.send('update:downloaded')
        if (!settled) { settled = true; resolve() }
      })

      // v2.6.9: electron-updater 下载失败时,正向 fallback 到直接下载安装包
      const fallbackToDirectDownload = async (errMessage: string) => {
        if (settled) return
        console.warn('[UpdateService] electron-updater download failed, trying direct download:', errMessage)
        try {
          // 如果还没有缓存下载信息,先检查一次
          if (!cachedFallbackInfo) {
            await checkLatestYmlFallback()
          }
          if (cachedFallbackInfo?.downloadUrl) {
            await this.downloadInstallerDirectly()
            if (!settled) { settled = true; resolve() }
          } else {
            // 直接下载也不可用,回退到打开 Releases 页面
            this.mainWindow?.webContents.send('update:error', errMessage)
            this.openReleasesPage()
            if (!settled) { settled = true; resolve() }
          }
        } catch (directErr) {
          const msg = directErr instanceof Error ? directErr.message : String(directErr)
          console.warn('[UpdateService] Direct download also failed:', msg)
          this.mainWindow?.webContents.send('update:error', msg)
          this.openReleasesPage()
          if (!settled) { settled = true; resolve() }
        }
      }

      updater.on('error', (err: Error) => {
        fallbackToDirectDownload(err.message)
      })

      updater.downloadUpdate().catch((err) => {
        fallbackToDirectDownload(err instanceof Error ? err.message : String(err))
      })
    })
  }

  /**
   * 直接下载安装包到本地下载目录(fallback 通道, 509-a 断点续传 + sha512 强校验)。
   * 下载前若已有旧安装包则保存为回滚基线。下载完成后通知前端,用户点击"重启安装"时由 quitAndInstall 打开安装包。
   */
  private async downloadInstallerDirectly(): Promise<void> {
    if (!cachedFallbackInfo?.downloadUrl) {
      throw new Error('No download URL available')
    }
    const settings = readUpdateSettings(path.join(app.getPath('userData'), 'update.config.json'))
    const { downloadUrl, fileName, sha512 } = cachedFallbackInfo
    const downloadsPath = app.getPath('downloads')
    // V3.4.1-L3: fileName 来自 yml path 字段，必须 basename 防本地路径拼接越界
    const localPath = path.join(downloadsPath, path.basename(fileName))

    // 509-a：安装前保留既有安装包为回滚基线（保守，不自动反复安装）
    if (fs.existsSync(localPath)) {
      try {
        this.rollback.save(localPath, cachedFallbackInfo.version)
      } catch {
        /* 回滚保存失败不阻断主流程 */
      }
    }

    console.log(`[UpdateService] Direct downloading ${fileName} to ${localPath}`)
    this.mainWindow?.webContents.send('update:downloadProgress', { percent: 0 })

    await downloadInstallerFile(
      downloadUrl,
      localPath,
      (percent) => {
        this.mainWindow?.webContents.send('update:downloadProgress', { percent: Math.round(percent) })
      },
      { sha512, proxy: settings.enableEnterpriseDeploy ? settings.proxy : '' },
    )

    console.log('[UpdateService] Direct download completed:', localPath)
    this.mainWindow?.webContents.send('update:downloaded')
  }

  /** 打开 GitHub Releases 页面(用于手动下载) */
  openReleasesPage(): void {
    import('electron').then(({ shell }) => {
      shell.openExternal(RELEASES_PAGE_URL)
    })
  }

  quitAndInstall(): void {
    // 直接下载场景:打开下载的安装包并退出应用
    if (cachedFallbackInfo) {
      const downloadsPath = app.getPath('downloads')
      const localPath = path.join(downloadsPath, path.basename(cachedFallbackInfo.fileName))
      console.log('[UpdateService] Opening installer and quitting:', localPath)
      import('electron').then(({ shell }) => {
        // V3.4.1-M7: 确认安装包真实存在后再打开，避免打开残缺/缺失文件
        if (fs.existsSync(localPath)) {
          shell.openPath(localPath)
          // 稍延迟退出,确保 shell.openPath 执行完成
          setTimeout(() => app.quit(), 500)
        } else {
          console.error('[UpdateService] Installer file missing, not quitting:', localPath)
        }
      })
      return
    }
    // electron-updater 场景
    if (autoUpdater) {
      autoUpdater.quitAndInstall()
    }
  }

  /* ===== 509-a 回滚基线暴露（保守，仅列出/清除） ===== */

  getRollbackEntries(): { version: string; filePath: string; savedAt: string }[] {
    return this.rollback.list().map((e) => ({ version: e.version, filePath: e.filePath, savedAt: e.savedAt }))
  }

  clearRollback(): void {
    this.rollback.clear()
  }

  /** 509-b：当前本地版本是否低于平台最低要求（版本锁定） */
  getVersionLock(): boolean {
    return lockBelowRequired
  }
}

export const updateService = new UpdateService()
