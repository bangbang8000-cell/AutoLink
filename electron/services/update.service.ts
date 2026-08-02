import { BrowserWindow, app, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { isVersionNewer } from '../utils/version.js'

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
}
let cachedFallbackInfo: FallbackDownloadInfo | null = null

interface CheckResult {
  updateAvailable: boolean
  version?: string
  releaseNotes?: string | unknown
  error?: string
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
  const ymlName = getPlatformYmlName()
  const ymlUrl = `https://github.com/${PUBLISH_OWNER}/${PUBLISH_REPO}/releases/latest/download/${ymlName}`
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
        if (isNewer && pathMatch) {
          const fileName = pathMatch[1].trim()
          const downloadUrl = `https://github.com/${PUBLISH_OWNER}/${PUBLISH_REPO}/releases/latest/download/${encodeURIComponent(fileName)}`
          cachedFallbackInfo = { version: latestVersion, downloadUrl, fileName }
          console.log(`[UpdateService] Fallback cached download info: ${fileName}`)
        }

        resolve({
          updateAvailable: isNewer,
          version: isNewer ? latestVersion : undefined,
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
 * 直接下载安装包到本地文件。
 * 使用 Electron net 模块,手动处理 3xx 重定向(GitHub Releases 会 302 到 objects.githubusercontent.com)。
 */
function downloadInstallerFile(
  url: string,
  localPath: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }
      const request = net.request(requestUrl)
      let fileStream: fs.WriteStream | null = null
      let totalBytes = 0
      let receivedBytes = 0
      let settled = false

      request.on('response', (response) => {
        const statusCode = response.statusCode || 0
        // 处理重定向
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const location = response.headers.location
          if (location) {
            // IncomingMessage 运行时继承自 stream.Readable,但类型定义未暴露 destroy
            ;(response as unknown as { destroy: () => void }).destroy()
            doRequest(Array.isArray(location) ? location[0] : location, redirectCount + 1)
            return
          }
        }
        if (statusCode !== 200) {
          if (!settled) { settled = true; reject(new Error(`HTTP ${statusCode}`)) }
          return
        }
        const contentLength = response.headers['content-length']
        totalBytes = parseInt(Array.isArray(contentLength) ? contentLength[0] : (contentLength || '0'), 10)
        fileStream = fs.createWriteStream(localPath)
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length
          fileStream?.write(chunk)
          if (totalBytes > 0) {
            onProgress((receivedBytes / totalBytes) * 100)
          }
        })
        response.on('end', () => {
          if (fileStream) {
            fileStream.end(() => {
              if (!settled) { settled = true; resolve() }
            })
          } else if (!settled) {
            settled = true
            resolve()
          }
        })
      })

      request.on('error', (err) => {
        if (fileStream) fileStream.destroy()
        try { fs.unlinkSync(localPath) } catch { /* ignore */ }
        if (!settled) { settled = true; reject(err) }
      })

      request.end()
    }
    doRequest(url, 0)
  })
}

class UpdateService {
  private mainWindow: BrowserWindow | null = null
  /** 上次检查更新是否走了 fallback 通道(fallback 通道需要用直接下载) */
  private lastCheckUsedFallback = false

  setWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async checkForUpdates(): Promise<CheckResult> {
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
   * 直接下载安装包到本地下载目录(fallback 通道)。
   * 下载完成后通知前端,用户点击"重启安装"时由 quitAndInstall 打开安装包。
   */
  private async downloadInstallerDirectly(): Promise<void> {
    if (!cachedFallbackInfo?.downloadUrl) {
      throw new Error('No download URL available')
    }
    const { downloadUrl, fileName } = cachedFallbackInfo
    const downloadsPath = app.getPath('downloads')
    const localPath = path.join(downloadsPath, fileName)

    console.log(`[UpdateService] Direct downloading ${fileName} to ${localPath}`)
    this.mainWindow?.webContents.send('update:downloadProgress', { percent: 0 })

    await downloadInstallerFile(downloadUrl, localPath, (percent) => {
      this.mainWindow?.webContents.send('update:downloadProgress', { percent: Math.round(percent) })
    })

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
      const localPath = path.join(downloadsPath, cachedFallbackInfo.fileName)
      console.log('[UpdateService] Opening installer and quitting:', localPath)
      import('electron').then(({ shell }) => {
        shell.openPath(localPath)
        // 稍延迟退出,确保 shell.openPath 执行完成
        setTimeout(() => app.quit(), 500)
      })
      return
    }
    // electron-updater 场景
    if (autoUpdater) {
      autoUpdater.quitAndInstall()
    }
  }
}

export const updateService = new UpdateService()
