import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Network, Maximize2 } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useDesignStore } from '@/stores/design.store'
import { useWorkspaceStore } from '@/stores/workspace.store'

export function TopologyPanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const topology = useDesignStore((s) => s.topology)
  const openTab = useWorkspaceStore((s) => s.openTab)

  const handleOpenWorkspace = () => {
    openTab({
      type: 'topology',
      title: selectedProjectName ? `拓扑视图 - ${selectedProjectName}` : '拓扑视图',
      closable: true,
    })
  }

  const stats = useMemo(() => {
    if (!topology) return { nodes: 0, edges: 0, types: new Set<string>() }
    return {
      nodes: topology.nodes.length,
      edges: topology.edges.length,
      types: new Set(topology.nodes.map((n) => n.type)),
    }
  }, [topology])

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <GitBranch size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-xs text-gray-400">{t('topology:noProject')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('topology:title')}
        </span>
      </div>

      {!topology ? (
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <Network size={28} className="text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-xs text-gray-400 mb-3">尚未生成拓扑</p>
          <p className="text-[10px] text-gray-400 mb-1">
            在「设计」面板中生成拓扑
          </p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="px-3 py-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 dark:bg-gray-800 rounded p-2 text-center">
                <div className="text-lg font-bold text-primary-600 dark:text-primary-400">{stats.nodes}</div>
                <div className="text-[10px] text-gray-400">{t('topology:deviceList')}</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded p-2 text-center">
                <div className="text-lg font-bold text-purple-600 dark:text-purple-400">{stats.edges}</div>
                <div className="text-[10px] text-gray-400">{t('topology:connectionList')}</div>
              </div>
            </div>

            {/* Node type summary */}
            <div className="flex flex-wrap gap-1">
              {Array.from(stats.types).slice(0, 8).map((type) => (
                <span key={type} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                  {type}
                </span>
              ))}
            </div>
          </div>

          {/* Open in workspace button */}
          <div className="px-3 pb-3 mt-auto">
            <button
              onClick={handleOpenWorkspace}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs rounded border border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
            >
              <Maximize2 size={13} />
              在工作区查看完整拓扑
            </button>
          </div>
        </>
      )}
    </div>
  )
}
