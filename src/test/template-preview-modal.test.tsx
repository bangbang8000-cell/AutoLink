import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@/i18n'
import { TemplatePreviewModal } from '@/components/layout/TemplatePreviewModal'

const mockPreview = vi.fn()

beforeEach(() => {
  mockPreview.mockReset()
  // setup.ts 已 mock window.electron，这里补充 template.preview
  ;(window as unknown as { electron: { template: { preview: typeof mockPreview } } }).electron.template = {
    preview: mockPreview,
  }
})

const VALID_SUMMARY = {
  numServers: 128,
  numGpuServers: 128,
  paramLeafCount: 16,
  paramSpineCount: 4,
  paramCoreCount: 0,
  storageLeafCount: 4,
  storageSpineCount: 0,
  paramSpeed: '400G',
  storageSpeed: '200G',
  paramProtocol: 'IB',
  totalRacks: 40,
  totalPowerWatts: 1500000,
  valid: true,
  errors: [],
  convergence: [{ networkType: 'param', convergenceRatio: 2 }],
}

describe('TemplatePreviewModal', () => {
  it('成功时展示统计摘要（服务器/机柜/交换机）', async () => {
    mockPreview.mockResolvedValue({ success: true, summary: VALID_SUMMARY })
    render(
      <TemplatePreviewModal
        template={{ id: 't1', name: 'T1' }}
        onClose={vi.fn()}
        onCreateProject={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    // 等待 preview resolve
    expect(await screen.findByText('128')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    // 校验通过横幅
    expect(screen.getByText('拓扑校验通过')).toBeInTheDocument()
  })

  it('noConfig 时展示明确提示（不静默）', async () => {
    mockPreview.mockResolvedValue({ success: false, error: 'template.noConfig' })
    render(
      <TemplatePreviewModal
        template={{ id: 't1', name: 'T1' }}
        onClose={vi.fn()}
        onCreateProject={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    expect(await screen.findByText(/project_config\.json/)).toBeInTheDocument()
  })

  it('校验失败时展示错误列表', async () => {
    mockPreview.mockResolvedValue({
      success: true,
      summary: { ...VALID_SUMMARY, valid: false, errors: ['端口溢出: sw-1', '收敛比不达标'] },
    })
    render(
      <TemplatePreviewModal
        template={{ id: 't1', name: 'T1' }}
        onClose={vi.fn()}
        onCreateProject={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    expect(await screen.findByText(/端口溢出: sw-1/)).toBeInTheDocument()
  })

  it('点击"基于此模板创建项目"回调模板名', async () => {
    mockPreview.mockResolvedValue({ success: true, summary: VALID_SUMMARY })
    const onCreateProject = vi.fn()
    render(
      <TemplatePreviewModal
        template={{ id: 't1', name: 'T1' }}
        onClose={vi.fn()}
        onCreateProject={onCreateProject}
        onEdit={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByText('基于此模板创建项目'))
    await waitFor(() => expect(onCreateProject).toHaveBeenCalledWith('t1'))
  })

  it('点击"去编辑"回调模板名与内置标记', async () => {
    mockPreview.mockResolvedValue({ success: true, summary: VALID_SUMMARY })
    const onEdit = vi.fn()
    render(
      <TemplatePreviewModal
        template={{ id: 't1', name: 'T1', isBuiltin: true }}
        onClose={vi.fn()}
        onCreateProject={vi.fn()}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(await screen.findByText('去编辑'))
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('t1', true))
  })
})
