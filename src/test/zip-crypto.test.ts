// @vitest-environment node
// V3.3.2-T15-2: ZIP 传统加密（PKWARE ZipCrypto）验证
// 构造明文 ZIP → encryptZipFile 加密 → adm-zip 带密码解密 → 内容一致性 + 错误密码拒绝
// 注意：必须使用 node 环境（jsdom 下 Buffer 跨 realm 导致 adm-zip 的 instanceof Uint8Array 检查失败）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import AdmZip from 'adm-zip'
import { encryptZipFile } from '../../electron/utils/zip-crypto'

const PASSWORD = 'p@ssw0rd-123'
const README = 'readme.txt'
const README_CONTENT = 'Hello AutoLink 3.3.2'
const CONFIG = 'config/project_config.json'

let tmpDir = ''
let encZip = ''

describe('ZipCrypto 加密导出', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipcrypto-test-'))
    const plainZip = path.join(tmpDir, 'plain.zip')
    encZip = path.join(tmpDir, 'enc.zip')

    // 构造明文 ZIP（含子目录 + 中文内容）
    const zip = new AdmZip()
    zip.addFile(README, Buffer.from(README_CONTENT, 'utf8'))
    zip.addFile(CONFIG, Buffer.from(JSON.stringify({ name: '测试项目', level: 3 }), 'utf8'))
    zip.addFile('bin/tool.bin', Buffer.from(new Uint8Array(2048).fill(0xab)))
    zip.writeZip(plainZip)

    // 加密
    fs.copyFileSync(plainZip, encZip)
    encryptZipFile(encZip, PASSWORD)
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('所有文件条目均标记为加密', () => {
    const fileEntries = new AdmZip(encZip).getEntries().filter((e) => !e.isDirectory)
    expect(fileEntries.length).toBeGreaterThan(0)
    for (const e of fileEntries) {
      expect(e.header.encrypted).toBe(true)
    }
  })

  it('正确密码可解密且内容一致', () => {
    const zip = new AdmZip(encZip)
    const readme = zip.getEntries().find((e) => e.entryName === README)!
    const content = zip.readFile(readme, PASSWORD)!.toString('utf8')
    expect(content).toBe(README_CONTENT)

    const cfg = zip.getEntries().find((e) => e.entryName === CONFIG)!
    const cfgJson = JSON.parse(zip.readFile(cfg, PASSWORD)!.toString('utf8'))
    expect(cfgJson.name).toBe('测试项目')
    expect(cfgJson.level).toBe(3)
  })

  it('二进制文件可完整还原', () => {
    const zip = new AdmZip(encZip)
    const bin = zip.getEntries().find((e) => e.entryName === 'bin/tool.bin')!
    const data = zip.readFile(bin, PASSWORD)!
    expect(data.length).toBe(2048)
    expect(data.every((b: number) => b === 0xab)).toBe(true)
  })

  it('错误密码解密被拒绝', () => {
    const zip = new AdmZip(encZip)
    const readme = zip.getEntries().find((e) => e.entryName === README)!
    expect(() => zip.readFile(readme, 'wrong-pass')).toThrow()
  })

  it('ZIP 结构完整（EOCD/中央目录字段有效）', () => {
    const buf = fs.readFileSync(encZip)
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50) // EOCD 签名
    const cdSize = buf.readUInt32LE(buf.length - 10)
    const cdOffset = buf.readUInt32LE(buf.length - 6)
    expect(cdOffset).toBeGreaterThan(0)
    expect(cdSize).toBeGreaterThan(0)
    expect(cdOffset + cdSize).toBeLessThanOrEqual(buf.length - 22)
  })

  it('空密码抛出异常', () => {
    const z = path.join(tmpDir, 'empty.zip')
    fs.copyFileSync(encZip, z)
    expect(() => encryptZipFile(z, '')).toThrow()
  })
})
