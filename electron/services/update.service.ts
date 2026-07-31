import { BrowserWindow, app } from 'electron'

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

class UpdateService {
  private mainWindow: BrowserWindow | null = null

  setWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async checkForUpdates(): Promise<{ updateAvailable: boolean; version?: string }> {
    const updater = await getAutoUpdater()
    if (!updater) {
      console.log('[UpdateService] electron-updater not available, skipping check')
      return { updateAvailable: false }
    }

    try {
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = true

      const result = await updater.checkForUpdates()
      if (result?.updateInfo?.version) {
        this.mainWindow?.webContents.send('update:available', {
          version: result.updateInfo.version,
          releaseNotes: result.updateInfo.releaseNotes,
        })
        return { updateAvailable: true, version: result.updateInfo.version }
      }
      return { updateAvailable: false }
    } catch (err) {
      console.error('[UpdateService] checkForUpdates failed:', err)
      return { updateAvailable: false }
    }
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
        this.mainWindow?.webContents.send('update:error', err.message)
        reject(err)
      })

      updater.downloadUpdate().catch(reject)
    })
  }

  quitAndInstall(): void {
    if (autoUpdater) {
      autoUpdater.quitAndInstall()
    }
  }
}

export const updateService = new UpdateService()
