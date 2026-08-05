interface Window {
  electron: {
    project: {
      list: () => Promise<{ id: number; name: string; index: number; status?: 'ready' | 'configured' | 'designed' | 'layouted'; fileCount?: number; updatedAt?: string; description?: string }[]>
      create: (name: string, options?: { template?: string; empty?: boolean }) => Promise<void>
      createWithConfig: (config: import('@/types/project-config').ProjectConfig) => Promise<void>
      delete: (ids: string[]) => Promise<void>
      duplicate: (sourceName: string, targetName: string) => Promise<void>
      rename: (oldName: string, newName: string) => Promise<void>
      exportZip: (projectName: string) => Promise<{ canceled: boolean; zipPath: string }>
      importZip: (options?: { projectName?: string; zipPath?: string }) => Promise<{ canceled: boolean; projectName: string }>
      batchExportZip: (projectNames: string[]) => Promise<{
        canceled: boolean
        result: {
          successes: { name: string; zipPath: string }[]
          failures: { name: string; error: string }[]
        } | null
        targetDir: string
      }>
      getStructure: (name: string) => Promise<import('@/types/file-tree').FileTreeNode[]>
      getConfigFile: (name: string) => Promise<string | null>
      saveConfigFile: (name: string, content: string) => Promise<void>
      // T6.1: 通用项目文件保存(白名单: topology.json, rack_layout.json)
      saveFile: (name: string, relativePath: string, content: string) => Promise<string>
      getFile: (name: string, filePath: string) => Promise<string | null>
      getFileBinary: (name: string, filePath: string) => Promise<string | null>
      listOutputFiles: (name: string) => Promise<{ name: string; type: string }[]>
      listOutputBatches: (projectName: string) => Promise<import('@/types/file-tree').OutputBatch[]>
      deleteOutputFile: (projectName: string, filePath: string) => Promise<void>
      deleteOutputBatch: (projectName: string, batchName: string) => Promise<void>
      clearOutput: (projectName: string) => Promise<void>
    }
    template: {
      getStructure: (templateName: string) => Promise<import('@/types/file-tree').FileTreeNode[]>
      getFile: (templateName: string, filePath: string) => Promise<string | null>
      getConfig: (templateName: string) => Promise<import('@/types/project-config').ProjectConfig | null>
      list: () => Promise<Array<{
        id: string; name: string; description: string; scenario: string; tags: string[]; updatedAt: string; isBuiltin: boolean
        summary: {
          numGpuServers: number; numAllFlashStorage: number; numHybridFlashStorage: number; numComputeServers: number
          paramProtocol: string; paramSpeed: string; storageSpeed: string; powerLimitPerRack: number
        } | null
      }>>
      preview: (templateName: string) => Promise<{
        success: boolean
        error?: string
        summary?: {
          numServers: number; numGpuServers: number
          paramLeafCount: number; paramSpineCount: number; paramCoreCount: number
          storageLeafCount: number; storageSpineCount: number
          paramSpeed: string; storageSpeed: string; paramProtocol: string
          totalRacks: number; totalPowerWatts: number
          valid: boolean; errors: string[]
          convergence: Array<{ networkType?: string; convergenceRatio?: number; meetsTarget?: boolean; recommendation?: string }> | null
        }
      }>
      healthCheck: () => Promise<{
        checked: number
        healthyCount: number
        unhealthy: Array<{
          id: string
          name: string
          isBuiltin: boolean
          issues: { type: 'missing_json' | 'invalid_json' | 'invalid_config' | 'bad_ref' | 'unresolved_ref'; detail: string }[]
        }>
      }>
      create: (projectName: string, meta: { name: string; description?: string; scenario?: string; tags?: string[] }) => Promise<void>
      delete: (templateName: string) => Promise<void>
      update: (templateName: string, updates: {
        name?: string
        description?: string
        scenario?: string
        tags?: string[]
        configContent?: string
        projectConfig?: string
      }) => Promise<void>
      exportZip: (templateName: string) => Promise<{ canceled: boolean; zipPath: string }>
      importZip: (options?: { templateName?: string; zipPath?: string }) => Promise<{ canceled: boolean; templateName: string }>
    }
    design: {
      generate: (projectName: string, configINI?: string) => Promise<unknown>
      validate: (projectName: string, configINI?: string) => Promise<unknown>
      estimate: (projectName: string, estimateParams?: Record<string, unknown>) => Promise<unknown>
      report: (projectName: string) => Promise<unknown>
    }
    // V3.0.4-T3-1: 机房矩阵
    room: {
      createMatrix: (rows: string[], cols: number[], name?: string) => Promise<{
        schemaVersion?: number
        name?: string
        rows?: string[]
        cols?: number[]
        cells?: Array<{
          row: string
          col: number
          type: string
          placeholder: string | null
          cabinetId: number | null
        }>
        error?: string
      }>
      validateLayout: (layout: unknown) => Promise<{ valid: boolean; errors: string[] }>
    }
    // V3.0.4-T3-4: 统一配置体系
    config: {
      listSchema: () => Promise<{
        schemas: Record<string, { schemaVersion: number; fields: Array<{
          key: string
          type: 'string' | 'number' | 'boolean'
          default: unknown
          group: string
          label: string
          description: string
          enum: unknown[]
        }> }>
        presets: Array<{ id: string; name: string; description: string }>
      }>
      applyPreset: (presetId: string, config: unknown) => Promise<{
        config: Record<string, unknown>
        errors: string[]
      }>
      exportConfig: (appSettings: unknown, projectConfig: unknown) => Promise<{
        payload: {
          format: string
          version: number
          exportedAt: string
          appSettings: Record<string, unknown>
          projectConfig: Record<string, unknown>
        }
      }>
      importConfig: (payload: unknown) => Promise<{
        appSettings: Record<string, unknown> | null
        projectConfig: Record<string, unknown> | null
        errors: string[]
      }>
    }
    // V3.1.0-T4-3: CLI 能力层信息与审计日志
    cli: {
      info: () => Promise<{ cliVersion: string; actions: string[] }>
      audit: (limit?: number) => Promise<{ entries: Array<Record<string, unknown>>; path: string }>
    }
    render: {
      exportConnections: (projectName: string, outputTypes: string[]) => Promise<unknown>
      onProgress: (callback: (data: unknown) => void) => () => void
    }
    app: {
      getPath: (name: string) => Promise<string>
      getVersion: () => Promise<string>
      getStackVersions: () => Promise<{
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
      } | null>
      showBrandingAsset: (filename: string) => Promise<string>
      readDocFile: (filename: string) => Promise<string | null>
      checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string; error?: string }>
      downloadUpdate: () => Promise<void>
      quitAndInstall: () => void
      openReleasesPage: () => Promise<void>
      onUpdateAvailable: (callback: (data: { version: string; releaseNotes?: string }) => void) => () => void
      onUpdateDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => () => void
      onUpdateDownloaded: (callback: () => void) => () => void
      onUpdateError: (callback: (message: string) => void) => () => void
    }
    window: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
    }
    shell: {
      showItemInFolder: (path: string) => void
      openPath: (path: string) => Promise<string>
      openExternal: (url: string) => Promise<void>
    }
    dialog: {
      openDirectory: () => Promise<string | null>
    }
    deviceLibrary: {
      list: () => Promise<{ categories: import('@/types/device-profile').DeviceCategory[] }>
      get: (deviceId: string) => Promise<import('@/types/device-profile').LibraryDevice | null>
      save: (device: import('@/types/device-profile').LibraryDevice) => Promise<void>
      delete: (deviceId: string) => Promise<void>
      import: (devices: import('@/types/device-profile').LibraryDevice[]) => Promise<void>
      export: (deviceIds: string[], format: 'json' | 'excel' | 'zip') => Promise<string | { devices: unknown[]; format: string }>
    }
    export: {
      saveFile: (projectName: string, fileName: string, base64Data: string) => Promise<string>
    }
    onLogOutput: (callback: (data: { message: string; level?: string }) => void) => () => void
    versions: {
      node: string
      electron: string
      chromium: string
      platform: string
      arch: string
    }
  }
}

/* Extend React CSSProperties for Electron window drag region */
declare namespace React {
  interface CSSProperties {
    WebkitAppRegion?: string
  }
}

/* Allow CSS imports */
declare module '*.css' {}
