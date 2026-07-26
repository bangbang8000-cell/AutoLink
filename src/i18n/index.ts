import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zhCN from './resources/zh-CN'
import en from './resources/en'
import ja from './resources/ja'
import ko from './resources/ko'
import zhTW from './resources/zh-TW'

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': zhCN,
    en,
    ja,
    ko,
    'zh-TW': zhTW,
  },
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
