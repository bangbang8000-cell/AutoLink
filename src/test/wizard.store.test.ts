import { describe, it, expect, beforeEach } from 'vitest'
import { useWizardStore } from '@/stores/wizard.store'
import { createDefaultProjectConfig } from '@/types/project-config'
import type { DeviceRef } from '@/types/device-profile'

describe('WizardStore', () => {
  beforeEach(() => {
    useWizardStore.setState({
      open: false,
      step: 1,
      config: createDefaultProjectConfig(''),
      templateName: null,
    })
  })

  describe('初始状态', () => {
    it('默认应处于关闭状态且步骤为 1', () => {
      const s = useWizardStore.getState()
      expect(s.open).toBe(false)
      expect(s.step).toBe(1)
      expect(s.templateName).toBeNull()
    })

    it('默认 config 应为空名称的默认配置', () => {
      expect(useWizardStore.getState().config.meta.name).toBe('')
      expect(useWizardStore.getState().config.topology.num_gpu_servers).toBe(100)
    })
  })

  describe('openWizard / closeWizard', () => {
    it('openWizard 应打开向导并重置步骤与配置', () => {
      // 先污染状态
      useWizardStore.setState({ step: 5, templateName: 'old', config: createDefaultProjectConfig('dirty') })
      useWizardStore.getState().openWizard()
      const s = useWizardStore.getState()
      expect(s.open).toBe(true)
      expect(s.step).toBe(1)
      expect(s.config.meta.name).toBe('')
      expect(s.templateName).toBeNull()
    })

    it('openWizard 应接受模板名称参数', () => {
      useWizardStore.getState().openWizard('H100-100台')
      expect(useWizardStore.getState().templateName).toBe('H100-100台')
    })

    it('closeWizard 应仅关闭向导而不清空配置', () => {
      useWizardStore.getState().openWizard('tmpl')
      useWizardStore.getState().updateMeta('myproj', 'desc')
      useWizardStore.getState().closeWizard()
      const s = useWizardStore.getState()
      expect(s.open).toBe(false)
      // 配置保留(下次打开时 openWizard 才会重置)
      expect(s.config.meta.name).toBe('myproj')
    })
  })

  describe('步骤导航 nextStep / prevStep / goToStep', () => {
    it('nextStep 应递增步骤', () => {
      useWizardStore.getState().nextStep()
      expect(useWizardStore.getState().step).toBe(2)
    })

    it('nextStep 在第 5 步应封顶不越界', () => {
      useWizardStore.setState({ step: 5 })
      useWizardStore.getState().nextStep()
      expect(useWizardStore.getState().step).toBe(5)
    })

    it('prevStep 应递减步骤', () => {
      useWizardStore.setState({ step: 3 })
      useWizardStore.getState().prevStep()
      expect(useWizardStore.getState().step).toBe(2)
    })

    it('prevStep 在第 1 步应封底不越界', () => {
      useWizardStore.setState({ step: 1 })
      useWizardStore.getState().prevStep()
      expect(useWizardStore.getState().step).toBe(1)
    })

    it('goToStep 应直接跳转到指定步骤', () => {
      useWizardStore.getState().goToStep(4)
      expect(useWizardStore.getState().step).toBe(4)
    })
  })

  describe('配置更新', () => {
    it('updateMeta 应同时更新 name 和 description', () => {
      useWizardStore.getState().updateMeta('proj1', '描述文本')
      const meta = useWizardStore.getState().config.meta
      expect(meta.name).toBe('proj1')
      expect(meta.description).toBe('描述文本')
    })

    it('updateNetworks 应部分更新网络选择并保留其他', () => {
      useWizardStore.getState().updateNetworks({ biz_network: false })
      const nets = useWizardStore.getState().config.networks
      expect(nets.biz_network).toBe(false)
      expect(nets.param_network).toBe(true) // 未更新字段保留
    })

    it('updateTopology 应部分更新拓扑参数', () => {
      useWizardStore.getState().updateTopology({ num_gpu_servers: 256, param_protocol: 'IB' })
      const topo = useWizardStore.getState().config.topology
      expect(topo.num_gpu_servers).toBe(256)
      expect(topo.param_protocol).toBe('IB')
      expect(topo.param_ports_per_server).toBe(8) // 未更新字段保留
    })

    it('updateRackConfig 应部分更新机柜配置', () => {
      useWizardStore.getState().updateRackConfig({ rack_type: 49, power_limit_per_rack: 12000 })
      const rack = useWizardStore.getState().config.rack_config
      expect(rack.rack_type).toBe(49)
      expect(rack.power_limit_per_rack).toBe(12000)
      expect(rack.naming_prefix).toBe('机柜') // 未更新字段保留
    })
  })

  describe('设备引用管理', () => {
    it('updateDeviceRefs 应合并新增设备引用', () => {
      const refs: Record<string, DeviceRef> = {
        gpu_server: { library_id: 'nvidia_dgx_h100' },
      }
      useWizardStore.getState().updateDeviceRefs(refs)
      expect(useWizardStore.getState().config.device_refs.gpu_server).toEqual({ library_id: 'nvidia_dgx_h100' })
    })

    it('updateDeviceRefs 应保留已存在的其他引用', () => {
      useWizardStore.getState().updateDeviceRefs({ gpu_server: { library_id: 'a' } })
      useWizardStore.getState().updateDeviceRefs({ param_leaf_switch: { library_id: 'b' } })
      const refs = useWizardStore.getState().config.device_refs
      expect(refs.gpu_server).toEqual({ library_id: 'a' })
      expect(refs.param_leaf_switch).toEqual({ library_id: 'b' })
    })

    it('removeDeviceRef 应删除指定设备引用', () => {
      useWizardStore.getState().updateDeviceRefs({
        gpu_server: { library_id: 'a' },
        param_leaf_switch: { library_id: 'b' },
      })
      useWizardStore.getState().removeDeviceRef('gpu_server')
      const refs = useWizardStore.getState().config.device_refs
      expect(refs.gpu_server).toBeUndefined()
      expect(refs.param_leaf_switch).toEqual({ library_id: 'b' })
    })

    it('removeDeviceRef 删除不存在的 key 不应报错', () => {
      expect(() => useWizardStore.getState().removeDeviceRef('nonexistent')).not.toThrow()
    })
  })

  describe('setTemplateName', () => {
    it('应更新模板名称', () => {
      useWizardStore.getState().setTemplateName('新模板')
      expect(useWizardStore.getState().templateName).toBe('新模板')
    })

    it('应支持设置为 null', () => {
      useWizardStore.getState().setTemplateName('x')
      useWizardStore.getState().setTemplateName(null)
      expect(useWizardStore.getState().templateName).toBeNull()
    })
  })
})
