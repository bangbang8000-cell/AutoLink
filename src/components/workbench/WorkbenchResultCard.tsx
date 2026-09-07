import React from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, XCircle, FolderOpen, FileSpreadsheet, GitBranch, Table2, List } from 'lucide-react'
import { useRenderStore, type RenderResult } from '@/stores/render.store'

const resultIcons: Record<string, React.ReactNode> = {
  connections: <FileSpreadsheet size={13} className="text-gray-400" />,
  rackTable: <Table2 size={13} className="text-gray-400" />,
  topology: <GitBranch size={13} className="text-gray-400" />,
  deviceList: <List size={13} className="text-gray-400" />,
}

export function WorkbenchResultCard() {
  const { t, i18n } = useTranslation()
  // V5.0.11: 结果类型标签改为 i18n 动态解析（切语言即时跟随），不再使用模块级硬编码中文
  const resultLabels: Record<string, string> = {
    connections: t('workbench:result.connections', '连接关系表'),
    rackTable: t('workbench:result.rackTable', '上机表'),
    topology: t('workbench:result.topology', '拓扑图'),
    deviceList: t('workbench:result.deviceList', '设备清单'),
  }
  const results = useRenderStore((s) => s.results)
  const progress = useRenderStore((s) => s.progress)

  if (results.length === 0 && progress.status !== 'complete') return null

  const handleOpenFile = async (result: RenderResult) => {
    const wsp = await window.electron.app.getPath('workspace')
    const filePath = `${wsp}\\${result.file.replace(/\//g, '\\')}`
    window.electron.shell.openPath(filePath)
  }

  const handleOpenFolder = async (result: RenderResult) => {
    const wsp = await window.electron.app.getPath('workspace')
    const parts = result.file.split('/')
    parts.pop() // remove filename
    const folderPath = `${wsp}\\${parts.join('\\')}`
    window.electron.shell.showItemInFolder(folderPath)
  }

  return (
    <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-app/50 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
        <CheckCircle size={12} />
        {t('workbench:renderResults')}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {results.map((result, i) => (
          <div key={i} className="px-3 py-2 flex items-center gap-2">
            {result.status === 'success' ? (
              <CheckCircle size={12} className="text-gray-400 shrink-0" />
            ) : (
              <XCircle size={12} className="text-gray-400 shrink-0" />
            )}
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {resultIcons[result.type]}
              <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
                {resultLabels[result.type] || result.type}
              </span>
              <span className="text-2xs text-gray-400 dark:text-gray-500">
                {new Date(result.timestamp).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => handleOpenFile(result)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-app-hover rounded text-gray-400"
                title={t('workbench:openFile', '打开文件')}
              >
                <FileSpreadsheet size={11} />
              </button>
              <button
                onClick={() => handleOpenFolder(result)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-app-hover rounded text-gray-400"
                title={t('workbench:openFolder', '打开文件夹')}
              >
                <FolderOpen size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}