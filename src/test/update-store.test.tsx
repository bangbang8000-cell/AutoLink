/**
 * AL-U1：update.store 聚合逻辑 + RestartPromptDialog「立即重启/稍后」分支
 *
 * 主进程无 onUpdateStatus，store 在渲染层订阅 preload 4 事件并聚合单一状态机。
 * 这里通过 mock window.electron.app 的 onUpdate* 回调模拟主进程事件。
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useUpdateStore } from '@/stores/update.store'
import { useToastStore } from '@/stores/toast.store'
import { RestartPromptDialog } from '@/components/layout/RestartPromptDialog'

// 捕获主进程事件回调（宽松类型，避免回调签名协变报错）
const handlers: Record<string, any> = {}

function appMock() {
  return (window.electron as unknown as { app: Record<string, unknown> }).app
}

describe('update.store（AL-U1 聚合状态机）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    handlers.onAvailable = undefined
    handlers.onProgress = undefined
    handlers.onDownloaded = undefined
    handlers.onError = undefined

    const app = appMock()
    app.onUpdateAvailable = vi.fn((cb: (d: unknown) => void) => {
      handlers.onAvailable = cb
      return () => {}
    })
    app.onUpdateDownloadProgress = vi.fn((cb: (d: unknown) => void) => {
      handlers.onProgress = cb
      return () => {}
    })
    app.onUpdateDownloaded = vi.fn((cb: () => void) => {
      handlers.onDownloaded = cb
      return () => {}
    })
    app.onUpdateError = vi.fn((cb: (m: string) => void) => {
      handlers.onError = cb
      return () => {}
    })
    app.checkUpdate = vi.fn().mockResolvedValue({ updateAvailable: false })
    app.downloadUpdate = vi.fn().mockResolvedValue(undefined)
    app.quitAndInstall = vi.fn()
    app.openReleasesPage = vi.fn().mockResolvedValue(undefined)

    useUpdateStore.getState().__reset()
    useToastStore.setState({ toasts: [] })
    useUpdateStore.getState().attach()
  })

  afterEach(() => {
    useUpdateStore.getState().__reset()
    vi.useRealTimers()
  })

  it('onUpdateAvailable → status=available + 版本号；启动新版本 toast 全生命周期只弹一次', () => {
    act(() => {
      handlers.onAvailable({ version: '5.5.0', releaseNotes: 'notes' })
    })
    const s = useUpdateStore.getState()
    expect(s.status).toBe('available')
    expect(s.version).toBe('5.5.0')
    expect(s.releaseNotes).toBe('notes')
    expect(useToastStore.getState().toasts.length).toBe(1)

    // 再次触发事件，toast 不应重复（autoNotified 守卫）
    act(() => {
      handlers.onAvailable({ version: '5.5.0', releaseNotes: 'notes' })
    })
    expect(useToastStore.getState().toasts.length).toBe(1)
  })

  it('onUpdateDownloaded → status=downloaded + 自动弹重启框 + success toast', () => {
    act(() => {
      handlers.onDownloaded()
    })
    const s = useUpdateStore.getState()
    expect(s.status).toBe('downloaded')
    expect(s.restartPromptVisible).toBe(true)
    expect(useToastStore.getState().toasts.some((t) => t.type === 'success')).toBe(true)
  })

  it('onUpdateError → status=error 并保留错误信息', () => {
    act(() => {
      handlers.onError('ETIMEDOUT')
    })
    const s = useUpdateStore.getState()
    expect(s.status).toBe('error')
    expect(s.error).toBe('ETIMEDOUT')
  })

  it('onUpdateDownloadProgress → 聚合 percent/transferred/total', () => {
    act(() => {
      handlers.onProgress({ percent: 42.4, transferred: 21 * 1024 * 1024, total: 50 * 1024 * 1024, bytesPerSecond: 5 })
    })
    const s = useUpdateStore.getState()
    expect(s.percent).toBe(42)
    expect(s.transferred).toBe(21 * 1024 * 1024)
    expect(s.total).toBe(50 * 1024 * 1024)
  })

  it('check() 发现更新 → available；无更新 → idle + 「已是最新」3 秒后回落', async () => {
    appMock().checkUpdate = vi.fn().mockResolvedValue({ updateAvailable: true, version: '5.5.0' })
    await act(async () => {
      await useUpdateStore.getState().check()
    })
    expect(useUpdateStore.getState().status).toBe('available')
    expect(useUpdateStore.getState().version).toBe('5.5.0')

    // 无更新路径
    appMock().checkUpdate = vi.fn().mockResolvedValue({ updateAvailable: false })
    await act(async () => {
      await useUpdateStore.getState().check()
    })
    expect(useUpdateStore.getState().status).toBe('idle')
    expect(useUpdateStore.getState().latestJustConfirmed).toBe(true)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(useUpdateStore.getState().latestJustConfirmed).toBe(false)
  })

  it('check() 有 error 结果 → error 态（与"无更新"区分）', async () => {
    appMock().checkUpdate = vi.fn().mockResolvedValue({ updateAvailable: false, error: 'timeout' })
    await act(async () => {
      await useUpdateStore.getState().check()
    })
    expect(useUpdateStore.getState().status).toBe('error')
  })

  it('download() 失败 → error 态', async () => {
    appMock().downloadUpdate = vi.fn().mockRejectedValue(new Error('net'))
    await act(async () => {
      await useUpdateStore.getState().download()
    })
    expect(useUpdateStore.getState().status).toBe('error')
  })
})

describe('RestartPromptDialog（立即重启/稍后分支）', () => {
  beforeEach(() => {
    vi.useRealTimers()
    handlers.onDownloaded = undefined
    const app = appMock()
    app.onUpdateAvailable = vi.fn(() => () => {})
    app.onUpdateDownloadProgress = vi.fn(() => () => {})
    app.onUpdateDownloaded = vi.fn((cb: () => void) => {
      handlers.onDownloaded = cb
      return () => {}
    })
    app.onUpdateError = vi.fn(() => () => {})
    app.quitAndInstall = vi.fn()
    useUpdateStore.getState().__reset()
    useUpdateStore.getState().attach()
  })

  afterEach(() => {
    useUpdateStore.getState().__reset()
  })

  it('下载完成自动弹窗：「稍后」仅关闭且保留右上角重启入口（status 仍 downloaded）', () => {
    render(<RestartPromptDialog />)
    // 触发下载完成事件 → 自动弹窗
    act(() => {
      handlers.onDownloaded()
    })
    expect(screen.getByText('更新已下载完成')).toBeInTheDocument()

    // 点「稍后」
    fireEvent.click(screen.getByText('稍后'))
    expect(useUpdateStore.getState().restartPromptVisible).toBe(false)
    // 状态仍是 downloaded → 右上角入口保留重启安装按钮
    expect(useUpdateStore.getState().status).toBe('downloaded')
    expect(appMock().quitAndInstall).not.toHaveBeenCalled()
  })

  it('「立即重启」→ quitAndInstall 调用并关闭弹窗', () => {
    render(<RestartPromptDialog />)
    // 手动打开弹窗
    act(() => {
      useUpdateStore.getState().setRestartPromptVisible(true)
    })
    expect(screen.getByText('更新已下载完成')).toBeInTheDocument()

    fireEvent.click(screen.getByText('立即重启'))
    expect(appMock().quitAndInstall).toHaveBeenCalledTimes(1)
    expect(useUpdateStore.getState().restartPromptVisible).toBe(false)
  })
})
