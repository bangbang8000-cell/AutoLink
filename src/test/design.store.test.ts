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

  describe('loadConfig', () => {
    it('V3.0.2-T2-2: 应优先从 project_config.json 重建 config(1024/IB)', async () => {
      // v2 INI: createWithConfig 生成的格式(num_gpu_servers, 无 param_protocol)
      const ini = `[topology]\nnum_gpu_servers = 1024\nparam_switch_ports = 144\nparam_speed = 800G`
      const json = JSON.stringify({
        meta: { name: 'x' },
        networks: { param_network: true, storage_network: true, biz_network: true, oob_network: true },
        topology: {
          num_gpu_servers: 1024,
          param_protocol: 'IB',
          param_planes: [{ leaf_count: 8 }, { leaf_count: 8 }],
          num_all_flash_storage: 8,
          num_compute_servers: 8,
          param_switch_ports: 144,
          param_speed: '800G',
        },
      })
      window.electron.project.getConfigFile = vi.fn().mockResolvedValue(ini)
      window.electron.project.getFile = vi.fn().mockResolvedValue(json)

      await useDesignStore.getState().loadConfig('DP3Tier-1024')

      const cfg = useDesignStore.getState().config
      expect(cfg.num_servers).toBe(1024)
      expect(cfg.param_protocol).toBe('IB')
      expect(cfg.additional_storage_servers).toBe(8)
      expect(cfg.additional_compute_servers).toBe(8)
      expect(cfg.param_switch_ports).toBe(144)
    })

    it('V3.0.2-T2-2: 无 project_config.json 时回落 parseINI(兼容 v2 INI 字段)', async () => {
      const ini = `[topology]\nnum_gpu_servers = 512\nnum_storage_servers = 4\nnum_compute_servers = 6`
      window.electron.project.getConfigFile = vi.fn().mockResolvedValue(ini)
      window.electron.project.getFile = vi.fn().mockResolvedValue(null)

      await useDesignStore.getState().loadConfig('legacy')

      const cfg = useDesignStore.getState().config
      expect(cfg.num_servers).toBe(512)
      expect(cfg.additional_storage_servers).toBe(4)
      expect(cfg.additional_compute_servers).toBe(6)
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