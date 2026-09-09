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
      // 5.2.2-522-a: param_planes 非空 → dual_plane_enabled 回填；param_network_mode 缺省 standard
      expect(cfg.dual_plane_enabled).toBe(true)
      expect(cfg.param_network_mode).toBe('standard')
    })

    it('5.2.2-522-a: JSON param_network_mode=zcube → config 回填', async () => {
      const ini = `[topology]\nnum_gpu_servers = 512\nparam_network_mode = zcube`
      const json = JSON.stringify({
        meta: { name: 'z' },
        networks: {},
        topology: { num_gpu_servers: 512, param_network_mode: 'zcube' },
      })
      window.electron.project.getConfigFile = vi.fn().mockResolvedValue(ini)
      window.electron.project.getFile = vi.fn().mockResolvedValue(json)

      await useDesignStore.getState().loadConfig('zcube-512')

      const cfg = useDesignStore.getState().config
      expect(cfg.param_network_mode).toBe('zcube')
      expect(cfg.dual_plane_enabled).toBe(false)
    })

    it('5.2.2-522-e: JSON topo.param_zcube → config.param_zcube 回填（DesignTab 可再生成 Zcube）', async () => {
      const ini = `[topology]\nnum_gpu_servers = 64\nparam_network_mode = zcube`
      const json = JSON.stringify({
        meta: { name: 'zcube-atop' },
        networks: {},
        topology: {
          num_gpu_servers: 64,
          param_network_mode: 'zcube',
          param_zcube: { nics_per_gpu: 2, leaf_count: 4, switch_ports: 128 },
        },
      })
      window.electron.project.getConfigFile = vi.fn().mockResolvedValue(ini)
      window.electron.project.getFile = vi.fn().mockResolvedValue(json)

      await useDesignStore.getState().loadConfig('zcube-atop')

      const cfg = useDesignStore.getState().config
      expect(cfg.param_network_mode).toBe('zcube')
      expect(cfg.param_zcube).toEqual({ nics_per_gpu: 2, leaf_count: 4, switch_ports: 128 })
    })

    it('5.2.2-522-e: 无 param_zcube 时 config 不生成空对象', async () => {
      const ini = `[topology]\nnum_gpu_servers = 64`
      const json = JSON.stringify({ meta: {}, networks: {}, topology: { num_gpu_servers: 64 } })
      window.electron.project.getConfigFile = vi.fn().mockResolvedValue(ini)
      window.electron.project.getFile = vi.fn().mockResolvedValue(json)

      await useDesignStore.getState().loadConfig('plain-64')

      expect(useDesignStore.getState().config.param_zcube).toBeUndefined()
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

    it('5.2.2-522-e: Zcube 模式 configToINI 发射 param_zcube_* 键', async () => {
      useDesignStore.setState({
        config: {
          ...useDesignStore.getState().config,
          param_network_mode: 'zcube',
          param_zcube: { nics_per_gpu: 2, leaf_count: 4, switch_ports: 128 },
        },
      })
      window.electron.design.generate = vi.fn().mockResolvedValue({ summary: {}, topology: {}, valid: true })
      await useDesignStore.getState().generate('zcube-gen')

      const ini = (window.electron.design.generate as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      expect(ini).toContain('param_network_mode = zcube')
      expect(ini).toContain('param_zcube_nics_per_gpu = 2')
      expect(ini).toContain('param_zcube_leaf_count = 4')
      expect(ini).toContain('param_zcube_switch_ports = 128')
    })

    it('5.2.2-522-e: 非 Zcube 模式不发射 param_zcube_* 键', async () => {
      useDesignStore.setState({
        config: {
          ...useDesignStore.getState().config,
          param_network_mode: 'standard',
          param_zcube: { nics_per_gpu: 2 },
        },
      })
      window.electron.design.generate = vi.fn().mockResolvedValue({ summary: {}, topology: {}, valid: true })
      await useDesignStore.getState().generate('std-gen')

      const ini = (window.electron.design.generate as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      expect(ini).not.toContain('param_zcube_nics_per_gpu')
    })

    it('5.2.2-522-f: 推理 4 合 1 模式发射 inference_servers/speed/convergence 键', async () => {
      useDesignStore.setState({
        config: {
          ...useDesignStore.getState().config,
          inference_plane: true,
          inference_servers: 4,
          inference_speed: '400G',
          inference_convergence: 3,
        },
      })
      window.electron.design.generate = vi.fn().mockResolvedValue({ summary: {}, topology: {}, valid: true })
      await useDesignStore.getState().generate('inf-gen')

      const ini = (window.electron.design.generate as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      expect(ini).toContain('inference_plane = true')
      expect(ini).toContain('inference_servers = 4')
      expect(ini).toContain('inference_speed = 400G')
      expect(ini).toContain('inference_convergence = 3')
    })

    it('5.2.2-522-f: 推理关闭时不发射 inference_* 子键', async () => {
      useDesignStore.setState({
        config: {
          ...useDesignStore.getState().config,
          inference_plane: false,
          inference_servers: 4,
        },
      })
      window.electron.design.generate = vi.fn().mockResolvedValue({ summary: {}, topology: {}, valid: true })
      await useDesignStore.getState().generate('inf-off')

      const ini = (window.electron.design.generate as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      expect(ini).toContain('inference_plane = false')
      expect(ini).not.toContain('inference_servers')
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