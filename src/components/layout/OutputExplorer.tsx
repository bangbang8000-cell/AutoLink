/**
 * 打磨轮（v1.6 / AL-O2a）：输出结果（全部项目）中栏
 * 复用 OutputSection 的项目输出批次树 → 点击文件在工作区 fileViewer 预览。
 */
import { useTranslation } from 'react-i18next'
import { Files } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { OutputSection } from '@/components/layout/OutputSection'

export function OutputExplorer() {
  const { t } = useTranslation()
  const projects = useProjectStore((s) => s.projects)
  const openTab = useWorkspaceStore((s) => s.openTab)

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 flex items-center gap-1.5 shrink-0">
        <Files size={13} className="text-amber-500" />
        {t('menu.output', '输出结果')}（全部项目）
      </div>
      <div className="flex-1 overflow-auto">
        {projects.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-400">暂无项目</div>
        ) : (
          <OutputSection projects={projects} openTab={openTab} />
        )}
      </div>
    </div>
  )
}
