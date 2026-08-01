import { BrowserWindow, app, net } from 'electron'

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
const LATEST_YML_URL = `https://github.com/${PUBLISH_OWNER}/${PUBLISH_REPO}/releases/latest/download/latest.yml`
const RELEASES_PAGE_URL = `https://github.com/${PUBLISH_OWNER}/${PUBLISH_REPO}/releases/latest`

interface CheckResult {
  updateAvailable: boolean
  version?: string
  releaseNotes?: string | unknown
  error?: string
}

/**
 * 备用更新检查:直接用 Electron net 模块请求 latest.yml 并解析版本号。
 * 当 electron-updater 模块加载失败或 checkForUpdates 网络异常时启用。
 * 相比 electron-updater,net 模块走 Chromium 网络栈,对国内网络更友好。
 */
async function checkLatestYmlFallback(timeoutMs = 15000): Promise<CheckResult> {
  return new Promise((resolve) => {
    const request = net.request(LATEST_YML_URL)
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
        const match = body.match(/^version:\s*(.+)$/m)
        if (!match) {
          resolve({ updateAvailable: false, error: 'Failed to parse latest.yml' })
          return
        }
        const latestVersion = match[1].trim()
        const currentVersion = app.getVersion()
        const isNewer = compareVersions(latestVersion, currentVersion) > 0
        console.log(`[UpdateService] Fallback check: latest=${latestVersion}, current=${currentVersion}, newer=${isNewer}`)
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

/** 简单的 semver 比较:返回 -1/0/1 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

class UpdateService {
  private mainWindow: BrowserWindow | null = null

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
          const isNewer = compareVersions(result.updateInfo.version, app.getVersion()) > 0
          if (isNewer) {
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
   * 设置 20 秒超时,超时后放弃(用户可走手动下载)。
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
        console.warn('[UpdateService] Background refill failed (download may need manual fallback):', err.message)
      })
      .finally(() => {
        updater.autoDownload = originalAutoDownload
      })
  }

  async downloadUpdate(): Promise<void> {
    const updater = await getAutoUpdater()
    if (!updater) {
      throw new Error('electron-updater not available')
    }

    // 注册前先清理监听器，避免多次下载时监听器累积导致回调重复执行与内存泄漏
    updater.removeAllListeners('download-progress')
    updater.removeAllListeners('update-downloaded')
    updater.removeAllListeners('error')

    return new Promise<void>((resolve, reject) => {
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
        resolve()
      })

      updater.on('error', (err: Error) => {
        console.warn('[UpdateService] Download error, falling back to releases page:', err.message)
        this.mainWindow?.webContents.send('update:error', err.message)
        // v2.6.9: 下载失败时回退到打开 Releases 页面，不 reject
        this.openReleasesPage()
        resolve()
      })

      updater.downloadUpdate().catch((err) => {
        console.warn('[UpdateService] downloadUpdate() threw, opening releases page:', err.message)
        this.mainWindow?.webContents.send('update:error', err.message)
        this.openReleasesPage()
        resolve()
      })
    })
  }

  /** 打开 GitHub Releases 页面(用于手动下载) */
  openReleasesPage(): void {
    import('electron').then(({ shell }) => {
      shell.openExternal(RELEASES_PAGE_URL)
    })
  }

  quitAndInstall(): void {
    if (autoUpdater) {
      autoUpdater.quitAndInstall()
    }
  }
}

export const updateService = new UpdateService()
