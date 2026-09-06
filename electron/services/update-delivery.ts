/**
 * 5.0.9（509-a 升级体验增强 / 509-b 企业部署基座）
 * 更新交付纯函数与配置载体（与 MC 对等同构）。
 *
 * 全部为纯函数/轻量 fs 操作，独立于 electron 运行时，便于 vitest 单测：
 *  - 断点续传：.part 文件名 / 已下载偏移 / Content-Range 解析
 *  - sha512 强校验：latest.yml / 平台响应中的 sha512 解析、比对待办
 *  - 回滚基线：回滚安装包管理（保存 / 列出 / 清除）
 *  - 版本锁定：本地版本是否低于平台最低要求
 *  - 灰度通道：按 updateChannel 选择 latest*.yml 文件名（Additive，不破坏默认 stable）
 *  - 配置读取：update.config.json（userData 隐藏配置，默认值兜底）
 */
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { compareVersions } from '../utils/version.js'

/* ============================================================
 * 配置（509-a 灰度通道 / 509-b 企业部署基座）
 * ============================================================ */

export interface UpdateSettings {
  /** 发布通道：stable（默认）/ beta / 其它（用于 ?channel= 与 yml 选择） */
  updateChannel: string
  /** 企业部署基座开关（默认 false，隐藏，不影响默认升级链路） */
  enableEnterpriseDeploy: boolean
  /** 内网镜像：latest.yml / 安装包地址（企业部署时优先于默认官方地址） */
  updateUrl: string
  /** 自定义代理（企业部署时用于下载请求） */
  proxy: string
  /** 平台版本端点 base url（用于 /api/v1/client/version?channel=，读取 sha512/min_required_version） */
  platformBaseUrl: string
}

export function defaultUpdateSettings(): UpdateSettings {
  return {
    updateChannel: 'stable',
    enableEnterpriseDeploy: false,
    updateUrl: '',
    proxy: '',
    platformBaseUrl: '',
  }
}

/**
 * 读取 userData 下的更新隐藏配置，按默认值合并、容忍损坏字段。
 * @param file 指定配置文件路径；为空时返回纯默认值（便于单测与未初始化环境）。
 */
export function readUpdateSettings(file?: string): UpdateSettings {
  const defaults = defaultUpdateSettings()
  if (!file) return defaults
  let raw: unknown
  try {
    if (!fs.existsSync(file)) return defaults
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return defaults
  }
  if (!raw || typeof raw !== 'object') return defaults
  const o = raw as Record<string, unknown>
  const s: UpdateSettings = { ...defaults }
  if (typeof o.updateChannel === 'string' && o.updateChannel.trim()) s.updateChannel = o.updateChannel.trim()
  if (typeof o.enableEnterpriseDeploy === 'boolean') s.enableEnterpriseDeploy = o.enableEnterpriseDeploy
  if (typeof o.updateUrl === 'string') s.updateUrl = o.updateUrl.trim()
  if (typeof o.proxy === 'string') s.proxy = o.proxy.trim()
  if (typeof o.platformBaseUrl === 'string') s.platformBaseUrl = o.platformBaseUrl.trim().replace(/\/+$/, '')
  return s
}

/* ============================================================
 * 灰度通道：按 updateChannel 选择 latest*.yml
 * ============================================================ */

/**
 * 按通道选择 yml 文件名（Additive，默认 stable 返回原文件名，行为不变）。
 * @param channel 发布通道，如 stable/beta
 * @param platformYml 平台标准 yml，如 latest.yml / latest-mac.yml / latest-linux.yml
 */
export function resolveYmlNameForChannel(channel: string, platformYml: string): string {
  const ch = (channel || '').trim().toLowerCase()
  if (!ch || ch === 'stable') return platformYml
  const base = platformYml.replace(/\.yml$/i, '')
  return `${base}-${ch}.yml`
}

/* ============================================================
 * 断点续传：.part / 偏移 / Content-Range
 * ============================================================ */

/** 目标文件对应的 .part 临时文件路径 */
export function partFileFor(localPath: string): string {
  return `${localPath}.part`
}

/** 已下载字节偏移：按 .part 文件大小续传；无残留文件返回 0（从 0 开始） */
export function resumeOffset(partFile: string): number {
  try {
    const size = fs.statSync(partFile).size
    return size > 0 ? size : 0
  } catch {
    return 0
  }
}

export interface ContentRange {
  start: number
  end: number
  total: number
}

/** 解析 206 响应的 Content-Range 头，形如 bytes 500-999/1000；无效返回 null */
export function parseContentRange(value: string | string[] | undefined | null): ContentRange | null {
  if (!value) return null
  const v = Array.isArray(value) ? value[0] : value
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(v))
  if (!m) return null
  const total = m[3] === '*' ? -1 : parseInt(m[3], 10)
  return { start: parseInt(m[1], 10), end: parseInt(m[2], 10), total }
}

/* ============================================================
 * sha512 强校验
 * ============================================================ */

/** 从 latest*.yml 正文解析 sha512（可能为 base64 表示，交由 sha512ToHex 归一化） */
export function parseSha512FromYml(body: string): string | undefined {
  const m = /^sha512:\s*(.+)$/m.exec(body || '')
  return m ? m[1].trim() : undefined
}

/**
 * 归一化期望哈希为小写 hex：
 *  - 已是 128 位 hex 的直接返回；
 *  - 否则视作 base64（electron-builder latest.yml 常见），解码为 64 字节后转 hex。
 * 无法识别返回 null。
 */
export function sha512ToHex(expected: string): string | null {
  const e = (expected || '').trim()
  if (!e) return null
  if (/^[0-9a-fA-F]{128}$/.test(e)) return e.toLowerCase()
  try {
    const buf = Buffer.from(e, 'base64')
    if (buf.length === 64) return buf.toString('hex')
  } catch {
    /* ignore */
  }
  return null
}

/** 期望哈希（hex 或 base64）与实算 hex 是否匹配 */
export function sha512Matches(expected: string, actualHex: string): boolean {
  const want = sha512ToHex(expected)
  if (!want || !actualHex) return false
  return want === actualHex.trim().toLowerCase()
}

/** 对本地文件流式计算 sha512（hex） */
export function computeSha512(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha512')
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath)
    rs.on('data', (chunk) => hash.update(chunk))
    rs.on('end', () => resolve(hash.digest('hex')))
    rs.on('error', reject)
  })
}

/* ============================================================
 * 回滚基线：回滚安装包管理（保存 / 列出 / 清除）
 * ============================================================ */

export interface RollbackEntry {
  fileName: string
  filePath: string
  version: string
  savedAt: string
}

function extractVersionFromFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/^rollback-/, '')
  const m = /(\d+(?:\.\d+)+)/.exec(base)
  return m ? m[1] : `unknown-${base}`
}

/** 保守的回滚安装包管理。仅管理目录，不做自动反复安装（避免启动循环）。 */
export class RollbackManager {
  constructor(public dir: string) {}

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true })
  }

  /** 将既有安装包复制为回滚产物；源文件缺失返回 null */
  save(srcPath: string, version: string): RollbackEntry | null {
    if (!srcPath || !fs.existsSync(srcPath)) return null
    this.ensureDir()
    const v = ((version || 'unknown').replace(/[^0-9A-Za-z.\-_]/g, '_')) || 'unknown'
    const fileName = `rollback-${v}-${Date.now()}${path.extname(srcPath)}`
    const dest = path.join(this.dir, fileName)
    fs.copyFileSync(srcPath, dest)
    return { fileName, filePath: dest, version: version || 'unknown', savedAt: new Date().toISOString() }
  }

  /** 列出回滚安装包（缺失目录返回空数组，按保存时间倒序） */
  list(): RollbackEntry[] {
    if (!fs.existsSync(this.dir)) return []
    const entries: RollbackEntry[] = []
    for (const name of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, name)
      try {
        const st = fs.statSync(p)
        if (!st.isFile()) continue
        entries.push({
          fileName: name,
          filePath: p,
          version: extractVersionFromFileName(name),
          savedAt: st.mtime.toISOString(),
        })
      } catch {
        /* 跳过无法读取的条目 */
      }
    }
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  /** 清除全部回滚安装包 */
  clear(): void {
    if (!fs.existsSync(this.dir)) return
    for (const name of fs.readdirSync(this.dir)) {
      try {
        fs.unlinkSync(path.join(this.dir, name))
      } catch {
        /* ignore */
      }
    }
  }
}

/* ============================================================
 * 版本锁定：本地版本是否低于平台最低要求
 * ============================================================ */

/** 本地版本 < min_required_version 时返回 true（需提示升级）；min_required 缺失一律 false */
export function isBelowMinRequired(localVersion: string, minRequiredVersion: string | undefined | null): boolean {
  if (!minRequiredVersion || !localVersion) return false
  return compareVersions(localVersion, minRequiredVersion) < 0
}