import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/project.store'

export function StatusBar() {
  const { t } = useTranslation()
  const selectedProject = useProjectStore((s) => s.selectedProject)
  const projects = useProjectStore((s) => s.projects)

  return (
    <div className="h-6 flex items-center justify-between shrink-0 bg-gray-100 dark:bg-app-surface border-t border-gray-200 dark:border-edge-subtle px-3 text-2xs text-gray-500 dark:text-gray-400 select-none">
      <div className="flex items-center gap-3">
        <span>
          {selectedProject
            ? `📁 ${selectedProject.name}`
            : t('common:status.noProject')}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span>{t('common:status.projectCount', { count: projects.length })}</span>
        <span>v2.0.1</span>
      </div>
    </div>
  )
}
