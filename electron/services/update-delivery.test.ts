/**
 * 5.0.9（509-a 升级体验增强 / 509-b 企业部署基座）
 * 更新交付纯函数单测（与 MC 对等同构）：
 *  - 断点续传：.part 文件名 / 已下载偏移 / Content-Range 解析
 *  - sha512 强校验：latest.yml / 平台响应 sha512 解析、hex/base64 归一化、实算比对
 *  - 回滚基线：RollbackManager 保存 / 列出 / 清除
 *  - 版本锁定：本地版本是否低于平台最低要求
 *  - 灰度通道：按 updateChannel 选择 latest*.yml
 *  - 配置读取：update.config.json 合并默认值
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import {
  partFileFor,
  resumeOffset,
  parseContentRange,
  parseSha512FromYml,
  sha512ToHex,
  sha512Matches,
  computeSha512,
  RollbackManager,
  isBelowMinRequired,
  resolveYmlNameForChannel,
  readUpdateSettings,
  defaultUpdateSettings,
} from './update-delivery.js'

describe('断点续传：.part 文件名 / 偏移 / Content-Range', () => {
  it('partFileFor 追加 .part 后缀', () => {
    expect(partFileFor('/x/pkg.exe')).toBe('/x/pkg.exe.part')
    expect(partFileFor('C:\\a\\pkg.dmg')).toBe('C:\\a\\pkg.dmg.part')
  })

  it('resumeOffset 按 .part 文件大小续传；无残留文件返回 0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-resume-'))
    try {
      expect(resumeOffset(path.join(dir, 'nope.part'))).toBe(0)
      const part = path.join(dir, 'x.part')
      fs.writeFileSync(part, Buffer.alloc(500))
      expect(resumeOffset(part)).toBe(500)
      fs.writeFileSync(part, Buffer.alloc(0))
      expect(resumeOffset(part)).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parseContentRange 解析 206 响应', () => {
    expect(parseContentRange('bytes 500-999/1000')).toEqual({ start: 500, end: 999, total: 1000 })
    expect(parseContentRange('bytes 0-0/*')).toEqual({ start: 0, end: 0, total: -1 })
    expect(parseContentRange('invalid')).toBeNull()
    expect(parseContentRange(null)).toBeNull()
  })
})

describe('sha512 强校验', () => {
  it('parseSha512FromYml 从 latest.yml 正文提取 sha512', () => {
    expect(parseSha512FromYml('version: 1.0.0\nsha512: abc123\n')).toBe('abc123')
    expect(parseSha512FromYml('path: pkg.exe')).toBeUndefined()
  })

  it('sha512ToHex 支持 128 位 hex 与 base64 归一化', () => {
    const hex = crypto.randomBytes(64).toString('hex')
    expect(sha512ToHex(hex)).toBe(hex)
    expect(sha512ToHex(hex.toUpperCase())).toBe(hex)
    const b64 = Buffer.from(hex, 'hex').toString('base64')
    expect(sha512ToHex(b64)).toBe(hex)
    expect(sha512ToHex('')).toBeNull()
    expect(sha512ToHex('not-a-hash')).toBeNull()
  })

  it('sha512Matches 比对期望与实算 hex', () => {
    const hex = crypto.randomBytes(64).toString('hex')
    expect(sha512Matches(hex, hex)).toBe(true)
    expect(sha512Matches(hex, hex.toUpperCase())).toBe(true)
    expect(sha512Matches(hex, crypto.randomBytes(64).toString('hex'))).toBe(false)
    expect(sha512Matches('', hex)).toBe(false)
  })

  it('computeSha512 对文件流式计算 sha512', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-sha-'))
    try {
      const f = path.join(dir, 'data.bin')
      const bytes = crypto.randomBytes(2048)
      fs.writeFileSync(f, bytes)
      expect(await computeSha512(f)).toBe(crypto.createHash('sha512').update(bytes).digest('hex'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('回滚基线：RollbackManager', () => {
  let dir: string
  let srcDir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-rollback-'))
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-rollback-src-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(srcDir, { recursive: true, force: true })
  })

  it('save 复制既有安装包为回滚产物；缺失返回 null', () => {
    const mgr = new RollbackManager(dir)
    expect(mgr.save(path.join(srcDir, 'missing.exe'), '5.0.1')).toBeNull()

    const src = path.join(srcDir, 'AutoLink-Setup-5.0.1.exe')
    fs.writeFileSync(src, 'bytes')
    const entry = mgr.save(src, '5.0.1')
    expect(entry).not.toBeNull()
    expect(entry!.fileName).toMatch(/^rollback-5\.0\.1-\d+\.exe$/)
    expect(fs.existsSync(entry!.filePath)).toBe(true)
  })

  it('list 倒序列出，缺失目录返回空数组', () => {
    const mgr = new RollbackManager(path.join(dir, 'missing'))
    expect(mgr.list()).toEqual([])

    const mgr2 = new RollbackManager(dir)
    const f1 = path.join(dir, 'rollback-5.0.1-1.exe')
    const f2 = path.join(dir, 'rollback-5.0.2-2.exe')
    fs.writeFileSync(f1, 'a')
    fs.writeFileSync(f2, 'b')
    // 显式设置 mtime，避免同一个刻度导致排序不稳定
    const t1 = new Date('2026-01-01T00:00:00Z')
    const t2 = new Date('2026-01-02T00:00:00Z')
    fs.utimesSync(f1, t1, t1)
    fs.utimesSync(f2, t2, t2)
    const entries = mgr2.list()
    expect(entries.length).toBe(2)
    expect(entries[0].version).toBe('5.0.2')
    expect(entries[1].version).toBe('5.0.1')
  })

  it('clear 清除全部回滚安装包', () => {
    const mgr = new RollbackManager(dir)
    const src = path.join(srcDir, 'src.exe')
    fs.writeFileSync(src, 'bytes')
    mgr.save(src, '5.0.1')
    expect(mgr.list().length).toBe(1)
    mgr.clear()
    expect(mgr.list()).toEqual([])
  })
})

describe('版本锁定：isBelowMinRequired', () => {
  it('本地低于平台最低要求返回 true，否则 false', () => {
    expect(isBelowMinRequired('5.0.5', '5.1.0')).toBe(true)
    expect(isBelowMinRequired('5.1.0', '5.1.0')).toBe(false)
    expect(isBelowMinRequired('5.2.0', '5.1.0')).toBe(false)
    expect(isBelowMinRequired('5.0.5', null)).toBe(false)
    expect(isBelowMinRequired('5.0.5', undefined)).toBe(false)
    expect(isBelowMinRequired('', '5.1.0')).toBe(false)
  })
})

describe('灰度通道：resolveYmlNameForChannel', () => {
  it('stable（默认）返回原 yml 文件名；其他通道追加后缀', () => {
    expect(resolveYmlNameForChannel('stable', 'latest.yml')).toBe('latest.yml')
    expect(resolveYmlNameForChannel('', 'latest.yml')).toBe('latest.yml')
    expect(resolveYmlNameForChannel('beta', 'latest.yml')).toBe('latest-beta.yml')
    expect(resolveYmlNameForChannel('BETA', 'latest-mac.yml')).toBe('latest-mac-beta.yml')
    expect(resolveYmlNameForChannel('beta', 'latest-linux.yml')).toBe('latest-linux-beta.yml')
  })
})

describe('配置读取：readUpdateSettings', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-cfg-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('无文件时返回默认值', () => {
    expect(readUpdateSettings()).toEqual(defaultUpdateSettings())
    expect(readUpdateSettings(path.join(dir, 'nope.json'))).toEqual(defaultUpdateSettings())
  })

  it('按默认值合并、容忍损坏字段', () => {
    const file = path.join(dir, 'update.config.json')
    fs.writeFileSync(
      file,
      JSON.stringify({ updateChannel: 'beta', enableEnterpriseDeploy: true, updateUrl: ' http://mirror/latest.yml ', platformBaseUrl: 'https://api.example.com/' }),
      'utf-8',
    )
    const s = readUpdateSettings(file)
    expect(s.updateChannel).toBe('beta')
    expect(s.enableEnterpriseDeploy).toBe(true)
    expect(s.updateUrl).toBe('http://mirror/latest.yml')
    expect(s.platformBaseUrl).toBe('https://api.example.com')
    expect(s.proxy).toBe('')

    fs.writeFileSync(file, '{not-json', 'utf-8')
    expect(readUpdateSettings(file)).toEqual(defaultUpdateSettings())
  })
})