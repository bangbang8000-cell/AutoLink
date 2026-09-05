import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Package, Download, Loader2, Clock, Tag, User, ChevronLeft, ChevronRight,
  Star, ShieldCheck, Bell, BellOff, Award, Users,
} from 'lucide-react'
import { useCloudStore } from '@/stores/cloud.store'
import { useToastStore } from '@/stores/toast.store'
import { templates as templatesApi } from '@/api/cloud'
import { TemplatePermissionDialog } from '@/components/cloud/TemplatePermissionDialog'
import type { RemoteTemplate } from '@/api/cloud'

interface TemplateMarketProps {
  searchQuery: string
}

const LIMIT = 20

type SortKey = 'updated' | 'downloads' | 'name'

export function TemplateMarket({ searchQuery }: TemplateMarketProps) {
  const { t } = useTranslation('cloud')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<SortKey>('updated')
  const [installing, setInstalling] = useState<string | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [permDialog, setPermDialog] = useState<{ owner: string; name: string } | null>(null)
  // V4-2: 模板统计（下载/安装计数）缓存
  const [statsMap, setStatsMap] = useState<Record<string, { downloads: number; usages: number }>>({})
  // 5.0.4-504-b: 订阅切换中 / 评分交互（hover 预览）
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [ratingBusy, setRatingBusy] = useState<string | null>(null)
  const [ratingHover, setRatingHover] = useState<string | null>(null)

  const addToast = useToastStore((s) => s.addToast)

  const {
    remoteTemplates,
    remoteLoading,
    remoteError,
    templateTotal,
    loggedIn,
    fetchRemoteTemplates,
    downloadTemplate,
    toggleTemplateFavorite,
    toggleTemplateSubscribe,
    rateTemplate,
  } = useCloudStore()

  // Reset page when search or category changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 搜索/品类变化时重置页码到首页
    setPage(1)
  }, [searchQuery, category])

  // Fetch templates
  useEffect(() => {
    fetchRemoteTemplates(searchQuery, category, page, sort)
  }, [searchQuery, category, page, sort, fetchRemoteTemplates])

  const totalPages = Math.max(1, Math.ceil(templateTotal / LIMIT))

  const handleInstall = useCallback(
    async (template: RemoteTemplate) => {
      const key = template.full_name || `${template.owner}/${template.name}`
      setInstalling(key)
      try {
        await downloadTemplate(template.owner, template.name)
        addToast('success', t('templates.installed', { name: template.name }))
      } catch (err) {
        addToast('error', (err as Error).message)
      } finally {
        setInstalling(null)
      }
    },
    [downloadTemplate, addToast, t],
  )

  // V3.3.2-T15-3: 收藏切换
  const handleToggleFavorite = useCallback(
    async (template: RemoteTemplate) => {
      try {
        await toggleTemplateFavorite(template.owner, template.name, !!template.is_favorite)
        addToast(
          'success',
          template.is_favorite
            ? t('permissions.unfavorited', { name: template.name })
            : t('permissions.favorited', { name: template.name }),
        )
      } catch (err) {
        addToast('error', (err as Error).message)
      }
    },
    [toggleTemplateFavorite, addToast, t],
  )

  // 5.0.4-504-b: 订阅 / 取消订阅
  const handleToggleSubscribe = useCallback(
    async (template: RemoteTemplate) => {
      const key = template.full_name || `${template.owner}/${template.name}`
      setSubscribing(key)
      try {
        await toggleTemplateSubscribe(template.owner, template.name, !!template.is_subscribed)
        addToast(
          'success',
          template.is_subscribed
            ? t('permissions.unsubscribed', { name: template.name })
            : t('permissions.subscribed', { name: template.name }),
        )
      } catch (err) {
        addToast('error', (err as Error).message)
      } finally {
        setSubscribing(null)
      }
    },
    [toggleTemplateSubscribe, addToast, t],
  )

  // 5.0.4-504-b: 评分（1-5 星）
  const handleRate = useCallback(
    async (template: RemoteTemplate, rating: number) => {
      const key = template.full_name || `${template.owner}/${template.name}`
      setRatingBusy(key)
      setRatingHover(null)
      try {
        await rateTemplate(template.owner, template.name, rating)
        addToast('success', t('permissions.rated', { name: template.name, rating }))
      } catch (err) {
        addToast('error', (err as Error).message)
      } finally {
        setRatingBusy(null)
      }
    },
    [rateTemplate, addToast, t],
  )

  // V3.3.2-T15-3: AutoLink 品类体系（兼容历史 MC 品类）
  const categories = useMemo(() => [
    { value: '', label: t('categories.all') },
    { value: 'general', label: t('categories.general') },
    { value: 'gpu', label: t('categories.gpu') },
    { value: 'storage', label: t('categories.storage') },
    { value: 'network', label: t('categories.network') },
    { value: 'other', label: t('categories.other') },
  ], [t])

  const categoryLabel = useCallback((value?: string) => {
    const match = categories.find((c) => c.value === value)
    return match?.label ?? value ?? t('categories.other')
  }, [categories, t])

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'updated', label: t('sort.latest') },
    { key: 'downloads', label: t('sort.downloads') },
    { key: 'name', label: t('sort.name') },
  ]

  // 收藏过滤
  const visibleTemplates = favoritesOnly
    ? remoteTemplates.filter((tp) => tp.is_favorite)
    : remoteTemplates

  // V4-2: 批量拉取当前可见模板的下载/安装计数
  useEffect(() => {
    if (!visibleTemplates.length) return
    let cancelled = false
    visibleTemplates.forEach(async (tp) => {
      const key = `${tp.owner}/${tp.name}`
      try {
        const s = await templatesApi.stats(tp.owner, tp.name)
        if (!cancelled) setStatsMap((prev) => ({ ...prev, [key]: s }))
      } catch { /* 统计失败静默，保留列表已有 downloads */ }
    })
    return () => { cancelled = true }
  }, [visibleTemplates])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar: category + sort */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 dark:border-edge-subtle">
        <div className="flex gap-1 overflow-x-auto flex-1">
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={`px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors ${
                category === cat.value
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        {/* Sort */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* V3.3.2-T15-3: 我的收藏过滤 */}
          <button
            onClick={() => { setFavoritesOnly((v) => !v); setPage(1) }}
            className={`px-1.5 py-1 rounded text-[10px] transition-colors flex items-center gap-1 ${
              favoritesOnly
                ? 'bg-warning-100 dark:bg-warning-900/30 text-warning-600 dark:text-warning-400 font-medium'
                : 'text-gray-400 hover:text-warning-500'
            }`}
            title={t('permissions.favoritesOnly')}
          >
            <Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} />
            {t('permissions.favoritesOnly')}
          </button>
          {sortOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => { setSort(opt.key); setPage(1) }}
              className={`px-1.5 py-1 rounded text-[10px] transition-colors ${
                sort === opt.key
                  ? 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-auto">
        {!loggedIn && (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            {t('dashboard.notLoggedIn')}
          </div>
        )}

        {loggedIn && remoteLoading && (
          <div className="flex items-center justify-center p-8">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        )}

        {loggedIn && !remoteLoading && remoteError && (
          <div className="p-4 text-center text-sm text-error-500">{remoteError}</div>
        )}

        {loggedIn && !remoteLoading && !remoteError && visibleTemplates.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            {favoritesOnly
              ? t('permissions.noFavorites')
              : (searchQuery ? t('search.noResultsTemplates') : t('noTemplates'))}
          </div>
        )}

        {loggedIn &&
          !remoteLoading &&
          !remoteError &&
          visibleTemplates.map((template) => (
            <div
              key={template.id ?? `${template.owner}/${template.name}`}
              className="px-3 py-3 border-b border-gray-100 dark:border-edge-subtle/50 hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Package size={14} className="text-primary-500 shrink-0" />
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {template.name}
                    </span>
                    <span className="text-[10px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 shrink-0">
                      {categoryLabel(template.category)}
                    </span>
                    {/* 5.0.4-504-b: 精选徽标 */}
                    {template.featured && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 shrink-0 flex items-center gap-0.5">
                        <Award size={10} />
                        {t('permissions.featured')}
                      </span>
                    )}
                    {/* V3.3.2-T15-3: 我的角色徽标 */}
                    {template.my_role && template.my_role !== 'reader' && (
                      <span
                        className={`text-[10px] px-1 py-0.5 rounded shrink-0 flex items-center gap-0.5 ${
                          template.my_role === 'owner'
                            ? 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400'
                            : 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400'
                        }`}
                      >
                        <ShieldCheck size={10} />
                        {t(`permissions.role_${template.my_role}`)}
                      </span>
                    )}
                  </div>
                  {template.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {template.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                      <User size={10} />
                      {template.owner}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                      <Clock size={10} />
                      {new Date(template.updated_at).toLocaleDateString()}
                    </span>
                    {(template.downloads ?? 0) > 0 && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <Download size={10} />
                        {template.downloads}
                      </span>
                    )}
                    {(() => {
                      const s = statsMap[`${template.owner}/${template.name}`]
                      return (s && s.usages > 0) ? (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                          <Package size={10} />
                          {t('templates.installs', { count: s.usages })}
                        </span>
                      ) : null
                    })()}
                    {/* 5.0.4-504-b: 评分星标（点击评分 1-5） + 订阅数 */}
                    {(() => {
                      const key = template.full_name || `${template.owner}/${template.name}`
                      const avg = template.rating_avg ?? 0
                      const count = template.rating_count ?? 0
                      if (count <= 0 && !template.rating_avg) return null
                      const hovered = ratingHover?.startsWith(`${key}:`)
                      const display = hovered ? Number(ratingHover!.split(':').pop()) : Math.round(avg)
                      return (
                        <span
                          className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500"
                          title={t('permissions.rateTitle')}
                        >
                          <span className="flex items-center">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                disabled={ratingBusy === key}
                                onMouseEnter={() => setRatingHover(`${key}:${n}`)}
                                onMouseLeave={() => setRatingHover(null)}
                                onClick={() => handleRate(template, n)}
                                className="p-0 disabled:opacity-50"
                                title={t('permissions.rateStars', { rating: n })}
                              >
                                <Star
                                  size={10}
                                  fill={n <= display ? 'currentColor' : 'none'}
                                  className={n <= display ? 'text-warning-500' : 'text-gray-300 dark:text-gray-600'}
                                />
                              </button>
                            ))}
                          </span>
                          <span>
                            {avg.toFixed(1)}
                            {count > 0 && <span className="opacity-80"> ({count})</span>}
                          </span>
                        </span>
                      )
                    })()}
                    {(template.subscribers_count ?? 0) > 0 && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <Users size={10} />
                        {t('permissions.subscribers', { count: template.subscribers_count })}
                      </span>
                    )}
                    {template.topics && template.topics.length > 0 && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <Tag size={10} />
                        {template.topics.filter((tp) => tp !== 'autolink-template' && !tp.startsWith('category-')).slice(0, 3).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-3 flex items-center gap-1 shrink-0">
                  {/* V3.3.2-T15-3: 收藏星标 */}
                  <button
                    onClick={() => handleToggleFavorite(template)}
                    className={`p-1.5 rounded transition-colors ${
                      template.is_favorite
                        ? 'text-warning-500 hover:bg-warning-50 dark:hover:bg-warning-900/20'
                        : 'text-gray-400 hover:text-warning-500 hover:bg-gray-100 dark:hover:bg-app-hover'
                    }`}
                    title={template.is_favorite ? t('permissions.unfavorite') : t('permissions.favorite')}
                  >
                    <Star size={13} fill={template.is_favorite ? 'currentColor' : 'none'} />
                  </button>
                  {/* V3.3.2-T15-3: 权限管理（owner 可见） */}
                  {template.my_role === 'owner' && (
                    <button
                      onClick={() => setPermDialog({ owner: template.owner, name: template.name })}
                      className="p-1.5 rounded text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-app-hover transition-colors"
                      title={t('permissions.manage')}
                    >
                      <ShieldCheck size={13} />
                    </button>
                  )}
                  {/* 5.0.4-504-b: 订阅 / 取消订阅 */}
                  <button
                    onClick={() => handleToggleSubscribe(template)}
                    disabled={subscribing === (template.full_name || `${template.owner}/${template.name}`)}
                    className={`p-1.5 rounded transition-colors disabled:opacity-50 ${
                      template.is_subscribed
                        ? 'text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                        : 'text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-app-hover'
                    }`}
                    title={template.is_subscribed ? t('permissions.unsubscribe') : t('permissions.subscribe')}
                  >
                    {subscribing === (template.full_name || `${template.owner}/${template.name}`) ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : template.is_subscribed ? (
                      <BellOff size={13} />
                    ) : (
                      <Bell size={13} />
                    )}
                  </button>
                  <button
                    onClick={() => handleInstall(template)}
                    disabled={installing === (template.full_name || `${template.owner}/${template.name}`)}
                    className="px-3 py-1.5 text-xs rounded-md bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 transition-colors flex items-center gap-1"
                  >
                    {installing === (template.full_name || `${template.owner}/${template.name}`) ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    {t('dashboard.install')}
                  </button>
                </div>
              </div>
            </div>
          ))}
      </div>

      {/* Pagination */}
      {loggedIn && totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 dark:border-edge-subtle text-xs text-gray-500 dark:text-gray-400">
          <span>
            {t('pagination.info', { page, total: totalPages })}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number
              if (totalPages <= 5) {
                pageNum = i + 1
              } else if (page <= 3) {
                pageNum = i + 1
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i
              } else {
                pageNum = page - 2 + i
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`min-w-[24px] h-6 rounded text-center ${
                    pageNum === page
                      ? 'bg-primary-500 text-white'
                      : 'hover:bg-gray-100 dark:hover:bg-app-hover'
                  }`}
                >
                  {pageNum}
                </button>
              )
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* V3.3.2-T15-3: 权限管理弹窗 */}
      {permDialog && (
        <TemplatePermissionDialog
          owner={permDialog.owner}
          name={permDialog.name}
          onClose={() => setPermDialog(null)}
        />
      )}
    </div>
  )
}
