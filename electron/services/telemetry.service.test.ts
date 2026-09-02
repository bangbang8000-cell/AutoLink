/**
 * 47-d（F7-4）：本地遥测服务单元测试
 * - 默认关闭 / setEnabled 持久化
 * - 启用后才写 telemetry.jsonl（仅本地不联网）
 * - 落盘前脱敏（apiKey/token 等）
 * - read/clear/export 能力
 * - 体积上限裁剪
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
}))

import { TelemetryService } from './telemetry.service.js'

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'autolink-telemetry-test-'))
}

describe('TelemetryService（47-d 本地遥测）', () => {
  let tmp: string
  let service: TelemetryService

  beforeEach(() => {
    tmp = makeTmpDir()
    service = new TelemetryService()
    service.setBaseDir(tmp)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('默认关闭：未启用时不写 telemetry.jsonl', () => {
    expect(service.isEnabled()).toBe(false)
    service.record({ ts: new Date().toISOString(), type: 'app:start' })
    expect(fs.existsSync(service.filePath)).toBe(false)
  })

  it('setEnabled(true) 后持久化，重建实例仍为开启', () => {
    service.setEnabled(true)
    expect(service.isEnabled()).toBe(true)
    const fresh = new TelemetryService()
    fresh.setBaseDir(tmp)
    expect(fresh.isEnabled()).toBe(true)
  })

  it('启用后 record 写 JSONL 行（本地仅落盘不联网）', () => {
    service.setEnabled(true)
    service.record({ ts: '2026-01-01T00:00:00.000Z', type: 'app:start', version: '4.7.0' })
    const content = fs.readFileSync(service.filePath, 'utf-8')
    const line = JSON.parse(content.trim())
    expect(line.type).toBe('app:start')
    expect(line.version).toBe('4.7.0')
  })

  it('record 落盘前脱敏（apiKey/token 值替换为 ***）', () => {
    service.setEnabled(true)
    service.record({
      ts: '2026-01-01T00:00:00.000Z',
      type: 'error',
      message: 'config failed api_key=sk-abc123def456 token=xyz789',
    })
    const content = fs.readFileSync(service.filePath, 'utf-8')
    expect(content).not.toContain('sk-abc123def456')
    expect(content).not.toContain('xyz789')
    expect(content).toContain('***')
  })

  it('read 返回条目与路径，limit 截断', () => {
    service.setEnabled(true)
    service.record({
      ts: '2026-01-01T00:00:00.000Z',
      type: 'action',
      name: 'design',
      durationMs: 12,
    })
    service.record({
      ts: '2026-01-01T00:00:01.000Z',
      type: 'action',
      name: 'export',
      durationMs: 34,
    })
    const all = service.read()
    expect(all.entries.length).toBe(2)
    expect(all.path).toBe(service.filePath)
    const one = service.read(1)
    expect(one.entries.length).toBe(1)
    expect(one.entries[0].name).toBe('export')
  })

  it('clear 清空文件', () => {
    service.setEnabled(true)
    service.record({ ts: '2026-01-01T00:00:00.000Z', type: 'app:start' })
    expect(fs.existsSync(service.filePath)).toBe(true)
    service.clear()
    expect(fs.readFileSync(service.filePath, 'utf-8').trim()).toBe('')
  })

  it('exportJson 返回完整 JSON 内容（含 summary）', () => {
    service.setEnabled(true)
    service.record({ ts: '2026-01-01T00:00:00.000Z', type: 'app:start', version: '4.7.0' })
    const payload = JSON.parse(service.exportJson())
    expect(payload.entries.length).toBe(1)
    expect(payload.exportedAt).toBeTruthy()
  })

  it('文件超过体积上限时裁剪为最近行', () => {
    service.setEnabled(true)
    // 直接写入超过上限（5MB）的原始文件，触发后续 record 裁剪
    const padding = 'x'.repeat(1024)
    const lines: string[] = []
    for (let i = 0; i < 6000; i++) {
      lines.push(
        JSON.stringify({
          ts: new Date().toISOString(),
          type: 'action',
          name: 'design',
          durationMs: i,
          padding,
        }),
      )
    }
    fs.writeFileSync(service.filePath, lines.join('\n') + '\n', 'utf-8')
    expect(fs.statSync(service.filePath).size).toBeGreaterThan(5 * 1024 * 1024)
    service.record({ ts: '2026-01-01T00:00:00.000Z', type: 'app:start' })
    const stat = fs.statSync(service.filePath).size
    expect(stat).toBeLessThan(5 * 1024 * 1024)
    const entries = service.read()
    expect(entries.entries.length).toBeLessThanOrEqual(2001)
    expect(entries.entries.at(-1)?.type).toBe('app:start')
  })

  it('recordAction 记录动作耗时（ok/error）', () => {
    service.setEnabled(true)
    service.recordAction('design:generate', 123, true)
    service.recordAction('render:exportConnections', 456, false)
    const entries = service.read().entries
    expect(entries.length).toBe(2)
    expect(entries[0].type).toBe('action')
    expect(entries[0].name).toBe('design:generate')
    expect(entries[0].durationMs).toBe(123)
    expect(entries[1].ok).toBe(false)
  })

  it('onAppStart 记录启动事件（版本/平台/架构）', () => {
    service.setEnabled(true)
    service.onAppStart('4.7.0', 'win32', 'x64')
    const entries = service.read().entries
    expect(entries[0].type).toBe('app:start')
    expect(entries[0].version).toBe('4.7.0')
    expect(entries[0].platform).toBe('win32')
    expect(entries[0].arch).toBe('x64')
  })
})
