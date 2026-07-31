import React, { useState, useRef } from 'react'
import { X, Upload, FileSpreadsheet, Download, AlertTriangle } from 'lucide-react'
import { parseCabinetCSV, parseCabinetXLSX, generateCabinetTemplateCSV } from '@/utils/cabinet-import'
import type { ParseResult } from '@/utils/cabinet-import'
import { useRackStore } from '@/stores/rack.store'
interface Props {
  open: boolean
  onClose: () => void
}

export function ImportCabinetsModal({ open, onClose }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [mode, setMode] = useState<'upload' | 'preview'>('upload')
  const [loading, setLoading] = useState(false)
  const { cabinets, addCabinet, updateCabinet } = useRackStore()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    try {
      const isXLSX = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
      if (isXLSX) {
        const buffer = await file.arrayBuffer()
        const res = parseCabinetXLSX(buffer)
        setResult(res)
        setMode('preview')
      } else {
        const text = await file.text()
        const res = parseCabinetCSV(text)
        setResult(res)
        setMode('preview')
      }
    } catch (err) {
      setResult({ cabinets: [], errors: [`文件读取失败: ${err}`], warnings: [] })
      setMode('preview')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = () => {
    if (!result?.cabinets.length) return

    for (const imp of result.cabinets) {
      // Check if cabinet with same name already exists
      const exists = cabinets.find((c) => c.name === imp.name)
      if (exists) {
        // Update existing
        updateCabinet(exists.id, {
          name: imp.name,
          totalU: imp.totalU,
          type: imp.type as any,
          power_limit: imp.powerLimit,
        })
      } else {
        // Add new
        addCabinet(imp.totalU, imp.type as any, imp.powerLimit)
      }
    }

    onClose()
  }

  const handleDownloadTemplate = () => {
    const csv = generateCabinetTemplateCSV()
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '机柜导入模板.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setResult(null)
    setMode('upload')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[600px] max-h-[85vh] flex flex-col border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            导入机柜列表
          </h2>
          <button onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500">
            <X size={16} />
          </button>
        </div>

        {mode === 'upload' ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center gap-4">
            <Upload size={40} className="text-gray-300 dark:text-gray-600" />
            <div className="text-center">
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">
                上传 CSV 或 Excel 机柜列表文件
              </p>
              <p className="text-xs text-gray-400">
                支持 .csv, .xlsx 格式
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50"
              >
                <FileSpreadsheet size={16} />
                {loading ? '解析中...' : '选择文件'}
              </button>
              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Download size={16} />
                下载模板
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Format hint */}
            <div className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 max-w-md">
              <p className="text-xs font-medium text-gray-500 mb-2">CSV 列格式说明：</p>
              <code className="text-2xs text-gray-400 block">
                机柜编号,机柜名称,类型,U数,功率上限(W),位置,备注
              </code>
              <p className="text-2xs text-gray-400 mt-2">
                类型支持: GPU柜 / 存储柜 / 网络柜 / 通算柜 / 安全柜 / 混合柜
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Preview header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <span className="text-xs text-gray-500">
                预览: {result?.cabinets.length || 0} 个机柜
              </span>
              <button onClick={handleReset}
                className="text-xs text-primary-500 hover:text-primary-600">
                重新选择文件
              </button>
            </div>

            {/* Errors */}
            {result?.errors && result.errors.length > 0 && (
              <div className="mx-4 mt-2 p-2 rounded bg-error-50 dark:bg-error-900/20 text-xs text-error-600 dark:text-error-400">
                {result.errors.map((err, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <AlertTriangle size={11} />{err}
                  </div>
                ))}
              </div>
            )}

            {/* Warnings */}
            {result?.warnings && result.warnings.length > 0 && (
              <div className="mx-4 mt-2 p-2 rounded bg-warning-50 dark:bg-warning-900/20 text-xs text-warning-600 dark:text-warning-400">
                {result.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}

            {/* Table preview */}
            <div className="flex-1 overflow-auto p-4">
              {result && result.cabinets.length > 0 ? (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                      <th className="py-1.5 px-2 text-gray-500 font-medium">编号</th>
                      <th className="py-1.5 px-2 text-gray-500 font-medium">名称</th>
                      <th className="py-1.5 px-2 text-gray-500 font-medium">类型</th>
                      <th className="py-1.5 px-2 text-gray-500 font-medium">U数</th>
                      <th className="py-1.5 px-2 text-gray-500 font-medium">功率上限</th>
                      <th className="py-1.5 px-2 text-gray-500 font-medium">位置</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.cabinets.map((cab) => (
                      <tr key={cab.id} className="border-b border-gray-100 dark:border-gray-700/30">
                        <td className="py-1.5 px-2 text-gray-700 dark:text-gray-300">{cab.id}</td>
                        <td className="py-1.5 px-2 text-gray-700 dark:text-gray-300">{cab.name}</td>
                        <td className="py-1.5 px-2 text-gray-500">{cab.type}</td>
                        <td className="py-1.5 px-2 text-gray-500">{cab.totalU}U</td>
                        <td className="py-1.5 px-2 text-gray-500">{cab.powerLimit}W</td>
                        <td className="py-1.5 px-2 text-gray-400">{cab.location || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-gray-400">
                  无有效数据
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              <button onClick={onClose}
                className="px-3 py-1.5 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                取消
              </button>
              <button onClick={handleImport}
                disabled={!result?.cabinets.length}
                className="px-4 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50">
                导入 {result?.cabinets.length || 0} 个机柜
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
