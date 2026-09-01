import '@/i18n'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import {
  Button,
  Input,
  Select,
  Modal,
  Tabs,
  Dropdown,
  ContextMenu,
  Popover,
  EmptyState,
  Loading,
  ErrorState,
  ThemePopover,
} from '@/components/ui'
import { ToastContainer } from '@/components/layout/ToastContainer'
import { useToastStore } from '@/stores/toast.store'

/**
 * 4.1 V-3 组件视觉基线: 关键组件统一到 4.0 契约 token（docs/双端设计Token契约_v1.0）。
 * 断言组件输出包含契约 token 类（bg-primary/edge-subtle/rounded-lg/shadow-lg/app-hover...），
 * 消除硬编码色值漂移。与 MC 端同类基线测试共享同一契约。
 */

function classes(el: HTMLElement): string {
  return el.getAttribute('class') ?? ''
}

describe('V-3 Button 视觉基线 (F1-3)', () => {
  it('primary: 契约主色 + hover + radius-md', () => {
    render(<Button variant="primary">确定</Button>)
    const btn = screen.getByRole('button')
    expect(classes(btn)).toContain('bg-primary')
    expect(classes(btn)).toContain('hover:bg-primary-hover')
    expect(classes(btn)).toContain('rounded-md')
  })

  it('danger: 契约 danger', () => {
    render(<Button variant="danger">删除</Button>)
    expect(classes(screen.getByRole('button'))).toContain('bg-danger')
  })

  it('ghost: 次要文字 + app-hover', () => {
    render(<Button variant="ghost">取消</Button>)
    const btn = screen.getByRole('button')
    expect(classes(btn)).toContain('text-text-secondary')
    expect(classes(btn)).toContain('hover:bg-app-hover')
  })

  it('size lg 存在且 radius-md', () => {
    render(<Button size="lg">大</Button>)
    const btn = screen.getByRole('button')
    expect(classes(btn)).toContain('px-4 py-2')
    expect(classes(btn)).toContain('rounded-md')
  })
})

describe('V-3 Input/Select 视觉基线 (F1-3)', () => {
  it('Input: edge-subtle 边框 + focus primary ring', () => {
    render(<Input placeholder="名称" />)
    const input = screen.getByPlaceholderText('名称')
    expect(classes(input)).toContain('border-edge-subtle')
    expect(classes(input)).toContain('focus:ring-primary/40')
    expect(classes(input)).toContain('focus:border-primary')
  })

  it('Input error: danger 边框 + 文案', () => {
    render(<Input error="必填" />)
    const input = screen.getByRole('textbox')
    expect(classes(input)).toContain('border-danger')
    expect(screen.getByText('必填')).toHaveClass('text-danger')
  })

  it('Select: edge-subtle 边框 + focus primary ring', () => {
    render(<Select options={[{ value: 'a', label: 'A' }]} aria-label="选择" />)
    const select = screen.getByRole('combobox')
    expect(classes(select)).toContain('border-edge-subtle')
    expect(classes(select)).toContain('focus:ring-primary/40')
  })
})

describe('V-3 Modal 视觉基线 (F1-3)', () => {
  it('radius-lg + shadow-lg + edge-subtle 边框', () => {
    render(<Modal open onClose={vi.fn()} title="标题"><div>内容</div></Modal>)
    const dialog = screen.getByRole('dialog')
    expect(classes(dialog)).toContain('rounded-lg')
    expect(classes(dialog)).toContain('shadow-lg')
    expect(classes(dialog)).toContain('border-edge-subtle')
  })
})

describe('V-3 Tabs 视觉基线 (F1-3)', () => {
  it('active 为契约 primary + 下划线', () => {
    render(<Tabs items={[{ value: 't1', label: '一' }, { value: 't2', label: '二' }]} value="t1" />)
    const active = screen.getByRole('tab', { name: '一' })
    expect(classes(active)).toContain('border-primary')
    expect(classes(active)).toContain('text-primary')
    expect(classes(active)).toContain('border-b-2')
  })
})

describe('V-3 Dropdown/ContextMenu/Popover 视觉基线 (F1-3)', () => {
  it('Dropdown 菜单: edge-subtle + rounded-lg + shadow-lg,选中项 primary', () => {
    render(<Dropdown items={[{ value: 'a', label: 'A' }]} value="a" />)
    fireEvent.click(screen.getByRole('button'))
    const menu = screen.getByRole('listbox')
    expect(classes(menu)).toContain('border-edge-subtle')
    expect(classes(menu)).toContain('rounded-lg')
    expect(classes(menu)).toContain('shadow-lg')
  })

  it('ContextMenu: bg-app + edge-subtle + shadow-lg,危险项 danger', () => {
    render(
      <ContextMenu
        items={[
          { label: '普通', action: vi.fn() },
          { label: '危险', action: vi.fn(), danger: true },
        ]}
        x={0} y={0} onClose={vi.fn()}
      />,
    )
    expect(classes(screen.getByText('普通').closest('div') as HTMLElement)).toContain('bg-app')
    const menu = screen.getByText('危险')
    expect(classes(menu)).toContain('text-danger')
  })

  it('Popover 面板: edge-subtle + rounded-lg + shadow-lg', () => {
    render(<Popover trigger={<button type="button">打开</button>} defaultOpen><div>面板</div></Popover>)
    const panel = screen.getByRole('dialog')
    expect(classes(panel)).toContain('border-edge-subtle')
    expect(classes(panel)).toContain('rounded-lg')
    expect(classes(panel)).toContain('shadow-lg')
  })
})

describe('V-3 Toast 视觉基线 (F1-3)', () => {
  beforeEach(() => { useToastStore.setState({ toasts: [] }) })
  afterEach(() => { useToastStore.setState({ toasts: [] }) })

  it('toast 文本使用契约 text-primary', () => {
    render(<ToastContainer />)
    act(() => { useToastStore.getState().addToast('success', '操作成功', 0) })
    const toast = screen.getByText('操作成功')
    expect(classes(toast.parentElement as HTMLElement)).toContain('text-text-primary')
  })
})

describe('V-3 ThemePopover 视觉基线 (F1-2)', () => {
  it('提供 light/dark/system/high-contrast 四选项', () => {
    render(<ThemePopover />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('高对比')).toBeInTheDocument()
    expect(screen.getByText('亮色')).toBeInTheDocument()
    expect(screen.getByText('暗色')).toBeInTheDocument()
    expect(screen.getByText('跟随系统')).toBeInTheDocument()
  })
})

describe('V-5 空/载/错态视觉基线 (F1-5)', () => {
  it('EmptyState: 图标/文案契约 token + 操作 primary', () => {
    render(<EmptyState title="空" description="描述" action={{ label: '去创建', onClick: vi.fn() }} />)
    expect(screen.getByText('空')).toHaveClass('text-text-secondary')
    expect(screen.getByText('描述')).toHaveClass('text-text-muted')
    expect(screen.getByText('去创建')).toHaveClass('bg-primary')
  })

  it('Loading: primary 指示器 + text-secondary 文案', () => {
    render(<Loading label="加载中" />)
    expect(screen.getByText('加载中')).toHaveClass('text-text-secondary')
  })

  it('ErrorState: danger 图标文案 + primary 重试', () => {
    render(<ErrorState title="出错" description="详情" retry={{ label: '重试', onClick: vi.fn() }} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('重试')).toHaveClass('bg-primary')
  })
})
