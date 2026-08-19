import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sun, Moon, Monitor, Globe, Palette,
  Cpu, Wifi, Download, Search,
  Upload, RotateCcw, Check,
  Sparkles, Star, Eye, EyeOff, RefreshCw, Wifi as WifiIcon, ScrollText, Cloud,
} from 'lucide-react'
import clsx from 'clsx'
import { useUIStore, type ThemeMode, type AccentColor, type AIConfig } from '@/stores/ui.store'
import { useCloudStore } from '@/stores/cloud.store'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useToastStore } from '@/stores/toast.store'
import { LoginDialog } from '@/components/cloud/LoginDialog'
import { Toggle } from '@/components/ui/Toggle'
import { SettingsSection, SettingsRow, INPUT_CLASS } from '@/components/ui/SettingsRow'

/* ================================================== */
/*  SettingsExplorer — two-column layout              */
/* ================================================== */
// 打磨轮（v1.2 复核）：设置精简为必要分类——移除 output/keyboard/deviceLibrary/explorer/data/configPresets/about
// （输出→项目默认、数据→诊断、资源管理器分组→项目浏览器、配置预设→设计工作台、关于→About 对话框）
const SETTINGS_CATEGORIES = [
  { key: 'appearance', label: 'appearance', icon: Palette },
  { key: 'language', label: 'language', icon: Globe },
  { key: 'projectDefaults', label: 'projectDefaults', icon: Cpu },
  { key: 'network', label: 'network', icon: Wifi },
  // V3.1.1-T5-5: AI 对话配置
  { key: 'ai', label: 'ai', icon: Sparkles },
  // V3.1.1-T5-7: 诊断（CLI 能力 + 命令审计 + 数据导出/重置）
  { key: 'diagnostics', label: 'diagnostics', icon: ScrollText },
  // V3.3.0-T13: 云平台（服务器地址 + 登录）
  { key: 'cloud', label: 'cloud', icon: Cloud },
] as const

type SettingsCategory = typeof SETTINGS_CATEGORIES[number]['key']

// V3.0.4-T3-4: 各设置分组对应的 localStorage keys（用于"重置本组为默认"）
const GROUP_LOCALSTORAGE_KEYS: Record<string, string[]> = {
  appearance: ['autolink-font-size', 'autolink-animations'],
  language: [],
  projectDefaults: ['autolink-default-rack', 'autolink-default-power', 'autolink-default-port-speed'],
  output: ['autolink-output-format', 'autolink-output-dir', 'autolink-autosave-interval'],
  keyboard: [],
  deviceLibrary: ['autolink-device-data-dir', 'autolink-device-auto-update', 'autolink-device-tab-reuse'],
  network: ['autolink-auto-update-check', 'autolink-proxy-host', 'autolink-proxy-port'],
  explorer: [],
  data: [],
  configPresets: [],
  ai: [],
  cloud: [],
  about: [],
}

export function SettingsExplorer() {
  const { t } = useTranslation()
  const [activeCat, setActiveCat] = useState<SettingsCategory>('appearance')
  // V3.0.4-T3-4: 设置搜索（过滤分类）
  const [search, setSearch] = useState('')
  const keyword = search.trim().toLowerCase()
  const visibleCats = SETTINGS_CATEGORIES.filter((cat) => {
    if (!keyword) return true
    const label = t(`common:explorer.settings.categories.${cat.label}`).toLowerCase()
    return label.includes(keyword) || cat.key.toLowerCase().includes(keyword)
  })

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('common:explorer.settings.title')}</span>
      </div>
      {/* V3.0.4-T3-4: 搜索框 */}
      <div className="px-3 py-1.5 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app">
          <Search size={12} className="text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('common:explorer.settings.searchPlaceholder')}
            className="w-full text-xs bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-400"
          />
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden">
        {/* Left: category nav */}
        <div className="w-36 shrink-0 border-r border-gray-200 dark:border-edge-subtle overflow-auto py-1">
          {visibleCats.map((cat) => {
            const Icon = cat.icon
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCat(cat.key)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left',
                  activeCat === cat.key
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-l-2 border-l-primary-500'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover/50 border-l-2 border-l-transparent',
                )}
              >
                <Icon size={13} />
                <span>{t(`common:explorer.settings.categories.${cat.label}`)}</span>
              </button>
            )
          })}
        </div>

        {/* Right: content */}
        <div className="flex-1 overflow-auto">
          <div className="p-3">
            {activeCat === 'appearance' && <AppearanceSettings />}
            {activeCat === 'language' && <LanguageSettings />}
            {activeCat === 'projectDefaults' && <ProjectDefaultsSettings />}
            {activeCat === 'network' && <NetworkSettings />}
            {activeCat === 'ai' && <AISettings />}
            {activeCat === 'diagnostics' && <DiagnosticsSettings />}
            {activeCat === 'cloud' && <CloudSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- sub-components ---------- */

/* 1. Appearance */
function AppearanceSettings() {
  const { t } = useTranslation()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  // V3.2.1-T10-1: 品牌主题色
  const accent = useUIStore((s) => s.accent)
  const setAccent = useUIStore((s) => s.setAccent)
  const [fontSize, setFontSize] = useLocalStorage('autolink-font-size', 14)
  const [animations, setAnimations] = useLocalStorage('autolink-animations', true)

  // v2.7.3-T11: 实时应用外观设置(启动时由 App.tsx 应用,此处处理用户交互)
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`)
  }, [fontSize])
  useEffect(() => {
    document.documentElement.classList.toggle('motion-off', !animations)
  }, [animations])

  return (
    <SettingsSection title={t('common:explorer.settings.appearance.title')}>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('common:explorer.settings.appearance.themeMode')}</label>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {([{ mode: 'light' as ThemeMode, icon: <Sun size={13} />, label: t('common:explorer.settings.appearance.light') },
           { mode: 'dark' as ThemeMode, icon: <Moon size={13} />, label: t('common:explorer.settings.appearance.dark') },
           { mode: 'system' as ThemeMode, icon: <Monitor size={13} />, label: t('common:explorer.settings.appearance.system') },
        ]).map((item) => (
          <button
            key={item.mode}
            onClick={() => setTheme(item.mode)}
            className={`flex flex-col items-center gap-0.5 py-2 rounded border text-2xs transition-colors
              ${theme === item.mode
                ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'}`}
          >
            {item.icon}{item.label}
          </button>
        ))}
      </div>

      {/* V3.2.1-T10-1: 品牌主题色 */}
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('common:explorer.settings.appearance.accentColor')}</label>
      <div className="flex gap-1.5 mb-3">
        {([
          { key: 'sky' as AccentColor, hex: '#3B82F6' },
          { key: 'emerald' as AccentColor, hex: '#10B981' },
          { key: 'violet' as AccentColor, hex: '#8B5CF6' },
          { key: 'rose' as AccentColor, hex: '#F43F5E' },
        ]).map((item) => (
          <button
            key={item.key}
            onClick={() => setAccent(item.key)}
            aria-label={item.key}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all border-2
              ${accent === item.key ? 'border-gray-700 dark:border-gray-200 scale-110' : 'border-transparent hover:scale-105'}`}
            style={{ backgroundColor: item.hex }}
          >
            {accent === item.key && <Check size={13} className="text-white drop-shadow" strokeWidth={3} />}
          </button>
        ))}
      </div>

      <SettingsRow label={t('common:explorer.settings.appearance.fontSize')}>
        <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}
          className={INPUT_CLASS}>
          {[12, 13, 14, 16, 18].map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
      </SettingsRow>

      <SettingsRow label={t('common:explorer.settings.appearance.animations')}>
        <Toggle checked={animations} onChange={setAnimations} />
      </SettingsRow>
      <GroupReset group="appearance" />
    </SettingsSection>
  )
}

/* 2. Language */
function LanguageSettings() {
  const { t, i18n } = useTranslation()
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)

  return (
    <SettingsSection title={t('common:explorer.settings.languageTitle')}>
      {[
        { code: 'zh-CN', label: '简体中文' },
        { code: 'en', label: 'English' },
        { code: 'ja', label: '日本語' },
        { code: 'ko', label: '한국어' },
        { code: 'zh-TW', label: '繁體中文' },
      ].map((lang) => (
        <button
          key={lang.code}
          onClick={() => { setLanguage(lang.code); i18n.changeLanguage(lang.code) }}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded border transition-colors
            ${language === lang.code
              ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
              : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300'}`}
        >
          {lang.label}
          {language === lang.code && <Check size={13} className="text-gray-400" />}
        </button>
      ))}
    </SettingsSection>
  )
}

/* 3. Project Defaults */
function ProjectDefaultsSettings() {
  const { t } = useTranslation()
  const [defaultRack, setDefaultRack] = useLocalStorage('autolink-default-rack', 42)
  const [defaultPowerLimit, setDefaultPowerLimit] = useLocalStorage('autolink-default-power', 6000)
  const [defaultPortSpeed, setDefaultPortSpeed] = useLocalStorage('autolink-default-port-speed', '400G')
  // 打磨轮（v1.2 复核）：输出偏好并入项目默认（移除自定义输出目录——输出默认=项目 output 目录）
  const [defaultFormat, setDefaultFormat] = useLocalStorage('autolink-output-format', 'xlsx')
  const [autoSaveInterval, setAutoSaveInterval] = useLocalStorage('autolink-autosave-interval', 5)

  return (
    <SettingsSection title={t('common:explorer.settings.projectDefaults.title')}>
      <SettingsRow label={t('common:explorer.settings.projectDefaults.defaultRackType')}>
        <select value={defaultRack} onChange={(e) => setDefaultRack(Number(e.target.value))}
          className={INPUT_CLASS}>
          <option value={42}>42U</option>
          <option value={49}>49U</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.projectDefaults.defaultPowerLimit')}>
        <input type="number" value={defaultPowerLimit}
          onChange={(e) => setDefaultPowerLimit(Number(e.target.value))}
          className={clsx('w-20', INPUT_CLASS)} />
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.projectDefaults.defaultPortSpeed')}>
        <select value={defaultPortSpeed} onChange={(e) => setDefaultPortSpeed(e.target.value)}
          className={INPUT_CLASS}>
          {['100G', '200G', '400G', '800G'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.output.defaultFormat')}>
        <select value={defaultFormat} onChange={(e) => setDefaultFormat(e.target.value)}
          className={INPUT_CLASS}>
          <option value="xlsx">{t('common:explorer.settings.output.formatExcel')}</option>
          <option value="csv">{t('common:explorer.settings.output.formatCsv')}</option>
          <option value="png">{t('common:explorer.settings.output.formatPng')}</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.output.autoSaveInterval')}>
        <input type="number" value={autoSaveInterval} min={1} max={60}
          onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
          className={clsx('w-16', INPUT_CLASS)} />
      </SettingsRow>
    </SettingsSection>
  )
}

/* 4. Output */

/* 5. Keyboard Shortcuts */

/* 6. Device Library */

/* 7. Network */
function NetworkSettings() {
  const { t } = useTranslation()
  const [autoCheck, setAutoCheck] = useLocalStorage('autolink-auto-update-check', true)
  const [proxyHost, setProxyHost] = useLocalStorage('autolink-proxy-host', '')
  const [proxyPort, setProxyPort] = useLocalStorage('autolink-proxy-port', '')

  return (
    <SettingsSection title={t('common:explorer.settings.network.title')}>
      <SettingsRow label={t('common:explorer.settings.network.autoCheckUpdate')}>
        <Toggle checked={autoCheck} onChange={setAutoCheck} />
      </SettingsRow>
      <SettingsRow label={t('common:explorer.settings.network.proxyServer')}>
        <div className="flex items-center gap-1">
          <input placeholder={t('common:explorer.settings.network.host')} value={proxyHost}
            onChange={(e) => setProxyHost(e.target.value)}
            className={clsx('w-20', INPUT_CLASS)} />
          <span className="text-gray-400">:</span>
          <input placeholder={t('common:explorer.settings.network.port')} value={proxyPort}
            onChange={(e) => setProxyPort(e.target.value)}
            className={clsx('w-20', INPUT_CLASS)} />
        </div>
      </SettingsRow>
      <GroupReset group="network" />
    </SettingsSection>
  )
}

/* 8a. Explorer (项目浏览器) */

/* 8. Data */

/* 9. About */
/* ---------- shared mini components ---------- */

function useRequireToast() {
  return useToastStore.getState().addToast
}

// V3.0.4-T3-4: 分组重置为默认（移除该组 localStorage keys）
function GroupReset({ group }: { group: string }) {
  const { t } = useTranslation()
  const addToast = useRequireToast()
  const keys = GROUP_LOCALSTORAGE_KEYS[group] || []
  if (keys.length === 0) return null
  return (
    <div className="pt-3 mt-2 border-t border-gray-200 dark:border-edge-subtle">
      <button
        onClick={() => {
          keys.forEach((k) => localStorage.removeItem(k))
          addToast('success', t('common:explorer.settings.resetGroupDone'))
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
      >
        <RotateCcw size={13} />{t('common:explorer.settings.resetGroup')}
      </button>
    </div>
  )
}

// V3.3.0-T13: 云平台设置（服务器地址 + 测试连接 + 登录/登出）
function CloudSettings() {
  const { t } = useTranslation()
  // 打磨轮（v1.2 / M2）：云平台总体开关（默认关）
  const cloudEnabled = useUIStore((s) => s.cloudEnabled)
  const setCloudEnabled = useUIStore((s) => s.setCloudEnabled)
  const baseUrl = useCloudStore((s) => s.baseUrl)
  const setBaseUrl = useCloudStore((s) => s.setBaseUrl)
  const loggedIn = useCloudStore((s) => s.loggedIn)
  const username = useCloudStore((s) => s.username)
  const checking = useCloudStore((s) => s.checkingConnection)
  const checkConnection = useCloudStore((s) => s.checkConnection)
  const logout = useCloudStore((s) => s.logout)
  const addToast = useToastStore((s) => s.addToast)

  const [url, setUrl] = useState(baseUrl)
  const [showLogin, setShowLogin] = useState(false)

  useEffect(() => setUrl(baseUrl), [baseUrl])

  const handleSave = async () => {
    const normalized = (url || '').trim().replace(/\/+$/, '')
    setBaseUrl(normalized)
    try {
      await window.electron?.cloud?.health?.()
      addToast('success', t('common:explorer.settings.cloud.connectionSuccess'))
    } catch {
      addToast('error', t('common:explorer.settings.cloud.connectionFailed'))
    }
  }

  const handleTest = async () => {
    if (url.trim()) setBaseUrl((url || '').trim().replace(/\/+$/, ''))
    await checkConnection()
    const ok = useCloudStore.getState().connected
    addToast(
      ok ? 'success' : 'error',
      ok ? t('common:explorer.settings.cloud.connectionSuccess') : t('common:explorer.settings.cloud.connectionFailed'),
    )
  }

  return (
    <SettingsSection title={t('common:explorer.settings.cloud.title')}>
      {/* v1.2：云平台总体开关（关时隐藏云一级菜单/云入口） */}
      <SettingsRow label={t('common:explorer.settings.cloud.enabled', '启用云平台')}>
        <Toggle checked={cloudEnabled} onChange={setCloudEnabled} />
      </SettingsRow>
      {!cloudEnabled && (
        <p className="text-2xs text-gray-400 px-4 pb-2 -mt-1">
          {t('common:explorer.settings.cloud.enabledHint', '关闭时云平台一级菜单与云入口隐藏，不影响离线使用')}
        </p>
      )}
      {/* 配置界面优化（v1.2 复核）：云开关关闭时仅显示开关与提示，配置区隐藏 */}
      {cloudEnabled && (
      <>
      {/* 服务器地址 */}
      <SettingsRow label={t('common:explorer.settings.cloud.serverUrl')}>
        <div className="flex items-center gap-1 flex-1">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('common:explorer.settings.cloud.serverUrlHint')}
            className={INPUT_CLASS + ' flex-1'}
          />
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-2xs rounded bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            <Check size={12} />{t('common:explorer.settings.cloud.saveUrl')}
          </button>
        </div>
      </SettingsRow>

      <SettingsRow label={t('common:explorer.settings.cloud.testConnection')}>
        <button
          onClick={handleTest}
          disabled={checking || !url.trim()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover disabled:opacity-40"
        >
          <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
          {checking ? t('common:loading') : t('common:explorer.settings.cloud.testConnection')}
        </button>
      </SettingsRow>

      <div className="pt-3 mt-2 border-t border-gray-200 dark:border-edge-subtle">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {t('common:explorer.settings.cloud.loginStatus')}:{' '}
          {loggedIn ? (
            <span className="text-success-500">{username || t('common:explorer.settings.cloud.accountInfo')}</span>
          ) : (
            <span className="text-gray-400">{t('common:explorer.settings.cloud.loginRequired')}</span>
          )}
        </div>
        {loggedIn ? (
          <button
            onClick={() => { logout(); addToast('info', t('common:explorer.settings.cloud.loggedOut')) }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-error-200 dark:border-error-800 text-error-500 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/10"
          >
            <RotateCcw size={13} />{t('common:explorer.settings.cloud.logout')}
          </button>
        ) : (
          <button
            onClick={() => setShowLogin(true)}
            disabled={!baseUrl}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 transition-colors"
          >
            <Cloud size={13} />{t('common:explorer.settings.cloud.login')}
          </button>
        )}
      </div>

      {showLogin && (
        <LoginDialog open={showLogin} onClose={() => setShowLogin(false)} />
      )}
      </>
      )}
    </SettingsSection>
  )
}

/* ---------- mini form components for explorers ---------- */

export function NumberInputMini({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-2xs text-gray-500 dark:text-gray-400">{label}</span>
      <input type="number" value={value}
        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(v) }}
        className="w-20 px-1.5 py-1 text-2xs text-right font-mono tabular-nums rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400" />
    </div>
  )
}

export function SelectMini({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-2xs text-gray-500 dark:text-gray-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-20 px-1 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

/* ================================================== */
/*  AI 服务配置（V3.1.1-T5-5）                        */
/* ================================================== */

/** 9 厂商目录（与 backend/autolink_hub/config.py PROVIDER_CATALOG 一致） */
const AI_PROVIDER_CATALOG: Record<string, { name: string; baseUrl: string; models: string[] }> = {
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-v4-pro', 'deepseek-v4', 'deepseek-chat'] },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'] },
  claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com/v1', models: ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4'] },
  gemini: { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-3.5-pro', 'gemini-3.5-flash'] },
  qwen: { name: 'Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3.7-max', 'qwen3.7-plus'] },
  glm: { name: 'GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-5.2', 'glm-5.1'] },
  grok: { name: 'Grok', baseUrl: 'https://api.x.ai/v1', models: ['grok-4.5'] },
  ollama: { name: 'Ollama (本地)', baseUrl: 'http://localhost:11434/v1', models: ['qwen3:latest', 'llama4:latest', 'deepseek-v4:latest'] },
  custom: { name: '自定义', baseUrl: '', models: [] },
}

function AISettings() {
  const { t } = useTranslation()
  const aiConfig = useUIStore((s) => s.aiConfig)
  const setProviderConfig = useUIStore((s) => s.setProviderConfig)
  const setAIConfig = useUIStore((s) => s.setAIConfig)
  const toast = useToastStore((s) => s.addToast)

  const [selected, setSelected] = useState<string>(aiConfig.defaultProvider || 'deepseek')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  const cfg = aiConfig.providers[selected] || { apiKey: '', model: '', baseUrl: '' }
  const catalog = AI_PROVIDER_CATALOG[selected] || AI_PROVIDER_CATALOG.custom

  const syncToHub = async (provider: string) => {
    const c = aiConfig.providers[provider]
    const aiHub = window.electron?.aihub
    if (!aiHub || !c?.apiKey) return
    await aiHub.config({ provider, apiKey: c.apiKey, model: c.model || '', baseUrl: c.baseUrl || '' })
  }

  const handleSave = async () => {
    setProviderConfig(selected, {
      apiKey: cfg.apiKey,
      model: cfg.model || catalog.models[0] || '',
      baseUrl: cfg.baseUrl || catalog.baseUrl,
    })
    try {
      await syncToHub(selected)
      toast('success', t('common:explorer.settings.ai.saved'))
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'save failed')
    }
  }

  const handleTest = async () => {
    const aiHub = window.electron?.aihub
    if (!aiHub) return
    setBusy(true)
    setStatusMsg('')
    try {
      const r = await aiHub.test({
        provider: selected,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl || catalog.baseUrl,
        model: cfg.model || catalog.models[0] || '',
      })
      setStatusMsg(r.message)
    } finally {
      setBusy(false)
    }
  }

  const handleFetchModels = async () => {
    const aiHub = window.electron?.aihub
    if (!aiHub) return
    setBusy(true)
    try {
      const r = await aiHub.models({ baseUrl: cfg.baseUrl || catalog.baseUrl, apiKey: cfg.apiKey })
      if (r.status === 'ok' && r.models.length > 0) {
        setProviderConfig(selected, { ...cfg, baseUrl: cfg.baseUrl || catalog.baseUrl, model: r.models[0] })
        setStatusMsg(`models: ${r.models.join(', ')}`)
      } else {
        setStatusMsg(r.message || 'no models')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleSetDefault = async () => {
    setAIConfig({ defaultProvider: selected })
    try {
      await window.electron?.aihub?.configDefault(selected)
      toast('success', t('common:explorer.settings.ai.defaultSet'))
    } catch { /* ignore */ }
  }

  return (
    <SettingsSection title={t('common:explorer.settings.ai.title')}>
      <p className="text-2xs text-gray-400 mb-2">{t('common:explorer.settings.ai.desc')}</p>

      {/* 厂商选择 */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(AI_PROVIDER_CATALOG).map(([key, p]) => (
          <button
            key={key}
            onClick={() => setSelected(key)}
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-1 text-2xs rounded border transition-colors',
              selected === key
                ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover',
            )}
          >
            {p.name}
            {aiConfig.defaultProvider === key && <Star size={10} className="text-warning-500" />}
          </button>
        ))}
      </div>

      {/* API Key */}
      <SettingsRow label={t('common:explorer.settings.ai.apiKey')}>
        <div className="flex items-center gap-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={cfg.apiKey}
            onChange={(e) => setProviderConfig(selected, { ...cfg, apiKey: e.target.value })}
            className={INPUT_CLASS + ' flex-1'}
            placeholder="sk-..."
          />
          <button className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" onClick={() => setShowKey(!showKey)}>
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </SettingsRow>

      {/* 模型 */}
      <SettingsRow label={t('common:explorer.settings.ai.model')}>
        <div className="flex items-center gap-1 flex-1">
          <input
            value={cfg.model}
            onChange={(e) => setProviderConfig(selected, { ...cfg, model: e.target.value })}
            className={INPUT_CLASS + ' flex-1'}
            placeholder={catalog.models[0] || ''}
          />
          <button
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            onClick={handleFetchModels}
            title={t('common:explorer.settings.ai.fetchModels')}
            disabled={busy}
          >
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
          </button>
        </div>
      </SettingsRow>

      {/* Base URL */}
      <SettingsRow label={t('common:explorer.settings.ai.baseUrl')}>
        <input
          value={cfg.baseUrl}
          onChange={(e) => setProviderConfig(selected, { ...cfg, baseUrl: e.target.value })}
          className={INPUT_CLASS + ' flex-1'}
          placeholder={catalog.baseUrl}
        />
      </SettingsRow>

      {/* 自主模式 */}
      <SettingsRow label={t('common:explorer.settings.ai.autonomyMode')}>
        <select
          value={aiConfig.autonomyMode}
          onChange={(e) => setAIConfig({ autonomyMode: e.target.value as AIConfig['autonomyMode'] })}
          className={INPUT_CLASS}
        >
          <option value="advisor">Advisor</option>
          <option value="semi_auto">Semi-auto</option>
          <option value="full_auto">Full auto</option>
        </select>
      </SettingsRow>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1.5 mt-1">
        <button
          onClick={handleSave}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-2xs rounded bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <Check size={12} />{t('common:explorer.settings.ai.save')}
        </button>
        <button
          onClick={handleTest}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover disabled:opacity-40"
        >
          <WifiIcon size={12} />{t('common:explorer.settings.ai.test')}
        </button>
        <button
          onClick={handleSetDefault}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover"
        >
          <Star size={12} />{t('common:explorer.settings.ai.setDefault')}
        </button>
      </div>

      {statusMsg && <p className="mt-2 text-2xs text-gray-500 dark:text-gray-400 break-all">{statusMsg}</p>}
    </SettingsSection>
  )
}

// V3.1.1-T5-7: 诊断（CLI 能力信息 + 命令审计日志，AI 调用以 ai: 前缀标记）
function DiagnosticsSettings() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<{ cliVersion: string; actions: string[] } | null>(null)
  const [entries, setEntries] = useState<Array<Record<string, unknown>>>([])
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [reloadFlag, setReloadFlag] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const cli = window.electron?.cli
    if (!cli) {
      setLoading(false)
      return
    }
    Promise.all([cli.info(), cli.audit(200)])
      .then(([infoRes, auditRes]) => {
        if (cancelled) return
        setInfo(infoRes)
        setEntries(auditRes.entries)
        setPath(auditRes.path)
      })
      .catch(() => { /* IPC 不可用时静默 */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadFlag])

  return (
    <SettingsSection title={t('common:explorer.settings.diagnostics.title')}>
      <p className="text-2xs text-gray-400 mb-2">{t('common:explorer.settings.diagnostics.desc')}</p>

      {/* CLI 能力信息 */}
      <div className="flex items-center gap-2 mb-3 text-2xs">
        <span className="text-gray-500 dark:text-gray-400">{t('common:explorer.settings.diagnostics.cliVersion')}</span>
        <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-app-hover">{info?.cliVersion ?? '—'}</code>
        <span className="text-gray-500 dark:text-gray-400">{t('common:explorer.settings.diagnostics.actionsCount')}</span>
        <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-app-hover">{info?.actions.length ?? '—'}</code>
        <button
          onClick={() => setReloadFlag((f) => f + 1)}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {t('common:explorer.settings.diagnostics.refresh')}
        </button>
      </div>

      {/* 命令审计日志（AI 调用留痕，脱敏） */}
      <div className="rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
        <div className="px-2.5 py-1.5 text-2xs font-medium bg-gray-50 dark:bg-app-hover flex items-center justify-between gap-2">
          <span>{t('common:explorer.settings.diagnostics.auditTitle')}（{entries.length}）</span>
          {path && <code className="text-[10px] text-gray-400 break-all max-w-[60%] text-right">{path}</code>}
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-edge-subtle">
          {entries.length === 0 && (
            <div className="px-2.5 py-3 text-2xs text-gray-400">{t('common:explorer.settings.diagnostics.empty')}</div>
          )}
          {entries.map((e, idx) => {
            const action = String(e.action ?? '')
            const isAi = Array.isArray(e.argv) && e.argv.some((a) => String(a).startsWith('ai:'))
            const ok = e.ok !== false
            return (
              <div key={idx} className="px-2.5 py-1.5 text-2xs flex items-start gap-2">
                <span className={ok ? 'text-success-500' : 'text-danger-500'}>{ok ? '✓' : '✗'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <code className="font-medium">{action}</code>
                    {isAi && (
                      <span className="px-1 rounded text-[10px] text-fuchsia-500 border border-fuchsia-300 dark:border-fuchsia-700">AI</span>
                    )}
                    {e.error ? <span className="text-danger-500 break-all">{String(e.error)}</span> : null}
                  </div>
                  <div className="text-gray-400 truncate">
                    {String(e.ts ?? '')}
                    {Array.isArray(e.argv) && e.argv.length > 0 ? ` · ${e.argv.join(' ')}` : ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 打磨轮（v1.2 复核）：数据管理并入诊断（导出/导入/重置 localStorage） */}
      <div className="pt-3 mt-2 border-t border-gray-200 dark:border-edge-subtle">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">数据管理（localStorage）</div>
        <div className="space-y-1.5">
          <button onClick={() => {
            const allKeys: string[] = []
            for (let i = 0; i < localStorage.length; i++) allKeys.push(localStorage.key(i)!)
            const data: Record<string, unknown> = {}
            for (const key of allKeys.filter((k) => k.startsWith('autolink-'))) {
              try { data[key] = JSON.parse(localStorage.getItem(key)!) } catch { data[key] = localStorage.getItem(key) }
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = `autolink-data-${new Date().toISOString().slice(0, 10)}.json`
            a.click(); URL.revokeObjectURL(url)
          }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover">
            <Download size={13} />导出全部数据
          </button>
          <button onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'; input.accept = '.json'
            input.onchange = async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0]
              if (!file) return
              try {
                const text = await file.text()
                const data = JSON.parse(text)
                for (const [key, value] of Object.entries(data)) {
                  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
                }
                window.location.reload()
              } catch { /* ignore */ }
            }
            input.click()
          }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover">
            <Upload size={13} />导入数据
          </button>
          <button onClick={() => {
            const keys: string[] = []
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i)!
              if (k.startsWith('autolink-')) keys.push(k)
            }
            keys.forEach((k) => localStorage.removeItem(k))
            window.location.reload()
          }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-error-200 dark:border-error-800 text-error-500 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/10">
            <RotateCcw size={13} />重置全部数据
          </button>
        </div>
      </div>
    </SettingsSection>
  )
}
