import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveTheme } from '@/utils/theme'
import { useUIStore } from '@/stores/ui.store'

/**
 * 4.1 测试:
 * - V-1 主题切换 light/dark/system(+high-contrast): 无闪变(启动脚本先于 React 应用主题) + 持久化(zustand persist)
 * - V-2 高对比主题: 可切换 + WCAG AA 对比度达标(style.css .high-contrast 断言)
 */
const REPO_ROOT = process.cwd()
const styleCss = readFileSync(path.join(REPO_ROOT, 'src/style.css'), 'utf-8')
const indexHtml = readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf-8')
const themeInitJs = readFileSync(path.join(REPO_ROOT, 'public/theme-init.js'), 'utf-8')

function cssVar(css: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`)
  const m = css.match(re)
  return m ? m[1].trim() : null
}

/** "R G B" 三元组字符串 -> [r,g,b] */
function tripletToRgb(t: string): [number, number, number] {
  const [r, g, b] = t.split(/\s+/).map(Number)
  return [r, g, b]
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG 2.x 对比度 */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// jsdom 无 matchMedia,setTheme(system) 依赖它
function mockMatchMedia(matches: boolean) {
  const mm = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mm),
  })
}

describe('V-1 主题切换 (F1-1)', () => {
  beforeEach(() => {
    localStorage.clear()
    mockMatchMedia(false)
    useUIStore.setState({
      theme: 'system',
      isDark: false,
      isHighContrast: false,
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  describe('resolveTheme 解析（与启动脚本同一判定）', () => {
    it('light → 亮色非高对比', () => {
      expect(resolveTheme('light', true)).toEqual({ isDark: false, isHighContrast: false })
    })
    it('dark → 暗色非高对比', () => {
      expect(resolveTheme('dark', false)).toEqual({ isDark: true, isHighContrast: false })
    })
    it('system → 跟随系统 prefers-color-scheme', () => {
      expect(resolveTheme('system', true)).toEqual({ isDark: true, isHighContrast: false })
      expect(resolveTheme('system', false)).toEqual({ isDark: false, isHighContrast: false })
    })
    it('high-contrast → 高对比(亮色底)非暗色', () => {
      expect(resolveTheme('high-contrast', true)).toEqual({ isDark: false, isHighContrast: true })
    })
  })

  describe('持久化', () => {
    it('setTheme 后 theme 持久化到 localStorage', () => {
      useUIStore.getState().setTheme('dark')
      const persisted = JSON.parse(localStorage.getItem('autolink-ui-state') as string)
      expect(persisted.state.theme).toBe('dark')
    })

    it('setTheme(high-contrast) 后持久化且 isHighContrast 生效', () => {
      useUIStore.getState().setTheme('high-contrast')
      const s = useUIStore.getState()
      expect(s.theme).toBe('high-contrast')
      expect(s.isHighContrast).toBe(true)
      const persisted = JSON.parse(localStorage.getItem('autolink-ui-state') as string)
      expect(persisted.state.theme).toBe('high-contrast')
    })

    it('重载后按持久化 theme 推导 isDark/isHighContrast（模拟 App 挂载 setTheme）', () => {
      useUIStore.getState().setTheme('high-contrast')
      const persisted = JSON.parse(localStorage.getItem('autolink-ui-state') as string)
      // 模拟新会话: 重置状态后从持久化恢复
      useUIStore.setState({ theme: 'system', isDark: false, isHighContrast: false })
      useUIStore.getState().setTheme(persisted.state.theme)
      const s = useUIStore.getState()
      expect(s.theme).toBe('high-contrast')
      expect(s.isDark).toBe(false)
      expect(s.isHighContrast).toBe(true)
    })

    it('toggleTheme: 高对比下切换回到亮色', () => {
      useUIStore.getState().setTheme('high-contrast')
      useUIStore.getState().toggleTheme()
      const s = useUIStore.getState()
      expect(s.theme).toBe('light')
      expect(s.isHighContrast).toBe(false)
    })
  })

  describe('无闪变启动（theme-init.js 先于 React 应用主题）', () => {
    it('index.html 在渲染前加载 /theme-init.js', () => {
      expect(indexHtml).toContain('/theme-init.js')
      const scriptTag = /<script src="\/theme-init\.js"><\/script>/.exec(indexHtml)
      expect(scriptTag).not.toBeNull()
      // 必须在模块脚本之前(首帧前)
      const initPos = indexHtml.indexOf('/theme-init.js')
      const modulePos = indexHtml.indexOf('/src/main.tsx')
      expect(initPos).toBeGreaterThan(-1)
      expect(modulePos).toBeGreaterThan(initPos)
    })

    it('theme-init.js 读取持久化键并应用 dark/high-contrast class 与 data-accent', () => {
      expect(themeInitJs).toContain('autolink-ui-state')
      expect(themeInitJs).toContain("classList.add('dark')")
      expect(themeInitJs).toContain("classList.add('high-contrast')")
      expect(themeInitJs).toContain('setAttribute(\'data-accent\'')
      expect(themeInitJs).toContain("prefers-color-scheme")
    })

    it('theme-init.js 判定逻辑与 resolveTheme 一致（system 跟随系统 / HC 独立）', () => {
      // 脚本片段语义: dark = theme==='dark' || (theme==='system' && media dark)
      expect(themeInitJs).toContain("theme === 'dark' || (theme === 'system' &&")
      expect(themeInitJs).toContain("theme === 'high-contrast'")
    })
  })
})

describe('V-2 高对比主题 WCAG AA (F1-2)', () => {
  const hcBlock = styleCss.match(/\.high-contrast\s*{([^}]*)}/)?.[1] ?? ''
  const bgHex = () => tripletToRgb(cssVar(hcBlock, '--app-bg') ?? '255 255 255')

  function hcContrast(varName: string): number {
    const fg = tripletToRgb(cssVar(hcBlock, varName) ?? '0 0 0')
    return contrast(fg, bgHex())
  }

  it('style.css 存在 .high-contrast 主题块', () => {
    expect(hcBlock).toContain('--text-primary:')
    expect(hcBlock).toContain('--edge-subtle:')
    expect(hcBlock).toContain('--focus-ring-width:')
  })

  it('text-primary 对比度 ≥ 7:1（AAA 级,远超 AA 4.5:1）', () => {
    expect(hcContrast('--text-primary')).toBeGreaterThanOrEqual(7)
  })

  it('text-secondary 对比度 ≥ 4.5:1（AA 正文）', () => {
    expect(hcContrast('--text-secondary')).toBeGreaterThanOrEqual(4.5)
  })

  it('text-muted 对比度 ≥ 4.5:1（AA 弱化文字）', () => {
    expect(hcContrast('--text-muted')).toBeGreaterThanOrEqual(4.5)
  })

  it('edge-subtle 边框对比度 ≥ 3:1（UI 组件边界）', () => {
    expect(hcContrast('--edge-subtle')).toBeGreaterThanOrEqual(3)
  })

  it('focus ring 加宽为 3px（常规 2px）', () => {
    expect(cssVar(hcBlock, '--focus-ring-width')).toBe('3px')
    expect(cssVar(styleCss, '--focus-ring-width')).toBe('2px')
  })

  it('高对比不是常规亮色的复刻（text-muted 对比显著提升）', () => {
    const hcMuted = hcContrast('--text-muted')
    const lightBlock = styleCss.match(/:root\s*{[\s\S]*?--text-muted:\s*([^;]+);/)?.[1] ?? ''
    const lightMuted = tripletToRgb(lightBlock.trim())
    const lightBg = tripletToRgb(cssVar(styleCss, '--app-bg') ?? '255 255 255')
    const lightContrast = contrast(lightMuted, lightBg)
    expect(hcMuted).toBeGreaterThan(lightContrast)
  })
})
