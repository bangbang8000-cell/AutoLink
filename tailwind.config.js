/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 4.0 契约语义色 (docs/双端设计Token契约_v1.0): 单源 CSS 变量,亮/暗共用
        primary: {
          // color.primary #2F6FED / color.primary-hover #1E5BC9
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          hover: 'rgb(var(--primary-hover) / <alpha-value>)',
          // v3.2.1-T10-1: primary 品牌色阶改为 CSS 变量驱动(默认 sky 蓝),支持 data-accent 主题色切换
          50: 'rgb(var(--primary-50) / <alpha-value>)',
          100: 'rgb(var(--primary-100) / <alpha-value>)',
          200: 'rgb(var(--primary-200) / <alpha-value>)',
          300: 'rgb(var(--primary-300) / <alpha-value>)',
          400: 'rgb(var(--primary-400) / <alpha-value>)',
          500: 'rgb(var(--primary-500) / <alpha-value>)',
          600: 'rgb(var(--primary-600) / <alpha-value>)',
          700: 'rgb(var(--primary-700) / <alpha-value>)',
          800: 'rgb(var(--primary-800) / <alpha-value>)',
          900: 'rgb(var(--primary-900) / <alpha-value>)',
        },
        // 契约语义色: success #16A34A / warning #F59E0B / danger #DC2626 / info #0EA5E9
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        // 既有 error 色阶(组件大量使用 text-error-*/bg-error-*),保留
        error: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        // 契约语义色 danger #DC2626 (与 error-600 同值)
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        info: {
          DEFAULT: 'rgb(var(--info) / <alpha-value>)',
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        purple: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
        },
        // v2.7.3-T5: 语义色阶 (CSS 变量驱动,亮暗自动适配)
        app: {
          DEFAULT: 'rgb(var(--app-bg) / <alpha-value>)',
          surface: 'rgb(var(--app-surface) / <alpha-value>)',
          elevated: 'rgb(var(--app-elevated) / <alpha-value>)',
          hover: 'rgb(var(--app-hover) / <alpha-value>)',
        },
        edge: {
          subtle: 'rgb(var(--edge-subtle) / <alpha-value>)',
          DEFAULT: 'rgb(var(--edge-default) / <alpha-value>)',
        },
        // 4.0 契约文本色 (契约 §2)
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
        },
      },
      // 4.0 契约圆角 (契约 §3)
      borderRadius: {
        'token': 'var(--radius-sm)', // 6px
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      // 4.0 契约阴影 (契约 §4)
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      // v2.6.8: 字号 token, 最小 10px 提升可读性
      // 4.0 契约字号 (契约 §7): xs=12 / md=14 / lg=16
      fontSize: {
        '3xs': ['10px', '13px'],
        '2xs': ['11px', '15px'],
        xs: ['var(--font-size-xs)', '1rem'],
        md: ['var(--font-size-md)', '1.25rem'],
        lg: ['var(--font-size-lg)', '1.375rem'],
      },
      // 4.0 契约字体 (契约 §7)
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"Segoe UI"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
      // 4.0 契约动效 (契约 §6)
      transitionDuration: {
        fast: 'var(--motion-fast)',
        normal: 'var(--motion-normal)',
        slow: 'var(--motion-slow)',
      },
      transitionTimingFunction: {
        standard: 'var(--motion-ease)',
      },
    },
  },
  plugins: [typography],
}
