import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertCircle, Loader2, Plug, Copy, Check } from 'lucide-react'
import { MCP_CONFIG_JSON } from '@/utils/mcpGuide'

/**
 * MCP 接入指南标签页（Agent Connect）。
 * 从应用内置文档目录(docs/user_guide/mcp_guide.md)读取 markdown 内容,
 * 在工作区中以渲染后的格式展示,并提供一键复制接入配置,无需联网。
 */
export function McpGuideTab() {
  const { t } = useTranslation('common')
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const text = await window.electron?.app?.readDocFile?.('mcp_guide.md')
        if (cancelled) return
        if (text == null) {
          setError(t('guide.mcpNotFound', { defaultValue: 'MCP 接入指南文档不存在' }))
        } else {
          setContent(text)
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error)?.message || t('guide.mcpLoadFailed', { defaultValue: 'MCP 接入指南加载失败' }))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [t])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_CONFIG_JSON)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* 剪贴板不可用时静默 */ }
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 gap-2">
        <Loader2 size={24} className="animate-spin" />
        <span className="text-sm">{t('guide.mcpLoading', { defaultValue: '正在加载 MCP 接入指南...' })}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-error-500 dark:text-error-400 gap-2 p-6">
        <AlertCircle size={24} />
        <span className="text-sm text-center">{error}</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-white dark:bg-app-elevated">
      <div className="max-w-4xl mx-auto px-8 py-6">
        {/* 顶部标识 + 一键复制 */}
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-200 dark:border-edge-subtle">
          <Plug size={18} className="text-primary-500" />
          <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {t('guide.mcpTitle', { defaultValue: 'MCP 接入指南' })}
          </h1>
          <button
            onClick={() => void handleCopy()}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover transition-colors"
          >
            {copied ? <Check size={12} className="text-success-500" /> : <Copy size={12} />}
            {copied
              ? t('guide.mcpCopied', { defaultValue: '已复制' })
              : t('guide.mcpCopyConfig', { defaultValue: '复制接入配置' })}
          </button>
        </div>
        {/* Markdown 渲染 */}
        <article className="prose prose-sm dark:prose-invert max-w-none
          prose-headings:font-semibold prose-headings:text-gray-800 dark:prose-headings:text-gray-100
          prose-h1:text-2xl prose-h1:border-b prose-h1:border-gray-200 dark:prose-h1:border-gray-700 prose-h1:pb-2
          prose-h2:text-xl prose-h2:mt-6
          prose-h3:text-base prose-h3:mt-4
          prose-p:text-gray-600 dark:prose-p:text-gray-300 prose-p:leading-relaxed
          prose-a:text-primary-500 prose-a:no-underline hover:prose-a:underline
          prose-strong:text-gray-800 dark:prose-strong:text-gray-100
          prose-code:text-primary-600 dark:prose-code:text-primary-400 prose-code:bg-gray-100 dark:prose-code:bg-gray-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-gray-50 dark:prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-200 dark:prose-pre:border-gray-700
          prose-table:text-xs
          prose-th:bg-gray-50 dark:prose-th:bg-gray-700 prose-th:text-gray-700 dark:prose-th:text-gray-200
          prose-td:text-gray-600 dark:prose-td:text-gray-300
          prose-li:text-gray-600 dark:prose-li:text-gray-300
          prose-blockquote:border-l-primary-400 prose-blockquote:bg-primary-50 dark:prose-blockquote:bg-primary-900/20 prose-blockquote:py-1 prose-blockquote:px-4
          prose-hr:border-gray-200 dark:prose-hr:border-gray-700
        ">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown>
        </article>
      </div>
    </div>
  )
}
