/**
 * 5.0.5-505-a：文档工作台（工作台子视图）
 *
 * 集中聚合项目文档产物：
 *  - 一键生成：设计报告 PDF / 评审 PDF / 评审包 ZIP / 信创合规报告 / 连接表 / 设备清单 / 布线 / BOM（doc:generate）
 *  - MC 交付包（exportDeliveryZip，保存对话框）
 *  - 产物清单（doc:list：时间/类型/状态）+ 导出到指定位置 / 打开位置
 *  - 用户指南查看（复用 GuideTab）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RefreshCw, Loader2, Download, FolderOpen, FileText, FileSpreadsheet, Package,
  BookOpen, FileDown, ShieldCheck, Cable, List, ClipboardList, ArrowUpRight,
} from 'lucide-react'
import { useToastStore } from '@/stores/toast.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { exportDeliveryZip } from '@/utils/aidcDelivery'

interface DocArtifact {
  id: string
  type: string
  label: string
  name: string
  time: string
  size: number
  path: string
  relPath: string
  status: 'ready'
}

interface GenerateKind {
  type: string
  icon: React.ReactNode
  titleKey: string
  descKey: string
  color: string
}

const GENERATE_KINDS: GenerateKind[] = [
  { type: 'designReport', icon: <FileText size={14} />, titleKey: 'doc.gen.designReport', descKey: 'doc.gen.designReportDesc', color: 'text-primary-600 dark:text-primary-400 border-primary-300 dark:border-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/20' },
  { type: 'compliance', icon: <ShieldCheck size={14} />, titleKey: 'doc.gen.compliance', descKey: 'doc.gen.complianceDesc', color: 'text-success-600 dark:text-success-400 border-success-300 dark:border-success-700 hover:bg-success-50 dark:hover:bg-success-900/20' },
  { type: 'connections', icon: <Cable size={14} />, titleKey: 'doc.gen.connections', descKey: 'doc.gen.connectionsDesc', color: 'text-teal-600 dark:text-teal-400 border-teal-300 dark:border-teal-700 hover:bg-teal-50 dark:hover:bg-teal-900/20' },
  { type: 'deviceList', icon: <List size={14} />, titleKey: 'doc.gen.deviceList', descKey: 'doc.gen.deviceListDesc', color: 'text-info-600 dark:text-info-400 border-info-300 dark:border-info-700 hover:bg-info-50 dark:hover:bg-info-900/20' },
  { type: 'cablingGuide', icon: <ClipboardList size={14} />, titleKey: 'doc.gen.cablingGuide', descKey: 'doc.gen.cablingGuideDesc', color: 'text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20' },
  { type: 'bom', icon: <FileSpreadsheet size={14} />, titleKey: 'doc.gen.bom', descKey: 'doc.gen.bomDesc', color: 'text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20' },
  { type: 'reviewPdf', icon: <FileDown size={14} />, titleKey: 'doc.gen.reviewPdf', descKey: 'doc.gen.reviewPdfDesc', color: 'text-sky-600 dark:text-sky-400 border-sky-300 dark:border-sky-700 hover:bg-sky-50 dark:hover:bg-sky-900/20' },
  { type: 'reviewPackage', icon: <Package size={14} />, titleKey: 'doc.gen.reviewPackage', descKey: 'doc.gen.reviewPackageDesc', color: 'text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-300 dark:border-fuchsia-700 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20' },
]

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : n > 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`)

export function DocsWorkbench({ projectName }: { projectName: string }) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [artifacts, setArtifacts] = useState<DocArtifact[]>([])
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const res = await window.electron.doc.list(projectName)
      setArtifacts((res as { ok?: boolean; artifacts?: DocArtifact[] })?.artifacts ?? [])
    } catch {
      setArtifacts([])
    } finally {
      setBusy(false)
    }
  }, [projectName])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时异步刷新文档列表并更新加载态
  useEffect(() => { refresh() }, [refresh])

  const latestByType = useMemo(() => {
    const map: Record<string, DocArtifact> = {}
    for (const a of artifacts) {
      if (!map[a.type] || a.time > map[a.type].time) map[a.type] = a
    }
    return map
  }, [artifacts])

  const handleGenerate = useCallback(async (type: string) => {
    setGenerating(type)
    try {
      const res = await window.electron.doc.generate(projectName, type) as {
        ok?: boolean
        path?: string
        error?: string
      }
      if (!res?.ok) throw new Error(res?.error ?? '生成失败')
      addToast('success', t('doc.generated', '已生成 → {{path}}', { path: res.path ?? '' }), 5000)
      refresh()
    } catch (err) {
      addToast('error', t('doc.generateFailed', '生成失败：{{reason}}', { reason: (err as Error).message }), 5000)
    } finally {
      setGenerating(null)
    }
  }, [projectName, addToast, refresh, t])

  // MC 交付包（前端生成：读 plan.json + 拓扑渲染 → plan:aidc:export zip，保存对话框）
  const handleExportDelivery = useCallback(async () => {
    setGenerating('delivery')
    try {
      const res = await exportDeliveryZip(projectName)
      if (res?.canceled) return
      if (res?.noPlan) {
        addToast('warning', t('doc.deliveryNoPlan', '当前项目未生成 AIDC 规划，请先在「AIDC 规划」视图生成规划'), 5000)
        return
      }
      if (res?.error) throw new Error(res.error)
      addToast('success', t('doc.deliveryExported', 'MC 交付包已导出 → {{path}}', { path: res.path ?? '' }), 6000)
    } catch (err) {
      addToast('error', t('doc.deliveryFailed', '交付包导出失败：{{reason}}', { reason: (err as Error).message }), 6000)
    } finally {
      setGenerating(null)
    }
  }, [projectName, addToast, t])

  const handleExportArtifact = useCallback(async (a: DocArtifact) => {
    try {
      const res = await window.electron.doc.export(projectName, a.path)
      if (res?.canceled) return
      if (res?.path) addToast('success', t('doc.exported', '已导出 → {{path}}', { path: res.path }), 4000)
    } catch (err) {
      addToast('error', t('doc.exportFailed', '导出失败：{{reason}}', { reason: (err as Error).message }), 4000)
    }
  }, [projectName, addToast, t])

  const handleOpenLocation = useCallback(async (a: DocArtifact) => {
    try {
      const wsp = await window.electron.app.getPath('workspace')
      window.electron.shell.showItemInFolder(`${wsp}\\${projectName}\\${a.relPath.replace(/\//g, '\\')}`)
    } catch { /* 忽略定位失败 */ }
  }, [projectName])

  return (
    <div className="space-y-4">
      {/* 顶部 */}
      <div className="flex items-center gap-2 flex-wrap">
        <FileText size={16} className="text-primary-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {t('doc.title', '文档工作台')}
        </span>
        <span className="text-2xs text-gray-400">
          {t('doc.summary', '{{count}} 份产物', { count: artifacts.length })}
        </span>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} {t('doc.refresh', '刷新')}
        </button>
        <button
          type="button"
          onClick={() => openTab({ type: 'guide', title: t('guide.title'), closable: true })}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-sky-300 dark:border-sky-700 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20"
        >
          <BookOpen size={11} /> {t('doc.userGuide', '用户指南')}
        </button>
      </div>

      {/* 一键生成区 */}
      <div>
        <p className="text-2xs font-medium text-gray-500 dark:text-gray-400 mb-2">
          {t('doc.generateSection', '一键生成 / 导出')}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {GENERATE_KINDS.map((k) => {
            const latest = latestByType[k.type]
            return (
              <div key={k.type} className={`rounded-lg border p-3 bg-white dark:bg-app-elevated flex flex-col gap-1.5 ${k.color.split(' ').slice(-2).join(' ')}`}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
                  <span className={k.color.split(' ').slice(0, 2).join(' ')}>{k.icon}</span>
                  {t(k.titleKey)}
                </div>
                <div className="text-2xs text-gray-400 dark:text-gray-500 flex-1">
                  {t(k.descKey)}
                </div>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleGenerate(k.type)}
                    disabled={generating !== null}
                    className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-40 disabled:cursor-wait"
                  >
                    {generating === k.type ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                    {generating === k.type ? t('doc.generating', '生成中…') : t('doc.generate', '生成')}
                  </button>
                  {latest && (
                    <span className="text-2xs text-gray-400">
                      {t('doc.latest', '最近 {{time}}', { time: latest.time.slice(5, 16).replace('T', ' ') })}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {/* MC 交付包（前端生成，独立卡片） */}
          <div className="rounded-lg border border-success-300 dark:border-success-700 p-3 bg-white dark:bg-app-elevated flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
              <ArrowUpRight size={14} className="text-success-600 dark:text-success-400" />
              {t('doc.gen.delivery', 'MC 交付包')}
            </div>
            <div className="text-2xs text-gray-400 dark:text-gray-500 flex-1">
              {t('doc.gen.deliveryDesc', '含 plan.json/README/拓扑图，供 MagicCommander 导入')}
            </div>
            <button
              type="button"
              onClick={handleExportDelivery}
              disabled={generating !== null}
              className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-success-500 hover:bg-success-600 text-white disabled:opacity-40 disabled:cursor-wait"
            >
              {generating === 'delivery' ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
              {generating === 'delivery' ? t('doc.exporting', '导出中…') : t('doc.exportDelivery', '导出交付包')}
            </button>
          </div>
        </div>
      </div>

      {/* 产物清单 */}
      <div className="rounded-lg border border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-elevated overflow-hidden">
        <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b bg-gray-50 dark:bg-app/50 flex items-center gap-1.5">
          <FolderOpen size={12} className="text-gray-400" />
          {t('doc.artifactList', '产物清单（时间 / 类型 / 状态）')}
        </div>
        {artifacts.length === 0 ? (
          <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-8">
            {t('doc.empty', '暂无文档产物，点击上方「生成」一键产出')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-edge-subtle">
                  <th className="py-2 px-3 font-medium">类型</th>
                  <th className="py-2 px-3 font-medium">文件名</th>
                  <th className="py-2 px-3 font-medium">时间</th>
                  <th className="py-2 px-3 font-medium">大小</th>
                  <th className="py-2 px-3 font-medium">状态</th>
                  <th className="py-2 px-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 dark:border-edge-subtle/50 hover:bg-gray-50 dark:hover:bg-app-hover">
                    <td className="py-1.5 px-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{a.label}</td>
                    <td className="py-1.5 px-3 text-gray-500 dark:text-gray-400 max-w-[220px] truncate" title={a.relPath}>{a.name}</td>
                    <td className="py-1.5 px-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {a.time.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="py-1.5 px-3 text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                      {a.type === 'archive' ? `${a.size} 文件` : fmtSize(a.size)}
                    </td>
                    <td className="py-1.5 px-3">
                      <span className="inline-block px-1.5 py-0.5 text-2xs rounded bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300">
                        {t('doc.ready', '已生成')}
                      </span>
                    </td>
                    <td className="py-1.5 px-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleExportArtifact(a)}
                          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-400 hover:text-gray-600"
                          title={t('doc.export', '导出到指定位置')}
                        >
                          <Download size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenLocation(a)}
                          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover text-gray-400 hover:text-gray-600"
                          title={t('doc.openLocation', '打开位置')}
                        >
                          <FolderOpen size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default DocsWorkbench
