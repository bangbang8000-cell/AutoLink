/**
 * F2-5（42-e / S-6）：性能仪表盘面板 组件测试
 * - S6-1 关键指标区：内存/操作耗时/渲染耗时/基准对比 一处可查
 * - S6-2 操作耗时可查：已记录操作展示在表格
 * - S6-3 渲染测量点：点击「运行渲染测量」→ 记录并展示渲染操作
 * - S6-4 基准对比：bench_perf.py 达标阈值（≤30s / ≤5s）展示
 */
import '@/i18n'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PerformancePanel } from '@/components/layout/PerformancePanel'
import { recordOp, resetPerf } from '@/utils/perf'

beforeEach(() => {
  resetPerf()
})

describe('PerformancePanel（F2-5 / S-6）', () => {
  it('S6-1 展示内存/操作耗时/渲染耗时/基准对比 关键指标区', () => {
    render(<PerformancePanel />)
    expect(screen.getByText('性能仪表盘')).toBeInTheDocument()
    expect(screen.getByText('内存占用')).toBeInTheDocument()
    expect(screen.getByText('操作耗时')).toBeInTheDocument()
    expect(screen.getByText('渲染耗时')).toBeInTheDocument()
    expect(screen.getByText('性能基准对比')).toBeInTheDocument()
  })

  it('S6-2 已记录的操作耗时可在面板查询', () => {
    recordOp('design', '设计序列化', 120)
    render(<PerformancePanel />)
    expect(screen.getByText('设计序列化')).toBeInTheDocument()
    expect(screen.getByText('120ms')).toBeInTheDocument()
  })

  it('S6-3 点击「运行渲染测量」→ 记录并展示渲染操作', () => {
    render(<PerformancePanel />)
    fireEvent.click(screen.getByText('运行渲染测量'))
    expect(screen.getByText(/合成大列表渲染/)).toBeInTheDocument()
  })

  it('S6-4 基准对比展示 bench_perf.py 达标阈值', () => {
    render(<PerformancePanel />)
    expect(screen.getByText('2048 GPU 设计/渲染')).toBeInTheDocument()
    expect(screen.getByText('225 柜机房落位')).toBeInTheDocument()
    expect(screen.getByText('≤ 30.00s')).toBeInTheDocument()
    expect(screen.getByText('≤ 5.00s')).toBeInTheDocument()
  })

  it('S6-5 清空记录后操作列表为空态提示', () => {
    recordOp('design', '待清空操作', 10)
    render(<PerformancePanel />)
    expect(screen.getByText('待清空操作')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('清空记录'))
    expect(screen.getByText('暂无操作耗时记录（可点击测量）')).toBeInTheDocument()
  })
})
