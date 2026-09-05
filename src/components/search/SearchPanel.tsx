/**
 * V3.3.1: 全局搜索面板（本地 + 云端二合一）
 *
 * - 本地：项目文件 / 设备库 / 模板 文件名 + 内容检索（主进程 search:local，渲染层零网络）
 * - 云端：登录后并行检索云端项目 / 模板 / 文件 / 内容
 * - 范围切换：全部 / 项目 / 设备 / 模板 / 云端
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Search, X, Loader2, FolderOpen, Server, LayoutTemplate, Cloud, FileText } from 'lucide-react'
import { useUIStore } from '@/stores/ui.store'
import { useCloudStore } from '@/stores/cloud.store'
import { searchApi, type LocalSearchHit } from '@/api/search'
import * as cloud from '@/api/cloud'
import type { RemoteProject, RemoteTemplate, FileSearchResult, ContentSearchResult } from '@/api/cloud'

type Scope = 'all' | 'project' | 'device' | 'template' | 'cloud'

interface CloudBundle {
  projects: RemoteProject[]
  templates: RemoteTemplate[]
  files: FileSearchResult[]
  contents: ContentSearchResult[]
}

const SCOPES: { id: Scope; key: string }[] = [
  { id: 'all', key: 'globalSearch.scopeAll' },
  { id: 'project', key: 'globalSearch.scopeProject' },
  { id: 'device', key: 'globalSearch.scopeDevice' },
  { id: 'template', key: 'globalSearch.scopeTemplate' },
  { id: 'cloud', key: 'globalSearch.scopeCloud' },
]

async function searchCloud(q: string): Promise<CloudBundle> {
  const [p, tl, f, c] = await Promise.all([
    cloud.projects.search(q).catch(() => ({ projects: [] })),
    cloud.templates.list(q).catch(() => ({ templates: [], total: 0 })),
    cloud.search.files(q, 20).catch(() => ({ results: [], total: 0 })),
    cloud.search.content(q, 20).catch(() => ({ results: [], total: 0 })),
  ])
  return {
    projects: p.projects ?? [],
    templates: tl.templates ?? [],
    files: f.results ?? [],
    contents: c.results ?? [],
  }
}

export function SearchPanel() {
  const { t } = useTranslation()
  const setActiveActivity = useUIStore((s) => s.setActiveActivity)
  const loggedIn = useCloudStore((s) => s.loggedIn)

  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [localHits, setLocalHits] = useState<LocalSearchHit[]>([])
  const [cloudData, setCloudData] = useState<CloudBundle | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 查询清空/变化时重置本地搜索结果
      setLocalHits([])
      setCloudData(null)
      setLoading(false)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    const timer = setTimeout(async () => {
      const runLocal = scope !== 'cloud'
      const runCloud = (scope === 'cloud' || scope === 'all') && loggedIn
      try {
        const [localRes, cloudRes] = await Promise.all([
          runLocal ? searchApi.local({ query: q, scope: scope === 'all' ? 'all' : scope, maxResults: 100 }) : Promise.resolve([] as LocalSearchHit[]),
          runCloud ? searchCloud(q) : Promise.resolve(null),
        ])
        setLocalHits(localRes)
        setCloudData(cloudRes)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setLocalHits([])
        setCloudData(null)
      } finally {
        setLoading(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [query, scope, loggedIn])

  const goto = (activity: 'project' | 'device_library' | 'cloud') => {
    setActiveActivity(activity)
  }

  const renderTypeBadge = (type: string) => {
    const cls: Record<string, string> = {
      project: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
      device: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
      template: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
      cloud: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
    }
    return <span className={clsx('shrink-0 px-1.5 py-0.5 text-[10px] rounded', cls[type] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300')}>{type}</span>
  }

  const renderHitRow = (hit: LocalSearchHit) => (
    <button
      key={`${hit.type}-${hit.name}-${hit.path ?? ''}-${hit.line ?? ''}`}
      onClick={() => goto(hit.type === 'project' ? 'project' : hit.type === 'device' ? 'device_library' : 'project')}
      className="w-full px-4 py-2 border-b border-gray-100 dark:border-edge-subtle/50 hover:bg-gray-50 dark:hover:bg-app-hover transition-colors text-left"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={clsx(
          'shrink-0 w-5 h-5 flex items-center justify-center',
          hit.type === 'project' ? 'text-primary-500' : hit.type === 'device' ? 'text-purple-500' : 'text-warning-500',
        )}>
          {hit.type === 'project' ? <FolderOpen size={14} /> : hit.type === 'device' ? <Server size={14} /> : <LayoutTemplate size={14} />}
        </span>
        <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{hit.name}</span>
        {hit.kind === 'filename' && <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">{t('globalSearch.kindFilename')}</span>}
      </div>
      {hit.path && (
        <div className="pl-7 text-xs text-gray-500 dark:text-gray-400 truncate">
          {hit.path}
          {hit.line !== undefined && <span className="ml-1.5 text-gray-400 dark:text-gray-500">L{hit.line}</span>}
        </div>
      )}
      {hit.excerpt && (
        <div className="pl-7 mt-0.5 text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-app-hover rounded px-1.5 py-0.5 truncate">
          {hit.excerpt}
        </div>
      )}
    </button>
  )

  const renderCloudFile = (f: FileSearchResult) => (
    <button key={`cf-${f.owner}-${f.repo}-${f.path}`} onClick={() => goto('cloud')} className="w-full px-4 py-2 border-b border-gray-100 dark:border-edge-subtle/50 hover:bg-gray-50 dark:hover:bg-app-hover transition-colors text-left">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-cyan-500"><FileText size={14} /></span>
        <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{f.repo}</span>
        <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">{t('globalSearch.groupCloudFile')}</span>
      </div>
      <div className="pl-7 text-xs text-gray-500 dark:text-gray-400 truncate">{f.owner}/{f.path}</div>
    </button>
  )

  const renderCloudContent = (c: ContentSearchResult) => (
    <button key={`cc-${c.owner}-${c.repo}-${c.path}-${c.line}`} onClick={() => goto('cloud')} className="w-full px-4 py-2 border-b border-gray-100 dark:border-edge-subtle/50 hover:bg-gray-50 dark:hover:bg-app-hover transition-colors text-left">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-cyan-500"><Search size={14} /></span>
        <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{c.repo}</span>
        <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">{t('globalSearch.groupCloudContent')}</span>
      </div>
      <div className="pl-7 text-xs text-gray-500 dark:text-gray-400 truncate">{c.owner}/{c.path} <span className="text-gray-400 dark:text-gray-500">L{c.line}</span></div>
      {c.snippet && (
        <div className="pl-7 mt-0.5 text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-app-hover rounded px-1.5 py-0.5 truncate">{c.snippet}</div>
      )}
    </button>
  )

  const groupHeading = (text: string) => (
    <div className="px-4 py-1.5 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-app border-b border-gray-100 dark:border-edge-subtle/50">{text}</div>
  )

  const hasResults =
    localHits.length > 0 ||
    (cloudData && (cloudData.projects.length > 0 || cloudData.templates.length > 0 || cloudData.files.length > 0 || cloudData.contents.length > 0))

  const showCloudHint = (scope === 'cloud' || scope === 'all') && !loggedIn

  return (
    <div className="flex flex-col h-full bg-white dark:bg-app">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-edge-subtle space-y-2">
        <div className="flex gap-1.5 flex-wrap">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={clsx(
                'px-2.5 py-1 text-xs rounded-md transition-colors',
                scope === s.id
                  ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 font-medium'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
              )}
            >
              {t(s.key)}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('globalSearch.placeholder')}
            className="w-full pl-8 pr-8 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-teal-500" />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-sm text-error-500">{error}</div>
        ) : !query.trim() ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Search size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('globalSearch.startHint')}</p>
          </div>
        ) : showCloudHint && !hasResults ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Cloud size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{t('globalSearch.loginHint')}</p>
            <button
              onClick={() => goto('cloud')}
              className="px-4 py-1.5 text-xs text-white bg-teal-500 hover:bg-teal-600 rounded-md transition-colors"
            >
              {t('globalSearch.login')}
            </button>
          </div>
        ) : !hasResults ? (
          <div className="p-4 text-center text-sm text-gray-400 dark:text-gray-500">{t('globalSearch.noResults')}</div>
        ) : (
          <div>
            {localHits.filter((h) => h.type === 'project').length > 0 && (
              <>
                {groupHeading(t('globalSearch.groupLocalProject'))}
                {localHits.filter((h) => h.type === 'project').map(renderHitRow)}
              </>
            )}
            {localHits.filter((h) => h.type === 'device').length > 0 && (
              <>
                {groupHeading(t('globalSearch.groupLocalDevice'))}
                {localHits.filter((h) => h.type === 'device').map(renderHitRow)}
              </>
            )}
            {localHits.filter((h) => h.type === 'template').length > 0 && (
              <>
                {groupHeading(t('globalSearch.groupLocalTemplate'))}
                {localHits.filter((h) => h.type === 'template').map(renderHitRow)}
              </>
            )}
            {cloudData && cloudData.projects.length > 0 && (
              <>
                {groupHeading(t('globalSearch.groupCloudProject'))}
                {cloudData.projects.map((p) => (
                  <button key={`cp-${p.owner}-${p.name}`} onClick={() => goto('cloud')} className="w-full px-4 py-2 border-b border-gray-100 dark:border-edge-subtle/50 hover:bg-gray-50 dark:hover:bg-app-hover transition-colors text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-cyan-500"><Cloud size={14} /></span>
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{p.name}</span>
                      {renderTypeBadge('cloud')}
                    </div>
                    <div className="pl-7 text-xs text-gray-500 dark:text-gray-400 truncate">{p.owner}/{p.full_name}</div>
                  </button>
                ))}
              </>
            )}
            {cloudData && cloudData.templates.length > 0 && (
              <>
                {groupHeading(t('globalSearch.groupCloudTemplate'))}
                {cloudData.templates.map((tp) => (
                  <button key={`ct-${tp.owner}-${tp.name}`} onClick={() => goto('cloud')} className="w-full px-4 py-2 border-b border-gray-100 dark:border-edge-subtle/50 hover:bg-gray-50 dark:hover:bg-app-hover transition-colors text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-cyan-500"><LayoutTemplate size={14} /></span>
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{tp.name}</span>
                    </div>
                    <div className="pl-7 text-xs text-gray-500 dark:text-gray-400 truncate">{tp.owner}/{tp.full_name}</div>
                  </button>
                ))}
              </>
            )}
            {cloudData && cloudData.files.length > 0 && (
              <>
                {groupHeading(t('globalSearch.groupCloudFile'))}
                {cloudData.files.map(renderCloudFile)}
              </>
            )}
            {cloudData && cloudData.contents.length > 0 && (
              <>
                {groupHeading(t('globalSearch.groupCloudContent'))}
                {cloudData.contents.map(renderCloudContent)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
