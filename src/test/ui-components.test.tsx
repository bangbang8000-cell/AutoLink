import '@/i18n'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Tooltip, Dropdown, Tabs } from '@/components/ui'

describe('Tooltip', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('hover 后显示内容(focus 触发)', () => {
    render(
      <Tooltip content="提示文本" delay={0}>
        <button>触发</button>
      </Tooltip>,
    )
    // 初始不可见
    expect(screen.queryByRole('tooltip')).toBeNull()
    // focus 触发
    fireEvent.focus(screen.getByText('触发'))
    act(() => { vi.advanceTimersByTime(10) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('提示文本')
  })

  it('disabled 时不显示', () => {
    render(
      <Tooltip content="提示" disabled delay={0}>
        <button>触发</button>
      </Tooltip>,
    )
    fireEvent.focus(screen.getByText('触发'))
    act(() => { vi.advanceTimersByTime(10) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('Dropdown', () => {
  const items = [
    { value: 'a', label: '选项 A' },
    { value: 'b', label: '选项 B' },
    { value: 'c', label: '选项 C' },
  ]

  it('受控模式:点击选项触发 onChange', () => {
    const onChange = vi.fn()
    render(<Dropdown items={items} value="a" onChange={onChange} />)
    expect(screen.getByText('选项 A')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('选项 B'))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('非受控模式:defaultValue 生效,点击后内部更新', () => {
    render(<Dropdown items={items} defaultValue="a" />)
    expect(screen.getByText('选项 A')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('选项 C'))
    expect(screen.getByText('选项 C')).toBeInTheDocument()
  })

  it('键盘 ArrowDown 打开并选择', () => {
    const onChange = vi.fn()
    render(<Dropdown items={items} onChange={onChange} placeholder="选" />)
    const btn = screen.getByRole('button')
    btn.focus()
    fireEvent.keyDown(btn, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(btn, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('a')
  })
})

describe('Tabs', () => {
  const items = [
    { value: 't1', label: '标签一' },
    { value: 't2', label: '标签二' },
    { value: 't3', label: '标签三' },
  ]

  it('受控模式:渲染激活 tab 内容', () => {
    render(
      <Tabs items={items} value="t2">
        {(v) => <div>当前:{v}</div>}
      </Tabs>,
    )
    expect(screen.getByText('当前:t2')).toBeInTheDocument()
  })

  it('点击 tab 触发 onChange', () => {
    const onChange = vi.fn()
    render(<Tabs items={items} value="t1" onChange={onChange} />)
    fireEvent.click(screen.getByText('标签三'))
    expect(onChange).toHaveBeenCalledWith('t3')
  })

  it('非受控模式:默认第一项,点击切换', () => {
    render(
      <Tabs items={items}>
        {(v) => <div>内容:{v}</div>}
      </Tabs>,
    )
    expect(screen.getByText('内容:t1')).toBeInTheDocument()
    fireEvent.click(screen.getByText('标签二'))
    expect(screen.getByText('内容:t2')).toBeInTheDocument()
  })

  it('键盘 ArrowRight 切换到下一个', () => {
    const onChange = vi.fn()
    render(<Tabs items={items} value="t1" onChange={onChange} />)
    const tablist = screen.getByRole('tablist')
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('t2')
  })
})
