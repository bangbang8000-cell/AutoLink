import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Package, FileText, Check } from 'lucide-react'
import { useProjectStore, type TemplateInfo } from '@/stores/project.store'

interface Props {
  templates: TemplateInfo[]
  onClose: () => void
}

export function CreateProjectModal({ templates, onClose }: Props) {
  const { t } = useTranslation()
  const { projects, createProject } = useProjectStore()

  const [name, setName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请输入项目名称')
      return
    }
    if (projects.some((p) => p.name === trimmed)) {
      setError('项目名称已存在')
      return
    }
    setCreating(true)
    setError(null)
    try {
      await createProject(trimmed, {
        ...(selectedTemplate && selectedTemplate !== 'empty' ? { template: selectedTemplate } : {}),
        ...(selectedTemplate === 'empty' ? { empty: true } : {}),
      })
      onClose()
    } catch (err: any) {
      setError(err?.message ?? '创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[480px] max-h-[70vh] flex flex-col border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {t('project:createProject')}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Project name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              {t('project:projectName')}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              placeholder={t('project:projectNamePlaceholder')}
              className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
            />
          </div>

          {/* Template selection */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              {t('project:templateSelect')}
            </label>
            <div className="space-y-1.5 max-h-48 overflow-auto">
              {/* Empty project option */}
              <button
                onClick={() => setSelectedTemplate('empty')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors
                  ${selectedTemplate === 'empty'
                    ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-500'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
              >
                <div className="w-8 h-8 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <FileText size={16} className="text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {t('project:emptyProject')}
                  </div>
                  <div className="text-xs text-gray-400">{t('project:emptyProject')}</div>
                </div>
                {selectedTemplate === 'empty' && (
                  <Check size={16} className="text-gray-400 shrink-0" />
                )}
              </button>

              {/* Template list */}
              {templates.filter((t) => t.id !== '空项目').map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => setSelectedTemplate(tmpl.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors
                    ${selectedTemplate === tmpl.id
                      ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-500'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                >
                  <div className="w-8 h-8 rounded bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                    <Package size={16} className="text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {tmpl.name}
                    </div>
                    <div className="text-xs text-gray-400 truncate">{tmpl.description}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {tmpl.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  {selectedTemplate === tmpl.id && (
                    <Check size={16} className="text-gray-400 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {t('project:cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="px-4 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? t('common:status.rendering') : t('project:confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
