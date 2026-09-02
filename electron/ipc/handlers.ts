import { BrowserWindow, ipcMain, shell, dialog, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { execSync } from 'child_process'
import { getWorkspacePath, getTemplatePath, getUserTemplatePath, getBackendPath, getBrandingAssetPath, getDocPath } from '../config.js'
import { pythonService } from '../services/python.service.js'
import { projectIOService } from '../services/project-io.service.js'
// M3b: AL AI 独立进程服务（ai:* 域 action 改由 HTTP 直连 al_ai_hub）
import { aiHubService } from '../services/aiHub.service.js'

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

/**
 * AL-S2: 剥离 params 中的路径类字段。
 * plan:aidc / plan:aidc:export 是纯宏观参数（或 filepath 由本进程 dialog 内部生成）的 action，
 * 前端不应能注入任意文件路径；此处做 IPC 层路径字段剥离（白名单思维，防绕过 workspace 限界）。
 */
const PATH_BEARING_KEYS = new Set([
  'configFile', 'configPath', 'config_path',
  'filepath', 'filePath',
  'workspaceDir', 'workspace', 'outputDir', 'output',
  'projectDir', 'project_path', 'project_dir',
])
function stripPathParams(params?: Record<string, unknown>): Record<string, unknown> {
  if (!params || typeof params !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (PATH_BEARING_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

/** AL-I18-4: 导出文件名 ASCII 安全——中文项目名在文件系统层面乱码，回退为 project_<id>_<ts>（中文仅显示层） */
function asciiSafeBase(name: string, id8: string): string {
  const ascii = String(name || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .trim()
  if (ascii) return ascii
  const ts = Date.now().toString(36)
  return `project_${id8 || '0'}_${ts}`
}

/**
 * AL-M1e: shell:openPath / shell:showItemInFolder 允许的基础目录白名单。
 * 渲染层只应定位"程序自己产出的路径"（workspace、品牌资源、内置文档、导出临时文件、
 * 下载/桌面），不允许对系统任意路径发起"在资源管理器定位"。仍保留 `..` 穿越防御。
 */
function isPathInShellWhitelist(filePath: string): boolean {
  if (!filePath) return false
  const normalized = path.normalize(filePath)
  // 渲染层传入的必须是绝对路径（相对路径一律拒绝，防绕过白名单）
  if (!path.isAbsolute(normalized)) return false
  const bases: string[] = [
    getWorkspacePath(),
    getBrandingAssetPath(''),
    getDocPath(''),
    path.dirname(getBrandingAssetPath('logo.svg') || ''),
    path.dirname(getDocPath('x') || ''),
    os.tmpdir(),
  ]
  try {
    bases.push(app.getPath('downloads'))
    bases.push(app.getPath('desktop'))
  } catch {
    /* 忽略路径获取失败 */
  }
  for (const base of bases) {
    if (!base) continue
    try {
      const rel = path.relative(path.normalize(base), normalized)
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true
    } catch {
      /* 忽略异常路径 */
    }
  }
  return false
}
import { updateService } from '../services/update.service.js'
import { redactSensitive } from '../utils/redact.js'
// 47-d（F7-4）：本地遥测（IPC 错误/动作耗时留痕，脱敏，默认关）
import { telemetryService } from '../services/telemetry.service.js'
import { registerCloudIpcHandlers } from './cloud.handlers.js'
import { registerSearchIpcHandlers } from './search.handlers.js'
// 47-b/47-c（F7-2/F7-3）：诊断中心 + 健康检查 IPC 分包
import { registerDiagnosticsIpcHandlers } from './diagnostics.handlers.js'

// V3.4.1-L7: app:getStackVersions 进程级缓存（Python 探测 execSync 阻塞主进程，只跑一次）
let cachedStackVersions: Record<string, string> | null = null
import {
  AI_ACTION_WHITELIST,
  actionSchema,
  aiChatSchema,
  assertParsed,
  atopRecommendSchema,
  capacityRecommendSchema,
  configPayloadSchema,
  createWithConfigSchema,
  deviceSaveSchema,
  exportSaveFileSchema,
  httpsUrlSchema,
  optimizeApplySchema,
  outputReadFileSchema,
  outputSaveFileSchema,
  paramsObjectSchema,
  projectNameSchema,
  rackOptimizeSchema,
  repairApplySchema,
  roomCreateSchema,
  roomOptimizeSchema,
  roomValidateSchema,
} from './schemas.js'

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

/**
 * V2.9.1-T2: 公共文件树遍历（project/template 结构共用）
 * 过滤隐藏文件与常见非业务目录，统一输出 FileTreeNode
 */
function walkDir(dir: string, basePath: string): FileTreeNode[] {
  const isHidden = (n: string) => n.startsWith('.')
  const isExcludedDir = (n: string) => n === 'node_modules' || n === '.git'
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

// ===== Security Helpers =====
function sanitizeUnderBase(base: string, ...segments: string[]): string {
  const resolved = path.resolve(base, ...segments)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('路径遍历攻击被阻止')
  }
  return resolved
}

function sanitizePath(segments: string[]): string {
  return sanitizeUnderBase(getWorkspacePath(), ...segments)
}

function sanitizeName(name: string): string {
  if (!name || name.includes('..') || path.isAbsolute(name)) {
    throw new Error(`无效的项目名称: ${name}`)
  }
  return name
}

/**
 * V3.4.1-H2: 项目级路径限界 —— 校验项目名并把解析结果限界到该项目目录内。
 * 与 sanitizePath（仅限界到 workspace 整体）不同，`../其他项目/...` 无法逃逸出目标项目，
 * 阻断跨项目读/删（project:getFile/getFileBinary/deleteOutputFile 等）。
 */
function sanitizeProjectPath(name: string, ...segments: string[]): string {
  sanitizeName(name)
  return sanitizeUnderBase(path.join(getWorkspacePath(), name), ...segments)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapHandler<T>(handler: (...args: any[]) => Promise<T>) {
  return async (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    const start = Date.now()
    const channel = (event as { channel?: string })?.channel ?? 'unknown'
    try {
      const result = await handler(event, ...args)
      // 47-d（F7-4）：长任务动作耗时留痕（遥测默认关，开启才采集）
      if (TELEMETRY_ACTION_CHANNELS.has(channel)) {
        telemetryService.recordAction(channel, Date.now() - start, true)
      }
      return result
    } catch (err) {
      // V3.2.2-R11.1: 错误日志脱敏后再输出，避免 apiKey/token 等凭据泄漏
      // （事件对象不可模板插值，只记录通道名，避免打印 [object Object]）
      const safeMsg = redactSensitive(err instanceof Error ? err.message : String(err))
      console.error('[IPC Error]', safeMsg)
      // 47-d（F7-4）：IPC 失败留痕（脱敏 message，遥测默认关）
      telemetryService.recordError(channel, safeMsg)
      throw err
    }
  }
}

/**
 * 47-d（F7-4）：遥测记录的长任务 IPC 通道白名单。
 * 仅记录计算/IO 密集通道的动作耗时，避免读文件/列表等高频轻量通道刷屏遥测。
 */
const TELEMETRY_ACTION_CHANNELS = new Set([
  'design:generate',
  'design:validate',
  'design:estimate',
  'design:report',
  'render:exportConnections',
  'plan:aidc',
  'plan:aidc:export',
  'optimize:suggest',
  'optimize:apply',
  'repair:plan',
  'repair:apply',
  'room:optimize',
  'rack:optimize',
  'project:exportZip',
  'project:batchExportZip',
  'project:importZip',
  'template:importZip',
  'template:exportZip',
  'capacity:recommend',
  'atop:recommend',
  'aidc:project:create',
  'aidc:project:save',
])

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

// ===== M-F1（PRD v3.6）：版本历史 + 评审 PDF 辅助 =====
function escapeHtmlText(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function planCellValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function wrapPrintableHtml(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: "Microsoft YaHei", "Segoe UI", sans-serif; padding: 24px; color: #111827; }
    h1 { font-size: 22px; border-bottom: 2px solid #2563eb; padding-bottom: 8px; color: #1e3a8a; }
    h2 { font-size: 16px; margin-top: 22px; color: #1e3a8a; border-left: 4px solid #93c5fd; padding-left: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; page-break-inside: avoid; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; font-size: 12px; }
    th { background: #eff6ff; font-weight: 700; }
    td { word-break: break-all; }
    p { font-size: 12px; color: #374151; }
  </style></head><body>${body}</body></html>`
}

/** 评审 PDF 内容组装：宏观参数 + 设计摘要（拓扑/协议/收敛/设备统计） */
function buildReviewPdfHtml(projectName: string, plan: Record<string, unknown>): string {
  const meta = (plan.meta && typeof plan.meta === 'object' && !Array.isArray(plan.meta))
    ? plan.meta as Record<string, unknown> : {}
  const macro = (plan.macro && typeof plan.macro === 'object' && !Array.isArray(plan.macro))
    ? plan.macro as Record<string, unknown> : {}
  const topology = (plan.topology && typeof plan.topology === 'object' && !Array.isArray(plan.topology))
    ? plan.topology as Record<string, unknown> : {}
  const protocols = (plan.protocols && typeof plan.protocols === 'object' && !Array.isArray(plan.protocols))
    ? plan.protocols as Record<string, unknown> : {}
  const convergence = (plan.convergence && typeof plan.convergence === 'object' && !Array.isArray(plan.convergence))
    ? plan.convergence as Record<string, unknown> : {}
  const deviceList = Array.isArray(plan.deviceList) ? plan.deviceList as Array<Record<string, unknown>> : []
  const connections = Array.isArray(plan.connections) ? plan.connections : []
  const terminals = Array.isArray(plan.terminals) ? plan.terminals : []

  const roleCounts: Record<string, number> = {}
  for (const d of deviceList) {
    const role = String(d.role ?? d.scenario ?? '?')
    roleCounts[role] = (roleCounts[role] ?? 0) + 1
  }

  const rows: string[] = []
  rows.push('<h1>AutoLink AIDC 规划评审报告</h1>')
  rows.push(`<p>项目：${escapeHtmlText(projectName)}</p>`)
  rows.push('<table><tr><th>字段</th><th>值</th></tr>')
  rows.push(`<tr><td>项目 ID</td><td>${escapeHtmlText(meta.projectId)}</td></tr>`)
  rows.push(`<tr><td>规划版本</td><td>v${escapeHtmlText(meta.planVersion)}</td></tr>`)
  rows.push(`<tr><td>planHash</td><td>${escapeHtmlText(meta.planHash)}</td></tr>`)
  rows.push(`<tr><td>生成时间</td><td>${escapeHtmlText(meta.generatedAt)}</td></tr>`)
  rows.push('</table>')

  rows.push('<h2>宏观参数</h2>')
  rows.push('<table><tr><th>参数</th><th>值</th></tr>')
  for (const [k, v] of Object.entries(macro)) {
    rows.push(`<tr><td>${escapeHtmlText(k)}</td><td>${escapeHtmlText(planCellValue(v))}</td></tr>`)
  }
  rows.push('</table>')

  rows.push('<h2>拓扑摘要</h2>')
  rows.push('<table><tr><th>字段</th><th>值</th></tr>')
  for (const [k, v] of Object.entries(topology)) {
    rows.push(`<tr><td>${escapeHtmlText(k)}</td><td>${escapeHtmlText(planCellValue(v))}</td></tr>`)
  }
  rows.push('</table>')

  rows.push('<h2>协议与收敛</h2>')
  rows.push('<table><tr><th>字段</th><th>值</th></tr>')
  rows.push(`<tr><td>OSPF</td><td>${escapeHtmlText(planCellValue(protocols.ospf))}</td></tr>`)
  rows.push(`<tr><td>BGP</td><td>${escapeHtmlText(planCellValue(protocols.bgp))}</td></tr>`)
  rows.push(`<tr><td>收敛比</td><td>${escapeHtmlText(planCellValue(convergence))}</td></tr>`)
  rows.push('</table>')

  rows.push(`<h2>设备清单摘要（${deviceList.length} 台）</h2>`)
  rows.push('<table><tr><th>角色</th><th>数量</th></tr>')
  for (const [role, count] of Object.entries(roleCounts)) {
    rows.push(`<tr><td>${escapeHtmlText(role)}</td><td>${count}</td></tr>`)
  }
  rows.push('</table>')

  if (deviceList.length > 0) {
    rows.push(`<h2>设备清单（前 ${Math.min(200, deviceList.length)} 台）</h2>`)
    rows.push('<table><tr><th>名称</th><th>角色</th><th>型号</th><th>机柜</th><th>ASN</th></tr>')
    for (const d of deviceList.slice(0, 200)) {
      rows.push(`<tr><td>${escapeHtmlText(d.name)}</td><td>${escapeHtmlText(d.role)}</td><td>${escapeHtmlText(d.model)}</td><td>${escapeHtmlText(d.rack)}</td><td>${escapeHtmlText(d.asn)}</td></tr>`)
    }
    rows.push('</table>')
  }

  rows.push(`<p>接线 ${connections.length} 条 · 终端 ${terminals.length} 条</p>`)
  return wrapPrintableHtml(rows.join('\n'))
}

export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  // ===== 云端平台（V3.3.0: 登录 + 云中心） =====
  registerCloudIpcHandlers()
  // ===== 本地搜索（V3.3.1: 项目文件 / 设备库 / 模板） =====
  registerSearchIpcHandlers()
  // ===== 部署运维（47-b 诊断 / 47-c 健康检查 / 47-d 本地遥测） =====
  registerDiagnosticsIpcHandlers()
  // ===== Project Management =====
  // U1: project:list 扩展返回 status/fileCount/updatedAt/description
  ipcMain.handle('project:list', wrapHandler(async () => {
    const wsp = getWorkspacePath()
    if (!fs.existsSync(wsp)) return []
    const dirs = fs.readdirSync(wsp, { withFileTypes: true })
      .filter((d) => d.isDirectory())
    return dirs.map((d, i) => {
      const projectDir = path.join(wsp, d.name)
      // 状态推断:基于关键文件存在性（P1 A-3：AIDC 项目含 plan.json → 'planned'）
      let status: 'ready' | 'planned' | 'configured' | 'designed' | 'layouted' = 'ready'
      if (fs.existsSync(path.join(projectDir, 'rack_layout.json'))) {
        status = 'layouted'
      } else if (fs.existsSync(path.join(projectDir, 'topology.json'))) {
        status = 'designed'
      } else if (fs.existsSync(path.join(projectDir, 'plan.json'))) {
        status = 'planned'
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

    // V2.9.5-T1: 从模板创建项目 — 用户模板优先（user-templates），再查内置模板
    // 复制 project_config.json（若存在）+ network_config.ini；模板不存在时明确抛错
    // V3.4.1-H1: options.template 必须经 sanitizeName 校验，防路径穿越读取模板目录外文件
    if (options?.template && !options.empty) {
      sanitizeName(options.template)
      const userTplDir = path.join(getUserTemplatePath(), options.template)
      const builtinTplDir = path.join(getTemplatePath(), options.template)
      const tplDir = fs.existsSync(userTplDir) ? userTplDir
        : fs.existsSync(builtinTplDir) ? builtinTplDir : null
      if (!tplDir) {
        throw new Error(`模板 "${options.template}" 不存在（用户模板与内置模板均未找到）`)
      }
      const tplJson = path.join(tplDir, 'project_config.json')
      if (fs.existsSync(tplJson)) {
        fs.copyFileSync(tplJson, path.join(projectDir, 'project_config.json'))
      }
      const tplConfig = path.join(tplDir, 'network_config.ini')
      if (fs.existsSync(tplConfig)) {
        fs.copyFileSync(tplConfig, path.join(projectDir, 'network_config.ini'))
      }
      // P1（A-6）：AIDC 模板带 plan.json，一并复制（AIDC 项目据此恢复）
      const tplPlan = path.join(tplDir, 'plan.json')
      if (fs.existsSync(tplPlan)) {
        fs.copyFileSync(tplPlan, path.join(projectDir, 'plan.json'))
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
    // V3.2.2-R11.1: 载荷形状校验（门禁；写入仍用原始 config 保留扩展字段）
    assertParsed(createWithConfigSchema, config, 'project:createWithConfig')
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
    // V2.9.1-T4: 存储数量字段双 schema 兼容（v1 全闪/混闪拆分 vs v2 单一字段）
    const storageCount = t as { num_all_flash_storage?: number; num_hybrid_flash_storage?: number; num_storage_servers?: number }
    const totalStorage = storageCount.num_all_flash_storage != null
      ? (storageCount.num_all_flash_storage || 0) + (storageCount.num_hybrid_flash_storage || 0)
      : storageCount.num_storage_servers || 0
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

  // V2.4.1: 项目导出为 ZIP - 显示保存对话框；T15-2 支持 password 加密
  ipcMain.handle('project:exportZip', wrapHandler(async (_event, projectName: string, options?: { password?: string }) => {
    sanitizeName(projectName)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `导出项目 "${projectName}"`,
      defaultPath: `${projectName}.zip`,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true, zipPath: '' }
    }
    await projectIOService.exportProjectZip(projectName, result.filePath, options?.password)
    return { canceled: false, zipPath: result.filePath }
  }))

  // V2.4.1: 项目导入 ZIP - 显示打开对话框；T15-2 支持 password 解密
  // 48-a（F8-1）：projectId 幂等——命中既有身份时 skip/覆盖更新，返回「已存在」语义
  ipcMain.handle('project:importZip', wrapHandler(async (_event, options?: { projectName?: string; zipPath?: string; password?: string; ifExists?: 'skip' | 'overwrite' }) => {
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
    const result = await projectIOService.importProjectZip(zipPath, options)
    return { canceled: false, ...result }
  }))

  // V2.4.1: 批量项目导出；T15-2 支持 password 加密
  ipcMain.handle('project:batchExportZip', wrapHandler(async (_event, projectNames: string[], options?: { password?: string }) => {
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
    const batchResult = await projectIOService.batchExportProjects(projectNames, result.filePaths[0], options?.password)
    return { canceled: false, result: batchResult, targetDir: result.filePaths[0] }
  }))

  ipcMain.handle('project:getStructure', wrapHandler(async (_event, name: string) => {
    sanitizeName(name)
    const projectDir = path.join(getWorkspacePath(), name)
    if (!fs.existsSync(projectDir)) return []
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
    const fullPath = sanitizeProjectPath(name, filePath)
    if (!fs.existsSync(fullPath)) return null
    return fs.readFileSync(fullPath, 'utf-8')
  }))

  ipcMain.handle('project:getFileBinary', wrapHandler(async (_event, name: string, filePath: string) => {
    const fullPath = sanitizeProjectPath(name, filePath)
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
      // v2.8.0-T6: type 统一返回小写扩展名,避免前端 MIME 拼接大小写不一致
      .map((f) => ({ name: f.name, type: path.extname(f.name).slice(1).toLowerCase() || 'file' }))
  }))

  ipcMain.handle('project:listOutputBatches', wrapHandler(async (_event, projectName: string) => {
    sanitizeName(projectName)
    const outputDir = path.join(getWorkspacePath(), projectName, 'output')
    if (!fs.existsSync(outputDir)) return []

    // v2.8.0-T7: 根目录文件(如导出的拓扑 PNG)作为虚拟批次 `[根目录]` 展示,
    // 避免导出到 output/ 根目录的文件在"输出结果"区不可见
    const rootFiles = fs.readdirSync(outputDir, { withFileTypes: true })
      .filter((f) => f.isFile() && !f.name.startsWith('.'))
      .map((f) => ({ name: f.name, path: `output/${f.name}` }))
    const batches: { name: string; files: { name: string; path: string }[] }[] =
      rootFiles.length > 0 ? [{ name: '[根目录]', files: rootFiles }] : []

    const dirs = fs.readdirSync(outputDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const batchFiles = fs.readdirSync(path.join(outputDir, d.name))
          .filter((f) => !f.startsWith('.'))
          .map((f) => ({ name: f, path: `output/${d.name}/${f}` }))
        return { name: d.name, files: batchFiles }
      })
    return [...batches, ...dirs]
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
    // V3.0.4-T3-1: 机房矩阵布局（RoomMatrix 持久化）
    'room_layout.json',
    // P1（A-5）：AIDC 规划文件（plan:table v1.2）按项目持久化
    'plan.json',
  ])
  ipcMain.handle('project:saveFile', wrapHandler(async (_event, name: string, relativePath: string, content: string) => {
    sanitizeName(name)
    // 仅允许白名单中的文件名,且必须是项目根目录下的直接文件(无子目录)
    const baseName = path.basename(relativePath)
    if (relativePath !== baseName || !PROJECT_SAVE_FILE_WHITELIST.has(baseName)) {
      throw new Error(`不允许保存的文件路径: ${relativePath}`)
    }
    const fullPath = sanitizeProjectPath(name, baseName)
    if (!fs.existsSync(path.dirname(fullPath))) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    }
    fs.writeFileSync(fullPath, content, 'utf-8')
    return fullPath
  }))

  // ===== Room（V3.0.4-T3-1: 机房矩阵） =====
  ipcMain.handle('room:create', wrapHandler(async (_event, rows: string[], cols: number[], name?: string) => {
    assertParsed(roomCreateSchema, { rows, cols, name }, 'room:create')
    return pythonService.call('room:create', { rows, cols, name: name ?? '机房' })
  }))

  ipcMain.handle('room:validate', wrapHandler(async (_event, layout: unknown) => {
    assertParsed(roomValidateSchema, layout ?? {}, 'room:validate')
    return pythonService.call('room:validate', { layout })
  }))

  // V3.1.4-T8-2: 机房智能落位（约束满足 + 多目标优化；复用 backend room:optimize）
  ipcMain.handle('room:optimize', wrapHandler(async (_event, params?: Record<string, unknown>) => {
    // V3.2.2-R11.1: 载荷形状校验（替代原手写缺参检查）
    assertParsed(roomOptimizeSchema, params ?? {}, 'room:optimize')
    const p = params ?? {}
    return pythonService.call('room:optimize', {
      matrix: p.matrix,
      project: p.project,
      counts: p.counts,
      cabinets: p.cabinets,
      objectives: p.objectives,
      constraints: p.constraints,
      time_budget_s: p.timeBudgetS,
      reset_existing: p.resetExisting,
    }, 20000)
  }))

  // 打磨轮（v1.5 / AL-R1b）：柜内智能落位（柜+待上架设备池 → U 位方案）
  ipcMain.handle('rack:optimize', wrapHandler(async (_event, params?: Record<string, unknown>) => {
    assertParsed(rackOptimizeSchema, params ?? {}, 'rack:optimize')
    const p = params ?? {}
    return pythonService.call('rack:optimize', {
      cabinets: p.cabinets,
      unplaced_devices: p.unplaced_devices,
      gpu_per_cabinet: p.gpu_per_cabinet,
    }, 20000)
  }))

  // ===== Config（V3.0.4-T3-4: 统一配置体系） =====
  ipcMain.handle('config:list-schema', wrapHandler(async () => {
    return pythonService.call('config:list-schema', {})
  }))

  ipcMain.handle('config:apply-preset', wrapHandler(async (_event, presetId: string, config: unknown) => {
    // V3.2.2-R11.1: presetId 形状 + config 对象校验
    assertParsed(projectNameSchema, presetId, 'config:apply-preset.presetId')
    assertParsed(configPayloadSchema, config ?? {}, 'config:apply-preset.config')
    return pythonService.call('config:apply-preset', { presetId, config })
  }))

  ipcMain.handle('config:export', wrapHandler(async (_event, appSettings: unknown, projectConfig: unknown) => {
    assertParsed(configPayloadSchema, appSettings ?? {}, 'config:export.appSettings')
    assertParsed(configPayloadSchema, projectConfig ?? {}, 'config:export.projectConfig')
    return pythonService.call('config:export', { appSettings, projectConfig })
  }))

  ipcMain.handle('config:import', wrapHandler(async (_event, payload: unknown) => {
    // V3.2.2-R11.1: 导入载荷必须为对象
    assertParsed(configPayloadSchema, payload ?? {}, 'config:import')
    return pythonService.call('config:import', { payload })
  }))

  // ===== CLI（V3.1.0-T4-3: 显式能力层信息与审计） =====
  ipcMain.handle('cli:info', wrapHandler(async () => {
    return pythonService.call('cli:info', {})
  }))

  ipcMain.handle('cli:audit', wrapHandler(async (_event, limit = 200) => {
    const auditPath = path.join(app.getPath('userData'), 'audit', 'cli-audit.jsonl')
    if (!fs.existsSync(auditPath)) {
      return { entries: [], path: auditPath }
    }
    const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n').filter(Boolean)
    const entries = lines.slice(-Math.max(1, Number(limit) || 200))
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter((e): e is Record<string, unknown> => e !== null)
    return { entries, path: auditPath }
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

  // V3.0.0-T0-6: 流式调用（engine {type:'event'} 行逐行透传 → webContents.send('ai:stream')）
  // M3b: ai:* 域 action 改由独立 al_ai_hub 进程承载（HTTP），其余仍走 engine
  ipcMain.handle('ai:call', wrapHandler(async (event, action: string, params?: unknown) => {
    // V3.2.2-R11.1: action 形状 + params 普通对象校验（动态 action 派发最高风险通道）
    assertParsed(actionSchema, action, 'ai:call.action')
    assertParsed(paramsObjectSchema, params ?? {}, 'ai:call.params')
    // AL-S1: ai:call 动作白名单——仅放行 ai:* 动作，其余拒绝（防泛化后门触达任意后端 action）
    if (!(AI_ACTION_WHITELIST as readonly string[]).includes(action)) {
      throw new Error(`ai:call 拒绝白名单外的 action: ${action}，请走专用通道`)
    }
    const p = (params as Record<string, unknown>) ?? {}
    // M3b: AI 域 action 全部走独立 al_ai_hub 进程（ai:chat 兜底非流式）
    switch (action) {
      case 'ai:chat': {
        const sessionId = String(p.sessionId ?? 'default')
        const reply = await aiHubService.sendChatMessage(
          sessionId, String(p.message ?? ''), String(p.mode ?? 'general'),
          p.provider as string | undefined,
          p.attachments as Array<{ id: string; name: string; type: string; path: string; size: number }> | undefined,
          String(p.autonomyMode ?? 'semi_auto'), p.projectName as string | undefined,
        )
        return { sessionId, status: 'completed', reply }
      }
      case 'ai:providers':
        return { providers: await aiHubService.getProviders() }
      case 'ai:config':
        return aiHubService.configureProvider(
          String(p.provider ?? ''), String(p.apiKey ?? ''),
          p.model != null ? String(p.model) : undefined,
          p.baseUrl != null ? String(p.baseUrl) : undefined,
          Array.isArray(p.models) ? p.models.map(String) : undefined,
        )
      case 'ai:config-default':
        return aiHubService.setDefaultProvider(String(p.provider ?? ''))
      case 'ai:test':
        return aiHubService.testConnection(
          String(p.provider ?? ''), String(p.apiKey ?? ''), String(p.baseUrl ?? ''), String(p.model ?? ''),
        )
      case 'ai:models':
        return aiHubService.fetchModels(String(p.baseUrl ?? ''), String(p.apiKey ?? ''))
      case 'ai:clear':
        return aiHubService.clearSession(String(p.sessionId ?? 'default'))
      default:
        throw new Error(`未知 AI action: ${action}`)
    }
  }))

  // V3.1.1-T5-4: AI 对话专用通道（流式事件带 sessionId → aihub:stream，前端按会话过滤）
  // M3b: 改由独立 al_ai_hub 进程（SSE）承载，不再经 engine 的 ai:chat action
  ipcMain.handle('ai:chat', wrapHandler(async (event, params?: unknown) => {
    // V3.2.2-R11.1: 对话载荷形状校验
    const p = assertParsed(aiChatSchema, params ?? {}, 'ai:chat')
    const win = BrowserWindow.fromWebContents(event.sender)
    const sessionId = String(p.sessionId ?? 'default')
    const result = await aiHubService.sendChatMessage(
      sessionId,
      String(p.message ?? ''),
      p.mode ?? 'general',
      p.provider,
      p.attachments as Array<{ id: string; name: string; type: string; path: string; size: number }> | undefined,
      p.autonomyMode ?? 'semi_auto',
      p.projectName,
      (chunk) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('aihub:stream', { sessionId, chunk })
        }
      },
    )
    return { sessionId, status: 'completed', reply: result }
  }))

  // P1.3: AIDC 规划（宏观参数 → plan:table，AL→MC 接口契约）——大 GPU 规模耗时长，放宽到 5 分钟
  ipcMain.handle('plan:aidc', wrapHandler(async (_event, params?: Record<string, unknown>) => {
    // AL-S2: 剥离路径类字段——plan:aidc 是纯宏观参数 action，不应携带任何路径
    return pythonService.call('plan:aidc', stripPathParams(params), 300000)
  }))

  // G2（REQ-A3）+ 契约 v1.2（A-2）：AIDC 规划导出（JSON / Excel / ZIP 交付包）
  // —— 保存对话框默认文件名带项目身份：{projectName}_{projectId前8}.{ext}（契约 v1.2 §6.4）
  ipcMain.handle('plan:aidc:export', wrapHandler(async (_event, params: Record<string, unknown>, format: 'json' | 'excel' | 'zip') => {
    const ext = format === 'excel' ? 'xlsx' : format === 'zip' ? 'zip' : 'json'
    const p = params ?? {}
    const projName = String(p.projectName ?? p.project_name ?? '')
    const projId = String(p.projectId ?? p.project_id ?? '')
    const id8 = projId.replace(/-/g, '').slice(0, 8)
    const base = asciiSafeBase(projName, id8) || 'aidc_plan'
    const defaultPath = id8 ? `${base}_${id8}.${ext}` : `${base}.${ext}`
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 AIDC 规划',
      defaultPath,
      filters: format === 'excel'
        ? [{ name: 'Excel 规划表', extensions: ['xlsx'] }]
        : format === 'zip'
          ? [{ name: 'AIDC 交付包 ZIP', extensions: ['zip'] }]
          : [{ name: 'plan:table JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true, path: '' }
    }
    // AL-S2: filepath 由上方 showSaveDialog 内部生成；透传前剥离前端可注入的其他路径字段
    return pythonService.call('plan:aidc:export', { ...stripPathParams(params), format, filepath: result.filePath })
  }))

  // 48-b（F8-2）：plan:table 回导——校验/归一化外部 plan JSON（JSON/ZIP 导出可回导）
  ipcMain.handle('plan:aidc:import', wrapHandler(async (_event, params: { plan?: Record<string, unknown> } | Record<string, unknown>) => {
    return pythonService.call('plan:aidc:import', stripPathParams(params ?? {}))
  }))

  // P1（A-3/A-5/A-7）：AIDC 项目化——新建/保存/打开/列表（workspace/<name>/ 落盘 + 版本快照）
  const aidcProjectDir = (name: string): string => {
    sanitizeName(name)
    return path.join(getWorkspacePath(), name)
  }
  ipcMain.handle('aidc:project:create', wrapHandler(async (_event, name: string, macro: Record<string, unknown>, projectId?: string) => {
    return pythonService.call('aidc:project:create', { projectDir: aidcProjectDir(name), name, macro, projectId })
  }))
  ipcMain.handle('aidc:project:save', wrapHandler(async (_event, name: string, macro: Record<string, unknown>) => {
    return pythonService.call('aidc:project:save', { projectDir: aidcProjectDir(name), macro })
  }))
  // 打磨轮（AL-B1）：向导建普通项目后转 AIDC（mint projectId + plan.json + aidc_macro 注入）
  ipcMain.handle('aidc:project:init', wrapHandler(async (_event, name: string, macro: Record<string, unknown>) => {
    return pythonService.call('aidc:project:init', { projectDir: aidcProjectDir(name), macro })
  }))
  ipcMain.handle('aidc:project:load', wrapHandler(async (_event, name: string) => {
    return pythonService.call('aidc:project:load', { projectDir: aidcProjectDir(name) })
  }))
  ipcMain.handle('aidc:project:list', wrapHandler(async () => {
    return pythonService.call('aidc:project:list', { workspaceDir: getWorkspacePath() })
  }))

  // P1（V-AL4）：保存拓扑 PNG（base64 → 保存对话框 → 写盘）
  ipcMain.handle('aidc:savePng', wrapHandler(async (_event, base64: string, defaultName: string) => {
    const safeName = asciiSafeBase(String(defaultName || '').replace(/\.png$/i, ''), '')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出拓扑 PNG',
      defaultPath: `${safeName}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true, path: '' }
    }
    const buffer = Buffer.from(base64, 'base64')
    fs.writeFileSync(result.filePath, buffer)
    return { ok: true, path: result.filePath }
  }))

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

    // 打磨轮（AL-B2 复核）：后端 1024 档实测 6s；超 120s 即视为进程卡死，超时自动杀进程恢复（避免"一直转圈"）
    return pythonService.call('design', { configFile: configPath }, 120000)
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

  // V3.1.3-T7-4: 容量规划（模型档案 + 推荐，纯计算只读）
  ipcMain.handle('capacity:list-presets', wrapHandler(async () => {
    return pythonService.call('capacity:list-presets', {}, 10000)
  }))

  ipcMain.handle('capacity:recommend', wrapHandler(async (_event, params: {
    model: string
    numGpus: number
    budget?: string
    precision?: string
    contextLength?: number
  }) => {
    // V3.2.2-R11.1: 推荐载荷形状校验
    assertParsed(capacityRecommendSchema, params ?? {}, 'capacity:recommend')
    return pythonService.call('capacity:recommend', {
      model: params.model,
      num_gpus: params.numGpus,
      budget: params.budget,
      precision: params.precision,
      context_length: params.contextLength,
    }, 15000)
  }))

  // V3.2.0-T9-2: ATOP 自动拓扑优化（模型通信特征 → ZCube cube 拓扑推荐，只读计算）
  ipcMain.handle('atop:recommend', wrapHandler(async (_event, params: {
    numGpus: number
    model?: string
    modelType?: string
    numExperts?: number
    precision?: string
    tp?: number
    dp?: number
    pp?: number
    communicationPattern?: string
    commRatio?: number
    traffic?: Record<string, number>
    switchPorts?: number
  }) => {
    // V3.4.1-L1: 载荷 zod 校验（含 numGpus 必填与 traffic 边界），替代原手写缺参检查
    assertParsed(atopRecommendSchema, params ?? {}, 'atop:recommend')
    return pythonService.call('atop:recommend', {
      num_gpus: params.numGpus,
      model: params.model,
      model_type: params.modelType,
      num_experts: params.numExperts,
      precision: params.precision,
      tp: params.tp,
      dp: params.dp,
      pp: params.pp,
      communication_pattern: params.communicationPattern,
      comm_ratio: params.commRatio,
      traffic: params.traffic,
      switch_ports: params.switchPorts,
    }, 15000)
  }))

  // V3.2.0-T9-3: 批量优化（收敛比/成本/散热建议生成 + 应用，轨道 B）
  ipcMain.handle('optimize:suggest', wrapHandler(async (_event, params: {
    projectName: string
  }) => {
    sanitizeName(params.projectName)
    const projectDir = path.join(getWorkspacePath(), params.projectName)
    const configPath = path.join(projectDir, 'network_config.ini')
    if (!fs.existsSync(configPath)) {
      throw new Error(`项目配置不存在: ${configPath}`)
    }
    return pythonService.call('optimize:suggest', { configFile: configPath }, 15000)
  }))

  ipcMain.handle('optimize:apply', wrapHandler(async (_event, params: {
    projectName: string
    suggestions: Array<{ category?: string; title?: string; patch: Record<string, Record<string, unknown>> }>
  }) => {
    // V3.2.2-R11.1: 载荷形状校验（替代原手写数组检查）
    assertParsed(optimizeApplySchema, params ?? {}, 'optimize:apply')
    sanitizeName(params.projectName)
    const projectDir = path.join(getWorkspacePath(), params.projectName)
    const configPath = path.join(projectDir, 'network_config.ini')
    if (!fs.existsSync(configPath)) {
      throw new Error(`项目配置不存在: ${configPath}`)
    }
    return pythonService.call('optimize:apply', {
      configFile: configPath,
      suggestions: params.suggestions,
    }, 15000)
  }))

  // V3.2.0-T9-4: 智能修复闭环（校验错误 → 修复 patch → 复核 → 一键应用）
  ipcMain.handle('repair:plan', wrapHandler(async (_event, params: {
    projectName: string
  }) => {
    sanitizeName(params.projectName)
    const projectDir = path.join(getWorkspacePath(), params.projectName)
    const configPath = path.join(projectDir, 'network_config.ini')
    if (!fs.existsSync(configPath)) {
      throw new Error(`项目配置不存在: ${configPath}`)
    }
    return pythonService.call('repair:plan', { configFile: configPath }, 15000)
  }))

  ipcMain.handle('repair:apply', wrapHandler(async (_event, params: {
    projectName: string
    fixes: Array<{ rule_id?: string; message?: string; patch: Record<string, Record<string, unknown>> }>
  }) => {
    // V3.2.2-R11.1: 载荷形状校验（替代原手写数组检查）
    assertParsed(repairApplySchema, params ?? {}, 'repair:apply')
    sanitizeName(params.projectName)
    const projectDir = path.join(getWorkspacePath(), params.projectName)
    const configPath = path.join(projectDir, 'network_config.ini')
    if (!fs.existsSync(configPath)) {
      throw new Error(`项目配置不存在: ${configPath}`)
    }
    return pythonService.call('repair:apply', {
      configFile: configPath,
      fixes: params.fixes,
    }, 20000)
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

  // 打磨轮（v1.2 / AL-2）：批量删除渲染结果（output / output-label / yaml）
  ipcMain.handle('render:deleteOutput', wrapHandler(async (_event, projects: string[]) => {
    const wsp = getWorkspacePath()
    let deleted = 0
    for (const name of projects ?? []) {
      sanitizeName(name)
      for (const sub of ['output', 'output-label', 'yaml']) {
        const dir = path.join(wsp, name, sub)
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true })
          deleted++
        }
      }
    }
    return { deleted }
  }))

  // 打磨轮（v1.2 / AL-2）：导出渲染结果 ZIP（output 或指定批次 output/<batch>）
  ipcMain.handle('render:exportOutput', wrapHandler(async (_event, projectName: string, batchName?: string) => {
    sanitizeName(projectName)
    const wsp = getWorkspacePath()
    const base = path.join(wsp, projectName, 'output')
    if (!fs.existsSync(base)) {
      throw new Error('该项目尚无渲染结果')
    }
    const srcDir = batchName ? path.join(base, batchName) : base
    if (!fs.existsSync(srcDir)) {
      throw new Error(`渲染批次不存在: ${batchName ?? ''}`)
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出渲染结果',
      defaultPath: `${projectName}_渲染结果${batchName ? `_${batchName}` : ''}.zip`,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true, path: '' }
    }
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip()
    const relBase = batchName ? path.join('output', batchName) : 'output'
    zip.addLocalFolder(srcDir, relBase)
    zip.writeZip(result.filePath)
    return { ok: true, path: result.filePath }
  }))

  // 打磨轮（v1.5 / AL-O1b）：前端生成物（上机表/拓扑图/布局图/柜图）写入版本批次目录
  ipcMain.handle('render:saveOutputFile', wrapHandler(async (_event, projectName: string, relPath: string, base64Data: string) => {
    assertParsed(outputSaveFileSchema, { projectName, relPath, base64Data }, 'render:saveOutputFile')
    const segments = ['output', ...relPath.replace(/^output\//, '').split('/')]
    const filePath = sanitizeProjectPath(projectName, ...segments)
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
    }
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'))
    return filePath
  }))

  // 打磨轮（v1.5 / AL-O1e）：读取输出文件（预览，返回 base64 + 扩展名 + 大小）
  ipcMain.handle('render:readOutputFile', wrapHandler(async (_event, projectName: string, relPath: string) => {
    assertParsed(outputReadFileSchema, { projectName, relPath }, 'render:readOutputFile')
    const segments = ['output', ...relPath.replace(/^output\//, '').split('/')]
    const filePath = sanitizeProjectPath(projectName, ...segments)
    if (!fs.existsSync(filePath)) throw new Error('文件不存在')
    const buf = fs.readFileSync(filePath)
    return {
      base64: buf.toString('base64'),
      ext: path.extname(filePath).slice(1).toLowerCase() || 'file',
      size: buf.length,
    }
  }))

  // 打磨轮（v1.5 / AL-O1f）：清空全部项目输出（仅 output/ 产物目录，不动源文件）
  ipcMain.handle('render:clearAllOutput', wrapHandler(async () => {
    const wsp = getWorkspacePath()
    let deleted = 0
    for (const name of fs.readdirSync(wsp, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)) {
      const outDir = path.join(wsp, name, 'output')
      if (fs.existsSync(outDir)) {
        fs.rmSync(outDir, { recursive: true, force: true })
        deleted++
      }
    }
    return { deleted }
  }))

  // ===== Export =====
  ipcMain.handle('export:saveFile', wrapHandler(async (_event, projectName: string, fileName: string, base64Data: string) => {
    // V3.2.2-R11.1: fileName 单层文件名 + base64 边界校验（防路径穿越/超大载荷）
    assertParsed(exportSaveFileSchema, { projectName, fileName, base64Data }, 'export:saveFile')
    const filePath = sanitizeProjectPath(projectName, 'output', fileName)
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
    }
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(filePath, buffer)
    return filePath
  }))

  // ===== 版本历史（M-F1 / PRD v3.6：F1-1/F1-2 对比与回滚） =====
  ipcMain.handle('feature:version-history:list', wrapHandler(async (_event, projectName: string) => {
    sanitizeName(projectName)
    const projectDir = path.join(getWorkspacePath(), projectName)
    if (!fs.existsSync(projectDir)) throw new Error(`项目不存在: ${projectName}`)
    let current: unknown = null
    const planPath = path.join(projectDir, 'plan.json')
    if (fs.existsSync(planPath)) {
      try { current = JSON.parse(fs.readFileSync(planPath, 'utf-8')) } catch { current = null }
    }
    const hdir = path.join(projectDir, 'plan_history')
    const files: { name: string; content: string | null }[] = []
    if (fs.existsSync(hdir)) {
      for (const name of fs.readdirSync(hdir)) {
        if (!/^v\d+\.plan\.json$/.test(name)) continue
        try {
          files.push({ name, content: fs.readFileSync(path.join(hdir, name), 'utf-8') })
        } catch {
          files.push({ name, content: null })
        }
      }
    }
    return { ok: true, projectName, current, files }
  }))

  ipcMain.handle('feature:version-history:rollback', wrapHandler(async (_event, projectName: string, targetVersion: number) => {
    sanitizeName(projectName)
    if (!Number.isInteger(targetVersion) || targetVersion < 1) {
      throw new Error(`版本号非法: ${targetVersion}`)
    }
    const projectDir = path.join(getWorkspacePath(), projectName)
    const planPath = path.join(projectDir, 'plan.json')
    if (!fs.existsSync(planPath)) throw new Error('当前项目缺少 plan.json，无法回滚')
    const targetPath = path.join(projectDir, 'plan_history', `v${targetVersion}.plan.json`)
    if (!fs.existsSync(targetPath)) throw new Error(`历史版本 v${targetVersion} 不存在`)
    let current: Record<string, unknown>
    let target: Record<string, unknown>
    try {
      current = JSON.parse(fs.readFileSync(planPath, 'utf-8'))
      target = JSON.parse(fs.readFileSync(targetPath, 'utf-8'))
    } catch {
      throw new Error('回滚失败：plan 文件解析异常')
    }
    // 与 src/utils/planVersionDiff.ts planRollback 语义一致：先存档当前版本（版本号 +1），再以目标覆盖（+2）
    const curVersion = Number((current.meta as Record<string, unknown> | undefined)?.planVersion ?? 0) || 0
    const archivedVersion = curVersion + 1
    const archived: Record<string, unknown> = {
      ...current,
      meta: { ...(current.meta as Record<string, unknown>), planVersion: archivedVersion, archivedAt: new Date().toISOString() },
    }
    const newVersion = archivedVersion + 1
    const restored: Record<string, unknown> = {
      ...target,
      meta: { ...(target.meta as Record<string, unknown>), planVersion: newVersion, generatedAt: new Date().toISOString() },
    }
    const hdir = path.join(projectDir, 'plan_history')
    fs.mkdirSync(hdir, { recursive: true })
    fs.writeFileSync(path.join(hdir, `v${archivedVersion}.plan.json`), JSON.stringify(archived, null, 2), 'utf-8')
    fs.writeFileSync(planPath, JSON.stringify(restored, null, 2), 'utf-8')
    // 同步 project_config.json 的 aidc_macro / aidc_meta（与后端 save_aidc_project 语义一致）
    const cfgPath = path.join(projectDir, 'project_config.json')
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
        const rmeta = restored.meta as Record<string, unknown>
        cfg.aidc_macro = restored.macro
        cfg.aidc_meta = {
          projectId: rmeta.projectId,
          projectName: rmeta.projectName,
          planVersion: newVersion,
          planHash: rmeta.planHash,
        }
        cfg.meta = { ...(cfg.meta as Record<string, unknown> || {}), updated_at: new Date().toISOString() }
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')
      } catch { /* 损坏的 config 不阻断回滚 */ }
    }
    // 刷新 project.json updatedAt
    const metaPath = path.join(projectDir, 'project.json')
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        meta.updatedAt = new Date().toISOString()
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
      } catch { /* ignore */ }
    }
    return { ok: true, projectName, archivedVersion, newVersion }
  }))

  // ===== 48-b（F8-2）：快照 / 版本历史 文件级导出与回导（导入导出格式增强） =====

  // 设计快照导出为文件（保存对话框 → 写盘）
  ipcMain.handle('feature:snapshot:exportFile', wrapHandler(async (_event, defaultName: string, jsonText: string) => {
    const safeName = asciiSafeBase(String(defaultName || 'snapshot').replace(/\.json$/i, ''), '')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出设计快照',
      defaultPath: `${safeName || 'snapshot'}.json`,
      filters: [{ name: '设计快照 JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true, path: '' }
    fs.writeFileSync(result.filePath, String(jsonText ?? ''), 'utf-8')
    return { canceled: false, path: result.filePath }
  }))

  // 设计快照文件导入（打开对话框 → 读文本，回导由前端 parseSnapshotFile + importFromJson 完成）
  ipcMain.handle('feature:snapshot:importFile', wrapHandler(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入设计快照',
      filters: [{ name: '设计快照 JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, content: '' }
    const content = fs.readFileSync(result.filePaths[0], 'utf-8')
    return { canceled: false, content }
  }))

  // 版本历史导出为文件（聚合 current + history → 可移植 JSON）
  ipcMain.handle('feature:version-history:exportFile', wrapHandler(async (_event, projectName: string) => {
    sanitizeName(projectName)
    const projectDir = path.join(getWorkspacePath(), projectName)
    if (!fs.existsSync(projectDir)) throw new Error(`项目不存在: ${projectName}`)
    let current: unknown = null
    const planPath = path.join(projectDir, 'plan.json')
    if (fs.existsSync(planPath)) {
      try { current = JSON.parse(fs.readFileSync(planPath, 'utf-8')) } catch { current = null }
    }
    const hdir = path.join(projectDir, 'plan_history')
    const history: { version: number; plan: unknown }[] = []
    if (fs.existsSync(hdir)) {
      for (const name of fs.readdirSync(hdir)) {
        const m = /^v(\d+)\.plan\.json$/.exec(name)
        if (!m) continue
        try {
          history.push({ version: Number(m[1]), plan: JSON.parse(fs.readFileSync(path.join(hdir, name), 'utf-8')) })
        } catch { /* 跳过损坏快照 */ }
      }
    }
    history.sort((a, b) => a.version - b.version)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `导出版本历史 "${projectName}"`,
      defaultPath: `${projectName}_版本历史.json`,
      filters: [{ name: '版本历史 JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true, path: '', count: 0 }
    const payload = {
      format: 'autolink-plan-history',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      project: { projectName },
      ...(current != null ? { current } : {}),
      history,
    }
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return { canceled: false, path: result.filePath, count: history.length }
  }))

  // 版本历史文件回导（打开对话框 → 解析 → 合并写盘；overwrite=true 覆盖同版本，默认补齐缺失）
  ipcMain.handle('feature:version-history:importFile', wrapHandler(async (_event, projectName: string, opts?: { overwrite?: boolean }) => {
    sanitizeName(projectName)
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入版本历史',
      filters: [{ name: '版本历史 JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, imported: 0, skipped: 0 }
    let payload: { format?: unknown; schemaVersion?: unknown; history?: { version?: unknown; plan?: unknown }[] }
    try {
      payload = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'))
    } catch {
      throw new Error('版本历史文件不是合法 JSON')
    }
    if (payload?.format !== 'autolink-plan-history') throw new Error('版本历史文件格式标识缺失/不符')
    if (!Array.isArray(payload?.history)) throw new Error('版本历史文件缺少 history 段')
    const projectDir = path.join(getWorkspacePath(), projectName)
    const hdir = path.join(projectDir, 'plan_history')
    fs.mkdirSync(hdir, { recursive: true })
    const overwrite = opts?.overwrite === true
    let imported = 0
    let skipped = 0
    for (const entry of payload.history ?? []) {
      const v = Number(entry?.version)
      if (!Number.isInteger(v) || v < 1 || entry?.plan == null) continue
      const targetPath = path.join(hdir, `v${v}.plan.json`)
      if (fs.existsSync(targetPath) && !overwrite) {
        skipped++
        continue
      }
      fs.writeFileSync(targetPath, JSON.stringify(entry.plan, null, 2), 'utf-8')
      imported++
    }
    return { canceled: false, imported, skipped }
  }))

  // ===== 评审 PDF（M-F1 / PRD v3.6：F1-3 printToPDF A4 → output/ 根目录 → [根目录] 批次） =====
  ipcMain.handle('feature:review-pdf', wrapHandler(async (_event, projectName: string) => {
    sanitizeName(projectName)
    const projectDir = path.join(getWorkspacePath(), projectName)
    const planPath = path.join(projectDir, 'plan.json')
    if (!fs.existsSync(planPath)) {
      throw new Error('当前项目未生成 AIDC 规划，无法导出评审 PDF（请先在「AIDC 规划」视图生成规划）')
    }
    let plan: Record<string, unknown>
    try {
      plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'))
    } catch {
      throw new Error('plan.json 解析失败，无法导出评审 PDF')
    }
    const html = buildReviewPdfHtml(projectName, plan)
    const outputDir = path.join(projectDir, 'output')
    fs.mkdirSync(outputDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fileName = `${projectName}_评审报告_${ts}.pdf`
    const pdfPath = path.join(outputDir, fileName)
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      fs.writeFileSync(pdfPath, data)
    } finally {
      win.destroy()
    }
    return { ok: true, path: pdfPath, fileName }
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
  // V3.4.1-L7: execSync 探测 Python 会阻塞主进程，结果做进程级缓存（会话内不变）
  ipcMain.handle('app:getStackVersions', () => {
    try {
      if (cachedStackVersions !== null) return cachedStackVersions
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
      const result = {
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
      cachedStackVersions = result
      return result
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
    // AL-M1e: 白名单基础目录收敛（workspace/品牌资源/内置文档/临时/下载/桌面），防对系统任意路径定位
    if (!filePath || filePath.includes('..') || !isPathInShellWhitelist(filePath)) {
      throw new Error(`无效路径: ${filePath}`)
    }
    shell.showItemInFolder(filePath)
  }))

  ipcMain.handle('shell:openPath', wrapHandler(async (_event, filePath: string) => {
    if (!filePath || filePath.includes('..') || !isPathInShellWhitelist(filePath)) {
      throw new Error(`无效路径: ${filePath}`)
    }
    return shell.openPath(filePath)
  }))

  ipcMain.handle('shell:openExternal', wrapHandler(async (_event, url: string) => {
    // V3.2.2-R11.1: 仅允许 https 协议，防止任意协议执行
    assertParsed(httpsUrlSchema, url, 'shell:openExternal')
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
    // V3.2.2-R11.1: id/category 边界校验（防路径穿越）
    assertParsed(deviceSaveSchema, device ?? {}, 'device-library:save')
    saveDeviceToFile(device)
  }))

  ipcMain.handle('device-library:delete', wrapHandler(async (_event, deviceId: string) => {
    deleteDeviceFile(deviceId)
  }))

  ipcMain.handle('device-library:import', wrapHandler(async (_event, devices: { id: string; category: string }[]) => {
    // V3.2.2-R11.1: 批量导入逐项校验
    if (!Array.isArray(devices) || devices.length > 500) {
      throw new Error('设备导入数量非法')
    }
    for (const device of devices) {
      assertParsed(deviceSaveSchema, device ?? {}, 'device-library:import')
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

  // 48-c（F8-3）：设备库跨端可移植格式（MC↔AL）——导出带 schema/版本清单的可移植 JSON
  ipcMain.handle('device-library:exportPortable', wrapHandler(async (_event, deviceIds: string[]) => {
    const libData = loadDeviceLibrary()
    const allDevices = libData.categories.flatMap((c) => c.devices)
    const selected = allDevices.filter((d) => deviceIds.includes(d.id))
    if (selected.length === 0) throw new Error('未选择要导出的设备')
    const payload = {
      format: 'autolink-device-library',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      devices: selected,
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出设备库（可移植 / MC 可导入）',
      defaultPath: 'device_library_portable.json',
      filters: [{ name: '设备库 JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true, path: '', count: 0 }
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return { canceled: false, path: result.filePath, count: selected.length }
  }))

  // 48-c（F8-3）：设备库跨端可移植格式导入（读取文件文本，前端 parsePortableLibrary 归一化后走 device-library:import）
  ipcMain.handle('device-library:importPortable', wrapHandler(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入设备库（可移植 / MC）',
      filters: [{ name: '设备库 JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, content: '' }
    const content = fs.readFileSync(result.filePaths[0], 'utf-8')
    return { canceled: false, content }
  }))

  // 48-c（F8-3）：技能库文件级导入导出（打包 skills/*.md + 状态 → zip，跨端互灌）
  ipcMain.handle('skills:list', wrapHandler(async () => {
    return pythonService.call('skills:list', {})
  }))
  ipcMain.handle('skills:export', wrapHandler(async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出技能库',
      defaultPath: 'skills_export.zip',
      filters: [{ name: '技能库 ZIP', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true, path: '' }
    const r = await pythonService.call('skills:export', { filepath: result.filePath })
    return { canceled: false, ...r }
  }))
  ipcMain.handle('skills:import', wrapHandler(async (_event, opts?: { overwrite?: boolean }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入技能库',
      filters: [{ name: '技能库 ZIP', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, imported: 0, skipped: 0 }
    const r = await pythonService.call('skills:import', { zipPath: result.filePaths[0], overwrite: opts?.overwrite === true })
    return { canceled: false, ...r }
  }))

  // ===== Template =====
  ipcMain.handle('template:getStructure', wrapHandler(async (_event, templateName: string) => {
    sanitizeName(templateName)
    // 优先查用户模板目录，再查内置模板目录
    const userTplDir = path.join(getUserTemplatePath(), templateName)
    const builtinTplDir = path.join(getTemplatePath(), templateName)
    const tplDir = fs.existsSync(userTplDir) ? userTplDir : builtinTplDir
    if (!fs.existsSync(tplDir)) return []
    return walkDir(tplDir, '')
  }))

  ipcMain.handle('template:getFile', wrapHandler(async (_event, templateName: string, filePath: string) => {
    sanitizeName(templateName)
    // 优先查用户模板目录，再查内置模板目录
    const userTplDir = getUserTemplatePath()
    const builtinTplDir = getTemplatePath()
    const baseDir = fs.existsSync(path.join(userTplDir, templateName)) ? userTplDir : builtinTplDir
    const fullPath = sanitizeUnderBase(baseDir, templateName, filePath)
    if (!fs.existsSync(fullPath)) return null
    return fs.readFileSync(fullPath, 'utf-8')
  }))

  // V2.9.5-T2: 读取模板 project_config.json（用户模板优先，无 JSON 返回 null）
  ipcMain.handle('template:getConfig', wrapHandler(async (_event, templateName: string) => {
    sanitizeName(templateName)
    const userTplDir = path.join(getUserTemplatePath(), templateName)
    const builtinTplDir = path.join(getTemplatePath(), templateName)
    const tplDir = fs.existsSync(userTplDir) ? userTplDir : builtinTplDir
    if (!fs.existsSync(tplDir)) return null
    const jsonPath = path.join(tplDir, 'project_config.json')
    if (!fs.existsSync(jsonPath)) return null
    try {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    } catch (err) {
      console.error(`[template:getConfig] 解析失败: ${templateName}`, err)
      return null
    }
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
    // V2.9.7-T1: 从模板 project_config.json 解析规模摘要（无 JSON 时返回 null）
    const readSummary = (tplDir: string) => {
      const jsonPath = path.join(tplDir, 'project_config.json')
      if (!fs.existsSync(jsonPath)) return null
      try {
        const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        const topo = cfg.topology || {}
        const rack = cfg.rack_config || {}
        return {
          numGpuServers: topo.num_gpu_servers ?? 0,
          numAllFlashStorage: topo.num_all_flash_storage ?? 0,
          numHybridFlashStorage: topo.num_hybrid_flash_storage ?? 0,
          numComputeServers: topo.num_compute_servers ?? 0,
          paramProtocol: topo.param_protocol || 'RoCE',
          paramSpeed: topo.param_speed || '',
          storageSpeed: topo.storage_speed || '',
          powerLimitPerRack: rack.power_limit_per_rack ?? 0,
        }
      } catch {
        return null
      }
    }

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
            summary: readSummary(path.join(tplDir, e.name)),
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

    // Copy config files（P1 A-6：AIDC 项目含 plan.json，一并进模板）
    const filesToCopy = ['network_config.ini', 'project_config.json', 'project.json', 'plan.json']
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
    projectConfig?: string
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

    // V2.9.6-T1: 如果提供了 project_config.json 内容（JSON 字符串），
    // 校验通过后写回 project_config.json，并从 JSON 反向生成同步 network_config.ini
    if (typeof updates.projectConfig === 'string') {
      let parsed: unknown
      try {
        parsed = JSON.parse(updates.projectConfig)
      } catch (e) {
        throw new Error(`project_config.json 不是合法 JSON: ${(e as Error).message}`)
      }
      const result = await pythonService.call('project_config_to_ini', { config: parsed }) as {
        valid?: boolean
        error?: string | null
        ini?: string | null
      }
      if (!result?.valid) {
        throw new Error(`模板配置校验失败: ${result?.error || '未知错误'}`)
      }
      const jsonPath = path.join(targetDir, 'project_config.json')
      fs.writeFileSync(jsonPath, updates.projectConfig, 'utf-8')
      const iniPath = path.join(targetDir, 'network_config.ini')
      fs.writeFileSync(iniPath, result.ini ?? '', 'utf-8')
    }
  }))

  // V2.9.7-T2/T4/T5: 模板预览方案 - 临时目录即时设计（不落盘到模板目录）
  ipcMain.handle('template:preview', wrapHandler(async (_event, templateName: string) => {
    sanitizeName(templateName)
    const userTplDir = path.join(getUserTemplatePath(), templateName)
    const builtinTplDir = path.join(getTemplatePath(), templateName)
    const tplDir = fs.existsSync(userTplDir) ? userTplDir
      : fs.existsSync(builtinTplDir) ? builtinTplDir : null
    if (!tplDir) throw new Error(`模板 "${templateName}" 不存在`)

    const jsonPath = path.join(tplDir, 'project_config.json')
    if (!fs.existsSync(jsonPath)) {
      // V2.9.7-T4: 旧模板（仅 INI）给出明确提示，不静默失败
      return { success: false, error: 'template.noConfig' }
    }

    // 临时目录：写入 JSON → design → 提取摘要 → finally 清理
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autolink-preview-'))
    const tmpJson = path.join(tmpDir, 'project_config.json')
    try {
      fs.copyFileSync(jsonPath, tmpJson)
      const result = await pythonService.call('design', { configFile: tmpJson }, 30000) as {
        summary?: Record<string, unknown>
        powerData?: { totalRacks?: number; totalPowerWatts?: number }
        valid?: boolean
        validationIssues?: Array<{ severity?: string; message?: string; rule_id?: string }>
        estimation?: { convergence?: unknown }
      }
      const summary = result?.summary || {}
      const power = result?.powerData || {}
      const issues = result?.validationIssues || []
      const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message || i.rule_id || '校验失败')
      return {
        success: true,
        summary: {
          numServers: (summary.totalServers as number) ?? (summary.numServers as number) ?? 0,
          numGpuServers: (summary.numServers as number) ?? 0,
          paramLeafCount: (summary.paramLeafCount as number) ?? 0,
          paramSpineCount: (summary.paramSpineCount as number) ?? 0,
          paramCoreCount: (summary.paramCoreCount as number) ?? 0,
          storageLeafCount: (summary.storageLeafCount as number) ?? 0,
          storageSpineCount: (summary.storageSpineCount as number) ?? 0,
          paramSpeed: (summary.paramSpeed as string) ?? '',
          storageSpeed: (summary.storageSpeed as string) ?? '',
          paramProtocol: (summary.paramProtocol as string) ?? 'RoCE',
          totalRacks: power.totalRacks ?? 0,
          totalPowerWatts: power.totalPowerWatts ?? 0,
          valid: !!result?.valid,
          errors,
          convergence: result?.estimation?.convergence ?? null,
        },
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }))

  // V2.9.8-T2: 模板健康检查 — 扫描内置+用户模板，定位损坏模板
  // 检查项：缺 JSON / JSON 非法 / 配置语义非法（validate_config）/ 选型引用失效
  ipcMain.handle('template:healthCheck', wrapHandler(async () => {
    const deviceIds = new Set(loadDeviceLibrary().categories.flatMap((c) => c.devices.map((d) => d.id)))

    const checkTemplate = async (tplDir: string): Promise<{ type: string; detail: string }[]> => {
      const issues: { type: string; detail: string }[] = []
      const jsonPath = path.join(tplDir, 'project_config.json')
      if (!fs.existsSync(jsonPath)) {
        issues.push({ type: 'missing_json', detail: '缺少 project_config.json（仅含 INI，无法预览/完整校验）' })
        return issues
      }

      let cfg: Record<string, unknown>
      try {
        cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
      } catch (e) {
        issues.push({ type: 'invalid_json', detail: `project_config.json 解析失败: ${(e as Error).message}` })
        return issues
      }

      // 配置语义校验（复用 project_config_to_ini 的 validate_config 逻辑）
      const checkResult = await pythonService.call('project_config_to_ini', { config: cfg }) as {
        valid?: boolean
        error?: string | null
      }
      if (!checkResult?.valid) {
        issues.push({ type: 'invalid_config', detail: `配置校验失败: ${checkResult?.error || '未知错误'}` })
      }

      // 选型引用失效：device_refs.library_id 必须在设备库中存在（兼容旧 id 别名，与 backend LEGACY_ALIASES 对齐）
      const legacyAliases: Record<string, string> = {
        h3c_s9850_64h: 'h3c_s9850_32h',
        h3c_s6805_48p: 'h3c_s6805_56hf_g',
        h3c_s5820v2_24p: 'h3c_s5820v2_52qf',
        ruijie_s6910_32oc2vs_1_6t: 'ruijie_rg_s6910_32oc2vs_1_6t',
      }
      const refs = (cfg.device_refs || {}) as Record<string, { library_id?: string }>
      for (const [key, ref] of Object.entries(refs)) {
        const rawLibId = ref?.library_id
        if (!rawLibId) {
          issues.push({ type: 'bad_ref', detail: `device_refs.${key} 缺少 library_id` })
        } else if (!deviceIds.has(legacyAliases[rawLibId] || rawLibId)) {
          issues.push({ type: 'unresolved_ref', detail: `device_refs.${key} 引用的设备不存在: ${rawLibId}` })
        }
      }
      return issues
    }

    const results: { id: string; name: string; isBuiltin: boolean; issues: { type: string; detail: string }[] }[] = []
    const scanDir = async (baseDir: string, isBuiltin: boolean) => {
      if (!fs.existsSync(baseDir)) return
      for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue
        const tplDir = path.join(baseDir, e.name)
        results.push({ id: e.name, name: e.name, isBuiltin, issues: await checkTemplate(tplDir) })
      }
    }
    await scanDir(getTemplatePath(), true)
    await scanDir(getUserTemplatePath(), false)

    return {
      checked: results.length,
      healthyCount: results.filter((r) => r.issues.length === 0).length,
      unhealthy: results.filter((r) => r.issues.length > 0),
    }
  }))

  // V2.4.1: 模板导出为 ZIP - 显示保存对话框
  // T15-2: 支持 password 加密
  ipcMain.handle('template:exportZip', wrapHandler(async (_event, templateName: string, options?: { password?: string }) => {
    sanitizeName(templateName)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `导出模板 "${templateName}"`,
      defaultPath: `${templateName}.zip`,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true, zipPath: '' }
    }
    await projectIOService.exportTemplateZip(templateName, result.filePath, options?.password)
    return { canceled: false, zipPath: result.filePath }
  }))

  // V2.4.1: 模板导入 ZIP - 显示打开对话框
  // V2.9.8-T1: 导入强校验 — 无 project_config.json 时自动调用 Python 迁移补全；
  //            含 JSON 时 validate_config 校验；任一失败则回滚删除并明确抛错
  // T15-2: 支持 password 解密
  ipcMain.handle('template:importZip', wrapHandler(async (_event, options?: { templateName?: string; zipPath?: string; password?: string }) => {
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
    const finalName = await projectIOService.importTemplateZip(zipPath, options?.templateName, options?.password)
    const destDir = path.join(getUserTemplatePath(), finalName)
    const jsonPath = path.join(destDir, 'project_config.json')
    const iniPath = path.join(destDir, 'network_config.ini')
    try {
      // 无 JSON：若含 INI 则自动迁移补全（旧模板包兼容），两者皆无时拒绝
      if (!fs.existsSync(jsonPath)) {
        if (!fs.existsSync(iniPath)) {
          throw new Error('模板 ZIP 未包含 project_config.json 或 network_config.ini，无法导入')
        }
        const migrateResult = await pythonService.call('migrate', { projectDir: destDir }) as {
          migrated?: boolean
          warnings?: string[]
        }
        if (!migrateResult?.migrated) {
          throw new Error(`模板配置自动迁移失败: ${(migrateResult?.warnings || []).join('; ') || '未知错误'}`)
        }
      }
      // 校验 JSON：语法 + validate_config（复用 project_config_to_ini 的校验逻辑）
      let parsed: unknown
      try {
        parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
      } catch (e) {
        throw new Error(`模板 project_config.json 不是合法 JSON: ${(e as Error).message}`)
      }
      const checkResult = await pythonService.call('project_config_to_ini', { config: parsed }) as {
        valid?: boolean
        error?: string | null
      }
      if (!checkResult?.valid) {
        throw new Error(`模板配置校验失败: ${checkResult?.error || '未知错误'}`)
      }
    } catch (err) {
      // 校验失败：回滚已导入的模板目录，避免残留损坏模板
      fs.rmSync(destDir, { recursive: true, force: true })
      throw err
    }
    return { canceled: false, templateName: finalName }
  }))

  // ===== Output File Deletion =====
  ipcMain.handle('project:deleteOutputFile', wrapHandler(async (_event, projectName: string, filePath: string) => {
    const fullPath = sanitizeProjectPath(projectName, 'output', filePath)
    if (!fs.existsSync(fullPath)) throw new Error('文件不存在')
    if (fs.statSync(fullPath).isDirectory()) throw new Error('不能删除目录，请使用删除批次功能')
    fs.rmSync(fullPath)
  }))

  ipcMain.handle('project:deleteOutputBatch', wrapHandler(async (_event, projectName: string, batchName: string) => {
    sanitizeName(batchName)
    const fullPath = sanitizeProjectPath(projectName, 'output', batchName)
    if (!fs.existsSync(fullPath)) throw new Error('批次不存在')
    fs.rmSync(fullPath, { recursive: true, force: true })
  }))

  ipcMain.handle('project:clearOutput', wrapHandler(async (_event, projectName: string) => {
    const outputDir = sanitizeProjectPath(projectName, 'output')
    if (!fs.existsSync(outputDir)) return

    const entries = fs.readdirSync(outputDir, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(outputDir, entry.name)
      fs.rmSync(entryPath, { recursive: true, force: true })
    }
  }))
}