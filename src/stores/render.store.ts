import { create } from 'zustand'

export type RenderStatus = 'idle' | 'rendering' | 'complete' | 'error'

export interface RenderProgress {
  status: RenderStatus
  message: string
  progress: number // 0-100
  error?: string
}

export interface RenderResult {
  type: string // 'connections' | 'rackTable' | 'topology' | 'deviceList'
  file: string
  status: 'success' | 'error'
  error?: string
  timestamp: string
}

export type OutputType = 'connections' | 'rackTable' | 'topology' | 'deviceList' | 'cablingGuide' | 'bom'

interface RenderState {
  progress: RenderProgress
  results: RenderResult[]
  selectedOutputTypes: OutputType[]
  batchMode: boolean
  batchProjects: string[]

  setProgress: (progress: Partial<RenderProgress>) => void
  resetProgress: () => void
  addResult: (result: RenderResult) => void
  clearResults: () => void
  toggleOutputType: (type: OutputType) => void
  setBatchMode: (enabled: boolean) => void
  setBatchProjects: (projects: string[]) => void
  toggleBatchProject: (name: string) => void
  /** 打磨轮（v1.2 / AL-2）：批量删除渲染结果（output/output-label/yaml） */
  deleteOutput: (projects: string[]) => Promise<{ deleted: number }>
}

export const useRenderStore = create<RenderState>()((set) => ({
  progress: { status: 'idle', message: '', progress: 0 },
  results: [],
  selectedOutputTypes: ['connections', 'rackTable', 'topology', 'deviceList'],
  batchMode: false,
  batchProjects: [],

  setProgress: (partial) =>
    set((s) => ({ progress: { ...s.progress, ...partial } })),

  resetProgress: () =>
    set({ progress: { status: 'idle', message: '', progress: 0 } }),

  addResult: (result) =>
    set((s) => ({ results: [...s.results, result] })),

  clearResults: () => set({ results: [] }),

  toggleOutputType: (type) =>
    set((s) => ({
      selectedOutputTypes: s.selectedOutputTypes.includes(type)
        ? s.selectedOutputTypes.filter((t) => t !== type)
        : [...s.selectedOutputTypes, type],
    })),

  setBatchMode: (enabled) => set({ batchMode: enabled }),

  setBatchProjects: (projects) => set({ batchProjects: projects }),

  toggleBatchProject: (name) =>
    set((s) => ({
      batchProjects: s.batchProjects.includes(name)
        ? s.batchProjects.filter((n) => n !== name)
        : [...s.batchProjects, name],
    })),

  deleteOutput: async (projects) => {
    if (!window.electron?.render?.deleteOutput) return { deleted: 0 }
    return window.electron.render.deleteOutput(projects)
  },
}))