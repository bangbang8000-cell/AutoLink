/**
 * 47-e（F7-5）：安装/升级体验——更新 UI 离线提示 + 完整性校验显示
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { UpdatePopover } from '@/components/layout/UpdatePopover'

describe('UpdatePopover（47-e 安装/升级体验）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const app = (window.electron as unknown as { app: Record<string, unknown> }).app
    app.onUpdateAvailable = vi.fn(() => vi.fn())
    app.onUpdateDownloadProgress = vi.fn(() => vi.fn())
    app.onUpdateDownloaded = vi.fn(() => vi.fn())
    app.onUpdateError = vi.fn(() => vi.fn())
  })

  it('检查失败（网络/离线场景）时展示离线友好提示', async () => {
    const app = (window.electron as unknown as { app: { checkUpdate: ReturnType<typeof vi.fn> } })
      .app
    app.checkUpdate.mockResolvedValue({ updateAvailable: false, error: 'Request timeout' })
    render(<UpdatePopover />)
    // 1. 打开更新弹窗
    fireEvent.click(screen.getByTitle(/更新/))
    // 2. 点击弹窗内「检查更新」按钮触发检查
    fireEvent.click(screen.getByText(/检查更新/))
    await waitFor(() => {
      expect(screen.getByText(/检查更新失败/)).toBeInTheDocument()
    })
    // 47-e：离线场景提示（安装包离线可用）
    expect(screen.getByText(/离线环境/)).toBeInTheDocument()
    // 提供重试入口
    expect(screen.getByText(/重试/)).toBeInTheDocument()
  })

  it('下载完成状态展示完整性校验通过提示（离线可安装）', async () => {
    let onDownloaded: (() => void) | undefined
    const app = (window.electron as unknown as { app: Record<string, unknown> }).app
    app.onUpdateDownloaded = vi.fn((cb: () => void) => {
      onDownloaded = cb
      return () => {}
    })
    render(<UpdatePopover />)
    // 打开更新弹窗（idle 态 → 触发 downloaded 事件后进入 downloaded 态）
    fireEvent.click(screen.getByTitle(/更新/))
    act(() => {
      onDownloaded?.()
    })
    await waitFor(() => {
      expect(screen.getByText(/完整性校验通过/)).toBeInTheDocument()
    })
  })
})
