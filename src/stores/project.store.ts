import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProjectConfig } from '@/types/project-config'

export interface ProjectInfo {
  id: number
  name: string
  index: number
}

export interface ProjectStatus {
  name: string
  status: 'ready' | 'configured' | 'designed' | 'layouted'
}

export interface TemplateInfo {
  id: string
  name: string
  description: string
  scenario: string
  tags: string[]
  updatedAt: string
  isBuiltin?: boolean
}

interface ProjectState {
  projects: ProjectInfo[]
  selectedProject: ProjectInfo | null
  selectedProjectName: string | null
  projectStatuses: Record<string, ProjectStatus>
  templates: TemplateInfo[]
  favoriteProjects: string[]
  recentProjects: string[]

  fetchProjects: () => Promise<void>
  createProject: (name: string, options?: { template?: string; empty?: boolean }) => Promise<void>
  createProjectWithConfig: (config: ProjectConfig) => Promise<void>
  deleteProjects: (ids: string[]) => Promise<void>
  selectProject: (project: ProjectInfo | null) => void
  toggleFavorite: (name: string) => void
  trackRecent: (name: string) => void
  fetchTemplates: () => Promise<void>
  deleteTemplate: (name: string) => Promise<void>
  convertToTemplate: (projectName: string, meta: { name: string; description?: string; scenario?: string; tags?: string[] }) => Promise<void>
}

const builtinTemplates: TemplateInfo[] = [
  {
    id: 'H100-128台',
    name: 'H100-128台方案',
    description: '128台H100 GPU（4组×32台）+ 14台存储 + 20台管理服务器',
    scenario: 'H100-128台',
    tags: ['H100', '128台', '4组', '2层组网'],
    updatedAt: '2026-07-26',
    isBuiltin: true,
  },
  {
    id: 'H100-100台',
    name: 'H100-100台方案',
    description: '100台H100 GPU（4组×25台）+ 14台存储 + 20台管理服务器',
    scenario: 'H100-100台',
    tags: ['H100', '100台', '4组', '2层组网'],
    updatedAt: '2026-07-26',
    isBuiltin: true,
  },
  {
    id: '空项目',
    name: '空项目',
    description: '空白项目模板，适合从头开始设计',
    scenario: '自定义',
    tags: ['空白', '自定义'],
    updatedAt: '2026-07-26',
    isBuiltin: true,
  },
]

function ensureIPC() {
  if (!window.electron?.project) {
    throw new Error('IPC 桥接未就绪，请确认 Electron 预加载脚本正常加载')
  }
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      selectedProject: null,
      selectedProjectName: null,
      projectStatuses: {},
      templates: builtinTemplates,
      favoriteProjects: [],
      recentProjects: [],

      fetchProjects: async () => {
        try {
          ensureIPC()
          const projects = await window.electron.project.list()
          const validNames = new Set(projects.map((p: ProjectInfo) => p.name))
          set((s) => ({
            projects,
            favoriteProjects: s.favoriteProjects.filter((n) => validNames.has(n)),
            recentProjects: s.recentProjects.filter((n) => validNames.has(n)),
          }))
        } catch (err) {
          console.error('[ProjectStore] fetchProjects failed:', err)
          // Keep existing projects list on error, don't wipe it
        }
      },

      createProject: async (name, options) => {
        ensureIPC()
        await window.electron.project.create(name, options)
        await get().fetchProjects()
      },

      createProjectWithConfig: async (config) => {
        ensureIPC()
        await window.electron.project.createWithConfig(config)
        await get().fetchProjects()
      },

      deleteProjects: async (ids) => {
        ensureIPC()
        // Convert string ids to indices for IPC
        const indices = ids.map((id) => parseInt(id))
        await window.electron.project.delete(indices.map(String))
        const projects = await window.electron.project.list()
        const { selectedProjectName } = get()
        const validNames = new Set(projects.map((p: ProjectInfo) => p.name))
        const selected = selectedProjectName && validNames.has(selectedProjectName)
          ? projects.find((p: ProjectInfo) => p.name === selectedProjectName) ?? null
          : null
        set({
          projects,
          selectedProject: selected,
          selectedProjectName: selected?.name ?? null,
        })
      },

      selectProject: (project) => {
        set({
          selectedProject: project,
          selectedProjectName: project?.name ?? null,
        })
        if (project) get().trackRecent(project.name)
      },

      toggleFavorite: (name) => {
        const list = get().favoriteProjects
        set({
          favoriteProjects: list.includes(name) ? list.filter((x) => x !== name) : [...list, name],
        })
      },

      trackRecent: (name) => {
        const list = get().recentProjects.filter((x) => x !== name)
        set({ recentProjects: [name, ...list].slice(0, 5) })
      },

      fetchTemplates: async () => {
        try {
          ensureIPC()
          if (window.electron.template?.list) {
            const templates = await window.electron.template.list()
            set({ templates })
          }
        } catch {
          // Fallback to hardcoded templates
          set({ templates: builtinTemplates })
        }
      },

      deleteTemplate: async (name) => {
        ensureIPC()
        await window.electron.template.delete(name)
        await get().fetchTemplates()
      },

      convertToTemplate: async (projectName, meta) => {
        ensureIPC()
        await window.electron.template.create(projectName, meta)
        await get().fetchTemplates()
      },
    }),
    {
      name: 'autolink-project-state',
      partialize: (state) => ({
        selectedProjectName: state.selectedProjectName,
        favoriteProjects: state.favoriteProjects,
        recentProjects: state.recentProjects,
        templates: state.templates,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            state.selectedProject = null
          }
        }
      },
    },
  ),
)
