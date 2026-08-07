import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Package, Cloud, Search } from 'lucide-react'
import clsx from 'clsx'
import { DashboardView } from './DashboardView'
import { RemoteProjectView } from './RemoteProjectView'
import { TemplateMarket } from './TemplateMarket'
import { LoginDialog } from './LoginDialog'
import { useCloudStore } from '@/stores/cloud.store'
import { useProjectStore } from '@/stores/project.store'
import { search as searchApi, projects as projectApi, templates as templateApi } from '@/api/cloud'

type CloudTab = 'search' | 'dashboard' | 'templates' | 'projects'
type SearchType = 'project' | 'template' | 'filename' | 'content'

interface SearchResultItem {
  repo: string
  owner: string
  path: string
  size?: number
  line?: number
  snippet?: string
}

export function CloudPanel() {
  const { t } = useTranslation('cloud')
  const [activeTab, setActiveTab] = useState<CloudTab>('dashboard')
  const [showLogin, setShowLogin] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Search tab state
  const [searchType, setSearchType] = useState<SearchType>('project')
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')

  const loggedIn = useCloudStore((s) => s.loggedIn)

  const tabs: { id: CloudTab; icon: React.ReactNode; labelKey: string }[] = [
    { id: 'dashboard', icon: <LayoutDashboard size={14} />, labelKey: 'cloud:panel.tabDashboard' },
    { id: 'projects', icon: <Cloud size={14} />, labelKey: 'cloud:panel.tabProjects' },
    { id: 'templates', icon: <Package size={14} />, labelKey: 'cloud:panel.tabTemplates' },
    { id: 'search', icon: <Search size={14} />, labelKey: 'cloud:panel.tabSearch' },
  ]

  const searchTypes: { id: SearchType; label: string }[] = [
    { id: 'project', label: t('search.typeProject') },
    { id: 'template', label: t('search.typeTemplate') },
    { id: 'filename', label: t('search.typeFilename') },
    { id: 'content', label: t('search.typeContent') },
  ]

  const handlePullSuccess = useCallback(() => {
    useProjectStore.getState().fetchProjects().catch(() => {})
  }, [])

  // 云端搜索
  const doSearch = useCallback(
    async (q: string, type: SearchType) => {
      if (!q.trim() || !loggedIn) {
        setSearchResults([])
        setSearchTotal(0)
        return
      }
      setSearchLoading(true)
      setSearchError('')
      try {
        if (type === 'project') {
          const res = await projectApi.search(q)
          const mapped = (res.projects || []).map((p) => ({
            repo: p.name,
            owner: p.owner,
            path: p.name,
            size: 0,
            snippet: p.description || '',
          }))
          setSearchResults(mapped)
          setSearchTotal(mapped.length)
        } else if (type === 'template') {
          const res = await templateApi.list(q)
          const mapped = (res.templates || []).map((tp) => ({
            repo: tp.name,
            owner: tp.owner,
            path: tp.name,
            size: 0,
            snippet: tp.description || '',
          }))
          setSearchResults(mapped)
          setSearchTotal(res.total || mapped.length)
        } else if (type === 'filename') {
          const res = await searchApi.files(q)
          setSearchResults(res.results.map((r) => ({ ...r, size: r.size || 0 })))
          setSearchTotal(res.total)
        } else {
          const res = await searchApi.content(q)
          setSearchResults(res.results.map((r) => ({ ...r, size: 0 })))
          setSearchTotal(res.total)
        }
      } catch (e: unknown) {
        setSearchError(e instanceof Error ? e.message : t('loadFailed'))
        setSearchResults([])
        setSearchTotal(0)
      } finally {
        setSearchLoading(false)
      }
    },
    [loggedIn, t],
  )

  // 防抖搜索
  useEffect(() => {
    if (activeTab !== 'search') return
    const timer = setTimeout(() => doSearch(searchQuery, searchType), 400)
    return () => clearTimeout(timer)
  }, [searchQuery, searchType, activeTab, doSearch])

  const renderSearchContent = () => {
    if (!loggedIn) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center px-6">
          <Search size={36} className="text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{t('search.loginHint')}</p>
          <button
            onClick={() => setShowLogin(true)}
            className="px-4 py-1.5 text-xs text-white bg-primary-500 hover:bg-primary-600 rounded-md transition-colors"
          >
            {t('login')}
          </button>
        </div>
      )
    }

    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-edge-subtle space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            {searchTypes.map((st) => (
              <button
                key={st.id}
                onClick={() => setSearchType(st.id)}
                className={clsx(
                  'px-2.5 py-1 text-xs rounded-md transition-colors',
                  searchType === st.id
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
                )}
              >
                {st.label}
              </button>
            ))}
          </div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search.typePlaceholder', { type: searchTypes.find((s) => s.id === searchType)?.label || '' })}
            className="w-full px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {searchLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full" />
            </div>
          ) : searchError ? (
            <div className="p-4 text-center text-sm text-error-500">{searchError}</div>
          ) : !searchQuery.trim() ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <Search size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('search.startHint')}</p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-400 dark:text-gray-500">
              {t('search.noResults')}
            </div>
          ) : (
            <div>
              <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-edge-subtle">
                {t('search.resultCount', { count: searchTotal })}
              </div>
              {searchResults.map((item, i) => (
                <div
                  key={i}
                  className="px-4 py-2.5 border-b border-gray-100 dark:border-edge-subtle/50 hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                        {item.path}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {item.owner}/{item.repo}
                        {item.line !== undefined && <span className="ml-2">L{item.line}</span>}
                      </div>
                      {item.snippet && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono bg-gray-100 dark:bg-app-hover rounded px-1.5 py-0.5 truncate">
                          {item.snippet}
                        </div>
                      )}
                    </div>
                    {item.size !== undefined && item.size > 0 && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 mt-0.5">
                        {item.size < 1024 ? `${item.size}B` : `${(item.size / 1024).toFixed(1)}KB`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView />
      case 'projects':
        return <RemoteProjectView onPullSuccess={handlePullSuccess} searchQuery={searchQuery} />
      case 'templates':
        return <TemplateMarket searchQuery={searchQuery} />
      case 'search':
        return renderSearchContent()
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-app">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-edge-subtle shrink-0">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('panel.title')}
        </h2>
        {!loggedIn && (
          <button
            onClick={() => setShowLogin(true)}
            className="px-3 py-1 text-xs text-white bg-primary-500 hover:bg-primary-600 rounded-md transition-colors"
          >
            {t('login')}
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 dark:border-edge-subtle shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
              activeTab === tab.id
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            {tab.icon}
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {renderContent()}
      </div>

      {/* Login dialog */}
      {showLogin && <LoginDialog open={showLogin} onClose={() => setShowLogin(false)} />}
    </div>
  )
}
