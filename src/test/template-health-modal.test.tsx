import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@/i18n'
import { TemplateHealthModal } from '@/components/layout/TemplateHealthModal'

const mockHealthCheck = vi.fn()

beforeEach(() => {
  mockHealthCheck.mockReset()
  // setup.ts 已 mock window.electron，这里补充 template.healthCheck
  ;(window as unknown as { electron: { template: { healthCheck: typeof mockHealthCheck } } }).electron.template = {
    healthCheck: mockHealthCheck,
  }
})

const HEALTHY_RESULT = {
  checked: 16,
  healthyCount: 16,
  unhealthy: [],
}

const UNHEALTHY_RESULT = {
  checked: 16,
  healthyCount: 14,
  unhealthy: [
    {
      id: 'broken-tpl',
      name: 'broken-tpl',
      isBuiltin: false,
      issues: [
        { type: 'missing_json', detail: '缺少 project_config.json（仅含 INI，无法预览/完整校验）' },
      ],
    },
    {
      id: 'H100-100台',
      name: 'H100-100台',
      isBuiltin: true,
      issues: [
        { type: 'unresolved_ref', detail: 'device_refs.param_leaf_switch 引用的设备不存在: xxx' },
      ],
    },
  ],
}

describe('TemplateHealthModal', () => {
  it('全部健康时展示成功横幅', async () => {
    mockHealthCheck.mockResolvedValue(HEALTHY_RESULT)
    render(<TemplateHealthModal onClose={vi.fn()} />)
    expect(await screen.findByText('所有模板均健康')).toBeInTheDocument()
  })

  it('存在异常时展示汇总与异常清单', async () => {
    mockHealthCheck.mockResolvedValue(UNHEALTHY_RESULT)
    render(<TemplateHealthModal onClose={vi.fn()} />)
    expect(await screen.findByText(/共检查 16 个模板/)).toBeInTheDocument()
    expect(screen.getByText('broken-tpl')).toBeInTheDocument()
    expect(screen.getByText('缺少 project_config.json')).toBeInTheDocument()
    // 内置模板徽标
    expect(screen.getByText('内置')).toBeInTheDocument()
    expect(screen.getByText('选型引用失效')).toBeInTheDocument()
  })

  it('健康检查失败时展示错误', async () => {
    mockHealthCheck.mockRejectedValue(new Error('Python 进程超时'))
    render(<TemplateHealthModal onClose={vi.fn()} />)
    expect(await screen.findByText(/Python 进程超时/)).toBeInTheDocument()
  })

  it('点击关闭回调 onClose', async () => {
    mockHealthCheck.mockResolvedValue(HEALTHY_RESULT)
    const onClose = vi.fn()
    render(<TemplateHealthModal onClose={onClose} />)
    fireEvent.click(await screen.findByText('关闭'))
    expect(onClose).toHaveBeenCalled()
  })
})
