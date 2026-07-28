import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import clsx from 'clsx'

export interface DeleteTarget {
  /** Label shown in title and confirmation input */
  name: string
  /** Type discriminator for UI text */
  type: 'project' | 'template' | 'file' | 'batch' | 'clearOutput'
}

interface Props {
  target: DeleteTarget
  onConfirm: () => Promise<void>
  onClose: () => void
}

const LABELS: Record<DeleteTarget['type'], { title: (n: string) => string; warning: string; requireName: boolean }> = {
  project: {
    title: (n) => `删除项目 ${n}`,
    warning: '此操作不可撤销。项目文件夹及其所有配置、输出文件将被永久删除。',
    requireName: true,
  },
  template: {
    title: (n) => `删除模板 ${n}`,
    warning: '模板将被永久删除，但不会影响已创建的项目。',
    requireName: true,
  },
  file: {
    title: (n) => `删除输出文件 ${n}`,
    warning: '此文件将被永久删除。',
    requireName: false,
  },
  batch: {
    title: (n) => `删除输出批次 ${n}`,
    warning: '该批次目录及所有文件将被永久删除。',
    requireName: false,
  },
  clearOutput: {
    title: (n) => `清空 ${n} 的全部输出`,
    warning: '所有渲染输出文件（拓扑图、表格、清单等）将被永久删除。此操作不可撤销。',
    requireName: true,
  },
}

export function ConfirmDeleteDialog({ target, onConfirm, onClose }: Props) {
  const [confirmName, setConfirmName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const config = LABELS[target.type]
  const canConfirm = !config.requireName || confirmName === target.name

  const handleConfirm = async () => {
    if (!canConfirm || loading) return
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
      setLoading(false)
    }
  }

  return (
    <div className={clsx(
      'fixed inset-0 z-[9999] flex items-center justify-center',
      'bg-black/30 dark:bg-black/50',
    )} onClick={onClose}>
      <div
        className={clsx(
          'bg-white dark:bg-gray-800 rounded-xl shadow-2xl',
          'w-full max-w-sm mx-4 overflow-hidden',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {config.title(target.name)}
            </h3>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
            {config.warning}
          </p>

          {config.requireName && (
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                请输入 <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">{target.name}</span> 以确认删除：
              </label>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={target.name}
                className={clsx(
                  'w-full px-3 py-1.5 text-xs rounded-lg border',
                  'bg-gray-50 dark:bg-gray-900',
                  'border-gray-200 dark:border-gray-600',
                  'focus:outline-none focus:ring-2 focus:ring-red-400',
                  'text-gray-900 dark:text-gray-100 placeholder-gray-400',
                )}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
              />
            </div>
          )}

          {error && (
            <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={onClose}
            disabled={loading}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg transition-colors',
              'text-gray-600 dark:text-gray-400',
              'hover:bg-gray-200 dark:hover:bg-gray-700',
            )}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-1.5',
              canConfirm && !loading
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed',
            )}
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}
