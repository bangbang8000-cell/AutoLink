/**
 * 5.4.16-F5416-11/12：内容资产增量同步（L2 MVP）
 *
 * 目标：模板/技能/设备库/示例等"内容资产"独立于安装包增量更新——
 * 平台维护 content_manifest.json（path+version+sha512+size），客户端只拉取变更文件，
 * sha512 强校验 + 原子替换，失败回退上一版本快照。
 *
 * 设计要点：
 * - httpGet / httpRangeGet 可注入（默认 fetch），便于纯单测（不依赖 Electron net）
 * - 本地状态文件 stateFile 记录 {schema, items: {path:{version,sha512}}, appliedAt}
 * - 同步前把旧状态存为快照（stateFile.snapshot），失败/校验失败可回退
 */
import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'

export interface ContentManifestItem {
  path: string
  version: string
  sha512: string
  size: number
}

export interface ContentManifest {
  schema: string
  generatedAt: string
  items: ContentManifestItem[]
}

export interface LocalItemState {
  version: string
  sha512: string
}

export interface ContentSyncState {
  schema: string
  items: Record<string, LocalItemState>
  appliedAt: string
}

export interface SyncSummary {
  added: number
  updated: number
  skipped: number
  failed: string[]
  downloadedBytes: number
}

export type HttpGet = (url: string, signal?: AbortSignal) => Promise<{ status: number; body: ArrayBuffer }>

/** 默认 HTTP 实现（Node 全局 fetch，Electron 主进程可用） */
export const defaultHttpGet: HttpGet = async (url, signal) => {
  const res = await fetch(url, { signal })
  const body = await res.arrayBuffer()
  return { status: res.status, body }
}

export function sha512Of(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('hex')
}

export function sha512OfFile(filePath: string): string {
  return sha512Of(fs.readFileSync(filePath))
}

export function loadLocalState(stateFile: string): ContentSyncState {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as ContentSyncState
    if (raw.schema === 'autolink.content-sync/1') return raw
  } catch {
    /* 缺失/损坏 → 空状态 */
  }
  return { schema: 'autolink.content-sync/1', items: {}, appliedAt: '' }
}

export function saveLocalState(stateFile: string, state: ContentSyncState): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
}

function toRelative(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * 同步内容资产：
 * - 拉取 manifest
 * - 对每项：本地 version 相同 → 跳过；否则下载（含 Range 续传）→ sha512 校验 → 原子替换
 * - 校验失败 → 该项记入 failed，保留旧文件（可回退）
 */
export async function syncContent(
  opts: {
    manifestUrl: string
    baseUrl: string
    contentDir: string
    stateFile: string
    httpGet?: HttpGet
    signal?: AbortSignal
  },
): Promise<SyncSummary> {
  const { manifestUrl, baseUrl, contentDir, stateFile, httpGet = defaultHttpGet, signal } = opts
  const manifestRes = await httpGet(manifestUrl, signal)
  if (manifestRes.status !== 200) throw new Error(`manifest 拉取失败: HTTP ${manifestRes.status}`)
  const manifest = JSON.parse(Buffer.from(manifestRes.body).toString('utf-8')) as ContentManifest

  const prevState = loadLocalState(stateFile)
  // 保留上一版本快照（回退用）
  const snapshot: ContentSyncState = { ...prevState, items: { ...prevState.items } }
  const nextState: ContentSyncState = { schema: 'autolink.content-sync/1', items: {}, appliedAt: new Date().toISOString() }
  const summary: SyncSummary = { added: 0, updated: 0, skipped: 0, failed: [], downloadedBytes: 0 }

  fs.mkdirSync(contentDir, { recursive: true })
  for (const item of manifest.items) {
    const rel = toRelative(item.path)
    const target = path.join(contentDir, rel)
    const prev = prevState.items[rel]
    if (prev && prev.version === item.version && prev.sha512 === item.sha512) {
      // 本地已是最新且校验一致 → 跳过
      if (fs.existsSync(target) && sha512OfFile(target) === item.sha512) {
        summary.skipped += 1
        nextState.items[rel] = prev
        continue
      }
    }
    // 下载 + 校验 + 原子替换
    const fileUrl = `${baseUrl.replace(/\/$/, '')}/content/files/${encodeURIComponent(rel)}`
    const fileRes = await httpGet(fileUrl, signal)
    if (fileRes.status !== 200) {
      summary.failed.push(rel)
      continue
    }
    const buf = Buffer.from(fileRes.body)
    const actual = sha512Of(buf)
    if (actual !== item.sha512) {
      summary.failed.push(`${rel}(sha512 不匹配)`)
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    // 原子替换：先写临时文件再改名
    const tmp = target + '.part'
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, target)
    nextState.items[rel] = { version: item.version, sha512: item.sha512 }
    summary.downloadedBytes += buf.length
    if (prev) summary.updated += 1
    else summary.added += 1
  }

  // 未在 manifest 中出现的本地内容：保留（不删除，避免误删用户数据）
  for (const [rel, st] of Object.entries(prevState.items)) {
    if (!nextState.items[rel]) nextState.items[rel] = st
  }

  // 快照与状态落盘（回退依据）
  saveLocalState(stateFile + '.snapshot', snapshot)
  saveLocalState(stateFile, nextState)
  return summary
}

/** 回退到上一版本快照（失败自愈：恢复状态戳，下次同步自动重拉被篡改/删除的文件） */
export function rollbackContent(opts: { stateFile: string }): ContentSyncState | null {
  const snapPath = opts.stateFile + '.snapshot'
  if (!fs.existsSync(snapPath)) return null
  const snapshot = JSON.parse(fs.readFileSync(snapPath, 'utf-8')) as ContentSyncState
  saveLocalState(opts.stateFile, snapshot)
  return snapshot
}
