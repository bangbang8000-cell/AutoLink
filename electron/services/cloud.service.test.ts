/**
 * 5.0.4-504-b/c: CloudService 云端 API（模板订阅/评分 + 设备库云同步）
 * - templateSubscribe / templateUnsubscribe / templateRate：路径与载荷契约
 * - deviceLibraryGet / deviceLibraryPush：GET/POST /device-library 契约
 * 通过 mock electron net.fetch 验证请求方法/URL/body 与服务端 success() 解包。
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { net } from 'electron'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => s, decryptString: (s: string) => s },
  net: { fetch: vi.fn() },
}))

import { cloudService } from './cloud.service.js'

const fetchMock = net.fetch as unknown as ReturnType<typeof vi.fn>

function mockResponse(data: unknown, opts: { status?: number } = {}) {
  const status = opts.status ?? 200
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(data),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as Response
}

describe('5.0.4 CloudService 模板订阅/评分 + 设备库云同步', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    cloudService.setBaseUrl('https://example.com')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('templateSubscribe：POST /templates/{owner}/{repo}/subscribe', async () => {
    fetchMock.mockResolvedValue(mockResponse({ code: 0, data: { subscribed: true } }))
    const r = await cloudService.templateSubscribe('alice', 'Tpl-504')
    expect(r).toEqual({ subscribed: true })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/api/v1/templates/alice/Tpl-504/subscribe')
    expect(opts.method).toBe('POST')
  })

  it('templateUnsubscribe：DELETE /templates/{owner}/{repo}/subscribe', async () => {
    fetchMock.mockResolvedValue(mockResponse({ code: 0, data: { subscribed: false } }))
    const r = await cloudService.templateUnsubscribe('alice', 'Tpl-504')
    expect(r).toEqual({ subscribed: false })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/api/v1/templates/alice/Tpl-504/subscribe')
    expect(opts.method).toBe('DELETE')
  })

  it('templateRate：POST /templates/{owner}/{repo}/rating，body 含 1-5 评分', async () => {
    fetchMock.mockResolvedValue(mockResponse({ code: 0, data: { rating_avg: 4.5, rating_count: 8 } }))
    const r = await cloudService.templateRate('alice', 'Tpl-504', 4)
    expect(r).toEqual({ rating_avg: 4.5, rating_count: 8 })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/api/v1/templates/alice/Tpl-504/rating')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ rating: 4 })
  })

  it('deviceLibraryGet：GET /device-library 返回原始载荷（解包）', async () => {
    fetchMock.mockResolvedValue(mockResponse({ code: 0, data: { format: 'autolink-device-library', schemaVersion: 1, exportedAt: 'x', devices: [] } }))
    const r = await cloudService.deviceLibraryGet()
    expect(r).toMatchObject({ format: 'autolink-device-library', schemaVersion: 1 })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/api/v1/device-library')
    expect(opts.method).toBe('GET')
  })

  it('deviceLibraryPush：POST /device-library，body 为 bundle payload', async () => {
    fetchMock.mockResolvedValue(mockResponse({ code: 0, data: { status: 'ok', count: 2 } }))
    const payload = { format: 'autolink-device-library', schemaVersion: 1, exportedAt: '2026-09-04T00:00:00Z', devices: [{ id: 'd1' }, { id: 'd2' }] }
    const r = await cloudService.deviceLibraryPush(payload)
    expect(r).toEqual({ status: 'ok', count: 2 })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/api/v1/device-library')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual(payload)
  })

  it('非 0 code：抛出服务端 message', async () => {
    fetchMock.mockResolvedValue(mockResponse({ code: 1, data: null, message: '订阅失败' }))
    await expect(cloudService.templateSubscribe('alice', 'Tpl-504')).rejects.toThrow('订阅失败')
  })
})
