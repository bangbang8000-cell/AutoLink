import '@/i18n'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Modal, ContextMenu, Select, Tabs, Dropdown, Popover } from '@/components/ui'
import { ToastContainer } from '@/components/layout/ToastContainer'
import { useToastStore } from '@/stores/toast.store'

/**
 * G-8 组件行为契约: Modal/Popover/Toast/ContextMenu/Select/Tabs/Dropdown。
 * 行为基准以《双端4.0系列PRD/开发计划 40-f》契约为准,与 MC 行为一致;
 * 覆盖打开/关闭/焦点/ESC 关闭/外部点击/键盘导航等核心行为。
 */

describe('Modal 行为契约 (G-8)', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    onClose.mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.style.overflow = ''
  })

  it('open=true 渲染 dialog 且 aria-modal/role 就位', () => {
    render(<Modal open onClose={onClose} title="测试标题"><div>内容</div></Modal>)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('测试标题')).toBeInTheDocument()
  })

  it('open=false 不渲染', () => {
    render(<Modal open={false} onClose={onClose} title="测试标题"><div>内容</div></Modal>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ESC 关闭(默认 closeOnEsc=true)', () => {
    render(<Modal open onClose={onClose} title="t"><div>内容</div></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closeOnEsc=false 时 ESC 不关闭', () => {
    render(<Modal open onClose={onClose} title="t" closeOnEsc={false}><div>内容</div></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('点击遮罩:默认不关闭,closeOnOverlay=true 时关闭', () => {
    const { container, rerender } = render(<Modal open onClose={onClose} title="t"><div>内容</div></Modal>)
    const overlay = container.firstChild as HTMLElement
    fireEvent.click(overlay)
    expect(onClose).not.toHaveBeenCalled()
    rerender(<Modal open onClose={onClose} title="t" closeOnOverlay><div>内容</div></Modal>)
    fireEvent.click(container.firstChild as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('右上关闭按钮点击触发 onClose', () => {
    render(<Modal open onClose={onClose} title="t"><div>内容</div></Modal>)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('打开后自动聚焦模态内首个可聚焦元素', () => {
    render(<Modal open onClose={onClose} title="t"><div>内容</div></Modal>)
    act(() => { vi.advanceTimersByTime(60) })
    expect(screen.getAllByRole('button')[0]).toHaveFocus()
  })

  it('打开时锁定 body 滚动,关闭后恢复', () => {
    const { rerender } = render(<Modal open onClose={onClose} title="t"><div>内容</div></Modal>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Modal open={false} onClose={onClose} title="t"><div>内容</div></Modal>)
    expect(document.body.style.overflow).toBe('')
  })

  it('title 存在时 dialog 关联 aria-labelledby', () => {
    render(<Modal open onClose={onClose} title="契约标题"><div>内容</div></Modal>)
    const dialog = screen.getByRole('dialog')
    const heading = screen.getByText('契约标题')
    expect(heading.id).toBeTruthy()
    expect(dialog).toHaveAttribute('aria-labelledby', heading.id)
  })
})

describe('Popover 行为契约 (G-8)', () => {
  const trigger = <button type="button">打开</button>

  it('点击触发器切换打开/关闭', () => {
    render(<Popover trigger={trigger}><div>popover 面板</div></Popover>)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByText('打开'))
    expect(screen.getByRole('dialog')).toHaveTextContent('popover 面板')
    fireEvent.click(screen.getByText('打开'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('受控模式:open + onOpenChange,不自行改变打开态', () => {
    const onOpenChange = vi.fn()
    render(<Popover trigger={trigger} open={false} onOpenChange={onOpenChange}><div>面板</div></Popover>)
    fireEvent.click(screen.getByText('打开'))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('点击外部关闭(默认)', () => {
    render(<Popover trigger={trigger} defaultOpen><div>面板</div></Popover>)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closeOnOutside=false 时外部点击不关闭', () => {
    render(<Popover trigger={trigger} defaultOpen closeOnOutside={false}><div>面板</div></Popover>)
    fireEvent.mouseDown(document.body)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('ESC 关闭(默认)', () => {
    render(<Popover trigger={trigger} defaultOpen><div>面板</div></Popover>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closeOnEsc=false 时 ESC 不关闭', () => {
    render(<Popover trigger={trigger} defaultOpen closeOnEsc={false}><div>面板</div></Popover>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('触发器透传 aria-haspopup/aria-expanded', () => {
    render(<Popover trigger={trigger}><div>面板</div></Popover>)
    const btn = screen.getByText('打开')
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('Toast 行为契约 (G-8)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('无 toast 时不渲染容器', () => {
    const { container } = render(<ToastContainer />)
    expect(container.firstChild).toBeNull()
  })

  it('addToast 后渲染消息,关闭按钮可移除', () => {
    render(<ToastContainer />)
    act(() => { useToastStore.getState().addToast('success', '操作成功', 0) })
    expect(screen.getByText('操作成功')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(screen.queryByText('操作成功')).toBeNull()
  })

  it('duration 后自动消失', () => {
    render(<ToastContainer />)
    act(() => { useToastStore.getState().addToast('info', '自动消失', 1000) })
    expect(screen.getByText('自动消失')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(999) })
    expect(screen.getByText('自动消失')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('自动消失')).toBeNull()
  })

  it('悬停暂停自动消失,离开后恢复计时', () => {
    render(<ToastContainer />)
    act(() => { useToastStore.getState().addToast('warning', '悬停暂停', 1000) })
    const toastDiv = screen.getByText('悬停暂停').parentElement as HTMLElement
    fireEvent.mouseEnter(toastDiv)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('悬停暂停')).toBeInTheDocument()
    fireEvent.mouseLeave(toastDiv)
    act(() => { vi.advanceTimersByTime(499) })
    expect(screen.getByText('悬停暂停')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('悬停暂停')).toBeNull()
  })
})

describe('ContextMenu 行为契约 (G-8)', () => {
  const onClose = vi.fn()
  const items = [
    { label: '操作一', action: vi.fn() },
    { label: '禁用项', action: vi.fn(), disabled: true },
    { label: '危险项', action: vi.fn(), danger: true },
  ]

  beforeEach(() => { vi.clearAllMocks() })

  it('按坐标渲染全部菜单项', () => {
    render(<ContextMenu items={items} x={100} y={80} onClose={onClose} />)
    expect(screen.getByText('操作一')).toBeInTheDocument()
    expect(screen.getByText('禁用项')).toBeInTheDocument()
    expect(screen.getByText('危险项')).toBeInTheDocument()
  })

  it('点击菜单项触发 action 并关闭', () => {
    render(<ContextMenu items={items} x={0} y={0} onClose={onClose} />)
    fireEvent.click(screen.getByText('操作一'))
    expect(items[0].action).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('禁用项不可点击(不触发 action 不关闭)', () => {
    render(<ContextMenu items={items} x={0} y={0} onClose={onClose} />)
    const disabledBtn = screen.getByText('禁用项')
    expect(disabledBtn).toBeDisabled()
    fireEvent.click(disabledBtn)
    expect(items[1].action).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ESC 关闭', () => {
    render(<ContextMenu items={items} x={0} y={0} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击外部(mousedown)关闭', () => {
    render(<ContextMenu items={items} x={0} y={0} onClose={onClose} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('分隔线渲染分隔元素', () => {
    const withSep = [
      { label: 'A', action: vi.fn() },
      { separator: true },
      { label: 'B', action: vi.fn() },
    ]
    const { container } = render(<ContextMenu items={withSep} x={0} y={0} onClose={onClose} />)
    expect(container.querySelector('.border-t')).not.toBeNull()
  })
})

describe('Select 行为契约 (G-8)', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ]

  it('渲染 combobox 与全部 option,change 触发 onChange', () => {
    const onChange = vi.fn()
    render(<Select options={options} value="a" onChange={onChange} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalled()
  })

  it('forwardRef 暴露原生 select 引用', () => {
    const ref = vi.fn()
    render(<Select options={options} ref={ref} />)
    expect(ref).toHaveBeenCalled()
    const el = ref.mock.calls[0][0] as HTMLSelectElement
    expect(el.tagName).toBe('SELECT')
  })

  it('disabled 透传到原生 select', () => {
    render(<Select options={options} value="a" disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})

describe('Tabs 行为契约 (G-8)', () => {
  const items = [
    { value: 't1', label: '标签一' },
    { value: 't2', label: '标签二' },
    { value: 't3', label: '标签三', disabled: true },
  ]

  it('aria 角色/选中态/控件关联', () => {
    render(<Tabs items={items} value="t1" />)
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal')
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[0]).toHaveAttribute('aria-controls')
    expect(tabs[0]).toHaveAttribute('id')
  })

  it('键盘 ArrowRight/ArrowLeft 切换', () => {
    const onChange = vi.fn()
    render(
      <Tabs items={[{ value: 't1', label: '一' }, { value: 't2', label: '二' }]} onChange={onChange} />,
    )
    const list = screen.getByRole('tablist')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('t2')
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('t1')
  })

  it('键盘 Home/End 跳首尾', () => {
    const onChange = vi.fn()
    const three = [
      { value: 't1', label: '一' },
      { value: 't2', label: '二' },
      { value: 't3', label: '三' },
    ]
    render(<Tabs items={three} onChange={onChange} />)
    const list = screen.getByRole('tablist')
    fireEvent.keyDown(list, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('t3')
    fireEvent.keyDown(list, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('t1')
  })

  it('禁用 tab 不可选择', () => {
    const onChange = vi.fn()
    render(<Tabs items={items} value="t1" onChange={onChange} />)
    const disabledTab = screen.getByRole('tab', { name: '标签三' })
    expect(disabledTab).toBeDisabled()
    fireEvent.click(disabledTab)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('tabpanel 展示激活内容', () => {
    render(<Tabs items={items} value="t2">{(v) => <div>内容:{v}</div>}</Tabs>)
    expect(screen.getByRole('tabpanel')).toHaveTextContent('内容:t2')
  })
})

describe('Dropdown 行为契约 (G-8)', () => {
  const items = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C', disabled: true },
  ]

  it('点击展开/收起 + aria-expanded', () => {
    render(<Dropdown items={items} placeholder="选择" />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(btn)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('点击外部关闭', () => {
    render(<Dropdown items={items} placeholder="选择" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('ESC 关闭', () => {
    render(<Dropdown items={items} placeholder="选择" />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.keyDown(btn, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('ArrowDown 打开并高亮首项,Enter 确认选择', () => {
    const onChange = vi.fn()
    render(<Dropdown items={items} placeholder="选择" onChange={onChange} />)
    const btn = screen.getByRole('button')
    fireEvent.keyDown(btn, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(btn, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('a')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('禁用项点击不触发选择', () => {
    const onChange = vi.fn()
    render(<Dropdown items={items} placeholder="选择" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    const disabledOpt = screen.getByRole('option', { name: 'C' })
    expect(disabledOpt).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(disabledOpt)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('选中项 option 带 aria-selected', () => {
    render(<Dropdown items={items} value="a" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('option', { name: 'A' })).toHaveAttribute('aria-selected', 'true')
  })
})
