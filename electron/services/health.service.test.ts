/**
 * 47-c（F7-3）：健康检查/自检服务单元测试
 * - 环境（OS/arch/node/electron/磁盘）
 * - 引擎（AI Hub /api/chat/health + python engine cli:info）
 * - 网络（cloud /api/v1/health 连通性；未配置时 skip）
 * - 依赖（Python 版本）
 * - 汇总（summary ok/warn/fail/skip）
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getVersion: () => '4.7.0' },
}))

import { HealthService, type HealthDeps } from './health.service.js'

function makeDeps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    aiHubHealth: vi.fn(async () => true),
    pythonInfo: vi.fn(async () => ({ cliVersion: '2.9.0', actions: ['design', 'export'] })),
    cloudHealth: vi.fn(async () => ({ status: 'ok' })),
    cloudBaseUrl: vi.fn(() => 'https://example.com'),
    pythonVersion: vi.fn(() => '3.12.5'),
    diskFreeMB: vi.fn(() => 10240),
    ...overrides,
  }
}

describe('HealthService（47-c 健康检查）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('全绿：summary 无 fail，各项 status ok', async () => {
    const service = new HealthService(makeDeps())
    const report = await service.runHealthCheck()
    expect(report.summary.fail).toBe(0)
    expect(report.summary.ok).toBeGreaterThan(0)
    expect(report.items.every((i) => i.status === 'ok')).toBe(true)
    expect(report.env.appVersion).toBe('4.7.0')
    expect(report.env.node).toBe(process.versions.node)
  })

  it('AI Hub 不可用：engine.aihub 状态 fail，summary.fail >= 1', async () => {
    const service = new HealthService(makeDeps({ aiHubHealth: vi.fn(async () => false) }))
    const report = await service.runHealthCheck()
    const item = report.items.find((i) => i.id === 'engine.aihub')
    expect(item?.status).toBe('fail')
    expect(report.summary.fail).toBeGreaterThanOrEqual(1)
  })

  it('Python 引擎 cli:info 失败：engine.python 状态 fail', async () => {
    const service = new HealthService(
      makeDeps({
        pythonInfo: vi.fn(async () => {
          throw new Error('python 进程不可用')
        }),
      }),
    )
    const report = await service.runHealthCheck()
    const item = report.items.find((i) => i.id === 'engine.python')
    expect(item?.status).toBe('fail')
    expect(item?.detail).toContain('python')
  })

  it('云平台未配置：network.cloud 状态 skip（不判定失败）', async () => {
    const service = new HealthService(makeDeps({ cloudBaseUrl: vi.fn(() => '') }))
    const report = await service.runHealthCheck()
    const item = report.items.find((i) => i.id === 'network.cloud')
    expect(item?.status).toBe('skip')
    expect(report.summary.fail).toBe(0)
  })

  it('云平台连通失败：network.cloud 状态 fail', async () => {
    const service = new HealthService(
      makeDeps({
        cloudHealth: vi.fn(async () => {
          throw new Error('ECONNREFUSED')
        }),
      }),
    )
    const report = await service.runHealthCheck()
    const item = report.items.find((i) => i.id === 'network.cloud')
    expect(item?.status).toBe('fail')
    expect(item?.detail).toContain('ECONNREFUSED')
  })

  it('Python 缺失：deps.python 状态 warn（引擎可用但版本未知）', async () => {
    const service = new HealthService(makeDeps({ pythonVersion: vi.fn(() => '') }))
    const report = await service.runHealthCheck()
    const item = report.items.find((i) => i.id === 'deps.python')
    expect(item?.status).toBe('warn')
  })

  it('磁盘可用信息可选（statfs 不可用时省略不判失败）', async () => {
    const service = new HealthService(makeDeps({ diskFreeMB: vi.fn(() => undefined) }))
    const report = await service.runHealthCheck()
    const item = report.items.find((i) => i.id === 'env.disk')
    expect(item?.status).toBe('ok')
    expect(report.summary.fail).toBe(0)
  })

  it('exportJson 序列化完整报告', async () => {
    const service = new HealthService(makeDeps())
    const report = await service.runHealthCheck()
    const payload = JSON.parse(service.exportJson(report))
    expect(payload.checkedAt).toBeTruthy()
    expect(payload.summary.total).toBe(report.items.length)
  })
})
