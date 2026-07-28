import { useEffect, useState, useCallback } from 'react'
import { FileCheck, FileSpreadsheet, Image, FileText, File, Loader2, FolderOpen, RefreshCw, Maximize2 } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'

interface OutputFile {
  name: string
  type: string
}

function getFileIcon(type: string) {
  const t = type.toUpperCase()
  if (t.includes('XLSX') || t.includes('XLS')) return <FileSpreadsheet size={14} className="text-gray-400" />
  if (t.includes('PNG') || t.includes('JPG') || t.includes('SVG') || t.includes('GIF'))
    return <Image size={14} className="text-gray-400" />
  if (t.includes('TXT') || t.includes('LOG') || t.includes('JSON') || t.includes('INI'))
    return <FileText size={14} className="text-gray-400" />
  return <File size={14} className="text-gray-400" />
}

export function OutputPanel() {
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const openTab = useWorkspaceStore((s) => s.openTab)
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

  const handleOpenFile = useCallback((fileName: string) => {
    const file = files.find((f) => f.name === fileName)
    openTab({
      type: 'output',
      title: fileName,
      closable: true,
      state: { fileName, fileType: file?.type || '' },
    })
  }, [files, openTab])

  const handleOpenWorkspace = useCallback(() => {
    openTab({ type: 'output', title: '输出结果', closable: true })
  }, [openTab])

  if (!selectedProjectName) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <FileCheck size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-xs text-gray-400">请先选择一个项目</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          输出结果
        </span>
        <div className="flex items-center gap-1">
          <button onClick={loadFiles} disabled={loading}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50" title="刷新">
            <RefreshCw size={13} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleOpenWorkspace}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500" title="在工作区打开">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-gray-400" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-3">
            <FolderOpen size={24} className="text-gray-300 dark:text-gray-600 mb-1" />
            <p className="text-[10px] text-gray-400">暂无输出文件</p>
          </div>
        ) : (
          <div className="py-1">
            <div className="px-3 py-1 text-[10px] font-medium text-gray-400 uppercase">
              {selectedProjectName}
            </div>
            {files.map((file) => (
              <button
                key={file.name}
                onClick={() => handleOpenFile(file.name)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors
                  text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50"
              >
                {getFileIcon(file.type)}
                <span className="flex-1 truncate">{file.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
