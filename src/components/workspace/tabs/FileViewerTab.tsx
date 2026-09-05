import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, Table2, FileSpreadsheet, FileText } from 'lucide-react'
import * as XLSX from 'xlsx'
import { ExcelTable } from '@/components/workspace/ExcelTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { getCachedExcel, setCachedExcel, parseWorkbookChunked } from '@/utils/excel-cache'
import { IMAGE_MIME, getFileExt, getImageMime, splitProjectFilePath } from '@/utils/file-type'

interface Props {
  templateName?: string
  filePath?: string
  isTemplate?: boolean
}

export function FileViewerTab({ templateName, filePath, isTemplate }: Props) {
  const { t } = useTranslation('common')
  const [content, setContent] = useState<string | null>(null)
  // v2.8.0-T2: 一次加载全部 sheet 缓存(dataMap),切 sheet 由 ExcelTable 纯状态切换
  const [excelData, setExcelData] = useState<Record<string, string[][]> | null>(null)
  // v2.8.0-T5: 图片 data URL 预览(修复 PNG 按文本读取乱码)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // V2.9.2-T5: Excel 分片解析进度(0-100), null 表示未在解析
  const [parseProgress, setParseProgress] = useState<number | null>(null)

  const displayPath = isTemplate && templateName && filePath
    ? `${templateName}/${filePath}`
    : filePath || templateName || ''

  const ext = getFileExt(filePath || '')
  const isExcel = ext === 'xlsx' || ext === 'xls'
  const isJson = ext === 'json'
  // v2.8.0-T5: 图片类型判定
  const isImage = ext in IMAGE_MIME

  const loadFile = useCallback(async () => {
    if (!filePath && !templateName) return

    setLoading(true)
    setError(null)
    try {
      if (isExcel) {
        // v2.8.0-T2/T3: 一次解析全部 sheet 并缓存,消除 atob 逐字节解码
        const parts = filePath ? splitProjectFilePath(filePath) : null
        if (parts) {
          const cacheKey = `${parts.projectName}/${parts.relPath}`
          let dataMap = getCachedExcel(cacheKey)
          if (!dataMap) {
            const base64 = await window.electron.project.getFileBinary(parts.projectName, parts.relPath)
            if (base64) {
              const wb = XLSX.read(base64, { type: 'base64' })
              // V2.9.2-T5: 分片解析 + 真实进度
              setParseProgress(0)
              dataMap = await parseWorkbookChunked(wb, (p) => setParseProgress(p))
              setCachedExcel(cacheKey, dataMap)
            }
          }
          if (dataMap) setExcelData(dataMap)
        }
        setContent(null)
        setImageSrc(null)
      } else if (isImage) {
        // v2.8.0-T5: 图片走二进制读取 + data URL 渲染(修复乱码)
        const parts = filePath ? splitProjectFilePath(filePath) : null
        if (parts) {
          const base64 = await window.electron.project.getFileBinary(parts.projectName, parts.relPath)
          const mime = getImageMime(parts.relPath)
          if (base64 && mime) {
            setImageSrc(`data:${mime};base64,${base64}`)
          }
        }
        setContent(null)
        setExcelData(null)
      } else {
        // Text files
        let text: string | null = null
        if (isTemplate && templateName) {
          const fp = filePath || ''
          text = await window.electron.template.getFile(templateName, fp)
        } else if (filePath) {
          const parts = splitProjectFilePath(filePath)
          if (parts) {
            text = await window.electron.project.getFile(parts.projectName, parts.relPath)
          }
        }
        setContent(text)
        setExcelData(null)
        setImageSrc(null)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      setParseProgress(null)
    }
  }, [filePath, templateName, isTemplate, isExcel, isImage])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时异步加载文件内容并更新加载态
    loadFile()
  }, [loadFile])

  const handleCopy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }, [content])

  /* ---------- render ---------- */

  const renderContent = () => {
    if (excelData) return renderExcel()
    if (imageSrc) return renderImage()
    if (content === null) {
      return (
        <div className="h-full">
          <EmptyState
            icon={FileText}
            title={t('emptyFile', '文件内容为空')}
            description={t('emptyFileHint', '该文件没有任何可显示的内容')}
          />
        </div>
      )
    }
    return renderText()
  }

  // v2.8.0-T1: 统一 ExcelTable 组件(一次加载全 sheet,切 sheet 零重载)
  const renderExcel = () => {
    if (!excelData) return null
    return <ExcelTable sheetsData={excelData} />
  }

  // v2.8.0-T5: 图片预览(修复乱码)
  const renderImage = () => {
    if (!imageSrc) return null
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-app-elevated p-4 overflow-auto">
        <img
          src={imageSrc}
          alt={displayPath}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    )
  }

  const renderText = () => {
    if (content === null) return null

    if (isJson) {
      try {
        const parsed = JSON.parse(content)
        const formatted = JSON.stringify(parsed, null, 2)
        return (
          <pre className="p-4 text-xs font-mono text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-all">
            {formatted}
          </pre>
        )
      } catch {
        // fall through to plain text
      }
    }

    if (ext === 'ini' || ext === 'cfg') {
      return (
        <pre className="p-4 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
          {content.split('\n').map((line, i) => {
            const trimmed = line.trim()
            if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
              return <div key={i} className="text-gray-400 dark:text-gray-500">{line}</div>
            }
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
              return <div key={i} className="text-gray-600 dark:text-gray-400 font-semibold mt-2">{line}</div>
            }
            const eqIdx = line.indexOf('=')
            if (eqIdx > 0) {
              return (
                <div key={i}>
                  <span className="text-gray-500">{line.substring(0, eqIdx + 1)}</span>
                  <span className="text-gray-400">{line.substring(eqIdx + 1)}</span>
                </div>
              )
            }
            return <div key={i}>{line}</div>
          })}
        </pre>
      )
    }

    return (
      <pre className="p-4 text-xs font-mono text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-all">
        {content}
      </pre>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-gray-400 dark:text-gray-500">
        {t('loading')}
        {parseProgress !== null && (
          <div className="w-48 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span>{t('parsing')}</span>
              <span>{parseProgress}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all duration-150"
                style={{ width: `${parseProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4">
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    )
  }

  const headerIcon = isExcel ? <FileSpreadsheet size={14} /> : isJson ? <Table2 size={14} /> : null

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-edge-subtle bg-gray-50 dark:bg-app/50 shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 min-w-0">
          {headerIcon}
          <span className="truncate">{displayPath}</span>
        </div>
        {content && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded hover:bg-gray-200 dark:hover:bg-app-hover text-gray-500 dark:text-gray-400 shrink-0 ml-2"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-white dark:bg-app-elevated">
        {renderContent()}
      </div>
    </div>
  )
}
