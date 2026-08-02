import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    create: (name: string, options?: { template?: string; empty?: boolean }) =>
      ipcRenderer.invoke('project:create', name, options),
    createWithConfig: (config: unknown) =>
      ipcRenderer.invoke('project:createWithConfig', config),
    delete: (names: string[]) => ipcRenderer.invoke('project:delete', names),
    duplicate: (sourceName: string, targetName: string) =>
      ipcRenderer.invoke('project:duplicate', sourceName, targetName),
    rename: (oldName: string, newName: string) =>
      ipcRenderer.invoke('project:rename', oldName, newName),
    exportZip: (projectName: string) =>
      ipcRenderer.invoke('project:exportZip', projectName),
    importZip: (options?: { projectName?: string; zipPath?: string }) =>
      ipcRenderer.invoke('project:importZip', options),
    batchExportZip: (projectNames: string[]) =>
      ipcRenderer.invoke('project:batchExportZip', projectNames),
    getStructure: (name: string) => ipcRenderer.invoke('project:getStructure', name),
    getConfigFile: (name: string) => ipcRenderer.invoke('project:getConfigFile', name),
    saveConfigFile: (name: string, content: string) =>
      ipcRenderer.invoke('project:saveConfigFile', name, content),
    // T6.1: 通用项目文件保存(白名单: topology.json, rack_layout.json)
    saveFile: (name: string, relativePath: string, content: string) =>
      ipcRenderer.invoke('project:saveFile', name, relativePath, content),
    getFile: (name: string, filePath: string) =>
      ipcRenderer.invoke('project:getFile', name, filePath),
    getFileBinary: (name: string, filePath: string) =>
      ipcRenderer.invoke('project:getFileBinary', name, filePath),
    listOutputFiles: (name: string) =>
      ipcRenderer.invoke('project:listOutputFiles', name),
    listOutputBatches: (projectName: string) =>
      ipcRenderer.invoke('project:listOutputBatches', projectName),
    deleteOutputFile: (projectName: string, filePath: string) =>
      ipcRenderer.invoke('project:deleteOutputFile', projectName, filePath),
    deleteOutputBatch: (projectName: string, batchName: string) =>
      ipcRenderer.invoke('project:deleteOutputBatch', projectName, batchName),
    clearOutput: (projectName: string) =>
      ipcRenderer.invoke('project:clearOutput', projectName),
  },
  template: {
    getStructure: (templateName: string) =>
      ipcRenderer.invoke('template:getStructure', templateName),
    getFile: (templateName: string, filePath: string) =>
      ipcRenderer.invoke('template:getFile', templateName, filePath),
    list: () => ipcRenderer.invoke('template:list'),
    create: (projectName: string, meta: unknown) =>
      ipcRenderer.invoke('template:create', projectName, meta),
    delete: (templateName: string) =>
      ipcRenderer.invoke('template:delete', templateName),
    update: (templateName: string, updates: unknown) =>
      ipcRenderer.invoke('template:update', templateName, updates),
    exportZip: (templateName: string) =>
      ipcRenderer.invoke('template:exportZip', templateName),
    importZip: (options?: { templateName?: string; zipPath?: string }) =>
      ipcRenderer.invoke('template:importZip', options),
  },
  design: {
    generate: (projectName: string, configINI?: string) =>
      ipcRenderer.invoke('design:generate', projectName, configINI),
    validate: (projectName: string, configINI?: string) =>
      ipcRenderer.invoke('design:validate', projectName, configINI),
    estimate: (projectName: string, estimateParams?: Record<string, unknown>) =>
      ipcRenderer.invoke('design:estimate', projectName, estimateParams),
    report: (projectName: string) =>
      ipcRenderer.invoke('design:report', projectName),
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
    getStackVersions: () => ipcRenderer.invoke('app:getStackVersions'),
    showBrandingAsset: (filename: string) => ipcRenderer.invoke('app:showBrandingAsset', filename),
    readDocFile: (filename: string) => ipcRenderer.invoke('app:readDocFile', filename),
    checkUpdate: () => ipcRenderer.invoke('app:check-update'),
    downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
    quitAndInstall: () => ipcRenderer.invoke('app:quit-and-install'),
    openReleasesPage: () => ipcRenderer.invoke('app:open-releases-page'),
    onUpdateAvailable: (callback: (data: { version: string; releaseNotes?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { version: string; releaseNotes?: string }) => callback(data)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    },
    onUpdateDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => callback(data)
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
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized)
      ipcRenderer.on('window:maximizeChange', handler)
      return () => ipcRenderer.removeListener('window:maximizeChange', handler)
    },
  },
  shell: {
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  },
  export: {
    saveFile: (projectName: string, fileName: string, base64Data: string) =>
      ipcRenderer.invoke('export:saveFile', projectName, fileName, base64Data),
  },
  onLogOutput: (callback: (data: { message: string; level?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string; level?: string }) => callback(data)
    ipcRenderer.on('log:output', handler)
    return () => ipcRenderer.removeListener('log:output', handler)
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
    chromium: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
  },
}

contextBridge.exposeInMainWorld('electron', electronAPI)

export type ElectronAPI = typeof electronAPI
