import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// 记录实际渲染的 lucide 图标名（vi.mock 提升到模块加载前，UpdatePopover 拿到的即 mock 后的模块）
const renderedIcons: string[] = []
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>()
  return {
    ...actual,
    ArrowUpCircle: () => {
      renderedIcons.push('ArrowUpCircle')
      return <span data-testid="icon-ArrowUpCircle" />
    },
    RefreshCw: () => {
      renderedIcons.push('RefreshCw')
      return <span data-testid="icon-RefreshCw" />
    },
  }
})

import { UpdatePopover } from '@/components/layout/UpdatePopover'

describe('UpdatePopover（AL-UX-1：更新图标对齐 MC 用 RefreshCw）', () => {
  beforeEach(() => {
    renderedIcons.length = 0
    // 补充 setup.ts 未 mock 的 app 事件订阅（可选链下仍会调用，缺了会 TypeError）
    const app = (window.electron as unknown as { app: Record<string, unknown> }).app
    app.onUpdateAvailable = vi.fn(() => vi.fn())
    app.onUpdateDownloadProgress = vi.fn(() => vi.fn())
    app.onUpdateDownloaded = vi.fn(() => vi.fn())
    app.onUpdateError = vi.fn(() => vi.fn())
  })

  it('空闲态渲染 RefreshCw 更新图标（对齐 MC），不再使用 ArrowUpCircle', () => {
    render(<UpdatePopover />)
    expect(renderedIcons).toContain('RefreshCw')
    expect(renderedIcons).not.toContain('ArrowUpCircle')
  })

  it('图标渲染在更新按钮内', () => {
    const { container } = render(<UpdatePopover />)
    const btn = container.querySelector('button')
    expect(btn).not.toBeNull()
    expect(btn!.querySelector('[data-testid="icon-RefreshCw"]')).not.toBeNull()
  })
})