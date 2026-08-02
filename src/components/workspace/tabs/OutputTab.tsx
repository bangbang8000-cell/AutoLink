import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { useProjectStore } from '@/stores/project.store'
import { ExcelTable } from '@/components/workspace/ExcelTable'
import { getImageMime } from '@/utils/file-type'

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
      // v2.8.0-T6: 类型归一(小写),兼容旧版大写 type 与 .PNG 大写扩展名
      const lowerName = fileName.toLowerCase()
      const type = String(fileType || '').toLowerCase()
      if (
        type === 'xlsx' ||
        type === 'xls' ||
        lowerName.endsWith('.xlsx') ||
        lowerName.endsWith('.xls')
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
      } else if (getImageMime(lowerName)) {
        // v2.8.0-T6: 图片预览(含 SVG),MIME 由扩展名映射,避免大小写脆弱
        const base64 = await window.electron?.project?.getFileBinary(projectName, `output/${fileName}`)
        const mime = getImageMime(lowerName)
        if (base64 && mime) {
          setImageSrc(`data:${mime};base64,${base64}`)
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
      <div className="h-full flex items-center justify-center bg-gray-100 dark:bg-app p-4">
        <img
          src={imageSrc}
          alt={fileName || 'preview'}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    )
  }

  // Excel table preview(v2.8.0-T1: 复用统一 ExcelTable,切 sheet 零重载)
  if (Object.keys(sheets).length > 0) {
    return <ExcelTable sheetsData={sheets} />
  }

  return (
    <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
      {t('common:fileViewer.cannotPreview')}
    </div>
  )
}
