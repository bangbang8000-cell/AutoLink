import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useCloudStore } from '@/stores/cloud.store'
import { useUIStore } from '@/stores/ui.store'
import { client } from '@/api/cloud'
import type { RemoteTemplate, RemoteProject } from '@/api/cloud'
import {
  Package, FolderGit2, WifiOff,
  Loader2, ExternalLink, Clock,
} from 'lucide-react'

interface DashboardData {
  template_count: number
  project_count: number
  recent_templates: RemoteTemplate[]
  recent_projects: RemoteProject[]
}

export function DashboardView() {
  const { t } = useTranslation('cloud')
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { loggedIn, username, baseUrl } = useCloudStore()
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await client.dashboard()
      setDashboard(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (loggedIn) fetchDashboard()
    else setLoading(false)
  }, [loggedIn, fetchDashboard])

  if (!loggedIn) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3 p-8">
        <WifiOff size={32} />
        <p className="text-sm">{t('dashboard.notLoggedIn')}</p>
        <button
          onClick={() => setActiveActivity('settings')}
          className="px-4 py-2 text-xs text-white bg-primary-500 hover:bg-primary-600 rounded-md transition-colors"
        >
          {t('dashboard.goSettings')}
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3 p-8">
        <p className="text-sm text-error-500">{t('dashboard.loadFailed')}: {error}</p>
        <button
          onClick={fetchDashboard}
          className="px-4 py-2 text-xs text-white bg-primary-500 hover:bg-primary-600 rounded-md transition-colors"
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  const d = dashboard!

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Welcome */}
      <div className="px-4 py-4 border-b border-gray-200 dark:border-edge-subtle">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('dashboard.welcome', { name: username || '' })}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {t('dashboard.server')}: {baseUrl}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 p-4">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
          <Package size={18} className="text-blue-500 shrink-0" />
          <div>
            <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{d.template_count}</div>
            <div className="text-[10px] text-blue-500 dark:text-blue-400">{t('dashboard.myTemplates')}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800">
          <FolderGit2 size={18} className="text-green-500 shrink-0" />
          <div>
            <div className="text-lg font-bold text-green-700 dark:text-green-300">{d.project_count}</div>
            <div className="text-[10px] text-green-500 dark:text-green-400">{t('dashboard.myProjects')}</div>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="flex gap-2 px-4 pb-3">
        <button
          onClick={() => setActiveActivity('cloud')}
          className="flex-1 px-3 py-1.5 text-xs rounded-md bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors"
        >
          {t('dashboard.browseMarket')}
        </button>
        <button
          onClick={() => setActiveActivity('cloud')}
          className="flex-1 px-3 py-1.5 text-xs rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          {t('dashboard.manageProjects')}
        </button>
      </div>

      {/* Recent templates */}
      <div className="px-4 pb-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          {t('dashboard.recentTemplates')}
        </h3>
        {d.recent_templates.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">{t('noTemplates')}</p>
        ) : (
          <div className="space-y-1">
            {d.recent_templates.slice(0, 5).map((item, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-app-hover/50 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <Package size={12} className="text-gray-400 shrink-0" />
                  <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{item.owner}/{item.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Clock size={10} />
                    {new Date(item.updated_at).toLocaleDateString()}
                  </span>
                  <a
                    href={item.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-primary-500"
                    title={t('dashboard.install')}
                  >
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent projects */}
      <div className="px-4 pb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          {t('dashboard.recentProjects')}
        </h3>
        {d.recent_projects.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">{t('noProjects')}</p>
        ) : (
          <div className="space-y-1">
            {d.recent_projects.slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-app-hover/50 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderGit2 size={12} className="text-gray-400 shrink-0" />
                  <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{p.full_name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Clock size={10} />
                    {new Date(p.updated_at).toLocaleDateString()}
                  </span>
                  <a
                    href={p.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-primary-500"
                    title={t('dashboard.pull')}
                  >
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
