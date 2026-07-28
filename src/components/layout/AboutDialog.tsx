import React from 'react'
import { useTranslation } from 'react-i18next'
import { X, GitBranch, ExternalLink } from 'lucide-react'

interface Props {
  onClose: () => void
}

export function AboutDialog({ onClose }: Props) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[400px] border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">关于 AutoLink</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 text-center">
          <div className="text-4xl mb-3">🔗</div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">AutoLink</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            AI 智算中心网络规划与可视化工具
          </p>

          <div className="mt-4 space-y-1 text-xs text-gray-500 dark:text-gray-400">
            <div><span className="text-gray-400">版本:</span> 2.0.1</div>
            <div><span className="text-gray-400">Electron:</span> 28.x</div>
            <div><span className="text-gray-400">React:</span> 18.x</div>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
            <a
              href="https://github.com/bangbang8000-cell/AutoLink"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary-500 hover:text-primary-600"
            >
              <GitBranch size={14} />
              GitHub Repository
              <ExternalLink size={10} />
            </a>
          </div>

          <p className="mt-3 text-[10px] text-gray-400 dark:text-gray-500">
            &copy; 2026 AutoLink Team. MIT License.
          </p>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
