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
    exportZip: (projectName: string, options?: { password?: string }) =>
      ipcRenderer.invoke('project:exportZip', projectName, options),
    importZip: (options?: { projectName?: string; zipPath?: string; password?: string }) =>
      ipcRenderer.invoke('project:importZip', options),
    batchExportZip: (projectNames: string[], options?: { password?: string }) =>
      ipcRenderer.invoke('project:batchExportZip', projectNames, options),
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
    getConfig: (templateName: string) =>
      ipcRenderer.invoke('template:getConfig', templateName),
    list: () => ipcRenderer.invoke('template:list'),
    preview: (templateName: string) =>
      ipcRenderer.invoke('template:preview', templateName),
    healthCheck: () => ipcRenderer.invoke('template:healthCheck'),
    create: (projectName: string, meta: unknown) =>
      ipcRenderer.invoke('template:create', projectName, meta),
    delete: (templateName: string) =>
      ipcRenderer.invoke('template:delete', templateName),
    update: (templateName: string, updates: unknown) =>
      ipcRenderer.invoke('template:update', templateName, updates),
    exportZip: (templateName: string, options?: { password?: string }) =>
      ipcRenderer.invoke('template:exportZip', templateName, options),
    importZip: (options?: { templateName?: string; zipPath?: string; password?: string }) =>
      ipcRenderer.invoke('template:importZip', options),
  },
  aidc: {
    plan: (params?: Record<string, unknown>) =>
      ipcRenderer.invoke('plan:aidc', params),
    // G2（REQ-A3）：导出 plan:table（json|excel），保存对话框在主进程弹出
    exportPlan: (params: Record<string, unknown>, format: 'json' | 'excel') =>
      ipcRenderer.invoke('plan:aidc:export', params, format),
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
  // V3.1.3-T7-4: 容量规划（模型档案 + 推荐）
  capacity: {
    listPresets: () =>
      ipcRenderer.invoke('capacity:list-presets'),
    recommend: (params: { model: string; numGpus: number; budget?: string; precision?: string; contextLength?: number }) =>
      ipcRenderer.invoke('capacity:recommend', params),
  },
  // V3.2.0-T9-2: ATOP 自动拓扑优化（通信特征 → ZCube cube 拓扑推荐，只读）
  atop: {
    recommend: (params: {
      numGpus: number
      model?: string
      modelType?: string
      numExperts?: number
      precision?: string
      tp?: number
      dp?: number
      pp?: number
      communicationPattern?: string
      commRatio?: number
      traffic?: Record<string, number>
      switchPorts?: number
    }) => ipcRenderer.invoke('atop:recommend', params),
  },
  // V3.2.0-T9-3: 批量优化（收敛比/成本/散热建议生成 + 应用）
  optimize: {
    suggest: (params: { projectName: string }) =>
      ipcRenderer.invoke('optimize:suggest', params),
    apply: (params: {
      projectName: string
      suggestions: Array<{ category?: string; title?: string; patch: Record<string, Record<string, unknown>> }>
    }) => ipcRenderer.invoke('optimize:apply', params),
  },
  // V3.2.0-T9-4: 智能修复（校验错误 → 修复 patch → 复核 → 一键应用）
  repair: {
    plan: (params: { projectName: string }) =>
      ipcRenderer.invoke('repair:plan', params),
    apply: (params: {
      projectName: string
      fixes: Array<{ rule_id?: string; message?: string; patch: Record<string, Record<string, unknown>> }>
    }) => ipcRenderer.invoke('repair:apply', params),
  },
  // V3.0.4-T3-1: 机房矩阵（创建/校验）
  room: {
    createMatrix: (rows: string[], cols: number[], name?: string) =>
      ipcRenderer.invoke('room:create', rows, cols, name),
    validateLayout: (layout: unknown) =>
      ipcRenderer.invoke('room:validate', layout),
    // V3.1.4-T8-2: 机房智能落位（backend room:optimize）
    optimize: (params: {
      matrix?: unknown
      project?: string
      counts?: Record<string, number>
      cabinets?: Array<{ id: number; type: string; power_watts: number }>
      objectives?: Record<string, number>
      constraints?: { powerLimitPerRack?: number }
      timeBudgetS?: number
      resetExisting?: boolean
    }) => ipcRenderer.invoke('room:optimize', params),
  },
  // V3.0.4-T3-4: 统一配置体系（schema/预设/导入导出）
  config: {
    listSchema: () =>
      ipcRenderer.invoke('config:list-schema'),
    applyPreset: (presetId: string, config: unknown) =>
      ipcRenderer.invoke('config:apply-preset', presetId, config),
    exportConfig: (appSettings: unknown, projectConfig: unknown) =>
      ipcRenderer.invoke('config:export', appSettings, projectConfig),
    importConfig: (payload: unknown) =>
      ipcRenderer.invoke('config:import', payload),
  },
  // V3.1.0-T4-3: CLI 能力层信息与审计日志
  cli: {
    info: () =>
      ipcRenderer.invoke('cli:info'),
    audit: (limit?: number) =>
      ipcRenderer.invoke('cli:audit', limit),
  },
  // V3.0.0-T0-6: Python 持久 Agent 流式通道（AIHUB 对话/进度复用）
  ai: {
    call: (action: string, params?: unknown) => ipcRenderer.invoke('ai:call', action, params),
    onStream: (callback: (data: { requestId: string; chunk: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; chunk: string }) => callback(data)
      ipcRenderer.on('ai:stream', handler)
      return () => ipcRenderer.removeListener('ai:stream', handler)
    },
  },
  // V3.1.1-T5-4: AI 对话专用桥接（chat 走 ai:chat 独立通道，其余复用 ai:call）
  aihub: {
    chat: (params: { sessionId: string; message: string; mode?: string; provider?: string; autonomyMode?: string; projectName?: string; attachments?: unknown[] }) =>
      ipcRenderer.invoke('ai:chat', params),
    onStream: (callback: (data: { sessionId: string; chunk: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; chunk: string }) => callback(data)
      ipcRenderer.on('aihub:stream', handler)
      return () => ipcRenderer.removeListener('aihub:stream', handler)
    },
    providers: () => ipcRenderer.invoke('ai:call', 'ai:providers', {}),
    config: (cfg: { provider: string; apiKey: string; model?: string; baseUrl?: string }) =>
      ipcRenderer.invoke('ai:call', 'ai:config', cfg),
    configDefault: (provider: string) =>
      ipcRenderer.invoke('ai:call', 'ai:config-default', { provider }),
    test: (cfg: { provider: string; apiKey: string; baseUrl: string; model: string }) =>
      ipcRenderer.invoke('ai:call', 'ai:test', cfg),
    models: (cfg: { baseUrl: string; apiKey: string }) =>
      ipcRenderer.invoke('ai:call', 'ai:models', cfg),
    clear: (sessionId: string) =>
      ipcRenderer.invoke('ai:call', 'ai:clear', { sessionId }),
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
  // V3.3.0-T13: 云端平台（登录 + 云中心）。渲染层零网络（CSP connect-src 'self'），
  // 所有 HTTP 由主进程 cloudService 发起，此处仅透传 IPC。
  cloud: {
    setBaseUrl: (url: string) => ipcRenderer.invoke('cloud:setBaseUrl', url),
    getBaseUrl: () => ipcRenderer.invoke('cloud:getBaseUrl'),
    getLoginState: () => ipcRenderer.invoke('cloud:getLoginState'),
    health: () => ipcRenderer.invoke('cloud:health'),
    authQrcode: (platform: string) => ipcRenderer.invoke('cloud:authQrcode', { platform }),
    authPoll: (sessionId: string) => ipcRenderer.invoke('cloud:authPoll', { sessionId }),
    authHealth: () => ipcRenderer.invoke('cloud:authHealth'),
    logout: () => ipcRenderer.invoke('cloud:logout'),
    clientDashboard: () => ipcRenderer.invoke('cloud:clientDashboard'),
    clientVersion: () => ipcRenderer.invoke('cloud:clientVersion'),
    clientNotifications: () => ipcRenderer.invoke('cloud:clientNotifications'),
    publicStats: () => ipcRenderer.invoke('cloud:publicStats'),
    projectList: () => ipcRenderer.invoke('cloud:projectList'),
    projectSearch: (q: string) => ipcRenderer.invoke('cloud:projectSearch', q),
    projectSearchPublic: (params: { q?: string; page?: number; limit?: number }) =>
      ipcRenderer.invoke('cloud:projectSearchPublic', params),
    projectCreate: (data: { name: string; description?: string; private: boolean; template_owner?: string; template_repo?: string; files?: { path: string; content: string }[] }) =>
      ipcRenderer.invoke('cloud:projectCreate', data),
    projectDelete: (owner: string, repo: string) => ipcRenderer.invoke('cloud:projectDelete', { owner, repo }),
    projectSyncCheck: (projects: { name: string; local_sha?: string }[]) =>
      ipcRenderer.invoke('cloud:projectSyncCheck', { projects }),
    projectDownload: (owner: string, repo: string) => ipcRenderer.invoke('cloud:projectDownload', { owner, repo }),
    // V4-1: 项目 Fork
    projectFork: (owner: string, repo: string) => ipcRenderer.invoke('cloud:projectFork', { owner, repo }),
    // V4-4: 大文件分片上传
    uploadFileChunked: (owner: string, repo: string, path: string, content: string) =>
      ipcRenderer.invoke('cloud:uploadFileChunked', { owner, repo, path, content }),
    templateList: (params?: { q?: string; category?: string; page?: number; limit?: number; sort?: string }) =>
      ipcRenderer.invoke('cloud:templateList', params ?? {}),
    templateDetail: (owner: string, repo: string) => ipcRenderer.invoke('cloud:templateDetail', { owner, repo }),
    // V4-2: 模板统计
    templateStats: (owner: string, repo: string) => ipcRenderer.invoke('cloud:templateStats', { owner, repo }),
    templateDownload: (owner: string, repo: string) => ipcRenderer.invoke('cloud:templateDownload', { owner, repo }),
    templateMine: () => ipcRenderer.invoke('cloud:templateMine'),
    templatePublish: (data: { name: string; description: string; category: string; public: boolean; files: { path: string; content: string }[] }) =>
      ipcRenderer.invoke('cloud:templatePublish', data),
    // V3.3.2-T15-3: 模板收藏 + 权限
    templateFavoriteAdd: (owner: string, repo: string) => ipcRenderer.invoke('cloud:templateFavoriteAdd', { owner, repo }),
    templateFavoriteRemove: (owner: string, repo: string) => ipcRenderer.invoke('cloud:templateFavoriteRemove', { owner, repo }),
    templateFavorites: () => ipcRenderer.invoke('cloud:templateFavorites'),
    templatePermissions: (owner: string, repo: string) => ipcRenderer.invoke('cloud:templatePermissions', { owner, repo }),
    templateGrantPermission: (owner: string, repo: string, username: string, role: string) =>
      ipcRenderer.invoke('cloud:templateGrantPermission', { owner, repo, username, role }),
    templateRevokePermission: (owner: string, repo: string, username: string) =>
      ipcRenderer.invoke('cloud:templateRevokePermission', { owner, repo, username }),
    userProfile: () => ipcRenderer.invoke('cloud:userProfile'),
    updateUserProfile: (data: { full_name?: string; bio?: string }) =>
      ipcRenderer.invoke('cloud:updateUserProfile', data),
    giteaCredentials: () => ipcRenderer.invoke('cloud:giteaCredentials'),
    searchFiles: (q: string, limit?: number) => ipcRenderer.invoke('cloud:searchFiles', { q, limit }),
    searchContent: (q: string, limit?: number) => ipcRenderer.invoke('cloud:searchContent', { q, limit }),
    collectProjectFiles: (name: string) => ipcRenderer.invoke('cloud:collectProjectFiles', name),
    computeProjectSha: (name: string) => ipcRenderer.invoke('cloud:computeProjectSha', name),
    installRemoteProject: (data: { name: string; zipData: string; owner: string; overwrite?: boolean }) =>
      ipcRenderer.invoke('cloud:installRemoteProject', data),
    installRemoteTemplate: (data: { name: string; zipData: string; owner: string }) =>
      ipcRenderer.invoke('cloud:installRemoteTemplate', data),
    // V3.3.2-T15-1: 分享链接（只读快照 → 免登录预览页）
    shareCreate: (data: { projectName: string; description?: string; expireDays?: number }) =>
      ipcRenderer.invoke('cloud:shareCreate', data),
    shareList: () => ipcRenderer.invoke('cloud:shareList'),
    shareDelete: (token: string) => ipcRenderer.invoke('cloud:shareDelete', token),
  },
  // V3.3.1: 本地搜索（项目文件 / 设备库 / 模板）
  search: {
    local: (params: { query: string; scope?: 'project' | 'device' | 'template' | 'all'; maxResults?: number }) =>
      ipcRenderer.invoke('search:local', params),
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
