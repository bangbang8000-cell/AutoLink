/**
 * 打磨轮（v1.5 / AL-V1a）：启动动画窗口 preload
 * 向 splash.html 暴露：
 *  - splash.getAppInfo()：版本 + 界面语言（读 localStorage，与主应用 i18n 一致）
 *  - splash.onStage(cb)：订阅主进程真实启动阶段事件（splash:stage）
 */
import { contextBridge, ipcRenderer } from 'electron'

function detectLocale(): string {
  try {
    return window.localStorage.getItem('i18nextLng') || 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

contextBridge.exposeInMainWorld('splash', {
  getAppInfo: async () => ({
    version: await ipcRenderer.invoke('app:getVersion'),
    locale: detectLocale(),
  }),
  onStage: (callback: (data: { stage: string; progress: number }) => void) => {
    const handler = (_e: unknown, data: { stage: string; progress: number }) => callback(data)
    ipcRenderer.on('splash:stage', handler)
    return () => ipcRenderer.removeListener('splash:stage', handler)
  },
})
