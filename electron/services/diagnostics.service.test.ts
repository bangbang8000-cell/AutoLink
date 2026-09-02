/**
 * 47-b（F7-2）：诊断中心服务单元测试
 * - 系统信息聚合（platform/arch/node/electron/磁盘）
 * - 主进程错误日志（errors.log）读取（最近 N 行）
 * - 审计（cli-audit.jsonl）读取
 * - 崩溃信息（Crashpad dump 文件 + render-process-gone 记录）
 * - 遥测文件读取
 * - 支持包文件组装（diagnostics.json + 源文件）
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getVersion: () => '4.7.0' },
}))

import { DiagnosticsService } from './diagnostics.service.js'

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'autolink-diag-test-'))
}

describe('DiagnosticsService（47-b 诊断中心）', () => {
  let tmp: string
  let service: DiagnosticsService

  beforeEach(() => {
    tmp = makeTmpDir()
    service = new DiagnosticsService()
    service.setUserDataDir(tmp)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('collectSystemInfo 返回 platform/arch/electron/node/磁盘字段', () => {
    const info = service.collectSystemInfo()
    expect(info.platform).toBe(process.platform)
    expect(info.arch).toBe(process.arch)
    expect(info.node).toBe(process.versions.node)
    expect(info.electron).toBe(process.versions.electron)
    expect(info.appVersion).toBe('4.7.0')
    expect(typeof info.totalMemMB).toBe('number')
    expect(typeof info.freeMemMB).toBe('number')
    expect(typeof info.userData).toBe('string')
  })

  it('collectDiagnostics 无任何文件时返回空结构（不抛错）', () => {
    const report = service.collectDiagnostics()
    expect(report.errorsLog.exists).toBe(false)
    expect(report.audit.entries).toEqual([])
    expect(report.crashes.dumpFiles).toEqual([])
    expect(report.telemetry.entries).toEqual([])
  })

  it('collectDiagnostics 读取 errors.log 最近 N 行', () => {
    const logsDir = path.join(tmp, 'logs')
    fs.mkdirSync(logsDir, { recursive: true })
    for (let i = 1; i <= 5; i++) {
      fs.appendFileSync(
        path.join(logsDir, 'errors.log'),
        `[2026-01-0${i}T00:00:00.000Z] [tag] error line ${i}\n`,
        'utf-8',
      )
    }
    const report = service.collectDiagnostics(3)
    expect(report.errorsLog.exists).toBe(true)
    expect(report.errorsLog.entries.length).toBe(3)
    expect(report.errorsLog.entries.at(-1)).toContain('error line 5')
  })

  it('collectDiagnostics 读取审计 cli-audit.jsonl（解析 JSONL）', () => {
    const auditDir = path.join(tmp, 'audit')
    fs.mkdirSync(auditDir, { recursive: true })
    fs.writeFileSync(
      path.join(auditDir, 'cli-audit.jsonl'),
      '{"ts":"2026-01-01T00:00:00","action":"design","ok":true}\n{"ts":"2026-01-01T00:00:01","action":"export","ok":false,"error":"boom"}\n',
      'utf-8',
    )
    const report = service.collectDiagnostics()
    expect(report.audit.entries.length).toBe(2)
    expect(report.audit.entries[1].action).toBe('export')
    expect(report.audit.entries[1].error).toBe('boom')
  })

  it('collectDiagnostics 识别 Crashpad 目录中的 dump 文件', () => {
    const crashpadDir = path.join(tmp, 'Crashpad', 'pending')
    fs.mkdirSync(crashpadDir, { recursive: true })
    fs.writeFileSync(path.join(crashpadDir, 'abc.dmp'), 'dump', 'utf-8')
    fs.writeFileSync(path.join(crashpadDir, 'def.dmp'), 'dump', 'utf-8')
    const report = service.collectDiagnostics()
    expect(report.crashes.dumpFiles.length).toBe(2)
    expect(report.crashes.dumpFiles.every((f) => f.endsWith('.dmp'))).toBe(true)
  })

  it('buildBundleFiles 组装支持包（diagnostics.json + 源文件）', () => {
    const logsDir = path.join(tmp, 'logs')
    fs.mkdirSync(logsDir, { recursive: true })
    fs.writeFileSync(path.join(logsDir, 'errors.log'), '[err] line\n', 'utf-8')
    const report = service.collectDiagnostics()
    const files = service.buildBundleFiles(report, { ops: [{ id: '1', durationMs: 12 }] })
    const names = files.map((f) => f.name)
    expect(names).toContain('diagnostics.json')
    expect(names).toContain('logs/errors.log')
    const diag = JSON.parse(files.find((f) => f.name === 'diagnostics.json')!.content)
    expect(diag.appVersion).toBe('4.7.0')
    expect(diag.perfSnapshot.ops[0].durationMs).toBe(12)
    expect(diag.system.platform).toBe(process.platform)
  })

  it('buildBundleFiles 在不存在的源文件时跳过（不抛错）', () => {
    const report = service.collectDiagnostics()
    const files = service.buildBundleFiles(report)
    expect(files.some((f) => f.name === 'logs/errors.log')).toBe(false)
    expect(files.some((f) => f.name === 'diagnostics.json')).toBe(true)
  })
})
