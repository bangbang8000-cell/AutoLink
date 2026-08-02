import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  /** 已解析的全 sheet 数据(切 sheet 纯状态切换,零重载) */
  sheetsData: Record<string, string[][]>
  /** 初始激活 sheet(缺省用第一个) */
  initialSheet?: string
}

/**
 * v2.8.0-T1: 统一 Excel 表格组件
 * - 由调用方一次性解析全部 sheet 传入,内部仅管理激活 sheet 状态
 * - FileViewerTab / OutputTab 共用,保证行为一致
 */
export function ExcelTable({ sheetsData, initialSheet }: Props) {
  const { t } = useTranslation('common')
  const sheetNames = Object.keys(sheetsData)
  const [activeSheet, setActiveSheet] = useState<string>(
    initialSheet && sheetsData[initialSheet] ? initialSheet : (sheetNames[0] || ''),
  )
  const data = sheetsData[activeSheet]

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
      {sheetNames.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-edge-subtle bg-gray-50 dark:bg-app/50 shrink-0 overflow-x-auto">
          {sheetNames.map((name) => (
            <button
              key={name}
              onClick={() => setActiveSheet(name)}
              className={`px-2.5 py-0.5 text-xs rounded whitespace-nowrap ${
                name === activeSheet
                  ? 'bg-primary-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-app-hover'
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
                className={ri % 2 === 0 ? 'bg-white dark:bg-app-elevated' : 'bg-gray-50 dark:bg-app/50'}
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
