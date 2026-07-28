import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    create: (name: string, options?: { template?: string; empty?: boolean }) =>
      ipcRenderer.invoke('project:create', name, options),
    createWithConfig: (config: unknown) =>
      ipcRenderer.invoke('project:createWithConfig', config),
    delete: (ids: string[]) => ipcRenderer.invoke('project:delete', ids),
    getStructure: (name: string) => ipcRenderer.invoke('project:getStructure', name),
    getConfigFile: (name: string) => ipcRenderer.invoke('project:getConfigFile', name),
    saveConfigFile: (name: string, content: string) =>
      ipcRenderer.invoke('project:saveConfigFile', name, content),
    getFile: (name: string, filePath: string) =>
      ipcRenderer.invoke('project:getFile', name, filePath),
    getFileBinary: (name: string, filePath: string) =>
      ipcRenderer.invoke('project:getFileBinary', name, filePath),
    listOutputFiles: (name: string) =>
      ipcRenderer.invoke('project:listOutputFiles', name),
  },
  design: {
    generate: (projectName: string, configINI?: string) =>
      ipcRenderer.invoke('design:generate', projectName, configINI),
    validate: (projectName: string, configINI?: string) =>
      ipcRenderer.invoke('design:validate', projectName, configINI),
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
    onUpdateAvailable: (callback: (data: { version: string; releaseNotes?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { version: string; releaseNotes?: string }) => callback(data)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    },
    onUpdateDownloadProgress: (callback: (data: { percent: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { percent: number }) => callback(data)
      ipcRenderer.on('update:downloadProgress', handler)
      return () => ipcRenderer.removeListener('update:downloadProgress', handler)
    },
    onUpdateDownloaded: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('update:downloaded', handler)
      return () => ipcRenderer.removeListener('update:downloaded', handler)
    },
    onUpdateError: (callback: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
      ipcRenderer.on('update:error', handler)
      return () => ipcRenderer.removeListener('update:error', handler)
    },
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
  export: {
    saveFile: (projectName: string, fileName: string, base64Data: string) =>
      ipcRenderer.invoke('export:saveFile', projectName, fileName, base64Data),
  },
  deviceLibrary: {
    list: () => ipcRenderer.invoke('device-library:list'),
    get: (deviceId: string) => ipcRenderer.invoke('device-library:get', deviceId),
    save: (device: unknown) => ipcRenderer.invoke('device-library:save', device),
    delete: (deviceId: string) => ipcRenderer.invoke('device-library:delete', deviceId),
    import: (devices: unknown[]) => ipcRenderer.invoke('device-library:import', devices),
    export: (deviceIds: string[], format: string) => ipcRenderer.invoke('device-library:export', deviceIds, format),
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
