/**
 * V3.2.0-T9-3: 批量优化面板测试（建议生成 → 全选/逐条 → 批量应用闭环）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@/i18n'
import { BatchOptimizePanel } from '@/components/chat/BatchOptimizePanel'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'

const sampleSuggestions = [
  {
    category: 'convergence',
    categoryLabel: '收敛比',
    title: '参数网收敛比优化',
    description: '参数网收敛比 3.6:1 超过目标 1.0:1',
    patch: { topology: { param_switch_ports: 128 } },
    impact: '参数网上行端口增大，缓解拥塞',
  },
  {
    category: 'cost',
    categoryLabel: '成本',
    title: '参数网协议降档（IB → RoCE）',
    description: 'GPU 服务器仅 8 台，IB 成本高企',
    patch: { topology: { param_protocol: 'RoCE' } },
    impact: '参数网硬件成本显著下降',
  },
  {
    category: 'thermal',
    categoryLabel: '散热',
    title: '冷却方式与功率密度匹配',
    description: '推荐 air 冷却，当前配置 immersion',
    patch: { rack_config: { cooling_method: 'air' } },
    impact: '散热方式切换为 air',
  },
]

describe('BatchOptimizePanel', () => {
  beforeEach(() => {
    useProjectStore.setState({ selectedProjectName: 'demo-project' })
    useToastStore.setState({ toasts: [] })
    window.electron = {
      ...window.electron,
      optimize: {
        suggest: vi.fn().mockResolvedValue({
          success: true,
          suggestions: sampleSuggestions,
          total: 3,
          counts: { convergence: 1, cost: 1, thermal: 1 },
        }),
        apply: vi.fn().mockResolvedValue({
          success: true,
          applied: [{ category: 'convergence', title: '参数网收敛比优化', patch: { topology: { param_switch_ports: 128 } } }],
        }),
      },
    } as never
  })

  it('空状态展示提示', () => {
    render(<BatchOptimizePanel open onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /生成建议/ })).toBeTruthy()
    expect(screen.getByText(/分析当前项目的收敛比/)).toBeTruthy()
  })

  it('生成建议后按类别渲染并默认全选', async () => {
    render(<BatchOptimizePanel open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /生成建议/ }))
    await waitFor(() => {
      expect(screen.getByText('参数网收敛比优化')).toBeTruthy()
    })
    expect(screen.getAllByText(/收敛比/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/成本/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/散热/).length).toBeGreaterThan(0)
    expect(screen.getByText(/已选 3 条/)).toBeTruthy()
    expect(screen.getByText('应用选中 (3)')).toBeTruthy()
  })

  it('逐条取消后应用仅选中项', async () => {
    render(<BatchOptimizePanel open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /生成建议/ }))
    await waitFor(() => {
      expect(screen.getByText('参数网收敛比优化')).toBeTruthy()
    })
    // 取消第 1、3 条，只保留第 2 条（成本）
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[2])
    expect(screen.getByText(/已选 1 条/)).toBeTruthy()
    fireEvent.click(screen.getByText('应用选中 (1)'))
    await waitFor(() => {
      const call = window.electron.optimize.apply as ReturnType<typeof vi.fn>
      expect(call).toHaveBeenCalledWith({
        projectName: 'demo-project',
        suggestions: [expect.objectContaining({ title: '参数网协议降档（IB → RoCE）' })],
      })
    })
  })

  it('全选/全不选切换', async () => {
    render(<BatchOptimizePanel open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /生成建议/ }))
    await waitFor(() => {
      expect(screen.getByText('参数网收敛比优化')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('全不选'))
    expect(screen.getByText(/已选 0 条/)).toBeTruthy()
    fireEvent.click(screen.getByText('全选'))
    expect(screen.getByText(/已选 3 条/)).toBeTruthy()
  })
})
