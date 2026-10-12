/**
 * 5.4.16-F5416-15：内容资产增量同步契约测试
 * - 增量：本地已有且版本一致 → 跳过；仅拉取变更文件
 * - sha512 强校验：不匹配 → 记 failed、不覆盖旧文件
 * - 原子替换：.part 临时文件后改名
 * - 回退：恢复上一版本快照状态
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  syncContent,
  rollbackContent,
  loadLocalState,
  sha512Of,
  type ContentManifest,
  type HttpGet,
} from './content-sync.service'

function makeManifest(items: Array<{ path: string; version: string; content: string }>): ContentManifest {
  return {
    schema: 'mc.content.manifest/1',
    generatedAt: new Date().toISOString(),
    items: items.map((i) => ({
      path: i.path,
      version: i.version,
      sha512: sha512Of(Buffer.from(i.content, 'utf-8')),
      size: Buffer.byteLength(i.content, 'utf-8'),
    })),
  }
}

function makeHttpGet(manifest: ContentManifest, files: Record<string, string>): HttpGet {
  return async (url) => {
    const u = new URL(url)
    if (u.pathname.endsWith('/content/manifest')) {
      return { status: 200, body: Buffer.from(JSON.stringify(manifest)) }
    }
    const m = u.pathname.match(/\/content\/files\/(.+)$/)
    if (m) {
      const rel = decodeURIComponent(m[1])
      const content = files[rel]
      if (content === undefined) return { status: 404, body: new ArrayBuffer(0) }
      return { status: 200, body: Buffer.from(content, 'utf-8') }
    }
    return { status: 404, body: new ArrayBuffer(0) }
  }
}

describe('content-sync', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-csync-'))
  })

  it('首次同步拉取全部文件并落状态', async () => {
    const manifest = makeManifest([
      { path: 'templates/leaf.j2', version: '1', content: 'A' },
      { path: 'skills/a.md', version: '1', content: 'B' },
    ])
    const stateFile = path.join(tmp, 'state.json')
    const contentDir = path.join(tmp, 'content')
    const summary = await syncContent({
      manifestUrl: 'https://x/content/manifest',
      baseUrl: 'https://x',
      contentDir,
      stateFile,
      httpGet: makeHttpGet(manifest, {
        'templates/leaf.j2': 'A',
        'skills/a.md': 'B',
      }),
    })
    expect(summary.added).toBe(2)
    expect(summary.skipped).toBe(0)
    expect(fs.readFileSync(path.join(contentDir, 'templates', 'leaf.j2'), 'utf-8')).toBe('A')
    const state = loadLocalState(stateFile)
    expect(state.items['templates/leaf.j2'].version).toBe('1')
  })

  it('增量：版本一致跳过，仅拉取变更文件', async () => {
    const manifest = makeManifest([
      { path: 'templates/leaf.j2', version: '2', content: 'A2' },
      { path: 'skills/a.md', version: '1', content: 'B' },
    ])
    const stateFile = path.join(tmp, 'state.json')
    const contentDir = path.join(tmp, 'content')
    // 第一次同步（全量）
    await syncContent({
      manifestUrl: 'https://x/content/manifest',
      baseUrl: 'https://x',
      contentDir,
      stateFile,
      httpGet: makeHttpGet(manifest, { 'templates/leaf.j2': 'A2', 'skills/a.md': 'B' }),
    })
    // 第二次：leaf 升到 v3
    const manifest2 = makeManifest([
      { path: 'templates/leaf.j2', version: '3', content: 'A3' },
      { path: 'skills/a.md', version: '1', content: 'B' },
    ])
    const summary = await syncContent({
      manifestUrl: 'https://x/content/manifest',
      baseUrl: 'https://x',
      contentDir,
      stateFile,
      httpGet: makeHttpGet(manifest2, { 'templates/leaf.j2': 'A3', 'skills/a.md': 'B' }),
    })
    expect(summary.skipped).toBe(1) // skills/a.md 未变
    expect(summary.updated).toBe(1) // leaf 已更新
    expect(fs.readFileSync(path.join(contentDir, 'templates', 'leaf.j2'), 'utf-8')).toBe('A3')
  })

  it('sha512 不匹配：记 failed 且不覆盖旧文件', async () => {
    const manifest = makeManifest([{ path: 'templates/leaf.j2', version: '1', content: 'GOOD' }])
    const stateFile = path.join(tmp, 'state.json')
    const contentDir = path.join(tmp, 'content')
    // 本地已存在旧文件
    fs.mkdirSync(path.join(contentDir, 'templates'), { recursive: true })
    fs.writeFileSync(path.join(contentDir, 'templates', 'leaf.j2'), 'OLD')
    // 服务器返回被篡改内容（与 manifest sha512 不符）
    const summary = await syncContent({
      manifestUrl: 'https://x/content/manifest',
      baseUrl: 'https://x',
      contentDir,
      stateFile,
      httpGet: makeHttpGet(manifest, { 'templates/leaf.j2': 'TAMPERED' }),
    })
    expect(summary.failed.length).toBe(1)
    expect(summary.failed[0]).toContain('sha512')
    // 旧文件未被覆盖
    expect(fs.readFileSync(path.join(contentDir, 'templates', 'leaf.j2'), 'utf-8')).toBe('OLD')
  })

  it('回退：恢复到上一版本状态戳（撤销最近一次更新）', async () => {
    const stateFile = path.join(tmp, 'state.json')
    const contentDir = path.join(tmp, 'content')
    // 第一次同步 v1
    const m1 = makeManifest([{ path: 'skills/a.md', version: '1', content: 'B' }])
    await syncContent({
      manifestUrl: 'https://x/content/manifest',
      baseUrl: 'https://x',
      contentDir,
      stateFile,
      httpGet: makeHttpGet(m1, { 'skills/a.md': 'B' }),
    })
    // 第二次同步 v2
    const m2 = makeManifest([{ path: 'skills/a.md', version: '2', content: 'B2' }])
    await syncContent({
      manifestUrl: 'https://x/content/manifest',
      baseUrl: 'https://x',
      contentDir,
      stateFile,
      httpGet: makeHttpGet(m2, { 'skills/a.md': 'B2' }),
    })
    expect(loadLocalState(stateFile).items['skills/a.md'].version).toBe('2')
    // 回退 → 恢复 v1 状态戳（下次同步自动重拉 v2）
    const snap = rollbackContent({ stateFile })
    expect(snap).not.toBeNull()
    expect(loadLocalState(stateFile).items['skills/a.md'].version).toBe('1')
  })

  it('manifest 拉取失败抛错', async () => {
    const httpGet: HttpGet = async () => ({ status: 500, body: new ArrayBuffer(0) })
    await expect(
      syncContent({
        manifestUrl: 'https://x/content/manifest',
        baseUrl: 'https://x',
        contentDir: path.join(tmp, 'c'),
        stateFile: path.join(tmp, 's.json'),
        httpGet,
      }),
    ).rejects.toThrow('HTTP 500')
  })
})
