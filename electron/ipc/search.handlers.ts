/**
 * V3.3.1: 本地搜索（项目文件 / 设备库 / 模板 文件名 + 内容检索）
 *
 * 渲染层 CSP 红线（connect-src 'self'，渲染层 0 网络/0 文件系统）：
 * 全部文件 IO 在宿主进程完成，渲染层仅通过 IPC 拿结构化结果。
 */
import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { getWorkspacePath, getTemplatePath, getUserTemplatePath } from '../config.js'

export type LocalSearchScope = 'project' | 'device' | 'template' | 'all'

export interface LocalSearchParams {
  query: string
  scope?: LocalSearchScope
  maxResults?: number
}

export interface LocalSearchHit {
  type: 'project' | 'device' | 'template'
  /** 项目名 / 设备 id / 模板名 */
  name: string
  /** 设备类别 / 模板来源（内置 / 用户） */
  category?: string
  /** 相对路径（文件命中时） */
  path?: string
  kind?: 'filename' | 'content'
  line?: number
  excerpt?: string
}

/** 参与内容检索的文本扩展名（避免二进制/大文件误读） */
const TEXT_EXTENSIONS = new Set([
  '.json', '.ini', '.cfg', '.conf', '.toml', '.yaml', '.yml', '.csv',
  '.md', '.txt', '.log', '.py', '.sh', '.ts', '.tsx', '.js', '.html',
])
/** 单文件内容读取上限（字节），超限仅匹配文件名 */
const MAX_READ_BYTES = 256 * 1024
/** 单文件内容命中上限 */
const MAX_HITS_PER_FILE = 5
const MAX_EXCERPT_CHARS = 120
const MAX_RESULTS_DEFAULT = 200
const MAX_RESULTS_LIMIT = 500

function isTextFile(fileName: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

function isExcludedDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules' || name === '.git' || name === 'device_library'
}

interface WalkedFile {
  full: string
  rel: string
  name: string
}

function walkFiles(dir: string, basePath: string, out: WalkedFile[]): void {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (isExcludedDir(e.name)) continue
    const full = path.join(dir, e.name)
    const rel = basePath ? `${basePath}/${e.name}` : e.name
    if (e.isDirectory()) {
      walkFiles(full, rel, out)
    } else {
      out.push({ full, rel, name: e.name })
    }
  }
}

/** 文件内容按行检索，返回命中行摘要 */
function matchContent(fullPath: string, fileName: string, qLower: string): { line: number; excerpt: string }[] {
  if (!isTextFile(fileName)) return []
  try {
    const stat = fs.statSync(fullPath)
    if (stat.size > MAX_READ_BYTES) return []
  } catch {
    return []
  }
  let content: string
  try {
    content = fs.readFileSync(fullPath, 'utf-8')
  } catch {
    return []
  }
  const hits: { line: number; excerpt: string }[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length && hits.length < MAX_HITS_PER_FILE; i++) {
    if (lines[i].toLowerCase().includes(qLower)) {
      hits.push({ line: i + 1, excerpt: lines[i].slice(0, MAX_EXCERPT_CHARS).trim() })
    }
  }
  return hits
}

function listDirs(root: string): string[] {
  try {
    return fs.readdirSync(root).filter((n) => {
      try {
        return fs.statSync(path.join(root, n)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function searchProjects(qLower: string, limit: number): LocalSearchHit[] {
  const hits: LocalSearchHit[] = []
  for (const pname of listDirs(getWorkspacePath())) {
    if (hits.length >= limit) break
    if (pname.toLowerCase().includes(qLower)) {
      hits.push({ type: 'project', name: pname, kind: 'filename' })
    }
    const files: WalkedFile[] = []
    walkFiles(path.join(getWorkspacePath(), pname), '', files)
    for (const f of files) {
      if (hits.length >= limit) break
      if (f.name.toLowerCase().includes(qLower)) {
        hits.push({ type: 'project', name: pname, path: f.rel, kind: 'filename' })
        continue
      }
      for (const ch of matchContent(f.full, f.name, qLower)) {
        if (hits.length >= limit) break
        hits.push({ type: 'project', name: pname, path: f.rel, kind: 'content', line: ch.line, excerpt: ch.excerpt })
      }
    }
  }
  return hits
}

function searchDevices(qLower: string, limit: number): LocalSearchHit[] {
  const hits: LocalSearchHit[] = []
  const libPath = path.join(getTemplatePath(), 'device_library')
  const files: WalkedFile[] = []
  walkFiles(libPath, '', files)
  for (const f of files) {
    if (hits.length >= limit) break
    if (f.rel === 'library_index.json') continue
    if (!isTextFile(f.name)) continue
    let text: string
    try {
      text = fs.readFileSync(f.full, 'utf-8')
    } catch {
      continue
    }
    if (text.length > MAX_READ_BYTES) continue
    if (!text.toLowerCase().includes(qLower)) continue
    let id = ''
    try {
      id = String((JSON.parse(text) as { id?: unknown })?.id ?? '')
    } catch {
      /* 非法 JSON 仍以文件名兜底 */
    }
    const hitLine = text.split('\n').findIndex((l) => l.toLowerCase().includes(qLower))
    hits.push({
      type: 'device',
      name: id || path.basename(f.name, '.json'),
      category: f.rel.split('/')[0] || '',
      kind: 'content',
      line: hitLine >= 0 ? hitLine + 1 : undefined,
      excerpt: hitLine >= 0 ? text.split('\n')[hitLine].slice(0, MAX_EXCERPT_CHARS).trim() : '',
    })
  }
  return hits
}

function searchTemplates(qLower: string, limit: number): LocalSearchHit[] {
  const hits: LocalSearchHit[] = []
  const roots: [string, string][] = [
    ['内置', getTemplatePath()],
    ['用户', getUserTemplatePath()],
  ]
  for (const [source, root] of roots) {
    for (const tname of listDirs(root)) {
      if (hits.length >= limit) break
      if (tname.toLowerCase().includes(qLower)) {
        hits.push({ type: 'template', name: tname, category: source, kind: 'filename' })
      }
      const files: WalkedFile[] = []
      walkFiles(path.join(root, tname), '', files)
      for (const f of files) {
        if (hits.length >= limit) break
        if (f.name.toLowerCase().includes(qLower)) {
          hits.push({ type: 'template', name: tname, path: f.rel, category: source, kind: 'filename' })
          continue
        }
        for (const ch of matchContent(f.full, f.name, qLower)) {
          if (hits.length >= limit) break
          hits.push({ type: 'template', name: tname, path: f.rel, category: source, kind: 'content', line: ch.line, excerpt: ch.excerpt })
        }
      }
    }
  }
  return hits
}

export function registerSearchIpcHandlers(): void {
  ipcMain.handle('search:local', (_event, params: LocalSearchParams) => {
    const query = typeof params?.query === 'string' ? params.query.trim().slice(0, 200) : ''
    const scope: LocalSearchScope = params?.scope === 'device' || params?.scope === 'template' || params?.scope === 'project'
      ? params.scope
      : 'all'
    const maxResults = Math.max(1, Math.min(params?.maxResults ?? MAX_RESULTS_DEFAULT, MAX_RESULTS_LIMIT))
    if (!query) return []

    const qLower = query.toLowerCase()
    if (scope === 'project') return searchProjects(qLower, maxResults)
    if (scope === 'device') return searchDevices(qLower, maxResults)
    if (scope === 'template') return searchTemplates(qLower, maxResults)

    // all：项目 → 设备 → 模板，组内按顺序输出
    return [
      ...searchProjects(qLower, maxResults),
      ...searchDevices(qLower, maxResults),
      ...searchTemplates(qLower, maxResults),
    ].slice(0, maxResults)
  })
}
