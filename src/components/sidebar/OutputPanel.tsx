import React, { useEffect, useState, useCallback } from 'react'
import { FileCheck, FileSpreadsheet, Image, FileText, File, Loader2, FolderOpen, RefreshCw, ExternalLink } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { ExcelPreview } from '@/components/output/ExcelPreview'
import { ImagePreview } from '@/components/output/ImagePreview'

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

function isPreviewable(type: string): boolean {
  const t = type.toUpperCase()
  return t.includes('XLSX') || t.includes('XLS') || t.includes('PNG') || t.includes('JPG') || t.includes('SVG') || t.includes('GIF')
}

export function OutputPanel() {
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const [files, setFiles] = useState<OutputFile[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [filePath, setFilePath] = useState('')

  const loadFiles = useCallback(async () => {
    if (!selectedProjectName) {
      setFiles([])
      setSelectedFile(null)
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

  const handleSelectFile = useCallback(async (fileName: string) => {
    setSelectedFile(fileName)
    const wsp = await window.electron.app.getPath('workspace')
    setFilePath(`${wsp}\\${selectedProjectName}\\output\\${fileName}`)
  }, [selectedProjectName])

  const handleOpenExternal = useCallback(async () => {
    if (!filePath) return
    window.electron.shell.openPath(filePath)
  }, [filePath])

  const handleOpenFolder = useCallback(async () => {
    if (!filePath) return
    window.electron.shell.showItemInFolder(filePath)
  }, [filePath])

  const selectedFileInfo = files.find((f) => f.name === selectedFile)

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
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          输出结果
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={loadFiles}
            disabled={loading}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={13} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* File tree */}
        <div className="w-48 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={16} className="animate-spin text-primary-500" />
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-3">
              <FolderOpen size={24} className="text-gray-300 dark:text-gray-600 mb-1" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500">暂无输出文件</p>
            </div>
          ) : (
            <div className="py-1">
              <div className="px-2 py-1 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase">
                {selectedProjectName}
              </div>
              {files.map((file) => (
                <button
                  key={file.name}
                  onClick={() => handleSelectFile(file.name)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors
                    ${selectedFile === file.name
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                    }`}
                >
                  {getFileIcon(file.type)}
                  <span className="flex-1 truncate">{file.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Preview area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedFile ? (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
              {files.length > 0 ? '选择左侧文件查看预览' : '暂无文件'}
            </div>
          ) : !isPreviewable(selectedFileInfo?.type || '') ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <File size={32} className="text-gray-300 dark:text-gray-600" />
              <p className="text-xs text-gray-400">此文件类型不支持预览</p>
              <button
                onClick={handleOpenExternal}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
              >
                <ExternalLink size={12} />
                外部程序打开
              </button>
            </div>
          ) : selectedFileInfo?.type?.toUpperCase()?.includes('XLSX') || selectedFileInfo?.type?.toUpperCase()?.includes('XLS') ? (
            <ExcelPreview filePath={filePath} fileName={selectedFile} />
          ) : (
            <ImagePreview filePath={filePath} fileName={selectedFile} />
          )}

          {/* Bottom bar */}
          {selectedFile && (
            <div className="flex items-center justify-between px-2 py-1 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
              <span className="truncate">{selectedFile}</span>
              <div className="flex items-center gap-2">
                <button onClick={handleOpenExternal} className="flex items-center gap-0.5 hover:text-gray-600 dark:hover:text-gray-300">
                  <ExternalLink size={10} />外部打开
                </button>
                <button onClick={handleOpenFolder} className="flex items-center gap-0.5 hover:text-gray-600 dark:hover:text-gray-300">
                  <FolderOpen size={10} />打开文件夹
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}