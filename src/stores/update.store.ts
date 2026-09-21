import { create } from 'zustand'
import i18n from '@/i18n'
import { useToastStore } from '@/stores/toast.store'

/**
 * AL-U1：更新机制单点聚合 store（对齐 MC Header 单点订阅）。
 *
 * 背景：AL 主进程无单一 onUpdateStatus；preload 暴露 4 个事件
 *   onUpdateAvailable / onUpdateDownloadProgress / onUpdateDownloaded / onUpdateError
 * 本 store 在渲染层订阅这 4 个事件并聚合为单一状态机，UpdatePopover / AboutDialog /
 * RestartPromptDialog 全部受控读取，消除原先两个组件各自 useState 状态机互不同步的问题。
 *
 * 主进程与 preload 一行不改；既有链路（完整性校验、离线提示、手动下载降级 GitHub Releases、
 * "已是最新"3 秒回 idle、错误态与"无更新"区分）完整保留。
 */

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateProgressInfo {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

interface UpdateState {
  /** 聚合状态机 */
  status: UpdateStatus
  /** 新版本号（status=available/downloading/downloaded 时有效） */
  version: string
  /** 解析后的更新日志纯文本 */
  releaseNotes: string
  /** 下载进度（0-100，已四舍五入） */
  percent: number
  /** 下载字节明细（AboutDialog 展示用） */
  transferred: number
  total: number
  bytesPerSecond: number
  /** 错误信息（status=error 时有效） */
  error: string
  /**
   * AboutDialog 手动检查「已是最新」3 秒绿色确认瞬态。
   * 不进 status 状态机（idle 时叠加），3 秒后自动复位，回落到「检查更新」按钮。
   */
  latestJustConfirmed: boolean
  /** 下载完成后是否弹出「立即重启/稍后」确认框 */
  restartPromptVisible: boolean

  /** 手动检查更新（Invoke checkUpdate，结果与事件双通道合并） */
  check: () => Promise<void>
  /** 触发下载（下载完成由 onUpdateDownloaded 事件驱动） */
  download: () => Promise<void>
  /** 退出并安装 */
  quitAndInstall: () => void
  /** 手动下载降级：打开 GitHub Releases 页面 */
  openReleasesPage: () => void
  setRestartPromptVisible: (v: boolean) => void
  /** 挂载到上层（Header）一次性订阅 preload 4 事件，返回解绑函数（幂等） */
  attach: () => () => void
  /** 测试专用：解绑并复位全部状态与模块级标志 */
  __reset: () => void
}

// electron-updater 的 releaseNotes 可能是 string / { notes } / [{version, notes}]
const parseReleaseNotes = (notes: unknown): string => {
  if (!notes) return ''
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    return notes
      .map((n: { version?: string; notes?: string }) => `## v${n.version}\n${n.notes || ''}`)
      .join('\n\n')
  }
  if (typeof notes === 'object' && notes !== null) {
    return (notes as { notes?: string }).notes || ''
  }
  return ''
}

// 模块级单例状态：事件只订阅一次；启动自动检查的「新版本」toast 只弹一次
let attached = false
let detachFns: Array<() => void> = []
let latestTimer: ReturnType<typeof setTimeout> | null = null
let autoNotified = false

const clearLatestTimer = () => {
  if (latestTimer) {
    clearTimeout(latestTimer)
    latestTimer = null
  }
}

const initialState = {
  status: 'idle' as UpdateStatus,
  version: '',
  releaseNotes: '',
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
  error: '',
  latestJustConfirmed: false,
  restartPromptVisible: false,
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  ...initialState,

  check: async () => {
    clearLatestTimer()
    set({ status: 'checking', error: '', latestJustConfirmed: false })
    try {
      const result = await window.electron?.app?.checkUpdate?.()
      if (result?.updateAvailable) {
        // 事件通道也会置 available；这里以 invoke 结果补齐版本号即可（幂等）
        set((s) => ({ status: 'available', version: result.version || s.version }))
      } else if (result?.error) {
        // 检查失败（网络问题等），与"无更新"区分
        set({ status: 'error', error: i18n.t('update.checkFailed') as string })
      } else {
        set({ status: 'idle' })
        useToastStore.getState().addToast('info', i18n.t('update.upToDate') as string, 3000)
        // AboutDialog「已是最新」绿色确认 3 秒后回落 idle
        set({ latestJustConfirmed: true })
        latestTimer = setTimeout(() => {
          set({ latestJustConfirmed: false })
          latestTimer = null
        }, 3000)
      }
    } catch {
      set({ status: 'error', error: i18n.t('update.checkFailed') as string })
    }
  },

  download: async () => {
    clearLatestTimer()
    set({ status: 'downloading', error: '', latestJustConfirmed: false })
    try {
      await window.electron?.app?.downloadUpdate?.()
      // 转入 downloaded 由 onUpdateDownloaded 事件驱动
    } catch {
      set({ status: 'error', error: i18n.t('update.downloadFailed') as string })
    }
  },

  quitAndInstall: () => {
    set({ restartPromptVisible: false })
    window.electron?.app?.quitAndInstall?.()
  },

  openReleasesPage: () => {
    window.electron?.app?.openReleasesPage?.()
  },

  setRestartPromptVisible: (v) => set({ restartPromptVisible: v }),

  attach: () => {
    if (attached) return () => {}
    const app = window.electron?.app
    if (!app) return () => {}

    const unsubAvailable = app.onUpdateAvailable?.((data) => {
      set({
        version: data.version || '',
        releaseNotes: parseReleaseNotes(data.releaseNotes),
        status: 'available',
      })
      // 启动自动检查发现新版本时的提示，全生命周期只弹一次
      if (!autoNotified) {
        autoNotified = true
        useToastStore
          .getState()
          .addToast('info', i18n.t('update.newVersionAvailable', { version: data.version }) as string, 6000)
      }
    })
    const unsubProgress = app.onUpdateDownloadProgress?.((data) => {
      set({
        percent: Math.round(data.percent),
        transferred: data.transferred,
        total: data.total,
        bytesPerSecond: data.bytesPerSecond,
      })
    })
    const unsubDownloaded = app.onUpdateDownloaded?.(() => {
      set({ status: 'downloaded' })
      useToastStore.getState().addToast('success', i18n.t('update.downloaded') as string, 5000)
      // 对齐 MC：下载完成自动弹重启确认框
      set({ restartPromptVisible: true })
    })
    const unsubError = app.onUpdateError?.((message) => {
      set({ status: 'error', error: message })
    })

    detachFns = [unsubAvailable, unsubProgress, unsubDownloaded, unsubError].filter(
      (fn): fn is () => void => typeof fn === 'function',
    )
    attached = true
    return () => {
      detachFns.forEach((fn) => fn())
      detachFns = []
      attached = false
    }
  },

  __reset: () => {
    if (attached) {
      detachFns.forEach((fn) => fn())
      detachFns = []
      attached = false
    }
    clearLatestTimer()
    autoNotified = false
    set({ ...initialState })
  },
}))
