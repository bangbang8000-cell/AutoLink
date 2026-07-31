import { useEffect, useState, useCallback } from 'react'
import { Copy, Check, Table2, FileSpreadsheet } from 'lucide-react'
import * as XLSX from 'xlsx'

interface Props {
  templateName?: string
  filePath?: string
  isTemplate?: boolean
}

export function FileViewerTab({ templateName, filePath, isTemplate }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [excelData, setExcelData] = useState<{ sheets: string[]; current: string; data: string[][] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const displayPath = isTemplate && templateName && filePath
    ? `${templateName}/${filePath}`
    : filePath || templateName || ''

  const ext = (filePath || '').split('.').pop()?.toLowerCase() || ''
  const isExcel = ext === 'xlsx' || ext === 'xls'
  const isJson = ext === 'json'

  const loadFile = useCallback(async () => {
    if (!filePath && !templateName) return

    setLoading(true)
    setError(null)
    try {
      if (isExcel) {
        // Read binary and parse with xlsx
        let buffer: Uint8Array | null = null
        if (filePath) {
          const firstSlash = filePath.indexOf('/')
          if (firstSlash > 0) {
            const projectName = filePath.substring(0, firstSlash)
            const relPath = filePath.substring(firstSlash + 1)
            const base64 = await window.electron.project.getFileBinary(projectName, relPath)
            if (base64) {
              const binary = atob(base64)
              buffer = new Uint8Array(binary.length)
              for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i)
            }
          }
        }
        if (buffer) {
          const wb = XLSX.read(buffer, { type: 'array' })
          const sheetName = wb.SheetNames[0] || ''
          const ws = wb.Sheets[sheetName]
          const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })
          setExcelData({
            sheets: wb.SheetNames,
            current: sheetName,
            data: data as string[][],
          })
        }
        setContent(null)
      } else {
        // Text files
        let text: string | null = null
        if (isTemplate && templateName) {
          const fp = filePath || ''
          text = await window.electron.template.getFile(templateName, fp)
        } else if (filePath) {
          const firstSlash = filePath.indexOf('/')
          if (firstSlash > 0) {
            const projectName = filePath.substring(0, firstSlash)
            const relPath = filePath.substring(firstSlash + 1)
            text = await window.electron.project.getFile(projectName, relPath)
          }
        }
        setContent(text)
        setExcelData(null)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filePath, templateName, isTemplate, isExcel])

  useEffect(() => {
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

  const switchSheet = useCallback((name: string) => {
    if (!excelData || !filePath) return
    setLoading(true)
    ;(async () => {
      try {
        const firstSlash = filePath.indexOf('/')
        if (firstSlash > 0) {
          const projectName = filePath.substring(0, firstSlash)
          const relPath = filePath.substring(firstSlash + 1)
          const base64 = await window.electron.project.getFileBinary(projectName, relPath)
          if (base64) {
            const binary = atob(base64)
            const buffer = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i)
            const wb = XLSX.read(buffer, { type: 'array' })
            const ws = wb.Sheets[name]
            const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })
            setExcelData({ sheets: wb.SheetNames, current: name, data: data as string[][] })
          }
        }
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  }, [excelData, filePath])

  /* ---------- render ---------- */

  const renderContent = () => {
    if (excelData) return renderExcel()
    if (content === null) return null
    return renderText()
  }

  const renderExcel = () => {
    if (!excelData) return null
    const { sheets, current, data } = excelData
    if (data.length === 0) {
      return <div className="p-4 text-sm text-gray-400">空表格</div>
    }

    return (
      <div className="flex-1 overflow-auto">
        {/* Sheet tabs */}
        {sheets.length > 1 && (
          <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
            {sheets.map((s) => (
              <button
                key={s}
                onClick={() => s !== current && switchSheet(s)}
                className={`px-2.5 py-0.5 text-[11px] rounded ${
                  s === current
                    ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 shadow-sm'
                    : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <table className="text-xs border-collapse">
          <tbody>
            {data.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? 'sticky top-0 z-10' : ''}>
                {row.map((cell, ci) => {
                  const CellTag = ri === 0 ? 'th' : 'td'
                  return (
                    <CellTag
                      key={ci}
                      className={`px-2 py-1 border border-gray-200 dark:border-gray-700 whitespace-nowrap ${
                        ri === 0
                          ? 'bg-gray-100 dark:bg-gray-700 font-semibold text-gray-700 dark:text-gray-200'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {cell ?? ''}
                    </CellTag>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
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
      <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
        加载中...
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
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 min-w-0">
          {headerIcon}
          <span className="truncate">{displayPath}</span>
        </div>
        {content && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0 ml-2"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
        {renderContent()}
      </div>
    </div>
  )
}
