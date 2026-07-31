import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { useProjectStore } from '@/stores/project.store'

interface Props {
  fileName?: string | null
  fileType?: string
}

export function OutputTab({ fileName, fileType }: Props) {
  const { t } = useTranslation('common')
  const projectName = useProjectStore((s) => s.selectedProjectName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheets, setSheets] = useState<Record<string, string[][]>>({})
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!fileName) return
    loadFile()
  }, [fileName, projectName])

  const loadFile = async () => {
    if (!projectName || !fileName) return
    setLoading(true)
    setError(null)
    try {
      if (
        fileType === 'xlsx' ||
        fileType === 'xls' ||
        fileName?.endsWith('.xlsx') ||
        fileName?.endsWith('.xls')
      ) {
        // T10: getFileBinary 需要 (projectName, relPath) 两个参数
        const base64 = await window.electron?.project?.getFileBinary(projectName, `output/${fileName}`)
        if (!base64) {
          setError(t('common:fileViewer.cannotRead'))
          return
        }
        const wb = XLSX.read(base64, { type: 'base64' })
        const sheetsData: Record<string, string[][]> = {}
        wb.SheetNames.forEach((name) => {
          const ws = wb.Sheets[name]
          sheetsData[name] = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })
        })
        setSheets(sheetsData)
        setActiveSheet(wb.SheetNames[0] || '')
      } else if (
        fileType === 'png' ||
        fileType === 'jpg' ||
        fileType === 'jpeg' ||
        fileName?.endsWith('.png') ||
        fileName?.endsWith('.jpg')
      ) {
        const base64 = await window.electron?.project?.getFileBinary(projectName, `output/${fileName}`)
        if (base64) {
          setImageSrc(`data:image/${fileType || 'png'};base64,${base64}`)
        }
      } else {
        setError(t('common:fileViewer.unsupportedType', { type: fileType || '' }))
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
        {t('common:loading')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4">
        <p className="text-sm text-error-500">{error}</p>
      </div>
    )
  }

  // Image preview
  if (imageSrc) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
        <img
          src={imageSrc}
          alt={fileName || 'preview'}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    )
  }

  // Excel table preview
  if (Object.keys(sheets).length > 0) {
    const data = sheets[activeSheet]
    if (!data || data.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
          {t('common:fileViewer.emptyTable')}
        </div>
      )
    }
    return (
      <div className="h-full flex flex-col">
        {/* Sheet tabs */}
        {Object.keys(sheets).length > 1 && (
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0 overflow-x-auto">
            {Object.keys(sheets).map((name) => (
              <button
                key={name}
                onClick={() => setActiveSheet(name)}
                className={`px-2.5 py-0.5 text-xs rounded whitespace-nowrap ${
                  name === activeSheet
                    ? 'bg-primary-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="sticky top-0 bg-gray-100 dark:bg-gray-700">
                {data[0]?.map((cell, i) => (
                  <th
                    key={i}
                    className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 whitespace-nowrap"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(1).map((row, ri) => (
                <tr
                  key={ri}
                  className={
                    ri % 2 === 0
                      ? 'bg-white dark:bg-gray-800'
                      : 'bg-gray-50 dark:bg-gray-800/50'
                  }
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-2 py-1 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 whitespace-nowrap"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
      {t('common:fileViewer.cannotPreview')}
    </div>
  )
}
