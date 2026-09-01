/**
 * 4.3 F3-1a（测试计划 A-1）：命令面板——打开/搜索/执行命令可用
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommandPalette } from '@/components/ui/CommandPalette'
import { buildCommandPaletteCommands } from '@/utils/commands'
import { useProjectStore } from '@/stores/project.store'

function makeCommands() {
  return [
    { id: 'a', label: '新建项目', category: '项目', action: vi.fn() },
    { id: 'b', label: '机房设计', category: '设计', action: vi.fn() },
    { id: 'c', label: '导出当前项目', category: '项目', action: vi.fn() },
  ]
}

describe('CommandPalette 组件（A-1）', () => {
  it('关闭时不渲染', () => {
    render(<CommandPalette open={false} onClose={vi.fn()} commands={makeCommands()} />)
    expect(screen.queryByPlaceholderText(/输入命令/)).toBeNull()
  })

  it('打开时显示全部命令', () => {
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />)
    expect(screen.getByText('新建项目')).toBeInTheDocument()
    expect(screen.getByText('机房设计')).toBeInTheDocument()
    expect(screen.getByText('导出当前项目')).toBeInTheDocument()
  })

  it('按 label 搜索过滤', () => {
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />)
    fireEvent.change(screen.getByPlaceholderText(/输入命令/), { target: { value: '设计' } })
    expect(screen.getByText('机房设计')).toBeInTheDocument()
    expect(screen.queryByText('新建项目')).toBeNull()
    expect(screen.queryByText('导出当前项目')).toBeNull()
  })

  it('按 category 搜索过滤', () => {
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />)
    fireEvent.change(screen.getByPlaceholderText(/输入命令/), { target: { value: '项目' } })
    expect(screen.getByText('新建项目')).toBeInTheDocument()
    expect(screen.getByText('导出当前项目')).toBeInTheDocument()
    expect(screen.queryByText('机房设计')).toBeNull()
  })

  it('Enter 执行选中命令并触发 onClose', () => {
    const commands = makeCommands()
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} commands={commands} />)
    fireEvent.keyDown(screen.getByPlaceholderText(/输入命令/), { key: 'Enter' })
    expect(commands[0].action).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ArrowDown 移动选择后 Enter 执行第二项', () => {
    const commands = makeCommands()
    render(<CommandPalette open onClose={vi.fn()} commands={commands} />)
    const input = screen.getByPlaceholderText(/输入命令/)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(commands[1].action).toHaveBeenCalledTimes(1)
  })

  it('点击命令项执行', () => {
    const commands = makeCommands()
    render(<CommandPalette open onClose={vi.fn()} commands={commands} />)
    fireEvent.click(screen.getByText('机房设计'))
    expect(commands[1].action).toHaveBeenCalledTimes(1)
  })

  it('Escape 关闭', () => {
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} commands={makeCommands()} />)
    fireEvent.keyDown(screen.getByPlaceholderText(/输入命令/), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('无匹配时显示空态', () => {
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />)
    fireEvent.change(screen.getByPlaceholderText(/输入命令/), { target: { value: 'zzz' } })
    expect(screen.getByText(/未找到匹配的命令/)).toBeInTheDocument()
  })
})

describe('buildCommandPaletteCommands 注册表（A-1）', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [{ id: 1, name: 'P1', index: 0 }],
      templates: [{ id: 'T1', name: 'T1', description: '', scenario: '', tags: [], updatedAt: '' }],
    } as never)
  })

  it('返回本地化命令，覆盖项目/设计/模板/常用，含动态项目/模板子命令', () => {
    const t = (key: string) => key
    const cmds = buildCommandPaletteCommands(t as never)
    const ids = new Set(cmds.map((c) => c.id))
    // 项目
    expect(ids.has('project.new')).toBe(true)
    expect(ids.has('project.render')).toBe(true)
    expect(ids.has('project.export')).toBe(true)
    expect(ids.has('project.open.P1')).toBe(true)
    // 设计
    expect(ids.has('design.room')).toBe(true)
    expect(ids.has('design.rack')).toBe(true)
    expect(ids.has('design.snapshot')).toBe(true)
    // 模板（动态：预览 + 基于模板创建）
    expect(ids.has('template.preview.T1')).toBe(true)
    expect(ids.has('template.create.T1')).toBe(true)
    // 常用
    expect(ids.has('common.ai')).toBe(true)
    expect(ids.has('common.settings')).toBe(true)
    expect(ids.has('common.shortcuts')).toBe(true)
    // 快捷键标注
    expect(cmds.find((c) => c.id === 'project.new')?.shortcut).toBe('Ctrl+N')
  })

  it('命令 label 使用本地化 key（类别/动作），命令 id 唯一', () => {
    const t = (key: string) => `[${key}]`
    const cmds = buildCommandPaletteCommands(t as never)
    expect(cmds[0].category).toBe('[common:commandPalette.categories.project]')
    const ids = cmds.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
