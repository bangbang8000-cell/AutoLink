import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, ExternalLink, RefreshCw, CheckCircle, AlertCircle, Download, RotateCw, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useUpdateStore } from '@/stores/update.store'

interface Props {
  onClose: () => void
}

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

  // AL-U1：更新状态全部受控来自单点聚合 store（与 UpdatePopover/RestartPromptDialog 同源）
  const status = useUpdateStore((s) => s.status)
  const updateVersion = useUpdateStore((s) => s.version)
  const updateError = useUpdateStore((s) => s.error)
  const downloadPercent = useUpdateStore((s) => s.percent)
  const downloadTransferred = useUpdateStore((s) => s.transferred)
  const downloadTotal = useUpdateStore((s) => s.total)
  const latestJustConfirmed = useUpdateStore((s) => s.latestJustConfirmed)
  const check = useUpdateStore((s) => s.check)
  const download = useUpdateStore((s) => s.download)
  const quitAndInstall = useUpdateStore((s) => s.quitAndInstall)
  const openReleasesPage = useUpdateStore((s) => s.openReleasesPage)

  // 加载版本信息
  useEffect(() => {
    window.electron?.app?.getVersion?.().then((v: string) => v && setAppVersion(v)).catch(() => {})
    window.electron?.app?.getStackVersions?.().then((s: StackVersions | null) => s && setStack(s)).catch(() => {})
  }, [])

  // AL-U1：手动检查更新（store 内部合并 invoke 结果与 preload 事件，并维护「已是最新」3 秒回 idle）
  const handleCheckUpdate = () => check()
  const handleDownload = () => download()
  const handleManualDownload = () => openReleasesPage()
  const handleRestart = () => quitAndInstall()

  const formatBytes = (b: number) => {
    if (!b) return '0 MB'
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 / 1024).toFixed(1)} MB`
  }

  // AboutDialog 专用瞬态：手动检查「已是最新」3 秒绿色确认
  const showLatest = status === 'idle' && latestJustConfirmed

  // 一行技术栈摘要（对齐 MagicCommander About 风格）
  const stackSummary = stack
    ? [
        ['Electron', stack.electron],
        ['Chromium', stack.chrome],
        ['Node.js', stack.node],
        ['React', cleanVer(stack.react)],
        ['TypeScript', cleanVer(stack.typescript)],
        ['Vite', cleanVer(stack.vite)],
        ['Python', stack.python],
      ]
        .map(([name, ver]) => (ver ? `${name} ${ver}` : name))
        .join(' · ')
    : ''

  return (
    <Modal
      open
      onClose={onClose}
      title={t('about.title')}
      width={460}
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
            {status === 'idle' && !showLatest && (
              <button
                onClick={handleCheckUpdate}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary hover:bg-primary-hover text-white"
              >
                <RefreshCw size={12} />
                {t('about.checkUpdate')}
              </button>
            )}
            {status === 'checking' && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <Loader2 size={12} className="animate-spin" />
                {t('about.checking')}
              </span>
            )}
            {showLatest && (
              <span className="inline-flex items-center gap-1 text-xs text-success-600 dark:text-success-400">
                <CheckCircle size={12} />
                {t('about.latest')}
              </span>
            )}
            {status === 'available' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 dark:text-gray-300">
                  {t('about.foundUpdate')} v{updateVersion}
                </span>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary hover:bg-primary-hover text-white"
                >
                  <Download size={11} />
                  {t('about.downloadInstall')}
                </button>
              </div>
            )}
            {status === 'downloading' && (
              <div className="flex items-center gap-2 flex-1 max-w-[240px]">
                <div className="flex-1 h-1.5 bg-app-hover rounded overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${downloadPercent}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                  {downloadPercent.toFixed(0)}% · {formatBytes(downloadTransferred)}/{formatBytes(downloadTotal)}
                </span>
              </div>
            )}
            {status === 'downloaded' && (
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
            {status === 'error' && (
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
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-app-hover hover:bg-app-hover/70 text-text-secondary"
                >
                  <RefreshCw size={11} />
                  {t('about.retry')}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded-md bg-text-secondary hover:bg-text-primary text-white shrink-0"
          >
            {t('about.close')}
          </button>
        </div>
      }
    >
      {/* 横排品牌区：小 Logo + 标题 + 版本（对齐 MagicCommander About 风格） */}
      <div className="flex items-center gap-3 px-6 pt-5 pb-3">
        <img src="icons/logo.svg" alt="AutoLink" className="w-12 h-12 rounded-lg shrink-0" />
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100 leading-tight">
            {t('app.title')}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
            {t('app.subtitle')}
          </p>
        </div>
      </div>

      {/* 简介 */}
      <div className="px-6 pb-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {t('app.description')}
        </p>
      </div>

      {/* 主要功能 */}
      <div className="px-6 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
          {t('about.featuresTitle')}
        </p>
        <ul className="space-y-1.5">
          {(t('about.features', { returnObjects: true }) as string[]).map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 技术栈一行 + 链接/版权 */}
      <div className="px-6 py-3 border-t border-gray-200 dark:border-edge-subtle">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
          {t('about.version')}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {stackSummary || appVersion}
        </p>
      </div>

      <div className="px-6 py-3 flex items-center justify-between gap-3 border-t border-gray-200 dark:border-edge-subtle">
        <a
          href="https://github.com/bangbang8000-cell/AutoLink"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary"
        >
          <GitBranch size={12} />
          {t('about.repository')}
          <ExternalLink size={10} />
        </a>
        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
          {t('about.copyright')}
        </span>
      </div>
    </Modal>
  )
}
