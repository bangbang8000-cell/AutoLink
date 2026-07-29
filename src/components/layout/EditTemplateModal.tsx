import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

interface TemplateData {
  id: string
  name: string
  description: string
  scenario: string
  tags: string[]
}

interface Props {
  template: TemplateData
  configContent?: string
  onConfirm: (updates: {
    name: string
    description: string
    scenario: string
    tags: string[]
    configContent?: string
  }) => Promise<void>
  onClose: () => void
}

export function EditTemplateModal({ template, configContent: initialConfig, onConfirm, onClose }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description || '')
  const [scenario, setScenario] = useState(template.scenario || '')
  const [tagsText, setTagsText] = useState((template.tags || []).join(', '))
  const [configContent, setConfigContent] = useState(initialConfig || '')
  const [configLoaded, setConfigLoaded] = useState(!!initialConfig)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 若未传入 configContent，则异步加载
  useEffect(() => {
    if (!initialConfig) {
      window.electron?.template?.getFile(template.id, 'network_config.ini')
        .then((content) => {
          if (content) {
            setConfigContent(content)
          }
          setConfigLoaded(true)
        })
        .catch(() => setConfigLoaded(true))
    }
  }, [template.id, initialConfig])

  const handleConfirm = useCallback(async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('common:project.nameRequired', '名称不能为空'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const tags = tagsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      await onConfirm({
        name: trimmedName,
        description: description.trim(),
        scenario: scenario.trim(),
        tags,
        configContent,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [name, description, scenario, tagsText, configContent, onConfirm, onClose, t])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[560px] max-h-[85vh] flex flex-col border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {t('common:template.edit', '编辑模板')} - {template.id}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('common:template.name', '模板名称')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError('') }}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('common:template.description', '描述')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              rows={2}
              className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('common:template.scenario', '场景')}
              </label>
              <input
                type="text"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('common:template.tags', '标签（逗号分隔）')}
              </label>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                disabled={loading}
                placeholder="H100, 128台, 2层组网"
                className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('common:template.configContent', '配置内容 (network_config.ini)')}
            </label>
            {!configLoaded ? (
              <div className="h-48 flex items-center justify-center text-xs text-gray-400">
                {t('common:loading', '加载中...')}
              </div>
            ) : (
              <textarea
                value={configContent}
                onChange={(e) => setConfigContent(e.target.value)}
                disabled={loading}
                rows={12}
                spellCheck={false}
                className="w-full px-3 py-2 text-[11px] font-mono rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
              />
            )}
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {t('common:cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !name.trim()}
            className="px-3 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50"
          >
            {loading ? t('common:processing') : t('common:save')}
          </button>
        </div>
      </div>
    </div>
  )
}
