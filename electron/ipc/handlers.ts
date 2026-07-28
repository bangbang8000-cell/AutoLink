import { BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { getWorkspacePath, getTemplatePath, getBackendPath } from '../config.js'
import { pythonService } from '../services/python.service.js'

// Shared category-to-directory mapping for device library
const DEVICE_CATEGORY_PATH_MAP: Record<string, string> = {
  gpu_servers: 'gpu_servers',
  compute_servers: 'compute_servers',
  storage_servers_all_flash: 'storage_servers/all_flash',
  storage_servers_hybrid_flash: 'storage_servers/hybrid_flash',
  switches_param: 'switches/param',
  switches_storage: 'switches/storage',
  switches_biz: 'switches/biz',
  switches_oob: 'switches/oob',
  custom: 'custom',
}
import { updateService } from '../services/update.service.js'

// ===== Security Helpers =====
function sanitizePath(segments: string[]): string {
  const wsp = getWorkspacePath()
  const resolved = path.resolve(wsp, ...segments)
  if (!resolved.startsWith(wsp + path.sep) && resolved !== wsp) {
    throw new Error('路径遍历攻击被阻止')
  }
  return resolved
}

function sanitizeName(name: string): string {
  if (!name || name.includes('..') || path.isAbsolute(name)) {
    throw new Error(`无效的项目名称: ${name}`)
  }
  return name
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapHandler<T>(handler: (...args: any[]) => Promise<T>) {
  return async (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      console.error(`[IPC Error] ${event}:`, err)
      throw err
    }
  }
}

// ===== Device Library =====
function getDeviceLibraryPath(): string {
  const tplPath = getTemplatePath()
  return path.join(tplPath, 'device_library')
}

interface DeviceCategory {
  id: string
  name: string
  description?: string
  device_ids?: string[]
  devices: { id: string; [key: string]: unknown }[]
}

function loadDeviceLibrary(): { categories: DeviceCategory[] } {
  const libPath = getDeviceLibraryPath()
  const indexPath = path.join(libPath, 'library_index.json')

  if (!fs.existsSync(indexPath)) {
    return { categories: [] }
  }

  let index: { categories?: { id: string; name: string; description?: string; device_ids?: string[] }[] }
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
  } catch (err) {
    console.error('[DeviceLibrary] Failed to parse library_index.json:', err)
    return { categories: [] }
  }

  // Map flat category IDs to nested directory paths

  const categories: DeviceCategory[] = []
  for (const cat of index.categories || []) {
    const catDir = DEVICE_CATEGORY_PATH_MAP[cat.id] || path.basename(cat.id)
    const devices: { id: string }[] = []
    for (const deviceId of cat.device_ids || []) {
      const safeDeviceId = path.basename(deviceId)
      const deviceFile = path.join(libPath, catDir, `${safeDeviceId}.json`)
      if (fs.existsSync(deviceFile)) {
        try {
          const deviceData = JSON.parse(fs.readFileSync(deviceFile, 'utf-8'))
          devices.push(deviceData)
        } catch (err) {
          console.error(`Failed to load device ${safeDeviceId}:`, err)
        }
      }
    }
    categories.push({
      id: cat.id,
      name: cat.name,
      description: cat.description,
      devices,
    })
  }

  return { categories }
}

function saveDeviceToFile(device: { id: string; category: string }): void {
  const libPath = getDeviceLibraryPath()
  const safeCategory = path.basename(device.category)
  const safeId = path.basename(device.id)

  const catDir = DEVICE_CATEGORY_PATH_MAP[device.category] || 'custom'

  const deviceFile = path.join(libPath, catDir, `${safeId}.json`)
  const catDirFull = path.dirname(deviceFile)
  if (!fs.existsSync(catDirFull)) {
    fs.mkdirSync(catDirFull, { recursive: true })
  }

  fs.writeFileSync(deviceFile, JSON.stringify(device, null, 2), 'utf-8')
}

function deleteDeviceFile(deviceId: string): void {
  const libPath = getDeviceLibraryPath()
  const safeId = path.basename(deviceId)
  if (!fs.existsSync(libPath)) return

  const searchDirs = (dir: string): boolean => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (searchDirs(fullPath)) return true
      } else if (entry.name === `${safeId}.json`) {
        fs.unlinkSync(fullPath)
        return true
      }
    }
    return false
  }

  searchDirs(libPath)
}

// Log forwarding
export function sendLog(mainWindow: BrowserWindow | null, message: string, level: string = 'info') {
  mainWindow?.webContents.send('log:output', { message, level })
}

export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  // ===== Project Management =====
  ipcMain.handle('project:list', wrapHandler(async () => {
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
  }))

  ipcMain.handle('project:create', wrapHandler(async (_event, name: string, options?: { template?: string; empty?: boolean }) => {
    sanitizeName(name)
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
  }))

  ipcMain.handle('project:createWithConfig', wrapHandler(async (_event, config: {
    meta: { name: string; description: string; version: number; created_at: string; updated_at: string }
    networks: Record<string, boolean>
    topology: Record<string, unknown>
    device_refs: Record<string, unknown>
    rack_config: Record<string, unknown>
  }) => {
    sanitizeName(config.meta.name)
    const wsp = getWorkspacePath()
    const projectDir = path.join(wsp, config.meta.name)
    if (fs.existsSync(projectDir)) {
      throw new Error(`项目 "${config.meta.name}" 已存在`)
    }

    fs.mkdirSync(projectDir, { recursive: true })
    fs.mkdirSync(path.join(projectDir, 'output'), { recursive: true })

    fs.writeFileSync(
      path.join(projectDir, 'project_config.json'),
      JSON.stringify(config, null, 2),
      'utf-8',
    )

    const iniLines: string[] = []
    iniLines.push('[topology]')
    const t = config.topology
    iniLines.push(`downlink_mode = ${t.downlink_mode || 'custom'}`)
    iniLines.push(`num_gpu_servers = ${t.num_gpu_servers || 0}`)
    const totalStorage = (t as any).num_all_flash_storage != null
      ? ((t as any).num_all_flash_storage || 0) + ((t as any).num_hybrid_flash_storage || 0)
      : (t as any).num_storage_servers || 0
    iniLines.push(`num_storage_servers = ${totalStorage}`)
    iniLines.push(`num_compute_servers = ${t.num_compute_servers || 0}`)
    if (config.networks.param_network) {
      iniLines.push(`param_ports_per_server = ${t.param_ports_per_server || 8}`)
      iniLines.push(`param_switch_ports = ${t.param_switch_ports || 64}`)
      iniLines.push(`param_speed = ${t.param_speed || '400G'}`)
      iniLines.push(`param_downlink_limit = ${t.param_downlink_limit || 25}`)
    }
    if (config.networks.storage_network) {
      iniLines.push(`storage_ports_per_server = ${t.storage_ports_per_server || 1}`)
      iniLines.push(`storage_switch_ports = ${t.storage_switch_ports || 40}`)
      iniLines.push(`storage_speed = ${t.storage_speed || '200G'}`)
      iniLines.push(`storage_downlink_limit = ${t.storage_downlink_limit || 20}`)
    }
    if (config.networks.biz_network) {
      iniLines.push(`biz_downlink_limit = ${t.biz_downlink_limit || 25}`)
    }
    if (config.networks.oob_network) {
      iniLines.push(`oob_downlink_limit = ${t.oob_downlink_limit || 25}`)
    }
    fs.writeFileSync(path.join(projectDir, 'network_config.ini'), iniLines.join('\n'), 'utf-8')

    const meta = {
      name: config.meta.name,
      description: config.meta.description || '',
      createdAt: config.meta.created_at || new Date().toISOString(),
      updatedAt: config.meta.updated_at || new Date().toISOString(),
      version: config.meta.version || 1,
    }
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(meta, null, 2), 'utf-8')
  }))

  ipcMain.handle('project:delete', wrapHandler(async (_event, ids: string[]) => {
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
  }))

  ipcMain.handle('project:getStructure', wrapHandler(async (_event, name: string) => {
    sanitizeName(name)
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
  }))

  ipcMain.handle('project:getConfigFile', wrapHandler(async (_event, name: string) => {
    sanitizeName(name)
    const configPath = path.join(getWorkspacePath(), name, 'network_config.ini')
    if (!fs.existsSync(configPath)) return null
    return fs.readFileSync(configPath, 'utf-8')
  }))

  ipcMain.handle('project:getFile', wrapHandler(async (_event, name: string, filePath: string) => {
    sanitizeName(name)
    const fullPath = sanitizePath([name, filePath])
    if (!fs.existsSync(fullPath)) return null
    return fs.readFileSync(fullPath, 'utf-8')
  }))

  ipcMain.handle('project:getFileBinary', wrapHandler(async (_event, name: string, filePath: string) => {
    sanitizeName(name)
    const fullPath = sanitizePath([name, filePath])
    if (!fs.existsSync(fullPath)) return null
    const buffer = fs.readFileSync(fullPath)
    return buffer.toString('base64')
  }))

  ipcMain.handle('project:listOutputFiles', wrapHandler(async (_event, name: string) => {
    sanitizeName(name)
    const outputDir = path.join(getWorkspacePath(), name, 'output')
    if (!fs.existsSync(outputDir)) return []
    const files = fs.readdirSync(outputDir, { withFileTypes: true })
    return files
      .filter((f) => f.isFile())
      .map((f) => ({ name: f.name, type: path.extname(f.name).toUpperCase().replace('.', '') || 'FILE' }))
  }))

  ipcMain.handle('project:listOutputBatches', wrapHandler(async (_event, projectName: string) => {
    sanitizeName(projectName)
    const outputDir = path.join(getWorkspacePath(), projectName, 'output')
    if (!fs.existsSync(outputDir)) return []

    const entries = fs.readdirSync(outputDir, { withFileTypes: true })
    return entries
      .filter((d) => d.isDirectory())
      .map((d) => {
        const batchFiles = fs.readdirSync(path.join(outputDir, d.name))
          .filter((f) => !f.startsWith('.'))
          .map((f) => ({ name: f, path: `${projectName}/output/${d.name}/${f}` }))
        return { name: d.name, files: batchFiles }
      })
  }))

  ipcMain.handle('project:saveConfigFile', wrapHandler(async (_event, name: string, content: string) => {
    sanitizeName(name)
    const projectDir = path.join(getWorkspacePath(), name)
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true })
    }
    fs.writeFileSync(path.join(projectDir, 'network_config.ini'), content, 'utf-8')
  }))

  // ===== Design =====
  ipcMain.handle('design:generate', wrapHandler(async (_event, projectName: string, configINI?: string) => {
    sanitizeName(projectName)
    const projectDir = path.join(getWorkspacePath(), projectName)
    const configPath = path.join(projectDir, 'network_config.ini')
    const jsonConfigPath = path.join(projectDir, 'project_config.json')

    if (configINI) {
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true })
      }
      fs.writeFileSync(configPath, configINI, 'utf-8')
      // 如果用户在设计中修改了配置，删除旧的 project_config.json
      // 确保后端使用最新的 INI 配置而非旧的 JSON 配置
      if (fs.existsSync(jsonConfigPath)) {
        fs.unlinkSync(jsonConfigPath)
      }
    }

    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`)
    }

    return pythonService.call('design', { configFile: configPath })
  }))

  ipcMain.handle('design:validate', wrapHandler(async (_event, projectName: string, configINI?: string) => {
    sanitizeName(projectName)
    const projectDir = path.join(getWorkspacePath(), projectName)
    const configPath = path.join(projectDir, 'network_config.ini')
    const jsonConfigPath = path.join(projectDir, 'project_config.json')

    if (configINI) {
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true })
      }
      fs.writeFileSync(configPath, configINI, 'utf-8')
      if (fs.existsSync(jsonConfigPath)) {
        fs.unlinkSync(jsonConfigPath)
      }
    }

    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`)
    }

    return pythonService.call('validate', { configFile: configPath })
  }))

  // ===== Render =====
  ipcMain.handle('render:exportConnections', wrapHandler(async (_event, projectName: string, outputTypes: string[]) => {
    sanitizeName(projectName)
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
  }))

  // ===== Export =====
  ipcMain.handle('export:saveFile', wrapHandler(async (_event, projectName: string, fileName: string, base64Data: string) => {
    sanitizeName(projectName)
    const projectDir = path.join(getWorkspacePath(), projectName)
    const outputDir = path.join(projectDir, 'output')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    const filePath = sanitizePath([projectName, 'output', fileName])
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(filePath, buffer)
    return filePath
  }))

  // ===== App =====
  ipcMain.handle('app:getPath', (_event, name: string) => {
    if (name === 'workspace') return getWorkspacePath()
    if (name === 'templates') return getTemplatePath()
    return ''
  })

  ipcMain.handle('app:getVersion', () => {
    // Read version dynamically from package.json
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'))
      return pkg.version || 'unknown'
    } catch {
      return 'unknown'
    }
  })

  // ===== Shell =====
  ipcMain.handle('shell:showItemInFolder', wrapHandler(async (_event, filePath: string) => {
    sanitizePath([filePath])
    shell.showItemInFolder(filePath)
  }))

  ipcMain.handle('shell:openPath', wrapHandler(async (_event, filePath: string) => {
    sanitizePath([filePath])
    return shell.openPath(filePath)
  }))

  // ===== Update =====
  updateService.setWindow(mainWindow)

  ipcMain.handle('app:check-update', wrapHandler(async () => {
    return updateService.checkForUpdates()
  }))

  ipcMain.handle('app:download-update', wrapHandler(async () => {
    return updateService.downloadUpdate()
  }))

  ipcMain.handle('app:quit-and-install', () => {
    updateService.quitAndInstall()
  })

  // ===== Device Library =====
  ipcMain.handle('device-library:list', wrapHandler(async () => {
    return loadDeviceLibrary()
  }))

  ipcMain.handle('device-library:get', wrapHandler(async (_event, deviceId: string) => {
    const libPath = getDeviceLibraryPath()
    const indexPath = path.join(libPath, 'library_index.json')
    if (!fs.existsSync(indexPath)) return null

    let index: { categories?: { id: string; device_ids?: string[] }[] }
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
    } catch {
      return null
    }

    for (const cat of index.categories || []) {
      const catDir = DEVICE_CATEGORY_PATH_MAP[cat.id] || path.basename(cat.id)
      const safeDeviceId = path.basename(deviceId)
      const deviceFile = path.join(libPath, catDir, `${safeDeviceId}.json`)
      if (fs.existsSync(deviceFile)) {
        try {
          return JSON.parse(fs.readFileSync(deviceFile, 'utf-8'))
        } catch {
          return null
        }
      }
    }
    return null
  }))

  ipcMain.handle('device-library:save', wrapHandler(async (_event, device: { id: string; category: string }) => {
    saveDeviceToFile(device)
  }))

  ipcMain.handle('device-library:delete', wrapHandler(async (_event, deviceId: string) => {
    deleteDeviceFile(deviceId)
  }))

  ipcMain.handle('device-library:import', wrapHandler(async (_event, devices: { id: string; category: string }[]) => {
    for (const device of devices) {
      saveDeviceToFile(device)
    }
  }))

  ipcMain.handle('device-library:export', wrapHandler(async (_event, deviceIds: string[], format: string) => {
    const libData = loadDeviceLibrary()
    const allDevices = libData.categories.flatMap((c) => c.devices)
    const selectedDevices = allDevices.filter((d) => deviceIds.includes(d.id))

    if (format === 'json') {
      return JSON.stringify(selectedDevices, null, 2)
    }

    return { devices: selectedDevices, format }
  }))

  // ===== Template =====
  ipcMain.handle('template:getStructure', wrapHandler(async (_event, templateName: string) => {
    sanitizeName(templateName)
    const tplDir = path.join(getTemplatePath(), templateName)
    if (!fs.existsSync(tplDir)) return []

    function walkDir(dir: string): { name: string; type: string; children?: unknown[] }[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      return entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => {
          if (e.isDirectory()) {
            return { name: e.name, type: 'directory', children: walkDir(path.join(dir, e.name)) }
          }
          return { name: e.name, type: 'file' }
        })
    }
    return walkDir(tplDir)
  }))

  ipcMain.handle('template:getFile', wrapHandler(async (_event, templateName: string, filePath: string) => {
    sanitizeName(templateName)
    const tplDir = getTemplatePath()
    const fullPath = path.resolve(tplDir, templateName, filePath)
    if (!fullPath.startsWith(tplDir + path.sep) && fullPath !== tplDir) {
      throw new Error('路径遍历攻击被阻止')
    }
    if (!fs.existsSync(fullPath)) return null
    return fs.readFileSync(fullPath, 'utf-8')
  }))

  interface TemplateMeta {
    name: string
    description: string
    scenario?: string
    tags?: string[]
    isBuiltin?: boolean
    createdAt?: string
    sourceProject?: string
  }

  ipcMain.handle('template:list', wrapHandler(async () => {
    const tplDir = getTemplatePath()
    if (!fs.existsSync(tplDir)) return []

    const entries = fs.readdirSync(tplDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => {
        const metaPath = path.join(tplDir, e.name, 'template.json')
        let meta: TemplateMeta = { name: e.name, description: '' }
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          } catch { /* ignore corrupt meta */ }
        }
        return {
          id: e.name,
          name: meta.name || e.name,
          description: meta.description || '',
          scenario: meta.scenario || '',
          tags: meta.tags || [],
          updatedAt: meta.createdAt || '',
          isBuiltin: !!meta.isBuiltin,
        }
      })
  }))

  ipcMain.handle('template:create', wrapHandler(async (_event, projectName: string, meta: TemplateMeta) => {
    sanitizeName(projectName)
    sanitizeName(meta.name)

    const wsp = getWorkspacePath()
    const tplDir = getTemplatePath()
    const srcDir = path.join(wsp, projectName)
    const destDir = path.join(tplDir, meta.name)

    if (!fs.existsSync(srcDir)) throw new Error(`项目 ${projectName} 不存在`)
    if (fs.existsSync(destDir)) throw new Error(`模板 ${meta.name} 已存在`)

    // Create template directory
    fs.mkdirSync(destDir, { recursive: true })

    // Copy config files
    const filesToCopy = ['network_config.ini', 'project_config.json', 'project.json']
    for (const file of filesToCopy) {
      const src = path.join(srcDir, file)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, file))
      }
    }

    // Write template metadata
    const templateMeta: TemplateMeta = {
      name: meta.name,
      description: meta.description || '',
      scenario: meta.scenario || '',
      tags: meta.tags || [],
      isBuiltin: false,
      createdAt: new Date().toISOString(),
      sourceProject: projectName,
    }
    fs.writeFileSync(path.join(destDir, 'template.json'), JSON.stringify(templateMeta, null, 2), 'utf-8')
  }))

  ipcMain.handle('template:delete', wrapHandler(async (_event, templateName: string) => {
    sanitizeName(templateName)
    const tplDir = getTemplatePath()
    const targetDir = path.join(tplDir, templateName)

    if (!fs.existsSync(targetDir)) throw new Error(`模板 ${templateName} 不存在`)

    // Check if builtin
    const metaPath = path.join(targetDir, 'template.json')
    if (fs.existsSync(metaPath)) {
      try {
        const meta: TemplateMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (meta.isBuiltin) throw new Error('内置模板不可删除')
      } catch (err) {
        if (err instanceof Error && err.message === '内置模板不可删除') throw err
        /* ignore corrupt meta */
      }
    }

    fs.rmSync(targetDir, { recursive: true, force: true })
  }))

  // ===== Output File Deletion =====
  ipcMain.handle('project:deleteOutputFile', wrapHandler(async (_event, projectName: string, filePath: string) => {
    sanitizeName(projectName)
    const fullPath = sanitizePath([projectName, 'output', filePath])
    if (!fs.existsSync(fullPath)) throw new Error('文件不存在')
    if (fs.statSync(fullPath).isDirectory()) throw new Error('不能删除目录，请使用删除批次功能')
    fs.rmSync(fullPath)
  }))

  ipcMain.handle('project:deleteOutputBatch', wrapHandler(async (_event, projectName: string, batchName: string) => {
    sanitizeName(projectName)
    sanitizeName(batchName)
    const fullPath = sanitizePath([projectName, 'output', batchName])
    if (!fs.existsSync(fullPath)) throw new Error('批次不存在')
    fs.rmSync(fullPath, { recursive: true, force: true })
  }))

  ipcMain.handle('project:clearOutput', wrapHandler(async (_event, projectName: string) => {
    sanitizeName(projectName)
    const outputDir = sanitizePath([projectName, 'output'])
    if (!fs.existsSync(outputDir)) return

    const entries = fs.readdirSync(outputDir, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(outputDir, entry.name)
      fs.rmSync(entryPath, { recursive: true, force: true })
    }
  }))
}