import { BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { getWorkspacePath, getTemplatePath, getBackendPath } from '../config'
import { pythonService } from '../services/python.service'

export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  // ===== Project Management =====
  ipcMain.handle('project:list', async () => {
    const wsp = getWorkspacePath()
    if (!fs.existsSync(wsp)) return []
    const dirs = fs.readdirSync(wsp, { withFileTypes: true })
    return dirs
      .filter((d) => d.isDirectory())
      .map((d, i) => ({
        id: i + 1,
        name: d.name,
        index: i,
      }))
  })

  ipcMain.handle('project:create', async (_event, name: string, options?: { template?: string; empty?: boolean }) => {
    const wsp = getWorkspacePath()
    const projectDir = path.join(wsp, name)
    if (fs.existsSync(projectDir)) {
      throw new Error(`项目 "${name}" 已存在`)
    }

    fs.mkdirSync(projectDir, { recursive: true })
    fs.mkdirSync(path.join(projectDir, 'output'), { recursive: true })

    if (options?.template && !options.empty) {
      const tplDir = path.join(getTemplatePath(), options.template)
      const tplConfig = path.join(tplDir, 'network_config.ini')
      if (fs.existsSync(tplConfig)) {
        fs.copyFileSync(tplConfig, path.join(projectDir, 'network_config.ini'))
      }
    } else {
      const defaultConfig = path.join(getBackendPath(), 'network_config.ini')
      if (fs.existsSync(defaultConfig)) {
        fs.copyFileSync(defaultConfig, path.join(projectDir, 'network_config.ini'))
      }
    }

    const meta = {
      name,
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    }
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(meta, null, 2), 'utf-8')
  })

  ipcMain.handle('project:delete', async (_event, ids: string[]) => {
    const wsp = getWorkspacePath()
    const dirs = fs.readdirSync(wsp, { withFileTypes: true }).filter((d) => d.isDirectory())
    for (const id of ids) {
      const idx = parseInt(id) - 1
      if (idx >= 0 && idx < dirs.length) {
        const projectDir = path.join(wsp, dirs[idx].name)
        if (fs.existsSync(projectDir)) {
          fs.rmSync(projectDir, { recursive: true, force: true })
        }
      }
    }
  })

  ipcMain.handle('project:getStructure', async (_event, name: string) => {
    const projectDir = path.join(getWorkspacePath(), name)
    if (!fs.existsSync(projectDir)) return []

    function walkDir(dir: string): { name: string; type: string; children?: unknown[] }[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      return entries.map((e) => {
        if (e.isDirectory()) {
          return { name: e.name, type: 'directory', children: walkDir(path.join(dir, e.name)) }
        }
        return { name: e.name, type: 'file' }
      })
    }
    return walkDir(projectDir)
  })

  // ===== Design =====
  ipcMain.handle('design:generate', async (_event, config: Record<string, unknown>) => {
    return pythonService.call('design', { config })
  })

  ipcMain.handle('design:validate', async (_event, config: Record<string, unknown>) => {
    return pythonService.call('validate', { config })
  })

  // ===== Render =====
  ipcMain.handle('render:exportConnections', async (_event, projectName: string, outputTypes: string[]) => {
    const projectDir = path.join(getWorkspacePath(), projectName)
    const configPath = path.join(projectDir, 'network_config.ini')
    const outputDir = path.join(projectDir, 'output')

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    mainWindow.webContents.send('render:progress', {
      status: 'start',
      message: '开始渲染...',
    })

    try {
      const result = await pythonService.call('export', {
        configFile: configPath,
        outputDir,
        outputTypes,
      })

      mainWindow.webContents.send('render:progress', {
        status: 'complete',
        message: '渲染完成',
        data: result,
      })
      return result
    } catch (err) {
      mainWindow.webContents.send('render:progress', {
        status: 'error',
        message: (err as Error).message,
      })
      throw err
    }
  })

  // ===== App =====
  ipcMain.handle('app:getPath', (_event, name: string) => {
    if (name === 'workspace') return getWorkspacePath()
    if (name === 'templates') return getTemplatePath()
    return ''
  })

  ipcMain.handle('app:getVersion', () => {
    return '2.0.0'
  })

  // ===== Shell =====
  ipcMain.handle('shell:showItemInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('shell:openPath', (_event, filePath: string) => {
    return shell.openPath(filePath)
  })
}
