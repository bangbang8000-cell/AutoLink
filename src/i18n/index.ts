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
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
