import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zhCN from './resources/zh-CN'
import en from './resources/en'
import ja from './resources/ja'
import ko from './resources/ko'
import zhTW from './resources/zh-TW'

// Read persisted language from zustand persist store (autolink-ui-state)
// to keep i18n language in sync with UI store on app startup
function getPersistedLanguage(): string {
  try {
    const raw = localStorage.getItem('autolink-ui-state')
    if (raw) {
      const parsed = JSON.parse(raw)
      const lang = parsed?.state?.language
      if (typeof lang === 'string' && lang) return lang
    }
  } catch {
    // ignore parse errors, fall back to default
  }
  return 'zh-CN'
}

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': zhCN,
    en,
    ja,
    ko,
    'zh-TW': zhTW,
  },
  lng: getPersistedLanguage(),
  // 5.4.16-F5416-1：回落策略 —— 繁体中文优先回落简体；其他语言（en/ja/ko）回落英文
  fallbackLng: {
    'zh-TW': ['zh-CN'],
    default: ['en'],
  },
  // 显式声明命名空间,并将默认命名空间设为 'common'
  // 这样 useTranslation() 不带参数时,t('about.title') 会正确解析到 common.about.title
  ns: ['common', 'design', 'project', 'rack', 'topology', 'workbench', 'device', 'chat', 'cloud', 'nav', 'aidc'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
