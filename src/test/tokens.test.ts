import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * G-7 token 单源: AL(src/style.css + tailwind.config.js) 实现值 = 契约值。
 * 事实源: docs/双端设计Token契约_v1.0_2026-08-29.md (唯一事实源, 双端按此实现)
 * 语义色/中性色以 hex 记录契约值, 断言 style.css 中的 RGB 通道三元组与之等价;
 * 圆角/阴影/间距/动效/字体断言原始实现值。任何一侧漂移即失败。
 */
const REPO_ROOT = process.cwd()
const styleCss = readFileSync(path.join(REPO_ROOT, 'src/style.css'), 'utf-8')
const tailwindConfig = readFileSync(path.join(REPO_ROOT, 'tailwind.config.js'), 'utf-8')

/** 提取 CSS 变量 --name 的声明值(首个匹配);name 含 '--' 前缀 */
function cssVar(css: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`)
  const m = css.match(re)
  return m ? m[1].trim() : null
}

/** #RRGGBB -> "R G B" 通道三元组(与 style.css 存储格式一致) */
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`非法 hex: ${hex}`)
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

// —— 契约值（来自 双端设计Token契约_v1.0_2026-08-29.md）——
const CONTRACT_SEMANTIC: Record<string, string> = {
  '--primary': '#2F6FED', // color.primary 主操作/强调
  '--primary-hover': '#1E5BC9', // color.primary-hover
  '--success': '#16A34A', // color.success
  '--warning': '#F59E0B', // color.warning
  '--danger': '#DC2626', // color.danger
  '--info': '#0EA5E9', // color.info
}

const CONTRACT_NEUTRAL_LIGHT: Record<string, string> = {
  '--app-bg': '#FFFFFF', // color.app
  '--app-surface': '#F6F7F9', // color.app-surface
  '--app-hover': '#ECEEF2', // color.app-hover
  '--edge-subtle': '#E4E7EB', // color.edge-subtle
  '--text-primary': '#1A2027', // color.text-primary
  '--text-secondary': '#5A6472', // color.text-secondary
  '--text-muted': '#8A94A2', // color.text-muted
}

const CONTRACT_NEUTRAL_DARK: Record<string, string> = {
  '--app-bg': '#0F141A', // color.app
  '--app-surface': '#161C23', // color.app-surface
  '--app-hover': '#1E2730', // color.app-hover
  '--edge-subtle': '#2A3540', // color.edge-subtle
  '--text-primary': '#E6EAF0', // color.text-primary
  '--text-secondary': '#9AA5B1', // color.text-secondary
  '--text-muted': '#6B7683', // color.text-muted
}

const CONTRACT_RADIUS: Record<string, string> = {
  '--radius-sm': '6px',
  '--radius-md': '8px',
  '--radius-lg': '12px',
}

const CONTRACT_SHADOW: Record<string, string> = {
  '--shadow-sm': '0 1px 2px rgba(16,24,40,.06)',
  '--shadow-md': '0 4px 12px rgba(16,24,40,.10)',
  '--shadow-lg': '0 12px 32px rgba(16,24,40,.14)',
}

const CONTRACT_SPACING: Record<string, string> = {
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-6': '24px',
  '--space-8': '32px',
}

const CONTRACT_MOTION: Record<string, string> = {
  '--motion-fast': '120ms',
  '--motion-normal': '200ms',
  '--motion-slow': '320ms',
  '--motion-ease': 'cubic-bezier(.2,.8,.2,1)',
}

const CONTRACT_FONT: Record<string, string> = {
  '--font-sans': "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  '--font-mono': "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  '--font-size-xs': '12px',
  '--font-size-md': '14px',
  '--font-size-lg': '16px',
}

/** 校验一组 CSS 变量实现值 = 契约值 */
function assertVarGroup(group: Record<string, string>, toExpected: (v: string) => string) {
  for (const [name, contract] of Object.entries(group)) {
    it(`${name} 实现值 = 契约值`, () => {
      expect(cssVar(styleCss, name)).toBe(toExpected(contract))
    })
  }
}

describe('4.0 Design Token 契约单源 (G-7)', () => {
  describe('语义色 (契约 §1, hex 等价 RGB 通道三元组)', () => {
    assertVarGroup(CONTRACT_SEMANTIC, hexToRgb)
  })

  describe('中性色 · Light (契约 §2)', () => {
    assertVarGroup(CONTRACT_NEUTRAL_LIGHT, hexToRgb)
  })

  describe('中性色 · Dark (契约 §2)', () => {
    // 暗色 token 只应在 .dark 块内生效,须在 .dark 作用域内取实现值断言
    const darkBlock = styleCss.match(/\.dark\s*{([^}]*)}/)?.[1] ?? ''
    for (const [name, contract] of Object.entries(CONTRACT_NEUTRAL_DARK)) {
      it(`${name} 实现值 = 契约值 (作用域 .dark)`, () => {
        expect(cssVar(darkBlock, name)).toBe(hexToRgb(contract))
      })
    }

    it('暗色 token 必须作用域在 .dark 块内', () => {
      for (const name of Object.keys(CONTRACT_NEUTRAL_DARK)) {
        expect(darkBlock).toContain(`${name}:`)
      }
    })
  })

  describe('圆角 (契约 §3)', () => {
    assertVarGroup(CONTRACT_RADIUS, (v) => v)
  })

  describe('阴影 (契约 §4)', () => {
    assertVarGroup(CONTRACT_SHADOW, (v) => v)
  })

  describe('间距 (契约 §5, 4px 基数)', () => {
    assertVarGroup(CONTRACT_SPACING, (v) => v)
  })

  describe('动效 (契约 §6)', () => {
    assertVarGroup(CONTRACT_MOTION, (v) => v)
  })

  describe('字体 (契约 §7)', () => {
    assertVarGroup(CONTRACT_FONT, (v) => v)
  })

  describe('Tailwind 映射一致 (契约 §8)', () => {
    const colorMappings: Array<[string, string]> = [
      ['primary.DEFAULT', 'var(--primary)'],
      ['primary.hover', 'var(--primary-hover)'],
      ['success.DEFAULT', 'var(--success)'],
      ['danger.DEFAULT', 'var(--danger)'],
      ['warning.DEFAULT', 'var(--warning)'],
      ['info.DEFAULT', 'var(--info)'],
      ['text.primary', 'var(--text-primary)'],
      ['text.secondary', 'var(--text-secondary)'],
      ['text.muted', 'var(--text-muted)'],
      ['app.DEFAULT', 'var(--app-bg)'],
      ['app.surface', 'var(--app-surface)'],
      ['app.hover', 'var(--app-hover)'],
      ['edge.subtle', 'var(--edge-subtle)'],
    ]
    for (const [label, cssVarRef] of colorMappings) {
      it(`colors.${label} 映射到 ${cssVarRef}`, () => {
        expect(tailwindConfig).toContain(cssVarRef)
      })
    }

    it('borderRadius 映射契约圆角变量', () => {
      expect(tailwindConfig).toContain('var(--radius-sm)')
      expect(tailwindConfig).toContain('var(--radius-md)')
      expect(tailwindConfig).toContain('var(--radius-lg)')
    })

    it('boxShadow 映射契约阴影变量', () => {
      expect(tailwindConfig).toContain('var(--shadow-sm)')
      expect(tailwindConfig).toContain('var(--shadow-md)')
      expect(tailwindConfig).toContain('var(--shadow-lg)')
    })

    it('transitionDuration/transitionTimingFunction 映射契约动效变量', () => {
      expect(tailwindConfig).toContain('var(--motion-fast)')
      expect(tailwindConfig).toContain('var(--motion-normal)')
      expect(tailwindConfig).toContain('var(--motion-slow)')
      expect(tailwindConfig).toContain('var(--motion-ease)')
    })

    it('fontFamily 对齐契约字体栈(中/等宽)', () => {
      expect(tailwindConfig).toContain('system-ui')
      expect(tailwindConfig).toContain('"Microsoft YaHei"')
      expect(tailwindConfig).toContain('"JetBrains Mono"')
      expect(tailwindConfig).toContain('"Cascadia Code"')
    })

    it('fontSize 映射契约字号变量 (xs/md/lg)', () => {
      expect(tailwindConfig).toContain('var(--font-size-xs)')
      expect(tailwindConfig).toContain('var(--font-size-md)')
      expect(tailwindConfig).toContain('var(--font-size-lg)')
    })
  })
})
