import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Download, Trash2, Loader2, Cloud, Globe, Upload } from 'lucide-react'
import { useCloudStore } from '@/stores/cloud.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import type { RemoteProject } from '@/api/cloud'
import { SyncStatusBadge } from './SyncStatusBadge'
import { PullDialog } from './PullDialog'
import { PushDialog } from './PushDialog'

type RemoteProjectViewProps = {
  onPullSuccess: () => void
  searchQuery: string
}

export function RemoteProjectView({ onPullSuccess, searchQuery }: RemoteProjectViewProps) {
  const { t } = useTranslation('cloud')
  const [activeTab, setActiveTab] = useState<'mine' | 'public'>('mine')
  const [pullingProject, setPullingProject] = useState<RemoteProject | null>(null)
  const [pushingName, setPushingName] = useState<string | null>(null)
  const [pushDialogName, setPushDialogName] = useState<string | null>(null)
  const [projectExists, setProjectExists] = useState(false)

  const localProjects = useProjectStore((s) => s.projects)
  const addToast = useToastStore((s) => s.addToast)

  const {
    remoteProjects,
    remoteProjectsLoading,
    publicProjects,
    publicProjectsLoading,
    syncStatuses,
    loggedIn,
    fetchRemoteProjects,
    searchPublicProjects,
    deleteRemoteProject,
    checkSyncStatus,
  } = useCloudStore()

  useEffect(() => {
    if (loggedIn) {
      fetchRemoteProjects()
    }
  }, [loggedIn, fetchRemoteProjects])

  // 加载远程项目后检查同步状态
  useEffect(() => {
    if (remoteProjects.length > 0 && loggedIn) {
      checkSyncStatus(remoteProjects.map((p) => ({ name: p.name })))
    }
  }, [remoteProjects, loggedIn, checkSyncStatus])

  // "我的项目"客户端过滤
  const filteredMyProjects = useMemo(() => {
    if (!searchQuery) return remoteProjects
    const q = searchQuery.toLowerCase()
    return remoteProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q),
    )
  }, [remoteProjects, searchQuery])

  // "公开项目"服务端搜索
  useEffect(() => {
    if (activeTab === 'public' && loggedIn) {
      searchPublicProjects(searchQuery)
    }
  }, [activeTab, searchQuery, loggedIn, searchPublicProjects])

  const handlePull = useCallback(async (project: RemoteProject) => {
    try {
      const projects = await window.electron.project.list()
      const exists = projects.some((p) => p.name === project.name)
      setProjectExists(exists)
    } catch {
      setProjectExists(false)
    }
    setPullingProject(project)
  }, [])

  const handlePush = useCallback((name: string) => {
    setPushDialogName(name)
  }, [])

  // 多本地项目时默认选中第一个
  useEffect(() => {
    if (localProjects.length > 0 && !pushingName) {
      setPushingName(localProjects[0].name)
    }
  }, [localProjects, pushingName])

  const handleDelete = useCallback(
    async (project: RemoteProject) => {
      if (!confirm(t('sync.deleteConfirm', { name: project.name }))) return
      try {
        await deleteRemoteProject(project.owner, project.name)
      } catch (err) {
        addToast('error', (err as Error).message)
      }
    },
    [deleteRemoteProject, t, addToast],
  )

  const displayProjects = activeTab === 'mine' ? filteredMyProjects : publicProjects
  const isLoading = activeTab === 'mine' ? remoteProjectsLoading : publicProjectsLoading

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 dark:border-edge-subtle">
        <button
          onClick={() => setActiveTab('mine')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'mine'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Cloud size={12} />
          {t('projects.my')}
        </button>
        <button
          onClick={() => setActiveTab('public')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'public'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Globe size={12} />
          {t('projects.public')}
        </button>
        <div className="flex-1" />
        {activeTab === 'mine' && localProjects.length === 1 && (
          <button
            onClick={() => handlePush(localProjects[0].name)}
            className="flex items-center gap-1 px-2.5 py-2 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
            title={t('sync.push')}
          >
            <Upload size={12} />
            {t('sync.push')}
          </button>
        )}
        <button
          onClick={() => fetchRemoteProjects()}
          disabled={remoteProjectsLoading}
          className="flex items-center gap-1 px-2 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          title={t('retry')}
        >
          <RefreshCw size={12} className={remoteProjectsLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 本地项目推送选择器（我的项目页） */}
      {activeTab === 'mine' && localProjects.length > 1 && (
        <div className="px-3 py-1.5 border-b border-gray-100 dark:border-edge-subtle/50 flex items-center gap-1.5">
          <span className="text-2xs text-gray-400 shrink-0">{t('sync.pushFrom')}</span>
          <select
            value={pushingName || localProjects[0].name}
            onChange={(e) => setPushingName(e.target.value)}
            className="flex-1 min-w-0 px-1.5 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-app text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          >
            {localProjects.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={() => handlePush(pushingName || localProjects[0].name)}
            className="text-2xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0"
          >
            {t('sync.push')}
          </button>
        </div>
      )}

      {/* Project list */}
      <div className="flex-1 overflow-auto">
        {!loggedIn && (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            {t('dashboard.notLoggedIn')}
          </div>
        )}

        {loggedIn && isLoading && (
          <div className="flex items-center justify-center p-8">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        )}

        {loggedIn && !isLoading && displayProjects.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            {searchQuery
              ? t('search.noResults')
              : activeTab === 'mine'
                ? t('projects.emptyMine')
                : t('projects.emptyPublic')}
          </div>
        )}

        {loggedIn &&
          !isLoading &&
          displayProjects.map((project) => {
            const syncStatus = syncStatuses[project.name]
            return (
              <div
                key={project.id}
                className="flex items-center gap-3 px-3 py-3 border-b border-gray-100 dark:border-edge-subtle/50 hover:bg-gray-50 dark:hover:bg-app-hover transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {project.name}
                    </span>
                    {project.private ? (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                        {t('projects.private')}
                      </span>
                    ) : (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        {t('projects.public')}
                      </span>
                    )}
                    <SyncStatusBadge syncStatus={syncStatus} />
                  </div>
                  {project.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {project.description}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {project.owner} · {new Date(project.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handlePull(project)}
                    className="p-1.5 rounded hover:bg-primary-50 dark:hover:bg-primary-900/30 text-primary-500 transition-colors"
                    title={t('sync.pull')}
                  >
                    <Download size={14} />
                  </button>
                  {activeTab === 'mine' && (
                    <button
                      onClick={() => handleDelete(project)}
                      className="p-1.5 rounded hover:bg-error-50 dark:hover:bg-error-900/30 text-error-400 hover:text-error-500 transition-colors"
                      title={t('projects.delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
      </div>

      {/* Pull dialog */}
      {pullingProject && (
        <PullDialog
          owner={pullingProject.owner}
          repo={pullingProject.name}
          projectName={pullingProject.name}
          existsLocally={projectExists}
          onClose={() => setPullingProject(null)}
          onSuccess={() => {
            setPullingProject(null)
            onPullSuccess()
          }}
        />
      )}

      {/* Push dialog */}
      {pushDialogName && (
        <PushDialog
          projectName={pushDialogName}
          onClose={() => setPushDialogName(null)}
          onSuccess={() => {
            addToast('success', t('sync.pushSuccess', { name: pushDialogName }))
            fetchRemoteProjects()
          }}
        />
      )}
    </div>
  )
}
