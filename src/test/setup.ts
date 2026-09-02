import '@testing-library/jest-dom'
import { vi } from 'vitest'

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
    saveFile: vi.fn(),
  },
  design: {
    generate: vi.fn(),
    validate: vi.fn(),
  },
  capacity: {
    listPresets: vi.fn(),
    recommend: vi.fn(),
  },
  room: {
    createMatrix: vi.fn(),
    validateLayout: vi.fn(),
    optimize: vi.fn(),
  },
  config: {
    listSchema: vi.fn(),
    applyPreset: vi.fn(),
    exportConfig: vi.fn(),
    importConfig: vi.fn(),
  },
  render: {
    exportConnections: vi.fn(),
    onProgress: vi.fn(),
  },
  export: {
    saveFile: vi.fn(),
  },
  // M-F1（PRD v3.6）：版本历史 + 评审 PDF 桥接
  // 48-b（F8-2）：快照/版本历史 文件级导出与回导
  feature: {
    versionHistory: {
      list: vi.fn(),
      rollback: vi.fn(),
      exportFile: vi.fn(),
      importFile: vi.fn(),
    },
    reviewPdf: vi.fn(),
    reviewPackage: vi.fn(),
    snapshot: {
      exportFile: vi.fn(),
      importFile: vi.fn(),
    },
  },
  deviceLibrary: {
    list: vi.fn(),
    get: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    import: vi.fn(),
    export: vi.fn(),
    // 48-c（F8-3）：设备库跨端可移植格式
    exportPortable: vi.fn(),
    importPortable: vi.fn(),
  },
  // 48-c（F8-3）：技能库文件级导入导出
  skills: {
    list: vi.fn(),
    export: vi.fn(),
    import: vi.fn(),
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
  // 4.7.0（47-b/47-c/47-d）：部署运维 IPC
  diag: {
    collect: vi.fn(),
    exportBundle: vi.fn(),
  },
  health: {
    run: vi.fn(),
    export: vi.fn(),
  },
  telemetry: {
    get: vi.fn(),
    setEnabled: vi.fn(),
    clear: vi.fn(),
    export: vi.fn(),
  },
}

// 非 jsdom 环境（如 node 环境的 zip-crypto 测试）没有 window
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electron', {
    value: mockElectron,
    writable: true,
    configurable: true,
  })
}