import type { ThemeMode } from '@/stores/ui.store'

export interface ResolvedTheme {
  isDark: boolean
  isHighContrast: boolean
}

/**
 * 4.1 F1-1/F1-2: 由主题模式解析实际生效的亮暗/高对比标记。
 * - light/dark: 显式亮/暗
 * - system: 跟随系统 prefers-color-scheme
 * - high-contrast: 高对比主题(WCAG AA, 亮色底)
 * 该函数与 public/theme-init.js 内联脚本共用同一判定逻辑(无闪变启动),
 * 任何一侧漂移都会破坏"切换无闪变"验收。
 */
export function resolveTheme(theme: ThemeMode, prefersDark: boolean): ResolvedTheme {
  switch (theme) {
    case 'dark':
      return { isDark: true, isHighContrast: false }
    case 'light':
      return { isDark: false, isHighContrast: false }
    case 'high-contrast':
      return { isDark: false, isHighContrast: true }
    case 'system':
    default:
      return { isDark: prefersDark, isHighContrast: false }
  }
}
