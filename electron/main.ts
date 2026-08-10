import { app, BrowserWindow, ipcMain, Menu, shell, session } from 'electron'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { isDev, initializeAppDirs, ensureDemoProjects } from './config.js'
import { setupIpcHandlers } from './ipc/handlers.js'
import { updateService } from './services/update.service.js'
import { pythonService } from './services/python.service.js'
import { initCrashReporting, registerProcessGuards, watchRendererCrashes } from './utils/crash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class AutoLinkApp {
  private mainWindow: BrowserWindow | null = null
  private splashWindow: BrowserWindow | null = null
  private splashStartTime = 0

  async initialize(): Promise<void> {
    initCrashReporting()
    registerProcessGuards()
    await app.whenReady()
    initializeAppDirs()
    ensureDemoProjects()
    this.registerCsp()
    this.splashStartTime = Date.now()
    this.createSplashWindow()
    Menu.setApplicationMenu(null)
    setupIpcHandlers(this.mainWindow!)
    this.registerWindowIpc()
    this.registerAppEvents()
  }

  /**
   * 窗口控制 IPC 一次性注册（不能在 createMainWindow 里重复注册：
   * macOS 关窗不退出，activate 重建窗口会第二次 ipcMain.handle 同一通道导致崩溃）
   */
  private registerWindowIpc(): void {
    ipcMain.handle('window:minimize', () => this.mainWindow?.minimize())
    ipcMain.handle('window:maximize', () => {
      if (this.mainWindow?.isMaximized()) {
        this.mainWindow.unmaximize()
      } else {
        this.mainWindow?.maximize()
      }
    })
    ipcMain.handle('window:close', () => this.mainWindow?.close())
    ipcMain.handle('window:isMaximized', () => this.mainWindow?.isMaximized() ?? false)
  }

  /**
   * V3.2.2-R11.1: CSP 注入
   *  - dev 需放宽：React Refresh preamble 是 inline script（script-src 加 'unsafe-inline'），
   *    Vite HMR 需 ws://localhost:5174；prod 收紧为纯 self（与 meta 宽松版交集后仍为严格）
   *  - 与 index.html / splash.html 的 meta CSP 配合（双保险）
   */
  private registerCsp(): void {
    const scriptSrc = isDev
      ? ["script-src 'self' 'unsafe-inline'"]
      : ["script-src 'self'"]
    const base = [
      "default-src 'self'",
      ...scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ]
    const connectSrc = isDev
      ? ["connect-src 'self' http://localhost:5174 ws://localhost:5174"]
      : ["connect-src 'self'", "frame-ancestors 'none'"]
    const csp = [...base, ...connectSrc].join('; ')
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      })
    })
  }

  private createSplashWindow(): void {
    this.splashWindow = new BrowserWindow({
      width: 440,
      height: 360,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      center: true,
      show: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    if (isDev) {
      this.splashWindow.loadURL('http://localhost:5174/splash.html')
    } else {
      this.splashWindow.loadFile(path.join(__dirname, '../dist/splash.html'))
    }

    this.splashWindow.on('closed', () => {
      this.splashWindow = null
    })

    // Create main window (hidden) while splash is showing
    this.createMainWindow()
  }

  private createMainWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 800,
      frame: false,
      title: 'AutoLink',
      icon: path.join(__dirname, '..', 'public', 'icons', 'icon.png'),
      backgroundColor: '#f9fafb',
      titleBarStyle: 'hidden',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        // V3.2.2-R11.1: preload 仅用 contextBridge/ipcRenderer/process.versions（sandbox 均支持），可安全开启
        sandbox: true,
      },
    })

    if (isDev) {
      this.mainWindow.loadURL('http://localhost:5174')
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    }

    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      // V3.2.2 加固：仅放行 https 外部链接（与 httpsUrlSchema 收紧口径一致）
      if (url.startsWith('https://')) {
        shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    // V3.2.2-R11.2: 渲染进程崩溃监控（脱敏留痕 + 自动恢复）
    watchRendererCrashes(this.mainWindow)

    // Show main window and close splash when ready (min 1.5s splash display)
    this.mainWindow.once('ready-to-show', () => {
      const minSplashTime = 1500
      const elapsed = Date.now() - this.splashStartTime
      const delay = Math.max(0, minSplashTime - elapsed)

      setTimeout(() => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.show()
          this.mainWindow.focus()
        }
        if (this.splashWindow && !this.splashWindow.isDestroyed()) {
          this.splashWindow.close()
        }
      }, delay)
    })

    this.mainWindow.on('closed', () => {
      this.mainWindow = null
    })

    // 窗口重建时重新绑定更新服务与崩溃监控（防止指向已销毁窗口）
    updateService.setWindow(this.mainWindow)
    this.mainWindow.on('maximize', () => {
      this.mainWindow?.webContents.send('window:maximizeChange', true)
    })
    this.mainWindow.on('unmaximize', () => {
      this.mainWindow?.webContents.send('window:maximizeChange', false)
    })
  }

  private registerAppEvents(): void {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit()
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow()
      }
    })

    // V3.0.0-T0-6: 退出时关闭 Python 长驻 Agent 进程
    app.on('will-quit', () => {
      pythonService.stop()
    })

    // Delayed update check (3s after startup)
    if (!isDev) {
      setTimeout(() => {
        updateService.setWindow(this.mainWindow!)
        updateService.checkForUpdates().catch((err) => {
          console.error('[AutoLink] Update check failed:', err)
        })
      }, 3000)
    }
  }
}

const autoLink = new AutoLinkApp()
autoLink.initialize().catch((err) => {
  console.error('Failed to start application:', err)
  app.quit()
})
