/**
 * 4.4 E-1（测试计划）：双端统一快捷键——共享规范 10 标准键 + 附加键
 * 断言 shortcuts.ts 单一映射表对齐共享规范，且 Cheatsheet 列出的快捷键全部可匹配（无假快捷键）。
 */
import { describe, it, expect } from 'vitest'
import { SHORTCUT_GROUPS, ALL_SHORTCUTS, matchShortcut, shortcutKeys } from '@/utils/shortcuts'

function ev(key: string, opts: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    altKey: !!opts.alt,
    metaKey: false,
  } as KeyboardEvent
}

/** 共享快捷键规范（双端一致） */
const STANDARD_KEYS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl+Z', action: 'undo' },
  { keys: 'Ctrl+Shift+Z', action: 'redo' },
  { keys: 'Ctrl+K', action: 'openCommandPalette' },
  { keys: 'Ctrl+B', action: 'toggleSidebar' },
  { keys: 'Ctrl+`', action: 'togglePanel' },
  { keys: 'Ctrl+N', action: 'newProject' },
  { keys: 'Ctrl+Enter', action: 'renderCurrentProject' },
  { keys: 'Ctrl+E', action: 'exportCurrentProject' },
  { keys: 'Ctrl+Shift+P', action: 'view-project' },
  { keys: 'Ctrl+,', action: 'preferences' },
  { keys: 'F1', action: 'showShortcuts' },
]

describe('E-1 双端统一快捷键（共享规范）', () => {
  it('包含共享规范的 11 个标准键（10 组合 + F1 Cheatsheet）且动作正确', () => {
    const byKeys = new Map(ALL_SHORTCUTS.map((s) => [s.keys, s.action]))
    for (const { keys, action } of STANDARD_KEYS) {
      expect(byKeys.get(keys), `缺少标准键 ${keys}`).toBe(action)
    }
  })

  it('Cheatsheet（SHORTCUT_GROUPS）列出的快捷键全部可匹配（无假快捷键）', () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0)
    for (const def of ALL_SHORTCUTS) {
      const m = matchShortcut(ev(def.key, { ctrl: def.ctrl, shift: def.shift, alt: def.alt }))
      expect(m, `快捷键 ${def.keys} 应可匹配`).not.toBeNull()
      expect(m!.action).toBe(def.action)
    }
  })

  it('matchShortcut 正确区分 Ctrl+Z（撤销）与 Ctrl+Shift+Z（重做）', () => {
    expect(matchShortcut(ev('z', { ctrl: true }))?.action).toBe('undo')
    expect(matchShortcut(ev('z', { ctrl: true, shift: true }))?.action).toBe('redo')
  })

  it('Ctrl+K 打开命令面板；F1 打开快捷键参考（Cheatsheet）', () => {
    expect(matchShortcut(ev('k', { ctrl: true }))?.action).toBe('openCommandPalette')
    expect(matchShortcut(ev('F1'))?.action).toBe('showShortcuts')
  })

  it('Ctrl+Enter 渲染当前项目；Ctrl+E 导出/输出当前项目', () => {
    expect(matchShortcut(ev('Enter', { ctrl: true }))?.action).toBe('renderCurrentProject')
    expect(matchShortcut(ev('e', { ctrl: true }))?.action).toBe('exportCurrentProject')
  })

  it('Ctrl+` 切换日志/终端面板；Ctrl+B 切换侧边栏', () => {
    expect(matchShortcut(ev('`', { ctrl: true }))?.action).toBe('togglePanel')
    expect(matchShortcut(ev('b', { ctrl: true }))?.action).toBe('toggleSidebar')
  })

  it('AL 原有个性键保留为附加（Ctrl+J 日志 / Ctrl+Shift+E 项目 / Ctrl+S 保存 / Ctrl+Shift+W 工作台）', () => {
    expect(matchShortcut(ev('j', { ctrl: true }))?.action).toBe('togglePanel')
    expect(matchShortcut(ev('e', { ctrl: true, shift: true }))?.action).toBe('view-project')
    expect(matchShortcut(ev('s', { ctrl: true }))?.action).toBe('saveConfig')
    expect(matchShortcut(ev('w', { ctrl: true, shift: true }))?.action).toBe('view-workbench')
  })

  it('shortcutKeys 单源读取：Ctrl+N / Ctrl+B 可被 MenuBar 复用', () => {
    expect(shortcutKeys('newProject')).toBe('Ctrl+N')
    expect(shortcutKeys('toggleSidebar')).toBe('Ctrl+B')
    expect(shortcutKeys('renderCurrentProject')).toBe('Ctrl+Enter')
  })
})
