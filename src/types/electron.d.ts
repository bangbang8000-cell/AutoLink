interface Window {
  electron: {
    project: {
      list: () => Promise<{ id: number; name: string; index: number }[]>
      create: (name: string, options?: { template?: string; empty?: boolean }) => Promise<void>
      createWithConfig: (config: import('@/types/project-config').ProjectConfig) => Promise<void>
      delete: (ids: string[]) => Promise<void>
      getStructure: (name: string) => Promise<unknown[]>
      getConfigFile: (name: string) => Promise<string | null>
      saveConfigFile: (name: string, content: string) => Promise<void>
      getFile: (name: string, filePath: string) => Promise<string | null>
      getFileBinary: (name: string, filePath: string) => Promise<Uint8Array | null>
      listOutputFiles: (name: string) => Promise<{ name: string; type: string }[]>
      listOutputBatches: (projectName: string) => Promise<Array<{ name: string; files: Array<{ name: string; path: string }> }>>
      deleteOutputFile: (projectName: string, filePath: string) => Promise<void>
      deleteOutputBatch: (projectName: string, batchName: string) => Promise<void>
      clearOutput: (projectName: string) => Promise<void>
    }
    template: {
      getStructure: (templateName: string) => Promise<Array<{ name: string; type: string; children?: Array<{ name: string; type: string; children?: unknown[] }> }>>
      getFile: (templateName: string, filePath: string) => Promise<string | null>
      list: () => Promise<Array<{ id: string; name: string; description: string; scenario: string; tags: string[]; updatedAt: string; isBuiltin: boolean }>>
      create: (projectName: string, meta: { name: string; description?: string; scenario?: string; tags?: string[] }) => Promise<void>
      delete: (templateName: string) => Promise<void>
    }
    design: {
      generate: (projectName: string, configINI?: string) => Promise<unknown>
      validate: (projectName: string, configINI?: string) => Promise<unknown>
      estimate: (projectName: string, estimateParams?: Record<string, unknown>) => Promise<unknown>
      report: (projectName: string) => Promise<unknown>
    }
    render: {
      exportConnections: (projectName: string, outputTypes: string[]) => Promise<unknown>
      onProgress: (callback: (data: unknown) => void) => () => void
    }
    app: {
      getPath: (name: string) => Promise<string>
      getVersion: () => Promise<string>
      checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
      downloadUpdate: () => Promise<void>
      quitAndInstall: () => void
      onUpdateAvailable: (callback: (data: { version: string; releaseNotes?: string }) => void) => () => void
      onUpdateDownloadProgress: (callback: (data: { percent: number }) => void) => () => void
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
    }
    dialog?: {
      openDirectory: () => Promise<string | null>
    }
    deviceLibrary: {
      list: () => Promise<{ categories: import('@/types/device-profile').DeviceCategory[] }>
      get: (deviceId: string) => Promise<import('@/types/device-profile').LibraryDevice | null>
      save: (device: import('@/types/device-profile').LibraryDevice) => Promise<void>
      delete: (deviceId: string) => Promise<void>
      import: (devices: import('@/types/device-profile').LibraryDevice[]) => Promise<void>
      export: (deviceIds: string[], format: 'json' | 'excel' | 'zip') => Promise<void>
    }
    export: {
      saveFile: (projectName: string, fileName: string, base64Data: string) => Promise<string>
    }
    onLogOutput: (callback: (data: { message: string; level?: string }) => void) => () => void
    versions: {
      node: string
      electron: string
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
