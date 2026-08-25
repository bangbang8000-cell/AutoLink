/**
 * v2.7.3-T1: 全局快捷键映射表(集中管理)
 *
 * App.tsx 通过 matchShortcut 匹配并派发 action
 * ShortcutsDialog 通过 SHORTCUT_GROUPS 生成展示内容
 * 确保对话框列出的快捷键全部可用,无"假"快捷键
 */

export type ShortcutAction =
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
      { keys: 'Ctrl+N', action: 'newProject', descKey: 'newProject', categoryKey: 'general', ctrl: true, shift: false, alt: false, key: 'n' },
      { keys: 'Ctrl+S', action: 'saveConfig', descKey: 'saveConfig', categoryKey: 'general', ctrl: true, shift: false, alt: false, key: 's' },
      { keys: 'Ctrl+,', action: 'preferences', descKey: 'preferences', categoryKey: 'general', ctrl: true, shift: false, alt: false, key: ',' },
    ],
  },
  {
    categoryKey: 'view',
    items: [
      { keys: 'Ctrl+B', action: 'toggleSidebar', descKey: 'toggleFileBrowser', categoryKey: 'view', ctrl: true, shift: false, alt: false, key: 'b' },
      { keys: 'Ctrl+J', action: 'togglePanel', descKey: 'toggleLogPanel', categoryKey: 'view', ctrl: true, shift: false, alt: false, key: 'j' },
    ],
  },
  {
    categoryKey: 'workspace',
    items: [
      // V3.3.1: 全局搜索
      { keys: 'Ctrl+Shift+F', action: 'view-search', descKey: 'searchView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'f' },
      { keys: 'Ctrl+Shift+E', action: 'view-project', descKey: 'projectView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'e' },
      { keys: 'Ctrl+Shift+D', action: 'view-design', descKey: 'designView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'd' },
      { keys: 'Ctrl+Shift+W', action: 'view-workbench', descKey: 'workbenchView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'w' },
      { keys: 'Ctrl+Shift+V', action: 'view-visualization', descKey: 'visualizationView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'v' },
      // 打磨轮（P-A）：AIDC 规划已并入工作台，Ctrl+Shift+P 直达 AIDC 规划子视图
      { keys: 'Ctrl+Shift+P', action: 'view-aidcPlan', descKey: 'aidcPlanView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'p' },
      { keys: 'Ctrl+Shift+L', action: 'view-deviceLibrary', descKey: 'deviceLibraryView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'l' },
      { keys: 'Ctrl+Shift+A', action: 'view-ai', descKey: 'aiView', categoryKey: 'workspace', ctrl: true, shift: true, alt: false, key: 'a' },
      // V3.3.0-T13: 云中心
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
      { keys: 'Ctrl+K', action: 'showShortcuts', descKey: 'shortcutsRef', categoryKey: 'help', ctrl: true, shift: false, alt: false, key: 'k' },
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
