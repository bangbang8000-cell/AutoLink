import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProjectConfig } from '@/types/project-config'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'

export interface ProjectInfo {
  id: number
  name: string
  index: number
  status?: 'ready' | 'configured' | 'designed' | 'layouted'
  fileCount?: number
  updatedAt?: string
  description?: string
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
  deleteProjects: (names: string[]) => Promise<void>
  duplicateProject: (sourceName: string, targetName: string) => Promise<void>
  renameProject: (oldName: string, newName: string) => Promise<void>
  exportProject: (projectName: string) => Promise<{ canceled: boolean; zipPath: string }>
  importProject: (options?: { projectName?: string; zipPath?: string }) => Promise<{ canceled: boolean; projectName: string }>
  batchExportProjects: (projectNames: string[]) => Promise<{ canceled: boolean; result: { successes: { name: string }[]; failures: { name: string; error: string }[] } | null; targetDir: string }>
  selectProject: (project: ProjectInfo | null) => void
  toggleFavorite: (name: string) => void
  trackRecent: (name: string) => void
  fetchTemplates: () => Promise<void>
  deleteTemplate: (name: string) => Promise<void>
  convertToTemplate: (projectName: string, meta: { name: string; description?: string; scenario?: string; tags?: string[] }) => Promise<void>
  updateTemplate: (templateName: string, updates: {
    name?: string
    description?: string
    scenario?: string
    tags?: string[]
    configContent?: string
  }) => Promise<void>
  exportTemplate: (templateName: string) => Promise<{ canceled: boolean; zipPath: string }>
  importTemplate: (options?: { templateName?: string; zipPath?: string }) => Promise<{ canceled: boolean; templateName: string }>
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

      deleteProjects: async (names) => {
        ensureIPC()
        await window.electron.project.delete(names)
        const projects = await window.electron.project.list()
        const validNames = new Set(projects.map((p: ProjectInfo) => p.name))
        const { selectedProjectName } = get()
        const selected = selectedProjectName && validNames.has(selectedProjectName)
          ? projects.find((p: ProjectInfo) => p.name === selectedProjectName) ?? null
          : null
        set({
          projects,
          selectedProject: selected,
          selectedProjectName: selected?.name ?? null,
        })
      },

      duplicateProject: async (sourceName, targetName) => {
        ensureIPC()
        await window.electron.project.duplicate(sourceName, targetName)
        await get().fetchProjects()
        // 自动选中新复制的项目
        const projects = get().projects
        const newProject = projects.find((p) => p.name === targetName)
        if (newProject) {
          get().selectProject(newProject)
        }
      },

      renameProject: async (oldName, newName) => {
        ensureIPC()
        await window.electron.project.rename(oldName, newName)
        await get().fetchProjects()
        // 保持选中重命名后的项目
        const projects = get().projects
        const renamed = projects.find((p) => p.name === newName)
        if (renamed) {
          get().selectProject(renamed)
        }
      },

      exportProject: async (projectName) => {
        ensureIPC()
        const result = await window.electron.project.exportZip(projectName)
        if (!result.canceled) {
          // 导出成功不刷新列表，项目未变化
          return result
        }
        return result
      },

      importProject: async (options) => {
        ensureIPC()
        const result = await window.electron.project.importZip(options)
        if (!result.canceled && result.projectName) {
          await get().fetchProjects()
          // 自动选中新导入的项目
          const projects = get().projects
          const newProject = projects.find((p) => p.name === result.projectName)
          if (newProject) {
            get().selectProject(newProject)
          }
        }
        return result
      },

      batchExportProjects: async (projectNames) => {
        ensureIPC()
        const raw = await window.electron.project.batchExportZip(projectNames)
        if (raw.canceled) {
          return { canceled: true, result: null, targetDir: '' }
        }
        // 简化 successes 结构，避免 zipPath 泄漏到前端
        const simplified = raw.result
          ? {
              successes: raw.result.successes.map((s) => ({ name: s.name })),
              failures: raw.result.failures,
            }
          : null
        return { canceled: false, result: simplified, targetDir: raw.targetDir }
      },

      selectProject: (project) => {
        set({
          selectedProject: project,
          selectedProjectName: project?.name ?? null,
        })
        if (project) {
          get().trackRecent(project.name)
          // T6.4: 统一加载入口 — 切换项目时预加载配置/拓扑/机柜数据
          // 无论当前激活哪个 Tab,数据都提前加载,避免组件挂载时才加载导致闪烁
          // 各组件(DesignTab/RackPanel)的 useEffect 会监听 selectedProjectName 变化,
          // 若数据已加载则为幂等操作,不会重复请求后端
          const name = project.name
          const designStore = useDesignStore.getState()
          designStore.loadConfig(name).then(() => designStore.loadSavedTopology(name))
          useRackStore.getState().loadRackLayout(name).catch(() => {
            // loadRackLayout 内部已有 fallback,此处仅防 unhandled rejection
          })
        }
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

      updateTemplate: async (templateName, updates) => {
        ensureIPC()
        if (!window.electron.template?.update) {
          throw new Error('模板更新接口未就绪')
        }
        await window.electron.template.update(templateName, updates)
        await get().fetchTemplates()
      },

      exportTemplate: async (templateName) => {
        ensureIPC()
        if (!window.electron.template?.exportZip) {
          throw new Error('模板导出接口未就绪')
        }
        return window.electron.template.exportZip(templateName)
      },

      importTemplate: async (options) => {
        ensureIPC()
        if (!window.electron.template?.importZip) {
          throw new Error('模板导入接口未就绪')
        }
        const result = await window.electron.template.importZip(options)
        if (!result.canceled && result.templateName) {
          await get().fetchTemplates()
        }
        return result
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
