/**
 * 47-c（F7-3）：健康检查面板测试
 * - 运行自检渲染报告（环境 / 引擎 / 网络 / 依赖 + 汇总）
 * - 异常项标记 fail 状态
 * - 导出 JSON 触发 health:export
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { HealthPanel } from '@/components/layout/HealthPanel'
import type { HealthReport } from '@/types/ops'

const okReport: HealthReport = {
  checkedAt: '2026-01-01T00:00:00.000Z',
  env: {
    appVersion: '4.7.0',
    platform: 'win32',
    arch: 'x64',
    node: '22.0.0',
    electron: '28.3.3',
    userData: '/tmp/user',
  },
  items: [
    { id: 'env.os', label: '操作系统', status: 'ok', detail: 'win32 (x64)' },
    { id: 'env.runtime', label: '运行时', status: 'ok', detail: 'Node 22.0.0 · Electron 28.3.3' },
    { id: 'engine.aihub', label: 'AI Hub 引擎', status: 'ok', detail: 'GET /api/chat/health 正常' },
    { id: 'network.cloud', label: '云平台连通', status: 'skip', detail: '未配置云平台服务器地址' },
  ],
  summary: { total: 4, ok: 3, warn: 0, fail: 0, skip: 1 },
}

const failReport: HealthReport = {
  ...okReport,
  items: [
    {
      id: 'engine.aihub',
      label: 'AI Hub 引擎',
      status: 'fail',
      detail: 'GET /api/chat/health 不可用',
    },
  ],
  summary: { total: 1, ok: 0, warn: 0, fail: 1, skip: 0 },
}

describe('HealthPanel（47-c 健康检查）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const health = (
      window.electron as unknown as { health: Record<string, ReturnType<typeof vi.fn>> }
    ).health
    health.run = vi.fn().mockResolvedValue(okReport)
    health.export = vi.fn().mockResolvedValue({ canceled: false, path: '/tmp/health.json' })
  })

  it('自动运行自检并渲染各检查项', async () => {
    render(<HealthPanel />)
    await waitFor(() => {
      expect(screen.getByText('AI Hub 引擎')).toBeInTheDocument()
    })
    expect(screen.getByText(/GET \/api\/chat\/health 正常/)).toBeInTheDocument()
    expect(screen.getByText(/未配置云平台服务器地址/)).toBeInTheDocument()
  })

  it('汇总徽标展示 ok/skip 计数', async () => {
    render(<HealthPanel />)
    await waitFor(() => {
      expect(screen.getAllByText('正常').length).toBeGreaterThanOrEqual(1)
    })
    // 汇总 pill：label + count（跳过 1）
    expect(screen.getByText('跳过 1')).toBeInTheDocument()
  })

  it('异常项展示 fail 状态与原因', async () => {
    const health = (window.electron as unknown as { health: { run: ReturnType<typeof vi.fn> } })
      .health
    health.run.mockResolvedValue(failReport)
    render(<HealthPanel />)
    await waitFor(() => {
      expect(screen.getAllByText('异常').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getByText(/\/api\/chat\/health 不可用/)).toBeInTheDocument()
  })

  it('导出 JSON 触发 health:export（携带报告）', async () => {
    render(<HealthPanel />)
    await waitFor(() => {
      expect(screen.getByText('AI Hub 引擎')).toBeInTheDocument()
    })
    const exportBtn = document.querySelector('[title="导出健康报告 JSON"]')
    expect(exportBtn).not.toBeNull()
    fireEvent.click(exportBtn!)
    await waitFor(() => {
      expect(
        (window.electron as unknown as { health: { export: ReturnType<typeof vi.fn> } }).health
          .export,
      ).toHaveBeenCalled()
    })
    const arg = (window.electron as unknown as { health: { export: ReturnType<typeof vi.fn> } })
      .health.export.mock.calls[0][0]
    expect(arg.summary).toBeDefined()
  })
})
