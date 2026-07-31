import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FileTreeNode, OutputBatch } from '@/types/file-tree'

/**
 * 项目浏览器展开状态 Store
 *
 * 命名空间约定(避免 key 冲突):
 * - 项目相关:`project:<projectName>`
 * - 模板相关:`template:<templateName>`
 * - 输出相关:`output:<projectName>`
 * - 智能分组:`group:<projectName>/<groupKey>`
 * - 真实目录:`dir:<projectName>/<relativePath>` 或 `dir:template:<templateName>/<relativePath>`
 * - 批次:`batch:<projectName>/<batchName>`
 */
interface ExplorerState {
  /** Section 折叠状态(key: section 标识) */
  collapsedSections: Record<string, boolean>
  /** 项目展开状态 */
  expandedProjects: Record<string, boolean>
  /** 智能分组展开状态(key: `group:<projectName>/<groupKey>`) */
  expandedGroups: Record<string, boolean>
  /** 真实子目录展开状态(key: `dir:<scope>/<relativePath>`) */
  expandedDirs: Record<string, boolean>
  /** 模板展开状态 */
  expandedTemplates: Record<string, boolean>
  /** 输出批次展开状态(key: `batch:<projectName>/<batchName>`) */
  expandedBatches: Record<string, boolean>
  /** 输出 Section 下项目展开状态 */
  expandedOutputProjects: Record<string, boolean>

  /** 项目结构缓存(运行时,不持久化) */
  projectStructures: Record<string, FileTreeNode[]>
  /** 模板结构缓存(运行时,不持久化) */
  templateStructures: Record<string, FileTreeNode[]>
  /** 输出批次缓存(运行时,不持久化) */
  outputBatches: Record<string, OutputBatch[]>

  toggleSection: (section: string) => void
  toggleProject: (name: string) => void
  toggleGroup: (projectName: string, groupKey: string) => void
  toggleDir: (scope: string, relativePath: string) => void
  toggleTemplate: (name: string) => void
  toggleBatch: (projectName: string, batchName: string) => void
  toggleOutputProject: (name: string) => void

  setProjectStructure: (name: string, structure: FileTreeNode[]) => void
  setTemplateStructure: (name: string, structure: FileTreeNode[]) => void
  setOutputBatches: (name: string, batches: OutputBatch[]) => void

  /** 删除/重命名项目时清理所有相关状态 */
  cleanupProject: (name: string) => void
  /** 删除/重命名模板时清理所有相关状态 */
  cleanupTemplate: (name: string) => void
  /** 重置所有展开状态 */
  resetAll: () => void
}

const emptyExpanded = {} as Record<string, boolean>

export const useExplorerStore = create<ExplorerState>()(
  persist(
    (set) => ({
      collapsedSections: { ...emptyExpanded },
      expandedProjects: { ...emptyExpanded },
      expandedGroups: { ...emptyExpanded },
      expandedDirs: { ...emptyExpanded },
      expandedTemplates: { ...emptyExpanded },
      expandedBatches: { ...emptyExpanded },
      expandedOutputProjects: { ...emptyExpanded },

      projectStructures: {},
      templateStructures: {},
      outputBatches: {},

      toggleSection: (section) =>
        set((s) => ({
          collapsedSections: { ...s.collapsedSections, [section]: !s.collapsedSections[section] },
        })),

      toggleProject: (name) =>
        set((s) => ({ expandedProjects: { ...s.expandedProjects, [name]: !s.expandedProjects[name] } })),

      toggleGroup: (projectName, groupKey) => {
        const key = `group:${projectName}/${groupKey}`
        set((s) => ({ expandedGroups: { ...s.expandedGroups, [key]: !s.expandedGroups[key] } }))
      },

      toggleDir: (scope, relativePath) => {
        const key = `dir:${scope}/${relativePath}`
        set((s) => ({ expandedDirs: { ...s.expandedDirs, [key]: !s.expandedDirs[key] } }))
      },

      toggleTemplate: (name) =>
        set((s) => ({ expandedTemplates: { ...s.expandedTemplates, [name]: !s.expandedTemplates[name] } })),

      toggleBatch: (projectName, batchName) => {
        const key = `batch:${projectName}/${batchName}`
        set((s) => ({ expandedBatches: { ...s.expandedBatches, [key]: !s.expandedBatches[key] } }))
      },

      toggleOutputProject: (name) =>
        set((s) => ({
          expandedOutputProjects: { ...s.expandedOutputProjects, [name]: !s.expandedOutputProjects[name] },
        })),

      setProjectStructure: (name, structure) =>
        set((s) => ({ projectStructures: { ...s.projectStructures, [name]: structure } })),

      setTemplateStructure: (name, structure) =>
        set((s) => ({ templateStructures: { ...s.templateStructures, [name]: structure } })),

      setOutputBatches: (name, batches) =>
        set((s) => ({ outputBatches: { ...s.outputBatches, [name]: batches } })),

      cleanupProject: (name) =>
        set((s) => {
          // 过滤掉与指定项目相关的所有 key
          const filterOut = (obj: Record<string, boolean>) => {
            const next: Record<string, boolean> = {}
            for (const [k, v] of Object.entries(obj)) {
              if (k === name || k.startsWith(`${name}/`) || k.startsWith(`group:${name}/`) || k.startsWith(`dir:${name}/`) || k.startsWith(`dir:project:${name}/`) || k.startsWith(`batch:${name}/`)) {
                continue
              }
              next[k] = v
            }
            return next
          }
          const projectStructures = { ...s.projectStructures }
          delete projectStructures[name]
          const outputBatches = { ...s.outputBatches }
          delete outputBatches[name]
          return {
            expandedProjects: filterOut(s.expandedProjects),
            expandedGroups: filterOut(s.expandedGroups),
            expandedDirs: filterOut(s.expandedDirs),
            expandedOutputProjects: filterOut(s.expandedOutputProjects),
            expandedBatches: filterOut(s.expandedBatches),
            projectStructures,
            outputBatches,
          }
        }),

      cleanupTemplate: (name) =>
        set((s) => {
          const filterOut = (obj: Record<string, boolean>) => {
            const next: Record<string, boolean> = {}
            for (const [k, v] of Object.entries(obj)) {
              if (k === name || k.startsWith(`dir:template:${name}/`)) continue
              next[k] = v
            }
            return next
          }
          const templateStructures = { ...s.templateStructures }
          delete templateStructures[name]
          return {
            expandedTemplates: filterOut(s.expandedTemplates),
            expandedDirs: filterOut(s.expandedDirs),
            templateStructures,
          }
        }),

      resetAll: () =>
        set({
          collapsedSections: { ...emptyExpanded },
          expandedProjects: { ...emptyExpanded },
          expandedGroups: { ...emptyExpanded },
          expandedDirs: { ...emptyExpanded },
          expandedTemplates: { ...emptyExpanded },
          expandedBatches: { ...emptyExpanded },
          expandedOutputProjects: { ...emptyExpanded },
        }),
    }),
    {
      name: 'autolink-explorer-state',
      // 仅持久化展开状态,不持久化结构缓存(每次启动重新拉取)
      partialize: (state) => ({
        collapsedSections: state.collapsedSections,
        expandedProjects: state.expandedProjects,
        expandedGroups: state.expandedGroups,
        expandedDirs: state.expandedDirs,
        expandedTemplates: state.expandedTemplates,
        expandedBatches: state.expandedBatches,
        expandedOutputProjects: state.expandedOutputProjects,
      }),
    },
  ),
)
