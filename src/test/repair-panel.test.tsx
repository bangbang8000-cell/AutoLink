/**
 * V3.2.0-T9-4: 智能修复面板测试（校验 → 修复项选择 → 一键应用 → 复核闭环）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@/i18n'
import { RepairPanel } from '@/components/chat/RepairPanel'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'

const sampleFixes = [
  {
    rule_id: 'V010',
    severity: 'error',
    message: '参数网收敛比 3.6:1 严重过高',
    recommendation: '参数网应保持 1:1 无阻塞设计',
    patch: { topology: { param_switch_ports: 128 } },
  },
  {
    rule_id: 'V002',
    severity: 'error',
    message: '机柜 机柜1 功率 8500W 超过机柜上限 6000W',
    recommendation: '提高单柜功率上限或减少机柜内设备',
    patch: { rack_config: { power_limit_per_rack: 9000 } },
  },
]

const sampleReview = {
  valid: true,
  remainingErrors: 0,
  issues: [],
}

describe('RepairPanel', () => {
  beforeEach(() => {
    useProjectStore.setState({ selectedProjectName: 'demo-project' })
    useToastStore.setState({ toasts: [] })
    window.electron = {
      ...window.electron,
      repair: {
        plan: vi.fn().mockResolvedValue({
          success: true,
          fixes: sampleFixes,
          fixable: 2,
          totalErrors: 3,
          valid: false,
          issues: [{ rule_id: 'V008', severity: 'error', message: '需人工处理项', recommendation: '' }],
        }),
        apply: vi.fn().mockResolvedValue({
          success: true,
          applied: [{ rule_id: 'V010', message: '参数网收敛比 3.6:1 严重过高', patch: { topology: { param_switch_ports: 128 } } }],
          skipped: [],
          validation: sampleReview,
        }),
      },
    } as never
  })

  it('空状态展示提示', () => {
    render(<RepairPanel open onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /生成修复方案/ })).toBeTruthy()
    expect(screen.getByText(/校验当前项目，自动给出可一键应用的修复项/)).toBeTruthy()
  })

  it('生成修复方案后渲染修复项并默认全选', async () => {
    render(<RepairPanel open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /生成修复方案/ }))
    await waitFor(() => {
      expect(screen.getByText('参数网收敛比 3.6:1 严重过高')).toBeTruthy()
    })
    expect(screen.getByText(/V010/)).toBeTruthy()
    expect(screen.getByText(/V002/)).toBeTruthy()
    expect(screen.getByText(/校验错误 3 项/)).toBeTruthy()
    expect(screen.getByText(/需人工处理 1 项/)).toBeTruthy()
    expect(screen.getByText('一键修复 (2)')).toBeTruthy()
  })

  it('逐条取消后仅应用选中项', async () => {
    render(<RepairPanel open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /生成修复方案/ }))
    await waitFor(() => {
      expect(screen.getByText('参数网收敛比 3.6:1 严重过高')).toBeTruthy()
    })
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[1]) // 取消 V002
    expect(screen.getByText('一键修复 (1)')).toBeTruthy()
    fireEvent.click(screen.getByText('一键修复 (1)'))
    await waitFor(() => {
      const call = window.electron.repair.apply as ReturnType<typeof vi.fn>
      expect(call).toHaveBeenCalledWith({
        projectName: 'demo-project',
        fixes: [expect.objectContaining({ rule_id: 'V010' })],
      })
    })
  })

  it('应用后展示复核结果（通过）', async () => {
    render(<RepairPanel open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /生成修复方案/ }))
    await waitFor(() => {
      expect(screen.getByText('参数网收敛比 3.6:1 严重过高')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('一键修复 (2)'))
    await waitFor(() => {
      expect(screen.getByText(/复核结果：通过/)).toBeTruthy()
    })
  })
})
