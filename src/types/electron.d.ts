interface Window {
  electron: {
    project: {
      list: () => Promise<{ id: number; name: string; index: number }[]>
      create: (name: string, options?: { template?: string; empty?: boolean }) => Promise<void>
      delete: (ids: string[]) => Promise<void>
      getStructure: (name: string) => Promise<unknown[]>
    }
    design: {
      generate: (config: Record<string, unknown>) => Promise<unknown>
      validate: (config: Record<string, unknown>) => Promise<unknown>
    }
    render: {
      exportConnections: (projectName: string, outputTypes: string[]) => Promise<unknown>
      onProgress: (callback: (data: unknown) => void) => () => void
    }
    app: {
      getPath: (name: string) => Promise<string>
      getVersion: () => Promise<string>
      checkUpdate: () => Promise<{ updateAvailable: boolean }>
      downloadUpdate: () => Promise<{ success: boolean }>
      quitAndInstall: () => void
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
    versions: {
      node: string
      electron: string
      platform: string
      arch: string
    }
  }
}
