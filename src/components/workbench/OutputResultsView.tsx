/**
 * 打磨轮（v1.5 / AL-O1a/O1e/O1f）：输出结果一级视图
 *  - 项目 → 输出版本批次(vN_ts) → 材料文件树
 *  - 预览三态：文本（JSON/ini/csv 高亮） / 表格（xlsx 只读） / 图形（PNG/SVG）
 *  - 操作：导出批次 ZIP / 导出全部 / 删单文件 / 删批次 / 清空项目 / 清空全部 / 打开位置
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import {
  RefreshCw, Download, Trash2, ChevronRight, ChevronDown,
  FileText, FileSpreadsheet, Image as ImageIcon, FolderOpen, Eye, Loader2,
} from 'lucide-react'

interface BatchFile { name: string; path: string }
interface Batch { name: string; files: BatchFile[] }

interface PreviewData { base64: string; ext: string; size: number }

const TEXT_EXTS = new Set(['json', 'ini', 'csv', 'yaml', 'yml', 'txt', 'md', 'log'])
const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])
const XL_EXTS = new Set(['xlsx', 'xls'])

const FILE_ICON = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMG_EXTS.has(ext)) return <ImageIcon size={13} className="text-primary-500 shrink-0" />
  if (XL_EXTS.has(ext)) return <FileSpreadsheet size={13} className="text-success-600 shrink-0" />
  return <FileText size={13} className="text-gray-400 shrink-0" />
}

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : n > 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`)

/** xlsx base64 → 二维表格（首 sheet） */
function xlsxToTable(base64: string): { name: string; rows: (string | number)[][] } | null {
  try {
    const wb = XLSX.read(base64, { type: 'base64' })
    const name = wb.SheetNames[0] ?? ''
    const ws = wb.Sheets[name]
    if (!ws) return null
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: true, defval: '' }) as (string | number)[][]
    return { name, rows: rows.slice(0, 500) }
  } catch {
    return null
  }
}

function base64ToText(base64: string): string {
  try {
    const bin = atob(base64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return '（无法解码为文本）'
  }
}

/** 预览面板：按扩展名选择 文本 / 表格 / 图形 */
function PreviewPanel({ preview, fileName }: { preview: PreviewData | null; fileName: string }) {
  const ext = preview?.ext ?? ''
  if (!preview) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-xs">
        选择左侧文件进行预览
      </div>
    )
  }
  if (IMG_EXTS.has(ext)) {
    return (
      <div className="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-app">
        <img
          src={`data:image/${ext};base64,${preview.base64}`}
          alt={fileName}
          className="max-w-full max-h-full border rounded bg-white shadow-sm"
          style={{ imageRendering: 'auto' }}
        />
      </div>
    )
  }
  if (XL_EXTS.has(ext)) {
    const table = xlsxToTable(preview.base64)
    if (!table) {
      return <div className="flex-1 p-4 text-gray-400 text-xs">表格解析失败（可能为空或损坏）</div>
    }
    return (
      <div className="flex-1 overflow-auto">
        <div className="px-3 py-1.5 text-2xs text-gray-400 bg-gray-50 dark:bg-app border-b">{table.name}（前 500 行）</div>
        <table className="w-full text-xs border-collapse">
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-edge-subtle">
                {r.map((cell, j) => (
                  <td key={j} className="px-2 py-1 text-gray-600 dark:text-gray-300 max-w-[240px] truncate">{String(cell ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  // 默认文本
  const text = TEXT_EXTS.has(ext) || ext === 'file' ? base64ToText(preview.base64) : `（${ext.toUpperCase()} 暂不支持文本预览）`
  return (
    <pre className="flex-1 overflow-auto p-3 text-2xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
      {text}
    </pre>
  )
}

export function OutputResultsView({ projectName }: { projectName: string }) {
  const addToast = useToastStore((s) => s.addToast)
  const projects = useProjectStore((s) => s.projects)
  const [activeProject, setActiveProject] = useState(projectName)
  const [batches, setBatches] = useState<Batch[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedFile, setSelectedFile] = useState<BatchFile | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const b = await window.electron.project.listOutputBatches(activeProject)
      setBatches((b as Batch[]) || [])
      // 默认展开第一个批次
      const first = (b as Batch[])?.[0]
      if (first && !expanded[first.name]) {
        setExpanded((e) => ({ ...e, [first.name]: true }))
      }
    } catch {
      setBatches([])
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => { setActiveProject(projectName) }, [projectName])

  const loadPreview = useCallback(async (file: BatchFile) => {
    setSelectedFile(file)
    setPreview(null)
    try {
      const d = await window.electron.render.readOutputFile(activeProject, file.path)
      setPreview(d)
    } catch (err) {
      setPreview(null)
      addToast('error', `预览失败: ${(err as Error).message}`, 4000)
    }
  }, [activeProject, addToast])

  const handleExport = useCallback(async (batchName?: string) => {
    try {
      const res = await window.electron.render.exportOutput(activeProject, batchName)
      if (res?.canceled) return
      if (res?.ok) addToast('success', `已导出 → ${res.path}`, 5000)
    } catch (err) {
      addToast('error', `导出失败: ${(err as Error).message}`, 5000)
    }
  }, [activeProject, addToast])

  const handleDeleteFile = useCallback(async (file?: BatchFile) => {
    const target = file ?? selectedFile
    if (!target) return
    const rel = target.path.replace(/^output\//, '')
    if (!window.confirm(`删除文件 ${target.name}？`)) return
    try {
      await window.electron.project.deleteOutputFile(activeProject, rel)
      addToast('success', '已删除', 3000)
      setSelectedFile(null)
      setPreview(null)
      refresh()
    } catch (err) {
      addToast('error', `删除失败: ${(err as Error).message}`, 4000)
    }
  }, [selectedFile, activeProject, addToast, refresh])

  const handleDeleteBatch = useCallback(async (batch: Batch) => {
    if (!window.confirm(`删除整个批次 ${batch.name}（${batch.files.length} 个文件）？`)) return
    try {
      await window.electron.project.deleteOutputBatch(activeProject, batch.name)
      addToast('success', '批次已删除', 3000)
      refresh()
    } catch (err) {
      addToast('error', `删除失败: ${(err as Error).message}`, 4000)
    }
  }, [activeProject, addToast, refresh])

  const handleClearProject = useCallback(async () => {
    if (!window.confirm(`清空项目「${activeProject}」的全部输出？此操作不可恢复。`)) return
    try {
      await window.electron.project.clearOutput(activeProject)
      addToast('success', '项目输出已清空', 3000)
      setBatches([])
      setSelectedFile(null)
      setPreview(null)
    } catch (err) {
      addToast('error', `清空失败: ${(err as Error).message}`, 4000)
    }
  }, [activeProject, addToast])

  const handleClearAll = useCallback(async () => {
    if (!window.confirm('清空全部项目的输出？此操作不可恢复。')) return
    try {
      const res = await window.electron.render.clearAllOutput()
      addToast('success', `已清空 ${res.deleted} 个项目的输出`, 3000)
      refresh()
    } catch (err) {
      addToast('error', `清空失败: ${(err as Error).message}`, 4000)
    }
  }, [addToast, refresh])

  const handleOpenLocation = useCallback(async (file: BatchFile) => {
    try {
      const wsp = await window.electron.app.getPath('workspace')
      window.electron.shell.showItemInFolder(`${wsp}\\${activeProject}\\${file.path.replace(/\//g, '\\')}`)
    } catch { /* ignore */ }
  }, [activeProject])

  const totalFiles = useMemo(() => batches.reduce((s, b) => s + b.files.length, 0), [batches])

  return (
    <div className="h-full flex flex-col gap-3">
      {/* 头部工具行 */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">输出结果</span>
        <select
          value={activeProject}
          onChange={(e) => setActiveProject(e.target.value)}
          className="text-xs rounded border bg-white dark:bg-app px-2 py-1 max-w-[220px]"
          aria-label="选择项目"
        >
          <option value={projectName}>{projectName}</option>
          {projects.filter((p) => p.name !== projectName).map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
        <span className="text-2xs text-gray-400">{batches.length} 批次 · {totalFiles} 文件</span>
        <button type="button" onClick={refresh} className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} 刷新
        </button>
        <button type="button" onClick={() => handleExport()} disabled={batches.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-40">
          <Download size={11} /> 导出全部 ZIP
        </button>
        <button type="button" onClick={handleClearProject} disabled={batches.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-error-300 dark:border-error-700 text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 disabled:opacity-40">
          <Trash2 size={11} /> 清空项目输出
        </button>
        <button type="button" onClick={handleClearAll}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-error-300 dark:border-error-700 text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20">
          <Trash2 size={11} /> 清空全部输出
        </button>
      </div>

      {/* 主体：批次树 + 预览 */}
      <div className="flex-1 min-h-0 flex gap-3">
        {/* 左侧：批次 → 文件树 */}
        <div className="w-[300px] shrink-0 rounded border overflow-hidden bg-white dark:bg-app flex flex-col">
          <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b bg-gray-50 dark:bg-app/50">
            材料（版本批次）
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {batches.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-6">暂无渲染输出（先「一键渲染」生成）</div>
            )}
            {batches.map((batch) => {
              const isOpen = expanded[batch.name]
              return (
                <div key={batch.name}>
                  <div className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-app-hover cursor-pointer"
                    onClick={() => setExpanded((e) => ({ ...e, [batch.name]: !isOpen }))}>
                    {isOpen ? <ChevronDown size={12} className="shrink-0 text-gray-400" /> : <ChevronRight size={12} className="shrink-0 text-gray-400" />}
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{batch.name}</span>
                    <span className="text-2xs text-gray-400 ml-auto shrink-0">{batch.files.length}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteBatch(batch) }}
                      className="p-0.5 rounded hover:bg-error-50 text-gray-400 hover:text-error-500 shrink-0" title="删除批次">
                      <Trash2 size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExport(batch.name) }}
                      className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 shrink-0" title="导出批次 ZIP">
                      <Download size={11} />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="ml-3 pl-3 border-l border-gray-100 dark:border-edge-subtle space-y-0.5 py-0.5">
                      {batch.files.length === 0 && <div className="text-2xs text-gray-400 px-2 py-1">空批次</div>}
                      {batch.files.map((file) => (
                        <div key={file.path}
                          className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-2xs ${selectedFile?.path === file.path ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-app-hover'}`}
                          onClick={() => loadPreview(file)}>
                          {FILE_ICON(file.name)}
                          <span className="truncate flex-1" title={file.path}>{file.name}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleOpenLocation(file) }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-100 text-gray-400" title="打开位置">
                            <FolderOpen size={11} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteFile(file) }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-error-50 text-gray-400 hover:text-error-500" title="删除文件">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 右侧：预览 */}
        <div className="flex-1 min-w-0 rounded border overflow-hidden bg-white dark:bg-app flex flex-col">
          <div className="px-3 py-2 text-xs border-b bg-gray-50 dark:bg-app/50 flex items-center gap-2 shrink-0">
            <Eye size={12} className="text-gray-400" />
            <span className="text-gray-600 dark:text-gray-300 font-mono truncate flex-1">{selectedFile?.path ?? '未选择文件'}</span>
            {selectedFile && preview && (
              <span className="text-2xs text-gray-400 shrink-0">{fmtSize(preview.size)}</span>
            )}
          </div>
          <PreviewPanel preview={preview} fileName={selectedFile?.name ?? ''} />
        </div>
      </div>
    </div>
  )
}
