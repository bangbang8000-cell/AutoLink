import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 4.1 V-4 品牌资产: 启动(splash)/About/徽标(logo)/字体统一到品牌契约。
 * - 主色 primary(#2F6FED, docs/双端设计Token契约 §1)驱动品牌视觉
 * - 产品名 AutoLink、版本号、字体栈(契约 §7)对齐
 */
const REPO_ROOT = process.cwd()
const read = (p: string) => readFileSync(path.join(REPO_ROOT, p), 'utf-8')

const indexHtml = read('index.html')
const splashHtml = read('public/splash.html')
const logoSvg = read('public/icons/logo.svg')
const aboutDialog = read('src/components/layout/AboutDialog.tsx')
const tailwindConfig = read('tailwind.config.js')

// i18n 五语言
const LANG_FILES = [
  'zh-CN', 'en', 'ja', 'ko', 'zh-TW',
].map((code) => ({ code, json: JSON.parse(read(`src/i18n/resources/${code}/common.json`)) }))

const CONTRACT_PRIMARY = '#2F6FED'
const CONTRACT_PRIMARY_HOVER = '#1E5BC9'

describe('V-4 品牌资产 (F1-4)', () => {
  describe('产品名/版本', () => {
    it('index.html 标题为 AutoLink', () => {
      expect(indexHtml).toContain('<title>AutoLink</title>')
    })

    it('About 使用 i18n 产品名 app.title（AutoLink）与 logo 资产', () => {
      expect(aboutDialog).toContain("t('app.title')")
      expect(aboutDialog).toContain('icons/logo.svg')
    })

    it('About 展示版本号(appVersion)与版权', () => {
      expect(aboutDialog).toContain('appVersion')
      expect(aboutDialog).toContain('about.copyright')
    })

    it('启动页显示产品名 AutoLink 与版本号容器', () => {
      expect(splashHtml).toContain('AutoLink')
      expect(splashHtml).toContain('versionText')
      expect(splashHtml).toContain("'v' + info.version")
    })
  })

  describe('徽标（logo）对齐契约 primary', () => {
    it('logo.svg 使用契约主色与 hover 色', () => {
      expect(logoSvg).toContain(CONTRACT_PRIMARY)
      expect(logoSvg).toContain(CONTRACT_PRIMARY_HOVER)
    })

    it('启动页内联 logo 使用契约 primary', () => {
      expect(splashHtml).toContain(CONTRACT_PRIMARY)
      expect(splashHtml).toContain(CONTRACT_PRIMARY_HOVER)
    })
  })

  describe('字体栈（契约 §7）', () => {
    it('tailwind fontFamily.sans 为契约系统 UI 栈', () => {
      expect(tailwindConfig).toContain('system-ui')
      expect(tailwindConfig).toContain('"Segoe UI"')
      expect(tailwindConfig).toContain('"Microsoft YaHei"')
    })

    it('tailwind fontFamily.mono 为契约等宽栈', () => {
      expect(tailwindConfig).toContain('"JetBrains Mono"')
      expect(tailwindConfig).toContain('Consolas')
    })

    it('启动页字体栈与契约一致', () => {
      expect(splashHtml).toContain('system-ui, -apple-system')
      expect(splashHtml).toContain("'Segoe UI'")
      expect(splashHtml).toContain("'Microsoft YaHei'")
    })
  })

  describe('i18n 主题文案（五语言 theme.highContrast）', () => {
    for (const { code, json } of LANG_FILES) {
      it(`${code} 包含 theme.highContrast 与 theme.title`, () => {
        expect(json.theme?.highContrast).toBeTruthy()
        expect(json.theme?.title).toBeTruthy()
      })
    }
  })
})
