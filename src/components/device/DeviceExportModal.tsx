import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Download, Check, FileJson, FileSpreadsheet, Package } from 'lucide-react'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import clsx from 'clsx'

export function DeviceExportModal() {
  const { t } = useTranslation('device')
  const {
    showExportModal,
    closeExportModal,
    allDevices,
    filteredDevices,
    exportDevices,
  } = useDeviceLibraryStore()

  const [mode, setMode] = useState<'all' | 'selected'>('all')
  const [format, setFormat] = useState<'json' | 'excel' | 'zip'>('json')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleDevice = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleExport = async () => {
    const ids = mode === 'all' ? allDevices.map((d) => d.id) : Array.from(selectedIds)
    await exportDevices(ids, format)
  }

  const displayDevices = mode === 'all' ? allDevices : filteredDevices

  if (!showExportModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeExportModal}>
      <div
        className="bg-white dark:bg-app-surface rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-edge-subtle">
          <h3 className="text-sm font-semibold">{t('export.title')}</h3>
          <button onClick={closeExportModal} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Mode selection */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
              {t('export.selectDevices')}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('all')}
                className={clsx(
                  'flex-1 px-3 py-2 text-xs rounded border',
                  mode === 'all'
                    ? 'border-primary-300 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400',
                )}
              >
                {t('export.allDevices')}
              </button>
              <button
                onClick={() => setMode('selected')}
                className={clsx(
                  'flex-1 px-3 py-2 text-xs rounded border',
                  mode === 'selected'
                    ? 'border-primary-300 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400',
                )}
              >
                {t('export.selectedDevices', { count: selectedIds.size })}
              </button>
            </div>
          </div>

          {/* Device selection list (only in selected mode) */}
          {mode === 'selected' && (
            <div className="border border-gray-200 dark:border-gray-600 rounded max-h-[240px] overflow-y-auto">
              {displayDevices.map((device) => {
                const isSelected = selectedIds.has(device.id)
                return (
                  <div
                    key={device.id}
                    onClick={() => toggleDevice(device.id)}
                    className={clsx(
                      'flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer border-b border-gray-100 dark:border-edge-subtle last:border-b-0 transition-colors',
                      isSelected
                        ? 'bg-primary-50 dark:bg-primary-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-app-hover',
                    )}
                  >
                    <div className={clsx(
                      'w-4 h-4 rounded border flex items-center justify-center',
                      isSelected
                        ? 'bg-primary-500 border-primary-500 text-white'
                        : 'border-gray-300 dark:border-gray-600',
                    )}>
                      {isSelected && <Check size={10} />}
                    </div>
                    <span className="text-gray-500">{device.vendor}</span>
                    <span className="font-medium">{device.model}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Format selection */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
              {t('export.format')}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setFormat('json')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-2 text-xs rounded border',
                  format === 'json'
                    ? 'border-primary-300 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400',
                )}
              >
                <FileJson size={14} /> {t('export.json')}
              </button>
              <button
                onClick={() => setFormat('excel')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-2 text-xs rounded border',
                  format === 'excel'
                    ? 'border-primary-300 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400',
                )}
              >
                <FileSpreadsheet size={14} /> {t('export.excel')}
              </button>
              <button
                onClick={() => setFormat('zip')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-2 text-xs rounded border',
                  format === 'zip'
                    ? 'border-primary-300 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400',
                )}
              >
                <Package size={14} /> {t('export.zip')}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-edge-subtle">
          <button
            onClick={closeExportModal}
            className="px-3 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-app-hover"
          >
            {t('export.cancel')}
          </button>
          <button
            onClick={handleExport}
            disabled={mode === 'selected' && selectedIds.size === 0}
            className={clsx(
              'flex items-center gap-1 px-3 py-1.5 text-xs rounded text-white',
              (mode === 'all' || selectedIds.size > 0)
                ? 'bg-primary-600 hover:bg-primary-700'
                : 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed',
            )}
          >
            <Download size={12} /> {t('export.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}