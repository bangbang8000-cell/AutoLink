/**
 * 47-b（F7-2）：诊断中心面板测试
 * - 聚合展示系统信息 / 错误日志 / 崩溃 / 审计
 * - 一键导出支持包触发 diag:exportBundle（含性能快照）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { DiagnosticsPanel } from '@/components/layout/DiagnosticsPanel'
import type { DiagnosticsReport } from '@/types/ops'

const sampleReport: DiagnosticsReport = {
  collectedAt: '2026-01-01T00:00:00.000Z',
  system: {
    appVersion: '4.7.0',
    platform: 'win32',
    platformLabel: 'Windows',
    arch: 'x64',
    node: '22.0.0',
    electron: '28.3.3',
    chromium: '120.0.0',
    osRelease: '10.0.26200',
    cpus: 8,
    totalMemMB: 16384,
    freeMemMB: 8192,
    userData: '/tmp/user',
    freeDiskMB: 10240,
  },
  errorsLog: {
    path: '/tmp/user/logs/errors.log',
    exists: true,
    entries: ['[2026-01-01T00:00:00.000Z] [tag] error line 1'],
  },
  audit: {
    path: '/tmp/user/audit/cli-audit.jsonl',
    entries: [{ ts: '2026-01-01T00:00:00', action: 'design', ok: true }],
  },
  crashes: {
    crashpadDir: '/tmp/user/Crashpad',
    dumpFiles: ['pending/a.dmp'],
    rendererGoneCount: 0,
  },
  telemetry: { path: '/tmp/user/telemetry/telemetry.jsonl', entries: [], enabled: false },
}

describe('DiagnosticsPanel（47-b 诊断中心）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const diag = (window.electron as unknown as { diag: Record<string, ReturnType<typeof vi.fn>> })
      .diag
    diag.collect = vi.fn().mockResolvedValue(sampleReport)
    diag.exportBundle = vi.fn().mockResolvedValue({ canceled: false, path: '/tmp/bundle.zip' })
  })

  it('渲染系统信息（应用版本/操作系统/运行时）', async () => {
    render(<DiagnosticsPanel />)
    await waitFor(() => {
      expect(screen.getByText('4.7.0')).toBeInTheDocument()
    })
    expect(screen.getByText(/Windows \(x64\)/)).toBeInTheDocument()
    expect(screen.getByText(/Electron 28\.3\.3/)).toBeInTheDocument()
  })

  it('展示错误日志与崩溃 dump 记录', async () => {
    render(<DiagnosticsPanel />)
    await waitFor(() => {
      expect(screen.getByText(/error line 1/)).toBeInTheDocument()
    })
    expect(screen.getByText(/a\.dmp/)).toBeInTheDocument()
  })

  it('展示审计记录 action', async () => {
    render(<DiagnosticsPanel />)
    await waitFor(() => {
      expect(screen.getByText('design')).toBeInTheDocument()
    })
  })

  it('点击「导出支持包」调用 diag:exportBundle（自动携带性能快照）', async () => {
    render(<DiagnosticsPanel />)
    await waitFor(() => {
      expect(screen.getByText(/导出支持包/)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(/导出支持包/))
    await waitFor(() => {
      expect(
        (window.electron as unknown as { diag: { exportBundle: ReturnType<typeof vi.fn> } }).diag
          .exportBundle,
      ).toHaveBeenCalled()
    })
    const arg = (window.electron as unknown as { diag: { exportBundle: ReturnType<typeof vi.fn> } })
      .diag.exportBundle.mock.calls[0][0]
    expect(arg).toHaveProperty('collectedAt')
  })
})
