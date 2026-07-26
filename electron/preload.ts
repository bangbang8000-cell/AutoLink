import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    create: (name: string, options?: { template?: string; empty?: boolean }) =>
      ipcRenderer.invoke('project:create', name, options),
    delete: (ids: string[]) => ipcRenderer.invoke('project:delete', ids),
    getStructure: (name: string) => ipcRenderer.invoke('project:getStructure', name),
  },
  design: {
    generate: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('design:generate', config),
    validate: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('design:validate', config),
  },
  render: {
    exportConnections: (projectName: string, outputTypes: string[]) =>
      ipcRenderer.invoke('render:exportConnections', projectName, outputTypes),
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('render:progress', handler)
      return () => ipcRenderer.removeListener('render:progress', handler)
    },
  },
  app: {
    getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    checkUpdate: () => ipcRenderer.invoke('app:check-update'),
    downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
    quitAndInstall: () => ipcRenderer.invoke('app:quit-and-install'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  shell: {
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  },
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
  },
}

contextBridge.exposeInMainWorld('electron', electronAPI)

export type ElectronAPI = typeof electronAPI
