import { create } from 'zustand'
import type { ProjectConfig, ProjectNetworks, ProjectTopology, ProjectRackConfig } from '@/types/project-config'
import { createDefaultProjectConfig } from '@/types/project-config'
import type { DeviceRef } from '@/types/device-profile'

export type WizardStep = 1 | 2 | 3 | 4 | 5

interface WizardState {
  open: boolean
  step: WizardStep
  config: ProjectConfig
  templateName: string | null

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

  setTemplateName: (name: string | null) => void
}

export const useWizardStore = create<WizardState>()((set, get) => ({
  open: false,
  step: 1,
  config: createDefaultProjectConfig(''),
  templateName: null,

  openWizard: (templateName) => {
    set({
      open: true,
      step: 1,
      config: createDefaultProjectConfig(''),
      templateName: templateName ?? null,
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

  setTemplateName: (name) => set({ templateName: name }),
}))