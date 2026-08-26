/**
 * M3b: AL AIHubService 单元测试（对照 MC aiHub.service.test.ts）
 * - 初始状态 / token 一致性（防止 token 漂移导致 401）
 * - 401 重试逻辑（withRetry）通过 mock fetch 验证
 * - sendChatMessage 前 ensureRunning
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'

// mock electron（config.ts 读取 app.isPackaged / app.getPath）
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
}))

import { AIHubService } from './aiHub.service.js'

// 私有方法访问
type PrivateHub = AIHubService & {
  authHeaders(): Record<string, string>
  ensureRunning(): Promise<void>
  withRetry<T>(fn: () => Promise<T>): Promise<T>
}

describe('AL AIHubService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('初始状态为未运行，端口 18722', () => {
    const s = new AIHubService()
    expect(s.getStatus().running).toBe(false)
    expect(s.getStatus().port).toBe(18722)
  })

  it('authHeaders 每次返回一致的鉴权 token（X-AL-Auth-Token，防止 token 漂移导致 401）', () => {
    const s = new AIHubService() as PrivateHub
    const h1 = s.authHeaders()
    const h2 = s.authHeaders()
    expect(h1['X-AL-Auth-Token']).toBeTruthy()
    expect(h1['X-AL-Auth-Token']).toBe(h2['X-AL-Auth-Token'])
  })

  it('withRetry：401 时重启 hub 并重试一次成功', async () => {
    const s = new AIHubService() as PrivateHub
    const stopSpy = vi.spyOn(s, 'stop').mockResolvedValue(undefined)
    const ensureSpy = vi.spyOn(s, 'ensureRunning').mockResolvedValue(undefined)

    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('AI Hub 请求失败: 401 {"detail":"Unauthorized"}')
      return 'ok-content'
    })

    const result = await s.withRetry(fn)
    expect(result).toBe('ok-content')
    expect(calls).toBe(2)
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(ensureSpy).toHaveBeenCalledTimes(1)
  })

  it('withRetry：非 401 错误不重试，原样抛出', async () => {
    const s = new AIHubService() as PrivateHub
    const stopSpy = vi.spyOn(s, 'stop').mockResolvedValue(undefined)
    const fn = vi.fn(async () => { throw new Error('模型响应超时') })

    await expect(s.withRetry(fn)).rejects.toThrow('模型响应超时')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(stopSpy).not.toHaveBeenCalled()
  })

  it('sendChatMessage 前 ensureRunning（hub 未运行先启动，不再裸 fetch 401）', async () => {
    const s = new AIHubService() as PrivateHub
    const ensureSpy = vi.spyOn(s, 'ensureRunning').mockResolvedValue(undefined)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    const content = await s.sendChatMessage('s1', 'hi')
    expect(ensureSpy).toHaveBeenCalled()
    expect(content).toBe('')
  })
})
