import { describe, it, expect, beforeEach } from 'vitest'
import { useExplorerStore } from '@/stores/explorer.store'
import type { FileTreeNode, OutputBatch } from '@/types/file-tree'

describe('ExplorerStore', () => {
  beforeEach(() => {
    // persist 中间件会在 localStorage 中持久化展开状态,测试前清空以避免相互干扰
    localStorage.clear()
    useExplorerStore.getState().resetAll()
    useExplorerStore.setState({
      projectStructures: {},
      templateStructures: {},
      outputBatches: {},
    })
  })

  describe('初始状态', () => {
    it('所有展开状态应为空对象', () => {
      const s = useExplorerStore.getState()
      expect(s.expandedProjects).toEqual({})
      expect(s.expandedGroups).toEqual({})
      expect(s.expandedDirs).toEqual({})
      expect(s.expandedTemplates).toEqual({})
      expect(s.expandedBatches).toEqual({})
      expect(s.expandedOutputProjects).toEqual({})
      expect(s.collapsedSections).toEqual({})
    })

    it('运行时缓存应为空对象', () => {
      const s = useExplorerStore.getState()
      expect(s.projectStructures).toEqual({})
      expect(s.templateStructures).toEqual({})
      expect(s.outputBatches).toEqual({})
    })
  })

  describe('toggleProject', () => {
    it('首次调用应将项目标记为展开', () => {
      useExplorerStore.getState().toggleProject('proj1')
      expect(useExplorerStore.getState().expandedProjects.proj1).toBe(true)
    })

    it('再次调用应取消展开', () => {
      useExplorerStore.getState().toggleProject('proj1')
      useExplorerStore.getState().toggleProject('proj1')
      expect(useExplorerStore.getState().expandedProjects.proj1).toBe(false)
    })

    it('不应影响其他项目的展开状态', () => {
      useExplorerStore.getState().toggleProject('proj1')
      useExplorerStore.getState().toggleProject('proj2')
      expect(useExplorerStore.getState().expandedProjects.proj1).toBe(true)
      expect(useExplorerStore.getState().expandedProjects.proj2).toBe(true)
    })
  })

  describe('toggleGroup', () => {
    it('应使用 group:<projectName>/<groupKey> 命名约定存储', () => {
      useExplorerStore.getState().toggleGroup('proj1', 'input')
      expect(useExplorerStore.getState().expandedGroups['group:proj1/input']).toBe(true)
    })

    it('应支持同一项目下多个分组的独立切换', () => {
      useExplorerStore.getState().toggleGroup('proj1', 'input')
      useExplorerStore.getState().toggleGroup('proj1', 'output')
      useExplorerStore.getState().toggleGroup('proj1', 'input')
      const groups = useExplorerStore.getState().expandedGroups
      expect(groups['group:proj1/input']).toBe(false)
      expect(groups['group:proj1/output']).toBe(true)
    })
  })

  describe('toggleDir', () => {
    it('应使用 dir:<scope>/<relativePath> 命名约定存储', () => {
      useExplorerStore.getState().toggleDir('project:proj1', 'output/batch1')
      expect(useExplorerStore.getState().expandedDirs['dir:project:proj1/output/batch1']).toBe(true)
    })

    it('模板作用域应与项目作用域互不干扰', () => {
      useExplorerStore.getState().toggleDir('project:proj1', 'subdir')
      useExplorerStore.getState().toggleDir('template:tmpl1', 'subdir')
      const dirs = useExplorerStore.getState().expandedDirs
      expect(dirs['dir:project:proj1/subdir']).toBe(true)
      expect(dirs['dir:template:tmpl1/subdir']).toBe(true)
    })
  })

  describe('cleanupProject', () => {
    it('应清理该项目在所有展开映射中的相关 key', () => {
      // 准备:在不同映射中放入与 proj1 相关及无关的 key
      useExplorerStore.setState({
        expandedProjects: { proj1: true, proj2: true },
        expandedGroups: { 'group:proj1/input': true, 'group:proj2/output': true },
        expandedDirs: { 'dir:project:proj1/sub': true, 'dir:project:proj2/sub': true },
        expandedOutputProjects: { proj1: true, proj2: true },
        expandedBatches: { 'batch:proj1/b1': true, 'batch:proj2/b1': true },
        projectStructures: { proj1: [], proj2: [] },
        outputBatches: { proj1: [], proj2: [] },
      })

      useExplorerStore.getState().cleanupProject('proj1')

      const s = useExplorerStore.getState()
      // proj1 相关被清理
      expect(s.expandedProjects).not.toHaveProperty('proj1')
      expect(s.expandedGroups).not.toHaveProperty('group:proj1/input')
      expect(s.expandedDirs).not.toHaveProperty('dir:project:proj1/sub')
      expect(s.expandedOutputProjects).not.toHaveProperty('proj1')
      expect(s.expandedBatches).not.toHaveProperty('batch:proj1/b1')
      expect(s.projectStructures).not.toHaveProperty('proj1')
      expect(s.outputBatches).not.toHaveProperty('proj1')
      // proj2 相关被保留
      expect(s.expandedProjects.proj2).toBe(true)
      expect(s.expandedGroups['group:proj2/output']).toBe(true)
      expect(s.expandedDirs['dir:project:proj2/sub']).toBe(true)
      expect(s.expandedOutputProjects.proj2).toBe(true)
      expect(s.expandedBatches['batch:proj2/b1']).toBe(true)
      expect(s.projectStructures.proj2).toEqual([])
      expect(s.outputBatches.proj2).toEqual([])
    })

    it('清理不存在的项目不应报错也不应影响其他状态', () => {
      useExplorerStore.setState({ expandedProjects: { proj1: true } })
      expect(() => useExplorerStore.getState().cleanupProject('nonexistent')).not.toThrow()
      expect(useExplorerStore.getState().expandedProjects.proj1).toBe(true)
    })
  })

  describe('setProjectStructure / setTemplateStructure / setOutputBatches', () => {
    it('应缓存项目结构', () => {
      const structure: FileTreeNode[] = [
        { name: 'src', type: 'directory', path: 'src', children: [] },
      ]
      useExplorerStore.getState().setProjectStructure('proj1', structure)
      expect(useExplorerStore.getState().projectStructures.proj1).toEqual(structure)
    })

    it('应缓存模板结构', () => {
      const structure: FileTreeNode[] = [{ name: 'file.ini', type: 'file', path: 'file.ini' }]
      useExplorerStore.getState().setTemplateStructure('tmpl1', structure)
      expect(useExplorerStore.getState().templateStructures.tmpl1).toEqual(structure)
    })

    it('应缓存输出批次', () => {
      const batches: OutputBatch[] = [{ name: 'batch1', files: [{ name: 'f.xlsx', path: 'proj1/output/batch1/f.xlsx' }] }]
      useExplorerStore.getState().setOutputBatches('proj1', batches)
      expect(useExplorerStore.getState().outputBatches.proj1).toEqual(batches)
    })
  })

  describe('resetAll', () => {
    it('应清空所有展开状态但保留运行时缓存', () => {
      useExplorerStore.setState({
        expandedProjects: { proj1: true },
        expandedGroups: { 'group:proj1/input': true },
        expandedDirs: { 'dir:project:proj1/sub': true },
        collapsedSections: { section1: true },
        projectStructures: { proj1: [] },
      })

      useExplorerStore.getState().resetAll()

      const s = useExplorerStore.getState()
      expect(s.expandedProjects).toEqual({})
      expect(s.expandedGroups).toEqual({})
      expect(s.expandedDirs).toEqual({})
      expect(s.collapsedSections).toEqual({})
      // 运行时缓存不被 resetAll 清理
      expect(s.projectStructures.proj1).toEqual([])
    })
  })
})
