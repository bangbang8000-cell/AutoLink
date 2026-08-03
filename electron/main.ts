import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { isDev, initializeAppDirs, ensureDemoProjects } from './config.js'
import { setupIpcHandlers } from './ipc/handlers.js'
import { updateService } from './services/update.service.js'
import { pythonService } from './services/python.service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class AutoLinkApp {
  private mainWindow: BrowserWindow | null = null
  private splashWindow: BrowserWindow | null = null
  private splashStartTime = 0

  async initialize(): Promise<void> {
    await app.whenReady()
    initializeAppDirs()
    ensureDemoProjects()
    this.splashStartTime = Date.now()
    this.createSplashWindow()
    Menu.setApplicationMenu(null)
    setupIpcHandlers(this.mainWindow!)
    this.registerAppEvents()
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
      this.splashWindow.loadURL('http://localhost:5173/splash.html')
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
        sandbox: false,
      },
    })

    if (isDev) {
      this.mainWindow.loadURL('http://localhost:5173')
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    }

    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

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

    // Window control IPC
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
