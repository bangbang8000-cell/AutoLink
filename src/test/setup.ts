import '@testing-library/jest-dom'

// Mock Electron preload API
const mockElectron = {
  project: {
    list: vi.fn(),
    create: vi.fn(),
    createWithConfig: vi.fn(),
    delete: vi.fn(),
    getStructure: vi.fn(),
    getConfigFile: vi.fn(),
    getFile: vi.fn(),
    listOutputFiles: vi.fn(),
    saveConfigFile: vi.fn(),
  },
  design: {
    generate: vi.fn(),
    validate: vi.fn(),
  },
  render: {
    exportConnections: vi.fn(),
    onProgress: vi.fn(),
  },
  export: {
    saveFile: vi.fn(),
  },
  deviceLibrary: {
    list: vi.fn(),
    get: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    import: vi.fn(),
    export: vi.fn(),
  },
  shell: {
    showItemInFolder: vi.fn(),
    openPath: vi.fn(),
  },
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(),
    checkUpdate: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}

Object.defineProperty(window, 'electron', {
  value: mockElectron,
  writable: true,
  configurable: true,
})