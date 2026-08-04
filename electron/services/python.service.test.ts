// V3.0.0-T0-6: Python 持久 Agent 进程服务集成测试
// mock electron（config.ts 顶层读取 app.isPackaged），走真实 engine.py 子进程
// engine.py 首次启动需 import pandas/matplotlib（3-8s），各用例均设长超时
import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: (name: string) => `C:/fake-userdata/${name}` },
}))

import { pythonService } from './python.service.js'

const LONG = 30000

describe('PythonService（V3.0.0-T0-6 持久 Agent 进程）', () => {
  afterAll(() => {
    pythonService.stop()
  })

  it('未知 action → reject 并带错误信息', async () => {
    await expect(pythonService.call('__no_such_action', {})).rejects.toThrow('未知 action')
  }, LONG)

  it('长驻进程：连续两次请求正常分发（进程复用）', async () => {
    await expect(pythonService.call('__no_such_action', {}, 30000)).rejects.toThrow('未知 action')
    await expect(pythonService.call('__no_such_action', {}, 30000)).rejects.toThrow('未知 action')
  }, LONG)

  it('并发 3 请求全部正确分发（队列 + requestId）', async () => {
    const results = await Promise.allSettled([
      pythonService.call('__no_such_action', {}, 30000),
      pythonService.call('__no_such_action', {}, 30000),
      pythonService.call('__no_such_action', {}, 30000),
    ])
    expect(results).toHaveLength(3)
    for (const r of results) {
      expect(r.status).toBe('rejected')
      expect((r as PromiseRejectedResult).reason.message).toContain('未知 action')
    }
  }, LONG)

  it('真实 action 走完整往返（validate 不存在配置 → error 数据）', async () => {
    const result = await pythonService.call('validate', { configFile: 'C:/nonexist/project_config.json' })
    expect((result as { error?: string }).error).toContain('配置文件不存在')
  }, LONG)
})
