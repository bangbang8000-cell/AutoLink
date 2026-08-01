import { describe, it, expect, beforeEach } from 'vitest'
import { useRenderStore, type RenderResult, type OutputType } from '@/stores/render.store'

describe('RenderStore', () => {
  beforeEach(() => {
    useRenderStore.setState({
      progress: { status: 'idle', message: '', progress: 0 },
      results: [],
      selectedOutputTypes: ['connections', 'rackTable', 'topology', 'deviceList'],
      batchMode: false,
      batchProjects: [],
    })
  })

  describe('初始状态', () => {
    it('progress 应为 idle 且进度为 0', () => {
      const { progress } = useRenderStore.getState()
      expect(progress.status).toBe('idle')
      expect(progress.message).toBe('')
      expect(progress.progress).toBe(0)
      expect(progress.error).toBeUndefined()
    })

    it('默认选中四种输出类型', () => {
      expect(useRenderStore.getState().selectedOutputTypes).toEqual([
        'connections',
        'rackTable',
        'topology',
        'deviceList',
      ])
    })

    it('批次模式默认关闭且批次项目为空', () => {
      expect(useRenderStore.getState().batchMode).toBe(false)
      expect(useRenderStore.getState().batchProjects).toEqual([])
    })
  })

  describe('setProgress', () => {
    it('应部分更新 progress 并保留其他字段', () => {
      useRenderStore.getState().setProgress({ status: 'rendering', message: '正在渲染...' })
      const { progress } = useRenderStore.getState()
      expect(progress.status).toBe('rendering')
      expect(progress.message).toBe('正在渲染...')
      expect(progress.progress).toBe(0) // 未更新字段保留
    })

    it('应支持更新进度数值', () => {
      useRenderStore.getState().setProgress({ progress: 50 })
      expect(useRenderStore.getState().progress.progress).toBe(50)
    })

    it('应支持设置错误状态', () => {
      useRenderStore.getState().setProgress({ status: 'error', error: '渲染失败', progress: 30 })
      const { progress } = useRenderStore.getState()
      expect(progress.status).toBe('error')
      expect(progress.error).toBe('渲染失败')
      expect(progress.progress).toBe(30)
    })
  })

  describe('resetProgress', () => {
    it('应将 progress 重置为初始 idle 状态', () => {
      useRenderStore.setState({
        progress: { status: 'error', message: 'err', progress: 99, error: '失败' },
      })
      useRenderStore.getState().resetProgress()
      expect(useRenderStore.getState().progress).toEqual({ status: 'idle', message: '', progress: 0 })
    })
  })

  describe('addResult / clearResults', () => {
    it('addResult 应追加到结果列表', () => {
      const r1: RenderResult = { type: 'connections', file: '/o/a.xlsx', status: 'success', timestamp: 't1' }
      const r2: RenderResult = { type: 'rackTable', file: '/o/b.xlsx', status: 'success', timestamp: 't2' }
      useRenderStore.getState().addResult(r1)
      useRenderStore.getState().addResult(r2)
      expect(useRenderStore.getState().results).toEqual([r1, r2])
    })

    it('clearResults 应清空结果列表', () => {
      useRenderStore.getState().addResult({ type: 'connections', file: '/o/a.xlsx', status: 'success', timestamp: 't1' })
      useRenderStore.getState().clearResults()
      expect(useRenderStore.getState().results).toEqual([])
    })

    it('addResult 应保留错误结果以供错误处理展示', () => {
      const errResult: RenderResult = { type: 'topology', file: '', status: 'error', error: '导出失败', timestamp: 't1' }
      useRenderStore.getState().addResult(errResult)
      expect(useRenderStore.getState().results[0].status).toBe('error')
      expect(useRenderStore.getState().results[0].error).toBe('导出失败')
    })
  })

  describe('toggleOutputType', () => {
    it('已选中的类型再次调用应移除', () => {
      useRenderStore.getState().toggleOutputType('connections')
      expect(useRenderStore.getState().selectedOutputTypes).not.toContain('connections')
      // 其他类型保留
      expect(useRenderStore.getState().selectedOutputTypes).toContain('rackTable')
    })

    it('未选中的类型调用应添加', () => {
      // 先移除 bom(默认未选中)
      const before = useRenderStore.getState().selectedOutputTypes
      expect(before).not.toContain('bom')
      useRenderStore.getState().toggleOutputType('bom' as OutputType)
      expect(useRenderStore.getState().selectedOutputTypes).toContain('bom')
    })
  })

  describe('批次模式', () => {
    it('setBatchMode 应切换批次模式开关', () => {
      useRenderStore.getState().setBatchMode(true)
      expect(useRenderStore.getState().batchMode).toBe(true)
      useRenderStore.getState().setBatchMode(false)
      expect(useRenderStore.getState().batchMode).toBe(false)
    })

    it('setBatchProjects 应直接替换批次项目列表', () => {
      useRenderStore.getState().setBatchProjects(['p1', 'p2'])
      expect(useRenderStore.getState().batchProjects).toEqual(['p1', 'p2'])
    })

    it('toggleBatchProject 应添加未存在的项目', () => {
      useRenderStore.getState().toggleBatchProject('p1')
      expect(useRenderStore.getState().batchProjects).toContain('p1')
    })

    it('toggleBatchProject 应移除已存在的项目', () => {
      useRenderStore.getState().setBatchProjects(['p1', 'p2'])
      useRenderStore.getState().toggleBatchProject('p1')
      expect(useRenderStore.getState().batchProjects).toEqual(['p2'])
    })
  })
})
