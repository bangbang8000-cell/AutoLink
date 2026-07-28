import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Maximize2 } from 'lucide-react'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import clsx from 'clsx'

export function DeviceLibraryPanel() {
  const { t } = useTranslation('device')
  const {
    loadLibrary, setFilter, filter,
  } = useDeviceLibraryStore()
  const openTab = useWorkspaceStore((s) => s.openTab)

  useEffect(() => {
    loadLibrary()
  }, [])

  const handleOpenWorkspace = () => {
    openTab({ type: 'deviceLibrary', title: '设备库', closable: false })
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <button
          onClick={handleOpenWorkspace}
          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          title="在工作区打开设备库"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {/* Quick search */}
      <div className="px-2 py-1.5">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filter.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            placeholder={t('search')}
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-0.5 px-2 overflow-x-auto scrollbar-thin pb-1.5">
        {[
          { id: 'all', label: t('category.all') },
          { id: 'gpu_servers', label: t('category.gpu_servers') },
          { id: 'storage_servers', label: t('category.storage_servers') },
          { id: 'compute_servers', label: t('category.compute_servers') },
          { id: 'switches', label: t('category.switches') },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setFilter({ category: cat.id as typeof filter.category })}
            className={clsx(
              'px-2 py-1 text-xs rounded whitespace-nowrap transition-colors',
              filter.category === cat.id
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Open workspace button */}
      <div className="px-3 pt-2 pb-3 mt-auto border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={handleOpenWorkspace}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Maximize2 size={13} />
          在工作区打开完整设备库
        </button>
      </div>
    </div>
  )
}
