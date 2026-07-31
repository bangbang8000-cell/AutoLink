import React, { useState, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Search, Plus, Trash2, Star, Clock, FolderOpen,
  ChevronRight, ChevronDown, RefreshCw, Package,
} from 'lucide-react'
import { useProjectStore, type ProjectInfo, type TemplateInfo } from '@/stores/project.store'
import { CreateProjectWizardModal } from '../wizard/CreateProjectWizardModal'

/* -------------------------------------------------- */
/*  Collapsible Section                               */
/* -------------------------------------------------- */
function Section({
  title,
  icon,
  defaultOpen = true,
  children,
  onRefresh,
}: {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
  onRefresh?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="select-none">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1 px-3 py-1.5 text-2xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-200"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {onRefresh && (
          <button
            onClick={(e) => { e.stopPropagation(); onRefresh() }}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            title="Refresh"
          >
            <RefreshCw size={10} />
          </button>
        )}
      </button>
      {open && <div className="pb-0.5">{children}</div>}
    </div>
  )
}

/* -------------------------------------------------- */
/*  Project Item                                      */
/* -------------------------------------------------- */
const ProjectItem = memo(function ProjectItem({
  project,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onDelete,
}: {
  project: ProjectInfo
  isSelected: boolean
  isFavorite: boolean
  onSelect: () => void
  onToggleFavorite: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-1.5 px-3 py-1 cursor-pointer text-xs
        ${isSelected
          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-200'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
        }`}
    >
      <FolderOpen size={13} className="shrink-0 text-gray-400" />
      <span className="flex-1 truncate">{project.name}</span>
      <div className="hidden group-hover:flex items-center gap-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
          className={`p-0.5 rounded ${isFavorite ? 'text-warning-400' : 'text-gray-400 hover:text-warning-400'}`}
          title={t('project:favorites')}
        >
          <Star size={11} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-0.5 rounded text-gray-400 hover:text-error-500"
          title={t('project:deleteProject')}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
})

/* -------------------------------------------------- */
/*  Delete Confirm Dialog                             */
/* -------------------------------------------------- */
function DeleteConfirmDialog({
  name,
  onConfirm,
  onCancel,
}: {
  name: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-80 border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-700 dark:text-gray-200 mb-4">
          {t('project:deleteConfirm', { name })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            {t('project:cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1 text-xs rounded bg-error-500 text-white hover:bg-error-600"
          >
            {t('project:confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------- */
/*  Template Item                                     */
/* -------------------------------------------------- */
const TemplateItem = memo(function TemplateItem({
  template,
  onCreateProject,
}: {
  template: TemplateInfo
  onCreateProject: () => void
}) {
  return (
    <div
      onClick={onCreateProject}
      className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300"
    >
      <Package size={13} className="shrink-0 text-gray-400" />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{template.name}</div>
        <div className="truncate text-2xs text-gray-400 dark:text-gray-500">
          {template.description}
        </div>
      </div>
      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
        {template.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="px-1 py-0.5 text-3xs rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
})

/* -------------------------------------------------- */
/*  ExplorerPanel                                     */
/* -------------------------------------------------- */
export function ExplorerPanel() {
  const { t } = useTranslation()
  const {
    projects, selectedProjectName, templates,
    favoriteProjects, recentProjects,
    fetchProjects, selectProject, toggleFavorite,
    deleteProjects,
  } = useProjectStore()

  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteName, setDeleteName] = useState<string | null>(null)

  const filteredProjects = useMemo(() => {
    if (!search.trim()) return projects
    const q = search.toLowerCase()
    return projects.filter((p) => p.name.toLowerCase().includes(q))
  }, [projects, search])

  const favProjects = useMemo(
    () => projects.filter((p) => favoriteProjects.includes(p.name)),
    [projects, favoriteProjects],
  )

  const recentProj = useMemo(
    () => projects.filter((p) => recentProjects.includes(p.name) && p.name !== selectedProjectName),
    [projects, recentProjects, selectedProjectName],
  )

  return (
    <div className="h-full flex flex-col">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-2xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('project:title')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => fetchProjects()}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            title={t('project:createProject')}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      {projects.length > 0 && (
        <div className="px-2 py-1.5">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('project:projectNamePlaceholder') ?? 'Search...'}
              className="w-full pl-6 pr-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-primary-400"
            />
          </div>
        </div>
      )}

      {/* Scrolling content */}
      <div className="flex-1 overflow-auto">
        {/* Empty state */}
        {projects.length === 0 && (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <FolderOpen size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              {t('project:noProjects')}
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
            >
              <Plus size={13} />
              {t('project:createProject')}
            </button>
          </div>
        )}

        {/* Favorites */}
        {favProjects.length > 0 && (
          <Section title={t('project:favorites')} icon={<Star size={11} className="text-gray-400" />}>
            {favProjects.map((p) => (
              <ProjectItem
                key={p.name}
                project={p}
                isSelected={p.name === selectedProjectName}
                isFavorite={true}
                onSelect={() => selectProject(p)}
                onToggleFavorite={() => toggleFavorite(p.name)}
                onDelete={() => setDeleteName(p.name)}
              />
            ))}
          </Section>
        )}

        {/* Recent */}
        {recentProj.length > 0 && (
          <Section title={t('project:recent')} icon={<Clock size={11} className="text-gray-400" />}>
            {recentProj.map((p) => (
              <ProjectItem
                key={p.name}
                project={p}
                isSelected={p.name === selectedProjectName}
                isFavorite={favoriteProjects.includes(p.name)}
                onSelect={() => selectProject(p)}
                onToggleFavorite={() => toggleFavorite(p.name)}
                onDelete={() => setDeleteName(p.name)}
              />
            ))}
          </Section>
        )}

        {/* Main project list */}
        {filteredProjects.length > 0 && (
          <Section
            title={t('project:projectList')}
            icon={<FolderOpen size={11} className="text-gray-400" />}
            onRefresh={() => fetchProjects()}
          >
            {filteredProjects.map((p) => (
              <ProjectItem
                key={p.name}
                project={p}
                isSelected={p.name === selectedProjectName}
                isFavorite={favoriteProjects.includes(p.name)}
                onSelect={() => selectProject(p)}
                onToggleFavorite={() => toggleFavorite(p.name)}
                onDelete={() => setDeleteName(p.name)}
              />
            ))}
          </Section>
        )}

        {/* Templates */}
        {templates.length > 0 && (
          <Section title={t('project:templateCenter')} icon={<Package size={11} className="text-gray-400" />}>
            {templates.map((tmpl) => (
              <TemplateItem
                key={tmpl.id}
                template={tmpl}
                onCreateProject={() => setModalOpen(true)}
              />
            ))}
          </Section>
        )}
      </div>

      {/* Delete confirm dialog */}
      {deleteName && (
        <DeleteConfirmDialog
          name={deleteName}
          onConfirm={async () => {
            await deleteProjects([deleteName])
            setDeleteName(null)
          }}
          onCancel={() => setDeleteName(null)}
        />
      )}

      {/* Create project wizard */}
      {modalOpen && (
        <CreateProjectWizardModal
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
