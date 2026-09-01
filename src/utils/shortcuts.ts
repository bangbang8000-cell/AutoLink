/**
 * v2.7.3-T1: 全局快捷键映射表(集中管理)
 *
 * App.tsx 通过 matchShortcut 匹配并派发 action
 * ShortcutsDialog 通过 SHORTCUT_GROUPS 生成展示内容
 * 确保对话框列出的快捷键全部可用,无"假"快捷键
 */

export type ShortcutAction =
  | 'undo'
  | 'redo'
  | 'newProject'
  | 'saveConfig'
  | 'preferences'
  | 'toggleSidebar'
  | 'togglePanel'
  | 'view-project'
  | 'view-design'
  | 'view-workbench'
  | 'view-visualization'
  | 'view-aidcPlan'
  | 'view-deviceLibrary'
  | 'view-search'
  | 'view-ai'
  | 'view-cloud'
  | 'closeTab'
  | 'reopenTab'
  | 'showShortcuts'
  | 'openCommandPalette'
  | 'renderCurrentProject'
  | 'exportCurrentProject'

export interface ShortcutDef {
  /** 显示文本,如 "Ctrl+Shift+E" */
  keys: string
  /** 派发的 action id */
  action: ShortcutAction
  /** i18n key 后缀(在 menu.shortcuts 下) */
  descKey: string
  /** i18n key 后缀(在 menu.shortcuts 下,用于分类标题) */
  categoryKey: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** 匹配用的 key(小写) */
  key: string
}

export const SHORTCUT_GROUPS: { categoryKey: string; items: ShortcutDef[] }[] = [
  {
    categoryKey: 'general',
    items: [
      // 4.4 F4-1（共享规范）：Ctrl+Z / Ctrl+Shift+Z 撤销/重做（AL 由设计组件/浏览器原生处理，全局不拦截）
      { keys: 'Ctrl+Z', action: 'undo', descKey: 'undo', categoryKey: 'general', ctrl: true, shift: false, alt: false, key: 'z' },
      { keys: 'Ctrl+Shift+Z', action: 'redo', descKey: 'redo', categoryKey: 'general', ctrl: true, shift: true, alt: false, key: 'z' },
      { keys: 'Ctrl+N', action: 'newProject', descKey: 'newProject', categoryKey: 'general', ctrl: true, shift: false, alt: false, key: 'n' },
      { keys: 'Ctrl+S', action: 'saveConfig', descKey: 'saveConfig', categoryKey: 'general', ctrl: true, shift: false, alt: false, key: 's' },
      { keys: 'Ctrl+,', action: 'preferences', descKey: 'preferences', categoryKey: 'general', ctrl: true, shift: false, alt: false, key: ',' },
    ],
  },
  {
    categoryKey: 'view',
    items: [
      { keys: 'Ctrl+B', action: 'toggleSidebar', descKey: 'toggleFileBrowser', categoryKey: 'view', ctrl: true, shift: false, alt: false, key: 'b' },
      // 4.4 F4-1（共享规范）：Ctrl+` 终端/日志面板（AL 原 Ctrl+J 保留为附加）
      { keys: 'Ctrl+`', action: 'togglePanel', descKey: 'toggleLogPanel', categoryKey: 'view', ctrl: true, shift: false, alt: false, key: '`' },
      { keys: 'Ctrl+J', action: 'togglePanel', descKey: 'toggleLogPanelAlt', categoryKey: 'view', ctrl: true, shift: false, alt: false, key: 'j' },
      // 4.4 F4-1（共享规范）：Ctrl+Enter 渲染当前项目 / Ctrl+E 导出输出
      { keys: 'Ctrl+Enter', action: 'renderCurrentProject', descKey: 'renderCurrentProject', categoryKey: 'view', ctrl: true, shift: false, alt: false, key: 'enter' },
      { keys: 'Ctrl+E', action: 'exportCurrentProject', descKey: 'exportCurrentProject', categoryKey: 'view', ctrl: true, shift: false, alt: false, key: 'e' },
    ],
  },
  {
    categoryKey: 'workspace',
    items: [
      // 4.4 F4-1（共享规范）：Ctrl+Shift+P 项目面板（AL 原 Ctrl+Shift+E 保留为附加）
      { keys: 'Ctrl+Shift+P', action: 'view-project', descKey: 'projectView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'p' },
      { keys: 'Ctrl+Shift+E', action: 'view-project', descKey: 'projectViewAlt', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'e' },
      { keys: 'Ctrl+Shift+D', action: 'view-design', descKey: 'designView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'd' },
      { keys: 'Ctrl+Shift+W', action: 'view-workbench', descKey: 'workbenchView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'w' },
      { keys: 'Ctrl+Shift+V', action: 'view-visualization', descKey: 'visualizationView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'v' },
      { keys: 'Ctrl+Shift+L', action: 'view-deviceLibrary', descKey: 'deviceLibraryView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'l' },
      { keys: 'Ctrl+Shift+F', action: 'view-search', descKey: 'searchView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'f' },
      { keys: 'Ctrl+Shift+A', action: 'view-ai', descKey: 'aiView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'a' },
      { keys: 'Ctrl+Shift+C', action: 'view-cloud', descKey: 'cloudView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'c' },
    ],
  },
  {
    categoryKey: 'tabs',
    items: [
      { keys: 'Ctrl+W', action: 'closeTab', descKey: 'closeTab', categoryKey: 'tabs', ctrl: true, shift: false, alt: false, key: 'w' },
      { keys: 'Ctrl+Shift+T', action: 'reopenTab', descKey: 'reopenTab', categoryKey: 'tabs', ctrl: true, shift: true, alt: false, key: 't' },
    ],
  },
  {
    categoryKey: 'help',
    items: [
      { keys: 'Ctrl+K', action: 'openCommandPalette', descKey: 'openCommandPalette', categoryKey: 'help', ctrl: true, shift: false, alt: false, key: 'k' },
      // 4.4 F4-1（共享规范）：F1 快捷键 Cheatsheet（ShortcutsDialog）
      { keys: 'F1', action: 'showShortcuts', descKey: 'shortcutsRef', categoryKey: 'help', ctrl: false, shift: false, alt: false, key: 'f1' },
    ],
  },
]

/** 所有快捷键的扁平列表 */
export const ALL_SHORTCUTS: ShortcutDef[] = SHORTCUT_GROUPS.flatMap((g) => g.items)

/** AL-M4l: 按 action 取显示按键串（MenuBar/ActivityBar 与 ShortcutsDialog 单源化,消除双源漂移） */
export function shortcutKeys(action: ShortcutAction): string | undefined {
  return ALL_SHORTCUTS.find((s) => s.action === action)?.keys
}

/**
 * 匹配键盘事件,返回对应的快捷键定义
 * 不匹配时返回 null
 */
export function matchShortcut(e: KeyboardEvent): ShortcutDef | null {
  const ctrl = e.ctrlKey || e.metaKey
  for (const def of ALL_SHORTCUTS) {
    if (def.ctrl === ctrl && def.shift === e.shiftKey && def.alt === e.altKey && def.key === e.key.toLowerCase()) {
      return def
    }
  }
  return null
}
