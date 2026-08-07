import { useTranslation } from 'react-i18next'
import { useCloudStore } from '@/stores/cloud.store'
import { useUIStore } from '@/stores/ui.store'
import { Cloud, CloudOff, Loader2 } from 'lucide-react'
import clsx from 'clsx'

/**
 * Header 云连接状态指示器
 * - 点击跳转云中心（cloud activity）
 * - 未配置服务器 / 未连接 / 已连接 三态 + 登录态
 */
export function CloudStatusIndicator() {
  const { t } = useTranslation()
  const isDark = useUIStore((s) => s.isDark)
  const baseUrl = useCloudStore((s) => s.baseUrl)
  const loggedIn = useCloudStore((s) => s.loggedIn)
  const connected = useCloudStore((s) => s.connected)
  const checking = useCloudStore((s) => s.checkingConnection)
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)

  const colorClass = (() => {
    if (!baseUrl) return 'text-gray-400 dark:text-gray-500'
    if (checking) return 'text-gray-400 animate-pulse'
    if (!connected) return 'text-error-500'
    return loggedIn ? 'text-success-500' : 'text-warning-500'
  })()

  const tooltip = (() => {
    if (!baseUrl) return t('cloud:status.notConfigured')
    if (checking) return t('cloud:status.connecting')
    if (!connected) return t('cloud:status.error')
    return loggedIn
      ? `${t('cloud:status.connected')} - ${t('cloud:status.loggedIn')}`
      : `${t('cloud:status.connected')} - ${t('cloud:status.notLoggedIn')}`
  })()

  return (
    <button
      onClick={() => setActiveActivity('cloud')}
      className={clsx('w-7 h-7 flex items-center justify-center rounded transition-colors', isDark ? 'hover:bg-app-hover' : 'hover:bg-gray-200')}
      title={tooltip}
    >
      {checking ? (
        <Loader2 size={15} className={colorClass + ' animate-spin'} />
      ) : connected ? (
        <Cloud size={15} className={colorClass} />
      ) : (
        <CloudOff size={15} className={colorClass} />
      )}
    </button>
  )
}
