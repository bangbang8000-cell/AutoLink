import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { isDev, initializeAppDirs, ensureDemoProjects } from './config.js'
import { setupIpcHandlers } from './ipc/handlers.js'
import { updateService } from './services/update.service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class AutoLinkApp {
  private mainWindow: BrowserWindow | null = null

  async initialize(): Promise<void> {
    await app.whenReady()
    initializeAppDirs()
    ensureDemoProjects()
    this.createMainWindow()
    Menu.setApplicationMenu(null)
    setupIpcHandlers(this.mainWindow!)
    this.registerAppEvents()
  }

  private createMainWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 800,
      frame: false,
      title: 'AutoLink',
      icon: path.join(__dirname, '..', 'public', 'icons', 'icon.ico'),
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

    this.mainWindow.show()

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
