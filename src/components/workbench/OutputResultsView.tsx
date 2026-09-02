/**
 * 打磨轮（v1.5 / AL-O1a/O1e/O1f）：输出结果一级视图
 *  - 项目 → 输出版本批次(vN_ts) → 材料文件树
 *  - 预览三态：文本（JSON/ini/csv 高亮） / 表格（xlsx 只读） / 图形（PNG/SVG）
 *  - 操作：导出批次 ZIP / 导出全部 / 删单文件 / 删批次 / 清空项目 / 清空全部 / 打开位置
 *  - M4（AL-N3）：导出收敛——设计子视图导出按钮移除，统一在此导出「机房设计 Excel / 机柜设计 Excel」
 *    （复用 exportRoomDesignExcel/exportRackDesignExcel，不传 batchName → 落 output/ 根目录 → [根目录] 批次）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { useSnapshotStore } from '@/stores/snapshot.store'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { exportRoomDesignExcel, buildRoomDesignRackConfig } from '@/utils/exportRoomDesignExcel'
import { exportRackDesignExcel } from '@/utils/exportRackDesignExcel'
import { serializeDesignState } from '@/utils/designSnapshot'
import { stringToBase64 } from '@/utils/exportSvg'
import { getFeatureBridge } from '@/utils/planVersionDiff'
import { VersionHistoryView } from '@/components/workbench/VersionHistoryView'
import {
  RefreshCw, Download, Trash2, ChevronRight, ChevronDown,
  FileText, FileSpreadsheet, Image as ImageIcon, FolderOpen, Eye, Loader2, Upload, History, FileDown, Package,
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
function xlsxToTable(base64: string): { name: string; rows: (string | number)[][]; truncated: boolean } | null {
  try {
    const wb = XLSX.read(base64, { type: 'base64' })
    const name = wb.SheetNames[0] ?? ''
    const ws = wb.Sheets[name]
    if (!ws) return null
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: true, defval: '' }) as (string | number)[][]
    // AL-M5d：大表仅渲染前 500 行并标记截断提示
    const truncated = rows.length > 500
    return { name, rows: rows.slice(0, 500), truncated }
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
function PreviewPanel({ preview, fileName, loading }: { preview: PreviewData | null; fileName: string; loading: boolean }) {
  const { t } = useTranslation()
  const ext = preview?.ext ?? ''
  // AL-M5d：加载中展示骨架屏
  if (loading) {
    return (
      <div className="flex-1 p-4 space-y-2 animate-pulse">
        <div className="h-3 w-1/4 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-2.5 w-2/3 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-2.5 w-1/2 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-2.5 w-3/5 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-2.5 w-2/5 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )
  }
  if (!preview) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-xs">
        {t('workbench:output.selectToPreview', '选择左侧文件进行预览')}
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
      return <div className="flex-1 p-4 text-gray-400 text-xs">{t('workbench:output.xlsxFail', '表格解析失败（可能为空或损坏）')}</div>
    }
    return (
      <div className="flex-1 overflow-auto">
        <div className="px-3 py-1.5 text-2xs text-gray-400 bg-gray-50 dark:bg-app border-b">{t('workbench:output.xlsxRows', { sheet: table.name })}</div>
        {/* AL-M5d：大表仅前 500 行提示（避免海量数据卡顿） */}
        {table.truncated && (
          <div className="px-3 py-1.5 text-2xs bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-b">
            {t('workbench:output.rowsTruncated', '大表预览仅显示前 500 行，完整数据见导出的 Excel/Cache 文件')}
          </div>
        )}
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
  const text = TEXT_EXTS.has(ext) || ext === 'file' ? base64ToText(preview.base64) : t('workbench:output.unsupported', { ext: ext.toUpperCase() })
  return (
    <pre className="flex-1 overflow-auto p-3 text-2xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
      {text}
    </pre>
  )
}

/**
 * M4（AL-N3）：导出收敛——从当前设计 store 导出「机房设计 Excel」到 output/ 根目录（不传 batchName
 * → electron export.saveFile → 落 output/ 根目录，自动出现在「[根目录]」批次）。成功返回落盘路径；
 * 无矩阵/落盘失败时抛错（由调用方提示）。
 */
export async function exportRoomDesignExcelToRoot(projectName: string): Promise<string> {
  const matrix = useRoomStore.getState().matrix
  if (!matrix) {
    throw new Error('机房设计尚未定义（请先在「机房设计」子视图创建矩阵）')
  }
  const cabinets = useRackStore.getState().cabinets
  const filePath = await exportRoomDesignExcel(projectName, matrix, cabinets, buildRoomDesignRackConfig())
  if (!filePath) throw new Error('导出失败（Electron 桥接未就绪）')
  return filePath
}

/**
 * M4（AL-N3）：导出收敛——从当前设计 store 导出「机柜设计 Excel」到 output/ 根目录（不传 batchName
 * → electron export.saveFile → 落 output/ 根目录，自动出现在「[根目录]」批次）。成功返回落盘路径；
 * 落盘失败时抛错（由调用方提示）。
 */
export async function exportRackDesignExcelToRoot(projectName: string): Promise<string> {
  const cabinets = useRackStore.getState().cabinets
  const filePath = await exportRackDesignExcel(projectName, cabinets)
  if (!filePath) throw new Error('导出失败（Electron 桥接未就绪）')
  return filePath
}

/**
 * M2（AL-SNAP2）：导出设计快照 JSON —— 序列化当前设计（矩阵+机柜+配置）到 output/snapshots/
 * （render.saveOutputFile 相对路径 → 自动以「snapshots」批次出现在材料树）。成功返回落盘路径。
 */
export async function exportDesignSnapshotToRoot(projectName: string): Promise<string> {
  const room = useRoomStore.getState()
  const rack = useRackStore.getState()
  const snapshot = serializeDesignState(room, rack)
  const json = JSON.stringify(snapshot, null, 2)
  const base64 = stringToBase64(json)
  const fileName = `设计快照_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
  const filePath = await window.electron.render.saveOutputFile(projectName, `output/snapshots/${fileName}`, base64)
  if (!filePath) throw new Error('导出失败（Electron 桥接未就绪）')
  return filePath
}

export function OutputResultsView({ projectName }: { projectName: string }) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const projects = useProjectStore((s) => s.projects)
  const [activeProject, setActiveProject] = useState(projectName)
  const [batches, setBatches] = useState<Batch[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedFile, setSelectedFile] = useState<BatchFile | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  // AL-M5d：预览加载态（骨架屏）
  const [previewLoading, setPreviewLoading] = useState(false)
  // AL-M5b：项目 Modal 确认体系（替代 window.confirm）
  const [confirmState, setConfirmState] = useState<{ message: string; danger: boolean; fn: () => void } | null>(null)
  const [busy, setBusy] = useState(false)
  // M-F1（PRD v3.6）：版本历史 Modal + 评审 PDF 导出
  const [showHistory, setShowHistory] = useState(false)

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
    setPreviewLoading(true)
    try {
      const d = await window.electron.render.readOutputFile(activeProject, file.path)
      setPreview(d)
    } catch (err) {
      setPreview(null)
      addToast('error', t('workbench:output.previewFailed', { err: (err as Error).message }), 4000)
    } finally {
      setPreviewLoading(false)
    }
  }, [activeProject, addToast])

  const handleExport = useCallback(async (batchName?: string) => {
    try {
      const res = await window.electron.render.exportOutput(activeProject, batchName)
      if (res?.canceled) return
      if (res?.ok) addToast('success', t('workbench:output.exported', { path: res.path }), 5000)
    } catch (err) {
      addToast('error', `导出失败: ${(err as Error).message}`, 5000)
    }
  }, [activeProject, addToast])

  // M4（AL-N3）：导出收敛——「本项目输出」统一导出双设计 Excel（落 output/ 根目录 → [根目录] 批次）
  const handleExportRoomDesign = useCallback(async () => {
    try {
      const path = await exportRoomDesignExcelToRoot(activeProject)
      addToast('success', `${t('rack:roomDesignExported', '机房设计 Excel 已导出')}: ${path}`, 4000)
      refresh()
    } catch (err) {
      addToast('error', (err as Error).message, 4000)
    }
  }, [activeProject, addToast, refresh, t])

  const handleExportRackDesign = useCallback(async () => {
    try {
      const path = await exportRackDesignExcelToRoot(activeProject)
      addToast('success', `${t('rack:rackDesignExported', '机柜设计 Excel 已导出')}: ${path}`, 4000)
      refresh()
    } catch (err) {
      addToast('error', (err as Error).message, 4000)
    }
  }, [activeProject, addToast, refresh, t])

  // M2（AL-SNAP2）：导出设计快照 JSON（落 output/snapshots/ → 材料树 snapshots 批次）
  const handleExportSnapshot = useCallback(async () => {
    try {
      const path = await exportDesignSnapshotToRoot(activeProject)
      addToast('success', t('workbench:output.snapshotExported', '设计快照已导出 → {{path}}', { path }), 5000)
      refresh()
    } catch (err) {
      addToast('error', t('workbench:output.snapshotExportFailed', '导出失败：{{reason}}', { reason: (err as Error).message }), 5000)
    }
  }, [activeProject, addToast, refresh, t])

  // 48-b（F8-2）：导出快照为可移植文件（保存对话框 → 便携格式，可跨端/跨机回导）
  const handleExportSnapshotFile = useCallback(async () => {
    try {
      const r = await useSnapshotStore.getState().exportToFile(undefined, activeProject)
      if (!r.ok) {
        if (r.reason !== 'canceled') {
          addToast('error', t('workbench:output.snapshotExportFailed', '导出失败：{{reason}}', { reason: r.reason }), 5000)
        }
        return
      }
      refresh()
    } catch (err) {
      addToast('error', t('workbench:output.snapshotExportFailed', '导出失败：{{reason}}', { reason: (err as Error).message }), 5000)
    }
  }, [activeProject, addToast, refresh, t])

  // M-F1（PRD v3.6 / F1-3）：导出评审 PDF（printToPDF A4 → output/ 根目录 → [根目录] 批次）
  const handleReviewPdf = useCallback(async () => {
    try {
      const res = await getFeatureBridge().reviewPdf(activeProject)
      if (res?.error) throw new Error(res.error)
      if (!res?.ok || !res.path) throw new Error('导出失败（Electron 桥接未就绪）')
      addToast('success', t('workbench:output.reviewPdfExported', '评审 PDF 已导出 → {{path}}', { path: res.path }), 5000)
      refresh()
    } catch (err) {
      addToast('error', t('workbench:output.reviewPdfFailed', '评审 PDF 导出失败：{{reason}}', { reason: (err as Error).message }), 5000)
    }
  }, [activeProject, addToast, refresh, t])

  // 48-d（F8-4）：导出评审包（聚合版本历史 + 设计报告 + 校验 + 交付清单 → zip，含 PDF 报告）
  const handleReviewPackage = useCallback(async () => {
    try {
      const res = await getFeatureBridge().reviewPackage(activeProject)
      if (res?.error) throw new Error(res.error)
      if (!res?.ok || !res.path) throw new Error('导出失败（Electron 桥接未就绪）')
      addToast('success', t('workbench:output.reviewPackageExported', '评审包已导出 → {{path}}', { path: res.path }), 6000)
      refresh()
    } catch (err) {
      addToast('error', t('workbench:output.reviewPackageFailed', '评审包导出失败：{{reason}}', { reason: (err as Error).message }), 6000)
    }
  }, [activeProject, addToast, refresh, t])

  // M2（AL-SNAP2）：导入设计快照 JSON（选文件 → validate → 导入前备份 → 应用）
  const importFileRef = useRef<HTMLInputElement>(null)
  const handleImportSnapshot = useCallback(() => {
    importFileRef.current?.click()
  }, [])

  const onImportSnapshotFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const r = useSnapshotStore.getState().importFromJson(text)
      if (r.ok) {
        addToast('success', t('workbench:output.snapshotImported', '已导入设计快照：{{name}}（导入前已备份当前设计）', { name: r.name ?? file.name }), 6000)
      } else {
        addToast('error', t('workbench:output.snapshotImportFailed', '导入失败：{{reason}}', { reason: r.reason }), 6000)
      }
    }
    reader.onerror = () => {
      addToast('error', t('workbench:output.snapshotImportFailed', '导入失败：{{reason}}', { reason: '文件读取失败' }), 6000)
    }
    reader.readAsText(file)
  }, [addToast, t])

  const handleDeleteFile = useCallback(async (file?: BatchFile) => {
    const target = file ?? selectedFile
    if (!target) return
    const rel = target.path.replace(/^output\//, '')
    // AL-M5b：window.confirm → 项目 Modal 确认体系
    setConfirmState({
      message: t('workbench:output.confirmDeleteFile', { name: target.name }),
      danger: true,
      fn: async () => {
        try {
          await window.electron.project.deleteOutputFile(activeProject, rel)
          addToast('success', t('workbench:output.deleted', '已删除'), 3000)
          setSelectedFile(null)
          setPreview(null)
          refresh()
        } catch (err) {
          addToast('error', `删除失败: ${(err as Error).message}`, 4000)
        }
      },
    })
  }, [selectedFile, activeProject, addToast, refresh, t])

  const handleDeleteBatch = useCallback(async (batch: Batch) => {
    // AL-M5b：window.confirm → 项目 Modal 确认体系
    setConfirmState({
      message: t('workbench:output.confirmDeleteBatch', { batch: batch.name, count: batch.files.length }),
      danger: true,
      fn: async () => {
        try {
          await window.electron.project.deleteOutputBatch(activeProject, batch.name)
          addToast('success', t('workbench:output.batchDeleted', '批次已删除'), 3000)
          refresh()
        } catch (err) {
          addToast('error', `删除失败: ${(err as Error).message}`, 4000)
        }
      },
    })
  }, [activeProject, addToast, refresh, t])

  const handleClearProject = useCallback(async () => {
    // AL-M5b：window.confirm → 项目 Modal 确认体系
    setConfirmState({
      message: t('workbench:output.confirmClearProject', { name: activeProject }),
      danger: true,
      fn: async () => {
        try {
          await window.electron.project.clearOutput(activeProject)
          addToast('success', t('workbench:output.projectCleared', '项目输出已清空'), 3000)
          setBatches([])
          setSelectedFile(null)
          setPreview(null)
        } catch (err) {
          addToast('error', `清空失败: ${(err as Error).message}`, 4000)
        }
      },
    })
  }, [activeProject, addToast, t])

  const handleClearAll = useCallback(async () => {
    // AL-M5b：window.confirm → 项目 Modal 确认体系
    setConfirmState({
      message: t('workbench:output.confirmClearAll', '清空全部项目的输出？此操作不可恢复。'),
      danger: true,
      fn: async () => {
        try {
          const res = await window.electron.render.clearAllOutput()
          addToast('success', t('workbench:output.clearedAll', { count: res.deleted }), 3000)
          refresh()
        } catch (err) {
          addToast('error', `清空失败: ${(err as Error).message}`, 4000)
        }
      },
    })
  }, [addToast, refresh, t])

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
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('workbench:output.title', '输出结果')}</span>
        <select
          value={activeProject}
          onChange={(e) => setActiveProject(e.target.value)}
          className="text-xs rounded border bg-white dark:bg-app px-2 py-1 max-w-[220px]"
          aria-label={t('workbench:output.projectLabel', '选择项目')}
        >
          <option value={projectName}>{projectName}</option>
          {projects.filter((p) => p.name !== projectName).map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
        <span className="text-2xs text-gray-400">{t('workbench:output.batches', { count: batches.length, files: totalFiles })}</span>
        <button type="button" onClick={refresh} className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} 刷新
        </button>
        <button type="button" onClick={() => handleExport()} disabled={batches.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-40">
          <Download size={11} /> {t('workbench:output.exportAllZip', '导出全部 ZIP')}
        </button>
        {/* M4（AL-N3）：导出收敛——设计子视图导出按钮移除后，统一在本项目输出导出双设计 Excel */}
        <button type="button" onClick={handleExportRoomDesign}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-success-300 dark:border-success-600 text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20">
          <Download size={11} /> {t('workbench:output.exportRoomDesignExcel', '导出机房设计 Excel')}
        </button>
        <button type="button" onClick={handleExportRackDesign}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-success-300 dark:border-success-600 text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20">
          <Download size={11} /> {t('workbench:output.exportRackDesignExcel', '导出机柜设计 Excel')}
        </button>
        {/* M2（AL-SNAP2）：设计快照 导出/导入（JSON，落 output/snapshots/） */}
        <button type="button" onClick={handleExportSnapshot}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-violet-300 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20">
          <Download size={11} /> {t('workbench:output.exportSnapshot', '导出设计快照 JSON')}
        </button>
        {/* 48-b（F8-2）：便携快照文件（保存对话框 → 可跨端回导） */}
        <button type="button" onClick={handleExportSnapshotFile}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-violet-300 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20">
          <Download size={11} /> {t('workbench:output.exportSnapshotFile', '导出快照文件')}
        </button>
        <button type="button" onClick={handleImportSnapshot}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-violet-300 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20">
          <Upload size={11} /> {t('workbench:output.importSnapshot', '导入快照')}
        </button>
        {/* M-F1（PRD v3.6）：版本历史入口 + 评审 PDF 导出 */}
        <button type="button" onClick={() => setShowHistory(true)}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-sky-300 dark:border-sky-600 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20">
          <History size={11} /> {t('workbench:versionHistory.open', '版本历史')}
        </button>
        <button type="button" onClick={handleReviewPdf}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-sky-300 dark:border-sky-600 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20">
          <FileDown size={11} /> {t('workbench:output.reviewPdf', '导出评审 PDF')}
        </button>
        {/* 48-d（F8-4）：评审包（聚合版本历史+设计报告+校验+交付清单 → zip，含 PDF） */}
        <button type="button" onClick={handleReviewPackage}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-sky-300 dark:border-sky-600 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20">
          <Package size={11} /> {t('workbench:output.reviewPackage', '导出评审包')}
        </button>
        <button type="button" onClick={handleClearProject} disabled={batches.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-error-300 dark:border-error-700 text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 disabled:opacity-40">
          <Trash2 size={11} /> {t('workbench:output.clearProject', '清空项目输出')}
        </button>
        <button type="button" onClick={handleClearAll}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-error-300 dark:border-error-700 text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20">
          <Trash2 size={11} /> {t('workbench:output.clearAll', '清空全部输出')}
        </button>
      </div>

      {/* 主体：批次树 + 预览 */}
      <div className="flex-1 min-h-0 flex gap-3">
        {/* 左侧：批次 → 文件树 */}
        <div className="w-[300px] shrink-0 rounded border overflow-hidden bg-white dark:bg-app flex flex-col">
          <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b bg-gray-50 dark:bg-app/50">
            {t('workbench:output.materialsTitle', '材料（版本批次）')}
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {batches.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-6">{t('workbench:output.empty', '暂无渲染输出（先「一键渲染」生成）')}</div>
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
                      className="p-0.5 rounded hover:bg-error-50 text-gray-400 hover:text-error-500 shrink-0" title={t('workbench:output.deleteBatch', '删除批次')}>
                      <Trash2 size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExport(batch.name) }}
                      className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 shrink-0" title={t('workbench:output.exportBatch', '导出批次 ZIP')}>
                      <Download size={11} />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="ml-3 pl-3 border-l border-gray-100 dark:border-edge-subtle space-y-0.5 py-0.5">
                      {batch.files.length === 0 && <div className="text-2xs text-gray-400 px-2 py-1">{t('workbench:output.emptyBatch', '空批次')}</div>}
                      {batch.files.map((file) => (
                        <div key={file.path}
                          className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-2xs ${selectedFile?.path === file.path ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-app-hover'}`}
                          onClick={() => loadPreview(file)}>
                          {FILE_ICON(file.name)}
                          <span className="truncate flex-1" title={file.path}>{file.name}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleOpenLocation(file) }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-100 text-gray-400" title={t('workbench:output.openLocation', '打开位置')}>
                            <FolderOpen size={11} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteFile(file) }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-error-50 text-gray-400 hover:text-error-500" title={t('workbench:output.deleteFile', '删除文件')}>
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
            <span className="text-gray-600 dark:text-gray-300 font-mono truncate flex-1">{selectedFile?.path ?? t('workbench:output.noSelection', '未选择文件')}</span>
            {selectedFile && preview && (
              <span className="text-2xs text-gray-400 shrink-0">{fmtSize(preview.size)}</span>
            )}
          </div>
          <PreviewPanel preview={preview} fileName={selectedFile?.name ?? ''} loading={previewLoading} />
        </div>
      </div>

      {/* AL-M5b：项目 Modal 确认体系（替代 window.confirm） */}
      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ''}
        danger={confirmState?.danger}
        onConfirm={() => { confirmState?.fn(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />

      {/* M2（AL-SNAP2）：导入设计快照的文件选择器（渲染层 FileReader，无需新增 IPC） */}
      <input
        ref={importFileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={onImportSnapshotFile}
      />

      {/* M-F1（PRD v3.6）：版本历史（列表/对比/回滚） */}
      <VersionHistoryView
        projectName={activeProject}
        open={showHistory}
        onClose={() => setShowHistory(false)}
      />
    </div>
  )
}
