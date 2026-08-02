import { BrowserWindow, ipcMain, shell, dialog, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { getWorkspacePath, getTemplatePath, getUserTemplatePath, getBackendPath, getBrandingAssetPath, getDocPath } from '../config.js'
import { pythonService } from '../services/python.service.js'
import { projectIOService } from '../services/project-io.service.js'

// Shared category-to-directory mapping for device library
// V2.7.6-T8: 旧索引向后兼容映射 (新索引应在 category 中声明 "directory" 字段)
const DEVICE_CATEGORY_PATH_MAP: Record<string, string> = {
  gpu_servers: 'gpu_servers',
  compute_servers: 'compute_servers',
  storage_servers_all_flash: 'storage_servers/all_flash',
  storage_servers_hybrid_flash: 'storage_servers/hybrid_flash',
  storage_servers_parallel_fs: 'storage_servers/parallel_fs',
  switches_param: 'switches/param',
  switches_storage: 'switches/storage',
  switches_biz: 'switches/biz',
  switches_oob: 'switches/oob',
  optical_modules: 'optical_modules',
  custom: 'custom',
}

/**
 * V2.7.6-T8: 从 category 解析目录路径 (动态化)
 *  1. 优先使用 category.directory 字段
 *  2. 缺省时回退到 DEVICE_CATEGORY_PATH_MAP (旧索引兼容)
 *  3. 再缺省则使用 category.id 本身
 */
function resolveCategoryDir(cat: { id: string; directory?: string }): string {
  return cat.directory || DEVICE_CATEGORY_PATH_MAP[cat.id] || path.basename(cat.id)
}
import { updateService } from '../services/update.service.js'

/**
 * 文件树节点类型(electron 端内联定义,避免跨 rootDir 导入 src/types)
 * 与 src/types/file-tree.ts 中的 FileTreeNode 保持同步
 */
interface FileTreeNode {
  name: string
  type: 'directory' | 'file'
  path: string
  size?: number
  updatedAt?: string
  children?: FileTreeNode[]
}

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

  let index: { categories?: { id: string; name: string; description?: string; directory?: string; device_ids?: string[] }[] }
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
  } catch (err) {
    console.error('[DeviceLibrary] Failed to parse library_index.json:', err)
    return { categories: [] }
  }

  // V2.7.6-T8: 使用 resolveCategoryDir 动态解析目录路径 (优先 category.directory 字段)
  const categories: DeviceCategory[] = []
  for (const cat of index.categories || []) {
    const catDir = resolveCategoryDir(cat)
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

function saveDeviceToFile(device: { id: string; category: string; directory?: string }): void {
  const libPath = getDeviceLibraryPath()
  const safeCategory = path.basename(device.category)
  const safeId = path.basename(device.id)

  // V2.7.6-T8: 使用 resolveCategoryDir 动态解析目录 (优先 device.directory, 再回退映射表)
  const catDir = resolveCategoryDir({ id: device.category, directory: device.directory })

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
  // U1: project:list 扩展返回 status/fileCount/updatedAt/description
  ipcMain.handle('project:list', wrapHandler(async () => {
    const wsp = getWorkspacePath()
    if (!fs.existsSync(wsp)) return []
    const dirs = fs.readdirSync(wsp, { withFileTypes: true })
      .filter((d) => d.isDirectory())
    return dirs.map((d, i) => {
      const projectDir = path.join(wsp, d.name)
      // 状态推断:基于关键文件存在性
      let status: 'ready' | 'configured' | 'designed' | 'layouted' = 'ready'
      if (fs.existsSync(path.join(projectDir, 'rack_layout.json'))) {
        status = 'layouted'
      } else if (fs.existsSync(path.join(projectDir, 'topology.json'))) {
        status = 'designed'
      } else if (
        fs.existsSync(path.join(projectDir, 'network_config.ini')) ||
        fs.existsSync(path.join(projectDir, 'project_config.json'))
      ) {
        status = 'configured'
      }
      // 读取 project.json 元数据
      let updatedAt: string | undefined
      let description: string | undefined
      try {
        const metaPath = path.join(projectDir, 'project.json')
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          updatedAt = meta.updatedAt
          description = meta.description
        }
      } catch { /* 忽略损坏的 project.json */ }
      // 文件数统计(递归,跳过 node_modules/.git)
      let fileCount = 0
      try {
        const countFiles = (dir: string): void => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              countFiles(fullPath)
            } else {
              fileCount++
            }
          }
        }
        countFiles(projectDir)
      } catch { /* 忽略统计失败 */ }
      return {
        id: i + 1,
        name: d.name,
        index: i,
        status,
        fileCount,
        updatedAt,
        description,
      }
    })
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

  ipcMain.handle('project:delete', wrapHandler(async (_event, names: string[]) => {
    const wsp = getWorkspacePath()
    for (const name of names) {
      sanitizeName(name)
      const projectDir = path.join(wsp, name)
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true })
      }
    }
  }))

  // V2.4.1: 项目复制
  ipcMain.handle('project:duplicate', wrapHandler(async (_event, sourceName: string, targetName: string) => {
    sanitizeName(sourceName)
    sanitizeName(targetName)
    const wsp = getWorkspacePath()
    const srcDir = path.join(wsp, sourceName)
    const dstDir = path.join(wsp, targetName)
    if (!fs.existsSync(srcDir)) {
      throw new Error(`源项目不存在: ${sourceName}`)
    }
    if (fs.existsSync(dstDir)) {
      throw new Error(`目标项目名已存在: ${targetName}`)
    }
    fs.cpSync(srcDir, dstDir, { recursive: true })
  }))

  // V2.4.1: 项目重命名
  ipcMain.handle('project:rename', wrapHandler(async (_event, oldName: string, newName: string) => {
    sanitizeName(oldName)
    sanitizeName(newName)
    const wsp = getWorkspacePath()
    const oldDir = path.join(wsp, oldName)
    const newDir = path.join(wsp, newName)
    if (!fs.existsSync(oldDir)) {
      throw new Error(`项目不存在: ${oldName}`)
    }
    if (fs.existsSync(newDir)) {
      throw new Error(`项目名已存在: ${newName}`)
    }
    fs.renameSync(oldDir, newDir)
  }))

  // V2.4.1: 项目导出为 ZIP - 显示保存对话框
  ipcMain.handle('project:exportZip', wrapHandler(async (_event, projectName: string) => {
    sanitizeName(projectName)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `导出项目 "${projectName}"`,
      defaultPath: `${projectName}.zip`,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true, zipPath: '' }
    }
    await projectIOService.exportProjectZip(projectName, result.filePath)
    return { canceled: false, zipPath: result.filePath }
  }))

  // V2.4.1: 项目导入 ZIP - 显示打开对话框
  ipcMain.handle('project:importZip', wrapHandler(async (_event, options?: { projectName?: string; zipPath?: string }) => {
    let zipPath = options?.zipPath
    if (!zipPath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '导入项目',
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, projectName: '' }
      }
      zipPath = result.filePaths[0]
    }
    const finalName = await projectIOService.importProjectZip(zipPath, options?.projectName)
    return { canceled: false, projectName: finalName }
  }))

  // V2.4.1: 批量项目导出
  ipcMain.handle('project:batchExportZip', wrapHandler(async (_event, projectNames: string[]) => {
    for (const name of projectNames) {
      sanitizeName(name)
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '批量导出项目',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, result: null }
    }
    const batchResult = await projectIOService.batchExportProjects(projectNames, result.filePaths[0])
    return { canceled: false, result: batchResult, targetDir: result.filePaths[0] }
  }))

  ipcMain.handle('project:getStructure', wrapHandler(async (_event, name: string) => {
    sanitizeName(name)
    const projectDir = path.join(getWorkspacePath(), name)
    if (!fs.existsSync(projectDir)) return []

    // 隐藏文件/目录 + 常见非业务目录过滤(与 template 统一)
    const isHidden = (n: string) => n.startsWith('.')
    const isExcludedDir = (n: string) => n === 'node_modules' || n === '.git'

    function walkDir(dir: string, basePath: string): FileTreeNode[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      return entries
        .filter((e) => !isHidden(e.name) && !(e.isDirectory() && isExcludedDir(e.name)))
        .map((e) => {
          const nodePath = basePath ? `${basePath}/${e.name}` : e.name
          if (e.isDirectory()) {
            return {
              name: e.name,
              type: 'directory' as const,
              path: nodePath,
              children: walkDir(path.join(dir, e.name), nodePath),
            }
          }
          const fullPath = path.join(dir, e.name)
          const stat = fs.statSync(fullPath)
          return {
            name: e.name,
            type: 'file' as const,
            path: nodePath,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
          }
        })
    }
    return walkDir(projectDir, '')
  }))

  ipcMain.handle('project:getConfigFile', wrapHandler(async (_event, name: string) => {
    sanitizeName(name)
    const projectDir = path.join(getWorkspacePath(), name)
    const iniPath = path.join(projectDir, 'network_config.ini')
    const jsonPath = path.join(projectDir, 'project_config.json')

    // V2.7.2-T10: 自动迁移 — INI 存在但 JSON 不存在时,调用 Python 引擎迁移
    if (fs.existsSync(iniPath) && !fs.existsSync(jsonPath)) {
      try {
        await pythonService.call('migrate', { projectDir })
        console.log(`[project:getConfigFile] V2.7.2-T10: 自动迁移项目 ${name}`)
      } catch (err) {
        console.error(`[project:getConfigFile] 自动迁移失败:`, err)
        // 迁移失败不阻塞,继续读 INI
      }
    }

    if (!fs.existsSync(iniPath)) return null
    return fs.readFileSync(iniPath, 'utf-8')
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
          .map((f) => ({ name: f, path: `output/${d.name}/${f}` }))
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

  // T6.1: 通用项目文件保存(白名单限制,仅允许项目根目录下的特定文件)
  // 用于拓扑数据、机柜布局等按项目持久化
  const PROJECT_SAVE_FILE_WHITELIST = new Set([
    'topology.json',
    'rack_layout.json',
  ])
  ipcMain.handle('project:saveFile', wrapHandler(async (_event, name: string, relativePath: string, content: string) => {
    sanitizeName(name)
    // 仅允许白名单中的文件名,且必须是项目根目录下的直接文件(无子目录)
    const baseName = path.basename(relativePath)
    if (relativePath !== baseName || !PROJECT_SAVE_FILE_WHITELIST.has(baseName)) {
      throw new Error(`不允许保存的文件路径: ${relativePath}`)
    }
    const projectDir = path.join(getWorkspacePath(), name)
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true })
    }
    const fullPath = sanitizePath([name, baseName])
    fs.writeFileSync(fullPath, content, 'utf-8')
    return fullPath
  }))

  // ===== Design =====
  // v2.7.2 B5: design:generate 改为合并更新 project_config.json(非删除)
  // 原逻辑删除 JSON 会导致 rail_mode/param_protocol 等扩展字段永久丢失
  // 新逻辑:读取现有 JSON,合并 INI 解析出的字段,保留扩展字段
  const mergeIniIntoJsonConfig = (projectDir: string, configINI: string): void => {
    const iniPath = path.join(projectDir, 'network_config.ini')
    const jsonPath = path.join(projectDir, 'project_config.json')
    fs.writeFileSync(iniPath, configINI, 'utf-8')

    // 尝试合并到现有 project_config.json
    if (!fs.existsSync(jsonPath)) {
      return // 无 JSON 可合并,后端会从 INI 加载
    }
    try {
      const existingJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
      // 从 INI 解析基础字段,合并到 JSON(保留 JSON 中的扩展字段如 rail_mode/param_protocol/device_refs)
      const iniConfig: Record<string, string> = {}
      for (const line of configINI.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        iniConfig[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
      }

      // 更新 topology 基础字段(INI 优先,但保留 JSON 中的扩展字段)
      const topo = existingJson.topology || {}
      const intFields: Record<string, string> = {
        num_gpu_servers: 'num_servers',
        param_ports_per_server: 'param_ports_per_server',
        storage_ports_per_server: 'storage_ports_per_server',
        param_switch_ports: 'param_switch_ports',
        storage_switch_ports: 'storage_switch_ports',
        param_downlink_limit: 'param_downlink_limit',
        storage_downlink_limit: 'storage_downlink_limit',
        biz_downlink_limit: 'biz_downlink_limit',
        oob_downlink_limit: 'oob_downlink_limit',
        num_compute_servers: 'additional_compute_servers',
      }
      for (const [jsonKey, iniKey] of Object.entries(intFields)) {
        if (iniKey in iniConfig) {
          const v = parseInt(iniConfig[iniKey])
          if (!isNaN(v)) topo[jsonKey] = v
        }
      }
      // additional_storage_servers 拆分为全闪/混闪(若 JSON 已有则保留)
      if ('additional_storage_servers' in iniConfig) {
        const storageCount = parseInt(iniConfig.additional_storage_servers) || 0
        if (!('num_all_flash_storage' in topo) && !('num_hybrid_flash_storage' in topo)) {
          topo.num_all_flash_storage = Math.max(1, Math.ceil(storageCount / 2))
          topo.num_hybrid_flash_storage = Math.floor(storageCount / 2)
        }
      }
      // 字符串字段
      if ('downlink_mode' in iniConfig) topo.downlink_mode = iniConfig.downlink_mode
      if ('param_speed' in iniConfig) topo.param_speed = iniConfig.param_speed
      if ('storage_speed' in iniConfig) topo.storage_speed = iniConfig.storage_speed
      // V2.7.2: rail_mode / param_protocol 字符串字段
      if ('rail_mode' in iniConfig) topo.rail_mode = iniConfig.rail_mode
      if ('param_protocol' in iniConfig) topo.param_protocol = iniConfig.param_protocol
      // V2.7.2: rail_count 整数字段
      if ('rail_count' in iniConfig) {
        const rc = parseInt(iniConfig.rail_count)
        if (!isNaN(rc)) topo.rail_count = rc
      }

      // 网络开关(保留 JSON 已有的 device_refs)
      const networks = existingJson.networks || {}
      if ('oob_enabled' in iniConfig) networks.oob_network = iniConfig.oob_enabled !== 'false'
      if ('biz_enabled' in iniConfig) networks.biz_network = iniConfig.biz_enabled !== 'false'

      existingJson.topology = topo
      existingJson.networks = networks
      fs.writeFileSync(jsonPath, JSON.stringify(existingJson, null, 2), 'utf-8')
    } catch (err) {
      console.error('[design:generate] merge INI into JSON failed:', err)
      // 合并失败不影响主流程,后端会从 INI 加载
    }
  }

  ipcMain.handle('design:generate', wrapHandler(async (_event, projectName: string, configINI?: string) => {
    sanitizeName(projectName)
    const projectDir = path.join(getWorkspacePath(), projectName)
    const configPath = path.join(projectDir, 'network_config.ini')

    if (configINI) {
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true })
      }
      // v2.7.2 B5: 合并更新 project_config.json(保留扩展字段),不再删除
      mergeIniIntoJsonConfig(projectDir, configINI)
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

    if (configINI) {
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true })
      }
      // v2.7.2 B5: 同步合并更新
      mergeIniIntoJsonConfig(projectDir, configINI)
    }

    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`)
    }

    return pythonService.call('validate', { configFile: configPath })
  }))

  // V2.4: 参数化 PUE/收敛比估算
  ipcMain.handle('design:estimate', wrapHandler(async (_event, projectName: string, estimateParams?: Record<string, unknown>) => {
    sanitizeName(projectName)
    const projectDir = path.join(getWorkspacePath(), projectName)
    const configPath = path.join(projectDir, 'network_config.ini')
    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`)
    }
    return pythonService.call('estimate', {
      configFile: configPath,
      estimateParams: estimateParams || {},
    }, 30000)
  }))

  // V2.4: 生成完整报告数据
  ipcMain.handle('design:report', wrapHandler(async (_event, projectName: string) => {
    sanitizeName(projectName)
    const projectDir = path.join(getWorkspacePath(), projectName)
    const configPath = path.join(projectDir, 'network_config.ini')
    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`)
    }
    return pythonService.call('report', { configFile: configPath }, 60000)
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

  // T2: 使用 app.getAppPath() 读取 package.json,确保打包后能正确读取 asar 内的 package.json
  ipcMain.handle('app:getVersion', () => {
    try {
      const pkgPath = path.join(app.getAppPath(), 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      return pkg.version || 'unknown'
    } catch {
      return 'unknown'
    }
  })

  // 返回产品软件栈关键依赖版本（供关于弹窗动态展示）
  // T2: 修复路径(app.getAppPath) + 合并 devDependencies + Python 检测增强
  ipcMain.handle('app:getStackVersions', () => {
    try {
      const pkgPath = path.join(app.getAppPath(), 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      // T2: 合并 dependencies 和 devDependencies,确保 typescript/vite 等也能读到
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      // T2: Python 检测增强 — python → python3 → py (Windows launcher)
      let pythonVersion = ''
      const tryPython = (cmd: string) => {
        try {
          return execSync(`${cmd} --version`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().replace(/^Python\s+/i, '')
        } catch {
          return ''
        }
      }
      pythonVersion = tryPython('python') || tryPython('python3') || tryPython('py')
      return {
        app: pkg.version || 'unknown',
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        react: allDeps['react'] || '',
        reactDom: allDeps['react-dom'] || '',
        typescript: allDeps['typescript'] || '',
        vite: allDeps['vite'] || '',
        echarts: allDeps['echarts'] || '',
        xyflow: allDeps['@xyflow/react'] || '',
        i18next: allDeps['i18next'] || '',
        electronUpdater: allDeps['electron-updater'] || '',
        python: pythonVersion,
        buildNumber: process.env.BUILD_NUMBER || '',
      }
    } catch (err) {
      console.error('[app:getStackVersions] failed:', err)
      return null
    }
  })

  // 在系统文件管理器中定位品牌资源（Logo 源码 / 设计规范文档）。
  // 将 Logo 绘制逻辑作为程序的一部分发布，用户可从关于弹窗直达源文件。
  ipcMain.handle('app:showBrandingAsset', wrapHandler(async (_event, filename: string) => {
    const filePath = getBrandingAssetPath(filename)
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`品牌资源不存在: ${filename}`)
    }
    shell.showItemInFolder(filePath)
    return filePath
  }))

  // 读取应用内置文档（用户指南等）。
  // 打包后文档随 extraResources 复制到 resourcesPath/docs（只读）；
  // 开发时从 docs/user_guide/ 读取。
  ipcMain.handle('app:readDocFile', wrapHandler(async (_event, filename: string) => {
    const safeName = path.basename(filename)
    const filePath = getDocPath(safeName)
    if (!filePath || !fs.existsSync(filePath)) {
      return null
    }
    return fs.readFileSync(filePath, 'utf-8')
  }))

  // ===== Shell =====
  // 注:openPath/showItemInFolder 需支持打开 workspace 外的路径
  // (导出 ZIP、branding 资产、guide 文档、用户自选目录),仅做 `..` 防御
  ipcMain.handle('shell:showItemInFolder', wrapHandler(async (_event, filePath: string) => {
    if (!filePath || filePath.includes('..')) {
      throw new Error(`无效路径: ${filePath}`)
    }
    shell.showItemInFolder(filePath)
  }))

  ipcMain.handle('shell:openPath', wrapHandler(async (_event, filePath: string) => {
    if (!filePath || filePath.includes('..')) {
      throw new Error(`无效路径: ${filePath}`)
    }
    return shell.openPath(filePath)
  }))

  ipcMain.handle('shell:openExternal', wrapHandler(async (_event, url: string) => {
    // 仅允许 https 协议，防止任意协议执行
    if (!url.startsWith('https://')) {
      throw new Error('仅允许打开 https 链接')
    }
    await shell.openExternal(url)
  }))

  // ===== Dialog =====
  ipcMain.handle('dialog:openDirectory', wrapHandler(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
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

  ipcMain.handle('app:open-releases-page', () => {
    updateService.openReleasesPage()
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
    // 优先查用户模板目录，再查内置模板目录
    const userTplDir = path.join(getUserTemplatePath(), templateName)
    const builtinTplDir = path.join(getTemplatePath(), templateName)
    const tplDir = fs.existsSync(userTplDir) ? userTplDir : builtinTplDir
    if (!fs.existsSync(tplDir)) return []

    const isHidden = (n: string) => n.startsWith('.')
    const isExcludedDir = (n: string) => n === 'node_modules' || n === '.git'

    function walkDir(dir: string, basePath: string): FileTreeNode[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      return entries
        .filter((e) => !isHidden(e.name) && !(e.isDirectory() && isExcludedDir(e.name)))
        .map((e) => {
          const nodePath = basePath ? `${basePath}/${e.name}` : e.name
          if (e.isDirectory()) {
            return {
              name: e.name,
              type: 'directory' as const,
              path: nodePath,
              children: walkDir(path.join(dir, e.name), nodePath),
            }
          }
          const fullPath = path.join(dir, e.name)
          const stat = fs.statSync(fullPath)
          return {
            name: e.name,
            type: 'file' as const,
            path: nodePath,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
          }
        })
    }
    return walkDir(tplDir, '')
  }))

  ipcMain.handle('template:getFile', wrapHandler(async (_event, templateName: string, filePath: string) => {
    sanitizeName(templateName)
    // 优先查用户模板目录，再查内置模板目录
    const userTplDir = getUserTemplatePath()
    const builtinTplDir = getTemplatePath()
    const baseDir = fs.existsSync(path.join(userTplDir, templateName)) ? userTplDir : builtinTplDir
    const fullPath = path.resolve(baseDir, templateName, filePath)
    if (!fullPath.startsWith(baseDir + path.sep) && fullPath !== baseDir) {
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
    updatedAt?: string
    sourceProject?: string
  }

  ipcMain.handle('template:list', wrapHandler(async () => {
    // 读取单个模板目录，返回模板元信息数组
    const readDir = (tplDir: string, isBuiltin: boolean) => {
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
            updatedAt: meta.updatedAt || meta.createdAt || '',
            isBuiltin: isBuiltin || !!meta.isBuiltin,
          }
        })
    }

    // 合并内置模板（只读）+ 用户模板（可读写）
    const builtinTplDir = getTemplatePath()
    const userTplDir = getUserTemplatePath()
    const builtin = readDir(builtinTplDir, true)
    const user = readDir(userTplDir, false)
    // 用户模板优先（同名时覆盖内置）
    const userNames = new Set(user.map((t) => t.id))
    return [...user, ...builtin.filter((t) => !userNames.has(t.id))]
  }))

  ipcMain.handle('template:create', wrapHandler(async (_event, projectName: string, meta: TemplateMeta) => {
    sanitizeName(projectName)
    sanitizeName(meta.name)

    const wsp = getWorkspacePath()
    // 用户模板写入 userData/user-templates（可读写），内置模板目录只读
    const userTplDir = getUserTemplatePath()
    const srcDir = path.join(wsp, projectName)
    const destDir = path.join(userTplDir, meta.name)

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
    // 优先在用户模板目录查找（可删除）；内置模板目录只读，不可删除
    const userTargetDir = path.join(getUserTemplatePath(), templateName)
    if (fs.existsSync(userTargetDir)) {
      fs.rmSync(userTargetDir, { recursive: true, force: true })
      return
    }
    // 若存在于内置目录，提示不可删除
    const builtinTargetDir = path.join(getTemplatePath(), templateName)
    if (fs.existsSync(builtinTargetDir)) {
      throw new Error('内置模板不可删除')
    }
    throw new Error(`模板 ${templateName} 不存在`)
  }))

  // V2.4.1: 模板编辑 - 更新元数据和配置内容
  ipcMain.handle('template:update', wrapHandler(async (_event, templateName: string, updates: {
    name?: string
    description?: string
    scenario?: string
    tags?: string[]
    configContent?: string
  }) => {
    sanitizeName(templateName)
    // 优先在用户模板目录查找（可编辑）；内置模板目录只读，不可编辑
    const userTargetDir = path.join(getUserTemplatePath(), templateName)
    const builtinTargetDir = path.join(getTemplatePath(), templateName)
    const targetDir = fs.existsSync(userTargetDir)
      ? userTargetDir
      : builtinTargetDir
    if (!fs.existsSync(targetDir)) throw new Error(`模板 ${templateName} 不存在`)

    const metaPath = path.join(targetDir, 'template.json')
    let meta: TemplateMeta = { name: templateName, description: '' }
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      } catch { /* ignore */ }
    }

    // 内置模板（在只读目录中）不可编辑
    if (targetDir === builtinTargetDir) {
      throw new Error('内置模板不可编辑')
    }

    // 合并更新字段（不修改目录名，只更新 meta.name）
    if (typeof updates.name === 'string' && updates.name.trim()) {
      meta.name = updates.name.trim()
    }
    if (typeof updates.description === 'string') {
      meta.description = updates.description
    }
    if (typeof updates.scenario === 'string') {
      meta.scenario = updates.scenario
    }
    if (Array.isArray(updates.tags)) {
      meta.tags = updates.tags
    }
    meta.updatedAt = new Date().toISOString()

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

    // 如果提供了配置内容，更新 network_config.ini
    if (typeof updates.configContent === 'string') {
      const configPath = path.join(targetDir, 'network_config.ini')
      fs.writeFileSync(configPath, updates.configContent, 'utf-8')
    }
  }))

  // V2.4.1: 模板导出为 ZIP - 显示保存对话框
  ipcMain.handle('template:exportZip', wrapHandler(async (_event, templateName: string) => {
    sanitizeName(templateName)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `导出模板 "${templateName}"`,
      defaultPath: `${templateName}.zip`,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true, zipPath: '' }
    }
    await projectIOService.exportTemplateZip(templateName, result.filePath)
    return { canceled: false, zipPath: result.filePath }
  }))

  // V2.4.1: 模板导入 ZIP - 显示打开对话框
  ipcMain.handle('template:importZip', wrapHandler(async (_event, options?: { templateName?: string; zipPath?: string }) => {
    let zipPath = options?.zipPath
    if (!zipPath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '导入模板',
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, templateName: '' }
      }
      zipPath = result.filePaths[0]
    }
    const finalName = await projectIOService.importTemplateZip(zipPath, options?.templateName)
    return { canceled: false, templateName: finalName }
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