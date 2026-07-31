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
      setUpdateError(err?.message || String(err))
      setUpdateState('error')
    }
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
      width={480}
      maxHeight="90vh"
      closeOnEsc
      bodyClassName="p-0"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-2xs text-gray-400 dark:text-gray-500 shrink-0">
            v{appVersion}{stack?.buildNumber ? ` · 构建 #${stack.buildNumber}` : ''}
          </div>

          {/* 检查更新状态区 */}
          <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
            {updateState === 'idle' && (
              <button
                onClick={handleCheckUpdate}
                className="inline-flex items-center gap-1 px-2 py-1 text-2xs rounded bg-primary-500 hover:bg-primary-600 text-white"
              >
                <RefreshCw size={11} />
                {t('about.checkUpdate')}
              </button>
            )}
            {updateState === 'checking' && (
              <span className="inline-flex items-center gap-1 text-2xs text-gray-500 dark:text-gray-400">
                <Loader2 size={11} className="animate-spin" />
                {t('about.checking')}
              </span>
            )}
            {updateState === 'latest' && (
              <span className="inline-flex items-center gap-1 text-2xs text-success-600 dark:text-success-400">
                <CheckCircle size={11} />
                {t('about.latest')}
              </span>
            )}
            {updateState === 'available' && (
              <div className="flex items-center gap-2">
                <span className="text-2xs text-gray-600 dark:text-gray-300">
                  {t('about.foundUpdate')} v{updateVersion}
                </span>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs rounded bg-primary-500 hover:bg-primary-600 text-white"
                >
                  <Download size={10} />
                  {t('about.downloadInstall')}
                </button>
              </div>
            )}
            {updateState === 'downloading' && (
              <div className="flex items-center gap-2 flex-1 max-w-[220px]">
                <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-primary-500 transition-all"
                    style={{ width: `${downloadPercent}%` }}
                  />
                </div>
                <span className="text-2xs text-gray-500 dark:text-gray-400 shrink-0">
                  {downloadPercent.toFixed(0)}% · {formatBytes(downloadTransferred)}/{formatBytes(downloadTotal)}
                </span>
              </div>
            )}
            {updateState === 'downloaded' && (
              <div className="flex items-center gap-2">
                <span className="text-2xs text-success-600 dark:text-success-400">
                  <CheckCircle size={11} className="inline mr-1" />
                  {t('about.downloaded')}
                </span>
                <button
                  onClick={handleRestart}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs rounded bg-success-600 hover:bg-success-700 text-white"
                >
                  <RotateCw size={10} />
                  {t('about.restart')}
                </button>
              </div>
            )}
            {updateState === 'error' && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-2xs text-error-500 dark:text-error-400 truncate" title={updateError}>
                  <AlertCircle size={11} />
                  {t('about.updateFailed')}
                </span>
                <button
                  onClick={handleCheckUpdate}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                >
                  <RefreshCw size={10} />
                  {t('about.retry')}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-3 py-1 text-2xs rounded bg-gray-500 hover:bg-gray-600 text-white shrink-0"
          >
            {t('about.close')}
          </button>
        </div>
      }
    >
      {/* 品牌区 */}
      <div className="px-6 pt-6 pb-3 text-center shrink-0">
        <div className="flex justify-center mb-2">
          <img src="icons/logo.svg" alt="AutoLink" className="w-24 h-24" />
        </div>
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">
          {t('app.title')}
        </h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {t('app.subtitle')}
        </p>
        {/* T3: 产品简介 */}
        <p className="text-2xs text-gray-400 dark:text-gray-500 mt-2 px-4 leading-relaxed">
          {t('app.description')}
        </p>
      </div>

      {/* 信息区：软件栈 + 快捷链接 */}
      <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 overflow-y-auto">
        <p className="text-2xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
          {t('about.version')}
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-2xs">
          {stackEntries.length === 0 ? (
            <div className="col-span-2 text-gray-400">{appVersion}</div>
          ) : stackEntries.map(([name, ver]) => (
            <div key={name} className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{name}</span>
              <span className="text-gray-600 dark:text-gray-300 font-mono">{ver || '-'}</span>
            </div>
          ))}
        </div>

        {/* 快捷链接 */}
        <div className="mt-4 flex items-center justify-center gap-4 text-2xs flex-wrap">
          <a
            href="https://github.com/bangbang8000-cell/AutoLink"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-primary-500"
          >
            <GitBranch size={12} />
            {t('about.repository')}
            <ExternalLink size={9} />
          </a>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <button
            type="button"
            onClick={() => setShowShortcutsDialog(true)}
            className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-primary-500"
          >
            <Keyboard size={12} />
            {t('about.shortcuts.title')}
          </button>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <button
            type="button"
            onClick={handleShowLogoSpec}
            title={t('about.logoSpec')}
            className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-primary-500"
          >
            <Palette size={12} />
            {t('about.logoSpec')}
          </button>
        </div>
        {/* 版权信息 */}
        <p className="mt-3 text-center text-2xs text-gray-400 dark:text-gray-500">
          {t('about.copyright')}
        </p>
      </div>
    </Modal>
  )
}
