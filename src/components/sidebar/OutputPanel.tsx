import React from 'react'
import { useTranslation } from 'react-i18next'
import { FileCheck, FileSpreadsheet, Image, FileText } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'

const outputFiles = (name: string) => [
  { icon: <FileSpreadsheet size={14} className="text-green-500" />, name: `${name}_rack_layout.xlsx`, type: 'Excel' },
  { icon: <FileSpreadsheet size={14} className="text-green-500" />, name: `${name}_connections.xlsx`, type: 'Excel' },
  { icon: <Image size={14} className="text-blue-500" />, name: `${name}_topology.png`, type: 'PNG' },
  { icon: <FileText size={14} className="text-gray-400" />, name: `${name}_report.txt`, type: 'TXT' },
]

export function OutputPanel() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)

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
      </div>
      <div className="flex-1 overflow-auto">
        <div className="p-2 space-y-0.5">
          {outputFiles(selectedProjectName).map((file) => (
            <div
              key={file.name}
              className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded cursor-pointer text-xs text-gray-600 dark:text-gray-400"
            >
              {file.icon}
              <span className="flex-1 truncate">{file.name}</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">{file.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
