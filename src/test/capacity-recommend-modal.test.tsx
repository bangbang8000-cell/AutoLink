/**
 * V3.1.3-T7-4: 容量规划推荐向导测试（表单/推荐结果/一键应用）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@/i18n'
import { CapacityRecommendModal } from '@/components/capacity/CapacityRecommendModal'

const PRESETS = {
  presets: [
    { id: 'llama3-70b', name: 'Llama 3 70B', model_type: 'dense', num_params: 70e9, context_length: 8192, precision: 'BF16', num_experts: 0 },
    { id: 'deepseek-v3', name: 'DeepSeek-V3', model_type: 'moe', num_params: 671e9, context_length: 131072, precision: 'FP8', num_experts: 256 },
  ],
  total: 2,
}

const RECOMMEND_RESULT = {
  success: true,
  estimated: true,
  estimation: {
    label: '预估值',
    method: '解析法（通信量公式 + 经验规则）',
    accuracy: '±15-20%',
    note: '推荐结果为预估值，最终以实测/厂商规格为准',
  },
  model: { name: 'DeepSeek-V3', model_type: 'moe', num_params_b: 671, context_length: 131072, precision: 'fp8', num_experts: 256 },
  comm: { total_gib: 1253, comm_ratio: 0.5 },
  recommendation: {
    scale_up_protocol: 'NVLink',
    scale_up_domain: 72,
    scale_out_protocol: 'UEC',
    scale_out_speed: '800G',
    convergence_ratio: 1.2,
    tier_count: 2,
    estimated_comm_overhead: 0.5,
  },
  notes: [{ level: 'info', message: 'FP8 训练计算密度 2x，通信占比相对提升' }],
}

const mockListPresets = vi.fn()
const mockRecommend = vi.fn()

beforeEach(() => {
  mockListPresets.mockReset()
  mockRecommend.mockReset()
  ;(window as any).electron.capacity.listPresets = mockListPresets
  ;(window as any).electron.capacity.recommend = mockRecommend
})

describe('CapacityRecommendModal', () => {
  it('打开后加载模型档案并渲染选择器', async () => {
    mockListPresets.mockResolvedValue(PRESETS)
    render(<CapacityRecommendModal open onClose={vi.fn()} onApply={vi.fn()} />)
    expect(await screen.findByText(/Llama 3 70B/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('1024')).toBeInTheDocument()
  })

  it('计算推荐 → 渲染协议/速率/收敛比', async () => {
    mockListPresets.mockResolvedValue(PRESETS)
    mockRecommend.mockResolvedValue(RECOMMEND_RESULT)
    render(<CapacityRecommendModal open onClose={vi.fn()} onApply={vi.fn()} />)
    fireEvent.click(await screen.findByText('计算容量推荐'))
    expect(await screen.findByText(/800G UEC/)).toBeInTheDocument()
    expect(screen.getByText(/收敛比 ≤ 1.2 · 2 层/)).toBeInTheDocument()
    expect(screen.getByText('NVLink (Scale-Up)')).toBeInTheDocument()
    expect(mockRecommend).toHaveBeenCalledWith({ model: 'llama3-70b', numGpus: 1024, budget: 'standard' })
  })

  it('预估值标注（V3.1.3-T7-5）', async () => {
    mockListPresets.mockResolvedValue(PRESETS)
    mockRecommend.mockResolvedValue(RECOMMEND_RESULT)
    render(<CapacityRecommendModal open onClose={vi.fn()} onApply={vi.fn()} />)
    fireEvent.click(await screen.findByText('计算容量推荐'))
    expect(await screen.findByText(/预估值 · 解析法.*误差 ±15-20%/)).toBeInTheDocument()
  })

  it('一键应用 → onApply 收到映射 patch', async () => {
    mockListPresets.mockResolvedValue(PRESETS)
    mockRecommend.mockResolvedValue(RECOMMEND_RESULT)
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<CapacityRecommendModal open onClose={onClose} onApply={onApply} />)
    fireEvent.click(await screen.findByText('计算容量推荐'))
    fireEvent.click(await screen.findByText('一键应用'))
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    const patch = onApply.mock.calls[0][0]
    expect(patch.param_speed).toBe('800G')
    expect(patch.param_protocol).toBe('RoCE') // UEC → RoCE
    expect(patch.num_servers).toBe(128) // 1024 / 8
    expect(onClose).toHaveBeenCalled()
  })

  it('推荐失败 → 显示错误', async () => {
    mockListPresets.mockResolvedValue(PRESETS)
    mockRecommend.mockResolvedValue({ success: false, error: '未知模型预设: xxx' })
    render(<CapacityRecommendModal open onClose={vi.fn()} onApply={vi.fn()} />)
    fireEvent.click(await screen.findByText('计算容量推荐'))
    expect(await screen.findByText('未知模型预设: xxx')).toBeInTheDocument()
  })
})
