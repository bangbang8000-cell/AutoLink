import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, ExternalLink, RefreshCw, CheckCircle, AlertCircle, Download, RotateCw, Loader2, Palette, Keyboard } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useUIStore } from '@/stores/ui.store'

interface Props {
  onClose: () => void
}

type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'error'

interface StackVersions {
  app: string
  electron: string
  chrome: string
  node: string
  react: string
  typescript: string
  vite: string
  echarts: string
  xyflow: string
  i18next: string
  electronUpdater: string
  python: string
  buildNumber: string
}

// 清理依赖版本号前缀（^/~/>=）
const cleanVer = (v: string) => (v || '').replace(/^[\^~>=]+/, '')

export function AboutDialog({ onClose }: Props) {
  // 显式指定 'common' 命名空间(双保险,即使全局 defaultNS 配置变更也不受影响)
  const { t } = useTranslation('common')
  const [appVersion, setAppVersion] = useState('...')
  const [stack, setStack] = useState<StackVersions | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [updateError, setUpdateError] = useState('')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [downloadTransferred, setDownloadTransferred] = useState(0)
  const [downloadTotal, setDownloadTotal] = useState(0)
  const latestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setShowShortcutsDialog = useUIStore((s) => s.setShowShortcutsDialog)

  // 加载版本信息
  useEffect(() => {
    window.electron?.app?.getVersion?.().then((v: string) => v && setAppVersion(v)).catch(() => {})
    window.electron?.app?.getStackVersions?.().then((s: StackVersions | null) => s && setStack(s)).catch(() => {})
  }, [])

  // 订阅下载进度
  useEffect(() => {
    const offProgress = window.electron?.app?.onUpdateDownloadProgress?.((data: { percent: number; transferred: number; total: number }) => {
      setDownloadPercent(data.percent)
      setDownloadTransferred(data.transferred)
      setDownloadTotal(data.total)
    })
    const offError = window.electron?.app?.onUpdateError?.((msg: string) => {
      setUpdateError(msg)
      setUpdateState('error')
    })
    return () => { offProgress?.(); offError?.() }
  }, [])

  // 清理定时器
  useEffect(() => () => { if (latestTimerRef.current) clearTimeout(latestTimerRef.current) }, [])

  const handleCheckUpdate = async () => {
    setUpdateState('checking')
    setUpdateError('')
    try {
      const result = await window.electron?.app?.checkUpdate?.()
      if (result?.updateAvailable) {
        setUpdateVersion(result.version || '')
        setUpdateState('available')
      } else {
        setUpdateState('latest')
        // 3 秒后回到空闲态
        latestTimerRef.current = setTimeout(() => setUpdateState('idle'), 3000)
      }
    } catch (err: any) {
      setUpdateError(err?.message || String(err))
      setUpdateState('error')
    }
  }

  const handleDownload = async () => {
    setUpdateState('downloading')
    setDownloadPercent(0)
    setUpdateError('')
    try {
      await window.electron?.app?.downloadUpdate?.()
      setUpdateState('downloaded')
    } catch (err: any) {
      // T2: 下载失败时保留错误信息,UI 会显示「手动下载」按钮作为降级方案
      setUpdateError(err?.message || String(err))
      setUpdateState('error')
    }
  }

  // T2: 手动下载降级方案 - 打开 GitHub Releases 页面
  const handleManualDownload = () => {
    window.electron?.app?.openReleasesPage?.()
  }

  const handleRestart = () => {
    window.electron?.app?.quitAndInstall?.()
  }

  // 在系统文件管理器中定位 Logo 设计规范文档（程序发布的一部分）
  const handleShowLogoSpec = () => {
    window.electron?.app?.showBrandingAsset?.('logo_specification.md').catch(() => {})
  }

  const formatBytes = (b: number) => {
    if (!b) return '0 MB'
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 / 1024).toFixed(1)} MB`
  }

  // 软件栈条目
  const stackEntries: [string, string][] = stack
    ? [
        ['AutoLink', stack.app],
        ['Electron', stack.electron],
        ['Chromium', stack.chrome],
        ['Node.js', stack.node],
        ['React', cleanVer(stack.react)],
        ['TypeScript', cleanVer(stack.typescript)],
        ['Vite', cleanVer(stack.vite)],
        ['ECharts', cleanVer(stack.echarts)],
        ['@xyflow/react', cleanVer(stack.xyflow)],
        ['i18next', cleanVer(stack.i18next)],
        ['Python', stack.python],
      ]
    : []

  return (
    <Modal
      open
      onClose={onClose}
      title={t('about.title')}
      width={520}
      maxHeight="90vh"
      closeOnEsc
      bodyClassName="p-0"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
            v{appVersion}{stack?.buildNumber ? ` · 构建 #${stack.buildNumber}` : ''}
          </div>

          {/* 检查更新状态区 */}
          <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
            {updateState === 'idle' && (
              <button
                onClick={handleCheckUpdate}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
              >
                <RefreshCw size={12} />
                {t('about.checkUpdate')}
              </button>
            )}
            {updateState === 'checking' && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <Loader2 size={12} className="animate-spin" />
                {t('about.checking')}
              </span>
            )}
            {updateState === 'latest' && (
              <span className="inline-flex items-center gap-1 text-xs text-success-600 dark:text-success-400">
                <CheckCircle size={12} />
                {t('about.latest')}
              </span>
            )}
            {updateState === 'available' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 dark:text-gray-300">
                  {t('about.foundUpdate')} v{updateVersion}
                </span>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
                >
                  <Download size={11} />
                  {t('about.downloadInstall')}
                </button>
              </div>
            )}
            {updateState === 'downloading' && (
              <div className="flex items-center gap-2 flex-1 max-w-[240px]">
                <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-primary-500 transition-all"
                    style={{ width: `${downloadPercent}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                  {downloadPercent.toFixed(0)}% · {formatBytes(downloadTransferred)}/{formatBytes(downloadTotal)}
                </span>
              </div>
            )}
            {updateState === 'downloaded' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-success-600 dark:text-success-400">
                  <CheckCircle size={12} className="inline mr-1" />
                  {t('about.downloaded')}
                </span>
                <button
                  onClick={handleRestart}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-success-600 hover:bg-success-700 text-white"
                >
                  <RotateCw size={11} />
                  {t('about.restart')}
                </button>
              </div>
            )}
            {updateState === 'error' && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-error-500 dark:text-error-400 truncate max-w-[140px]" title={updateError}>
                  <AlertCircle size={12} />
                  {t('about.updateFailed')}
                </span>
                {/* T2: 下载失败时提供「手动下载」降级按钮 */}
                <button
                  onClick={handleManualDownload}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-info-500 hover:bg-info-600 text-white"
                  title={t('update.manualDownload')}
                >
                  <ExternalLink size={11} />
                  {t('update.manualDownload')}
                </button>
                <button
                  onClick={handleCheckUpdate}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                >
                  <RefreshCw size={11} />
                  {t('about.retry')}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded bg-gray-500 hover:bg-gray-600 text-white shrink-0"
          >
            {t('about.close')}
          </button>
        </div>
      }
    >
      {/* 品牌区 - T4: 增大字号和间距 */}
      <div className="px-6 pt-6 pb-4 text-center shrink-0">
        <div className="flex justify-center mb-3">
          <img src="icons/logo.svg" alt="AutoLink" className="w-24 h-24" />
        </div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
          {t('app.title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5">
          {t('app.subtitle')}
        </p>
        {/* T4: 产品简介字号提升为 text-xs,增加行距和内边距 */}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 px-6 leading-relaxed">
          {t('app.description')}
        </p>
      </div>

      {/* 信息区：软件栈 + 快捷链接 - T4: 优化字号和布局层次 */}
      <div className="px-6 py-4 border-t border-gray-200 dark:border-edge-subtle overflow-y-auto">
        {/* T4: 软件栈标题更醒目 */}
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
          {t('about.version')}
        </p>
        {/* T4: 软件栈条目字号提升为 text-xs,增加行距 */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          {stackEntries.length === 0 ? (
            <div className="col-span-2 text-gray-400">{appVersion}</div>
          ) : stackEntries.map(([name, ver]) => (
            <div key={name} className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{name}</span>
              <span className="text-gray-700 dark:text-gray-300 font-mono">{ver || '-'}</span>
            </div>
          ))}
        </div>

        {/* 快捷链接 - T4: 字号提升为 text-xs */}
        <div className="mt-5 flex items-center justify-center gap-4 text-xs flex-wrap">
          <a
            href="https://github.com/bangbang8000-cell/AutoLink"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-primary-500"
          >
            <GitBranch size={13} />
            {t('about.repository')}
            <ExternalLink size={10} />
          </a>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <button
            type="button"
            onClick={() => setShowShortcutsDialog(true)}
            className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-primary-500"
          >
            <Keyboard size={13} />
            {t('about.shortcuts.title')}
          </button>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <button
            type="button"
            onClick={handleShowLogoSpec}
            title={t('about.logoSpec')}
            className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-primary-500"
          >
            <Palette size={13} />
            {t('about.logoSpec')}
          </button>
        </div>
        {/* 版权信息 - T4: 字号提升为 text-xs */}
        <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
          {t('about.copyright')}
        </p>
      </div>
    </Modal>
  )
}
