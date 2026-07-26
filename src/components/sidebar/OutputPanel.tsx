import React, { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCheck, FileSpreadsheet, Image, FileText, File, Loader2, FolderOpen, RefreshCw } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'

interface OutputFile {
  name: string
  type: string
}

function getFileIcon(type: string) {
  const t = type.toUpperCase()
  if (t.includes('XLSX') || t.includes('XLS')) return <FileSpreadsheet size={14} className="text-green-500" />
  if (t.includes('PNG') || t.includes('JPG') || t.includes('SVG') || t.includes('GIF'))
    return <Image size={14} className="text-blue-500" />
  if (t.includes('TXT') || t.includes('LOG') || t.includes('JSON') || t.includes('INI'))
    return <FileText size={14} className="text-gray-400" />
  return <File size={14} className="text-gray-400" />
}

export function OutputPanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const [files, setFiles] = useState<OutputFile[]>([])
  const [loading, setLoading] = useState(false)

  const loadFiles = useCallback(async () => {
    if (!selectedProjectName) {
      setFiles([])
      return
    }
    setLoading(true)
    try {
      if (window.electron?.project?.listOutputFiles) {
        const result = await window.electron.project.listOutputFiles(selectedProjectName)
        setFiles(result)
      }
    } catch (err) {
      console.error('OutputPanel loadFiles:', err)
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [selectedProjectName])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  // Open file in system default app
  const handleOpenFile = useCallback(async (fileName: string) => {
    if (!selectedProjectName) return
    try {
      const wsp = await window.electron.app.getPath('workspace')
      const filePath = `${wsp}\\${selectedProjectName}\\output\\${fileName}`
      window.electron.shell.openPath(filePath)
    } catch (err) {
      console.error('open file:', err)
    }
  }, [selectedProjectName])

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <FileCheck size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">输出结果</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">请先在项目浏览器中选择一个项目</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          输出结果
        </span>
        <button
          onClick={loadFiles}
          disabled={loading}
          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw size={13} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-primary-500" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <FolderOpen size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-xs text-gray-400 dark:text-gray-500">
              暂无输出文件
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
              在设计面板生成拓扑后，输出文件将出现在这里
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {files.map((file) => (
              <div
                key={file.name}
                onClick={() => handleOpenFile(file.name)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded cursor-pointer text-xs text-gray-600 dark:text-gray-400"
              >
                {getFileIcon(file.type)}
                <span className="flex-1 truncate">{file.name}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">{file.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
