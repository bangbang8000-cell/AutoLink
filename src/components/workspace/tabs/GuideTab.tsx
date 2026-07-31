import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertCircle, Loader2, BookOpen } from 'lucide-react'

/**
 * 用户指南标签页。
 * 从应用内置文档目录(docs/user_guide/user_guide.md)读取 markdown 内容,
 * 在工作区中以渲染后的格式展示,无需联网。
 */
export function GuideTab() {
  const { t } = useTranslation('common')
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const text = await window.electron?.app?.readDocFile?.('user_guide.md')
        if (cancelled) return
        if (text == null) {
          setError(t('guide.notFound'))
        } else {
          setContent(text)
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error)?.message || t('guide.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [t])

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 gap-2">
        <Loader2 size={24} className="animate-spin" />
        <span className="text-sm">{t('guide.loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-red-500 dark:text-red-400 gap-2 p-6">
        <AlertCircle size={24} />
        <span className="text-sm text-center">{error}</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-white dark:bg-gray-800">
      <div className="max-w-4xl mx-auto px-8 py-6">
        {/* 顶部标识 */}
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
          <BookOpen size={18} className="text-primary-500" />
          <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {t('guide.title')}
          </h1>
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
