import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDesignStore, defaultDesignConfig } from '@/stores/design.store'

describe('DesignStore', () => {
  beforeEach(() => {
    useDesignStore.setState({
      config: { ...defaultDesignConfig },
      summary: null,
      valid: null,
      topology: null,
      generating: false,
      error: null,
      configLoaded: false,
      projectName: null,
    })
    vi.clearAllMocks()
  })

  describe('updateConfig', () => {
    it('应该部分更新配置', () => {
      useDesignStore.getState().updateConfig({ num_servers: 200 })
      expect(useDesignStore.getState().config.num_servers).toBe(200)
    })

    it('应该保留其他字段', () => {
      useDesignStore.getState().updateConfig({ num_servers: 200 })
      expect(useDesignStore.getState().config.param_ports_per_server).toBe(8)
    })

    it('应该清除错误', () => {
      useDesignStore.setState({ error: 'old error' })
      useDesignStore.getState().updateConfig({ num_servers: 200 })
      expect(useDesignStore.getState().error).toBeNull()
    })
  })

  describe('resetConfig', () => {
    it('应该重置为默认配置', () => {
      useDesignStore.getState().updateConfig({ num_servers: 999 })
      useDesignStore.getState().resetConfig()
      expect(useDesignStore.getState().config).toEqual(defaultDesignConfig)
    })
  })

  describe('configToINI', () => {
    it('应该生成有效的INI格式', async () => {
      // 通过 generate 间接测试 configToINI
      window.electron.design.generate = vi.fn().mockResolvedValue({ summary: {}, topology: {}, valid: true })
      await useDesignStore.getState().generate('test')

      const callArgs = (window.electron.design.generate as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(callArgs[0]).toBe('test')
      expect(callArgs[1]).toContain('[DEFAULT]')
      expect(callArgs[1]).toContain('downlink_mode = custom')
    })
  })

  describe('generate', () => {
    it('应该在生成期间设置generating状态', async () => {
      window.electron.design.generate = vi.fn().mockImplementation(
        () => new Promise((r) => setTimeout(() => r({ summary: {}, topology: {}, valid: true }), 10))
      )
      const promise = useDesignStore.getState().generate('test')
      expect(useDesignStore.getState().generating).toBe(true)
      await promise
      expect(useDesignStore.getState().generating).toBe(false)
    })

    it('应该处理生成错误', async () => {
      window.electron.design.generate = vi.fn().mockRejectedValue(new Error('生成失败'))
      await useDesignStore.getState().generate('test')

      expect(useDesignStore.getState().error).toBe('生成失败')
      expect(useDesignStore.getState().generating).toBe(false)
    })

    it('应该在IPC不可用时抛出错误', async () => {
      const saved = window.electron
      // @ts-expect-error 测试IPC不可用场景
      delete window.electron
      await useDesignStore.getState().generate('test')
      expect(useDesignStore.getState().error).toContain('IPC')
      window.electron = saved
    })
  })

  describe('validate', () => {
    it('应该设置valid结果', async () => {
      window.electron.design.validate = vi.fn().mockResolvedValue({ valid: true })
      await useDesignStore.getState().validate('test')

      expect(useDesignStore.getState().valid).toBe(true)
      expect(useDesignStore.getState().generating).toBe(false)
    })

    it('应该处理验证错误', async () => {
      window.electron.design.validate = vi.fn().mockRejectedValue(new Error('验证失败'))
      await useDesignStore.getState().validate('test')

      expect(useDesignStore.getState().error).toBe('验证失败')
    })
  })

  describe('clearResults', () => {
    it('应该清除所有结果', () => {
      useDesignStore.setState({ summary: {} as any, topology: {} as any, valid: true, error: 'err' })
      useDesignStore.getState().clearResults()

      expect(useDesignStore.getState().summary).toBeNull()
      expect(useDesignStore.getState().topology).toBeNull()
      expect(useDesignStore.getState().valid).toBeNull()
      expect(useDesignStore.getState().error).toBeNull()
    })
  })
})