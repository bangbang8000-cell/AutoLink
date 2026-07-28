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
      getFileBinary: (name: string, filePath: string) => Promise<string | null>
      listOutputFiles: (name: string) => Promise<{ name: string; type: string }[]>
    }
    design: {
      generate: (projectName: string, configINI?: string) => Promise<unknown>
      validate: (projectName: string, configINI?: string) => Promise<unknown>
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
    }
    shell: {
      showItemInFolder: (path: string) => void
      openPath: (path: string) => Promise<string>
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
    versions: {
      node: string
      electron: string
      platform: string
      arch: string
    }
  }
}
