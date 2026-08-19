import { create } from 'zustand'
import type { ProjectConfig, ProjectNetworks, ProjectTopology, ProjectRackConfig } from '@/types/project-config'
import { createDefaultProjectConfig } from '@/types/project-config'
import type { DeviceRef } from '@/types/device-profile'

export type WizardStep = 1 | 2 | 3 | 4 | 5

/** 打磨轮（AL-B1）：向导 AIDC 规划参数默认值（snake_case，与 aidc_project/plan_aidc 输入一致） */
export const DEFAULT_AIDC_MACRO: Record<string, unknown> = {
  gpu_count: 64,
  site: 'BJ01',
  pfc_queue: 3,
  cnp_queue: 6,
  convergence: 1,
  rails: 8,
  as_range: [65001, 65500],
  vlan_ranges: { compute: [100, 199], storage: [200, 299], biz: [300, 399], oob: [400, 499] },
}

interface WizardState {
  open: boolean
  step: WizardStep
  config: ProjectConfig
  templateName: string | null
  /** 打磨轮（AL-B1）：是否包含 AIDC 规划参数 */
  aidcEnabled: boolean
  aidcMacro: Record<string, unknown>

  openWizard: (templateName?: string | null) => void
  closeWizard: () => void
  nextStep: () => void
  prevStep: () => void
  goToStep: (step: WizardStep) => void

  updateMeta: (name: string, description: string) => void
  updateNetworks: (networks: Partial<ProjectNetworks>) => void
  updateTopology: (topology: Partial<ProjectTopology>) => void
  updateDeviceRefs: (refs: Record<string, DeviceRef>) => void
  removeDeviceRef: (refKey: string) => void
  updateRackConfig: (rack: Partial<ProjectRackConfig>) => void
  loadTemplateConfig: (tplConfig: ProjectConfig | null) => void
  resetConfig: () => void
  setAidcEnabled: (enabled: boolean) => void
  updateAidcMacro: (patch: Partial<Record<string, unknown>>) => void

  setTemplateName: (name: string | null) => void
}

export const useWizardStore = create<WizardState>()((set, get) => ({
  open: false,
  step: 1,
  config: createDefaultProjectConfig(''),
  templateName: null,
  aidcEnabled: false,
  aidcMacro: { ...DEFAULT_AIDC_MACRO },

  openWizard: (templateName) => {
    set({
      open: true,
      step: 1,
      config: createDefaultProjectConfig(''),
      templateName: templateName ?? null,
      aidcEnabled: false,
      aidcMacro: { ...DEFAULT_AIDC_MACRO },
    })
  },

  // V2.9.5-T3: 加载模板配置预填向导（meta.name 保留由用户输入，其余模板字段优先）
  loadTemplateConfig: (tplConfig) => {
    if (!tplConfig) return
    set((s) => {
      const base = createDefaultProjectConfig(tplConfig.meta?.name || s.config.meta.name || '')
      const merged: ProjectConfig = {
        meta: {
          ...base.meta,
          ...tplConfig.meta,
          created_at: base.meta.created_at,
          updated_at: base.meta.updated_at,
        },
        networks: { ...base.networks, ...tplConfig.networks },
        topology: { ...base.topology, ...tplConfig.topology },
        device_refs: { ...(tplConfig.device_refs || {}) },
        rack_config: { ...base.rack_config, ...tplConfig.rack_config },
        scale_up: { ...base.scale_up, ...(tplConfig.scale_up || {}) },
      }
      return { config: merged }
    })
  },

  closeWizard: () => set({ open: false }),

  nextStep: () => {
    const { step } = get()
    if (step < 5) set({ step: (step + 1) as WizardStep })
  },

  prevStep: () => {
    const { step } = get()
    if (step > 1) set({ step: (step - 1) as WizardStep })
  },

  goToStep: (step) => set({ step }),

  updateMeta: (name, description) =>
    set((s) => ({ config: { ...s.config, meta: { ...s.config.meta, name, description } } })),

  updateNetworks: (networks) =>
    set((s) => ({ config: { ...s.config, networks: { ...s.config.networks, ...networks } } })),

  updateTopology: (topology) =>
    set((s) => ({ config: { ...s.config, topology: { ...s.config.topology, ...topology } } })),

  updateDeviceRefs: (refs) =>
    set((s) => ({ config: { ...s.config, device_refs: { ...s.config.device_refs, ...refs } } })),

  removeDeviceRef: (refKey: string) =>
    set((s) => {
      const refs = { ...s.config.device_refs }
      delete refs[refKey]
      return { config: { ...s.config, device_refs: refs } }
    }),

  updateRackConfig: (rack) =>
    set((s) => ({ config: { ...s.config, rack_config: { ...s.config.rack_config, ...rack } } })),

  // V2.9.5-T5: 重置为默认（放弃模板预填，从头创建）
  resetConfig: () => set({ config: createDefaultProjectConfig(''), templateName: null, aidcEnabled: false, aidcMacro: { ...DEFAULT_AIDC_MACRO } }),

  setAidcEnabled: (enabled) => set({ aidcEnabled: enabled }),
  updateAidcMacro: (patch) =>
    set((s) => ({ aidcMacro: { ...s.aidcMacro, ...patch } })),

  setTemplateName: (name) => set({ templateName: name }),
}))