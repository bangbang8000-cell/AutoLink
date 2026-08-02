/**
 * T15: i18n 命名空间完整性测试
 * 验证 5 个语言文件都包含必要的命名空间和关键 key
 */
import { describe, it, expect } from 'vitest'
import zhCN from '@/i18n/resources/zh-CN'
import en from '@/i18n/resources/en'
import ja from '@/i18n/resources/ja'
import ko from '@/i18n/resources/ko'
import zhTW from '@/i18n/resources/zh-TW'

const LANGUAGES = [
  { code: 'zh-CN', resources: zhCN },
  { code: 'en', resources: en },
  { code: 'ja', resources: ja },
  { code: 'ko', resources: ko },
  { code: 'zh-TW', resources: zhTW },
]

const REQUIRED_NAMESPACES = ['common', 'design', 'project', 'rack', 'topology', 'workbench', 'device']

/**
 * 动态 key 访问辅助:避免 TS7053(对象无字符串索引签名)
 * 测试场景下我们需要按字符串 key 校验存在性,这是合理的动态访问
 */
function hasKey(obj: unknown, key: string): boolean {
  return typeof obj === 'object' && obj !== null && key in (obj as Record<string, unknown>)
}

describe('i18n 命名空间完整性', () => {
  for (const { code, resources } of LANGUAGES) {
    describe(`语言: ${code}`, () => {
      it('应包含所有必需的命名空间', () => {
        for (const ns of REQUIRED_NAMESPACES) {
          expect(hasKey(resources, ns), `${code} 缺少命名空间: ${ns}`).toBe(true)
        }
      })

      it('common 命名空间应包含 explorer 子命名空间', () => {
        expect(resources.common.explorer).toBeDefined()
      })

      it('explorer 应包含 contextMenu 子命名空间', () => {
        expect(resources.common.explorer.contextMenu).toBeDefined()
      })

      it('explorer 应包含 toast 子命名空间', () => {
        expect(resources.common.explorer.toast).toBeDefined()
      })

      it('explorer 应包含 settings 子命名空间', () => {
        expect(resources.common.explorer.settings).toBeDefined()
      })

      it('explorer 应包含 deviceLibrary.categories 子命名空间', () => {
        expect(resources.common.explorer.deviceLibrary.categories).toBeDefined()
      })

      it('contextMenu 应包含 8 个项目右键菜单项', () => {
        const cm = resources.common.explorer.contextMenu
        const requiredKeys = [
          'setAsCurrent',
          'openInFileManager',
          'duplicateProject',
          'rename',
          'exportZip',
          'convertToTemplate',
          'unfavorite',
          'favorite',
          'deleteProject',
        ]
        for (const key of requiredKeys) {
          expect(hasKey(cm, key), `${code} contextMenu 缺少 key: ${key}`).toBe(true)
        }
      })

      it('toast 应包含关键提示消息 key', () => {
        const toast = resources.common.explorer.toast
        const requiredKeys = [
          'projectDeleted',
          'batchDeleted',
          'fileDeleted',
          'outputCleared',
          'projectDuplicated',
          'projectRenamed',
          'projectExported',
          'projectImported',
          'templateExported',
          'templateImported',
          'templateDeleted',
          'projectConvertedToTemplate',
          'batchExportSuccess',
          'batchExportPartial',
        ]
        for (const key of requiredKeys) {
          expect(hasKey(toast, key), `${code} toast 缺少 key: ${key}`).toBe(true)
        }
      })

      it('deviceLibrary.categories 应包含 11 个分类标签', () => {
        const cats = resources.common.explorer.deviceLibrary.categories
        const requiredKeys = [
          'gpuServers',
          'storageServers',
          'allFlash',
          'hybridFlash',
          'computeServers',
          'switches',
          'paramSwitches',
          'storageSwitches',
          'bizSwitches',
          'oobSwitches',
          'custom',
        ]
        for (const key of requiredKeys) {
          expect(hasKey(cats, key), `${code} deviceLibrary.categories 缺少 key: ${key}`).toBe(true)
        }
      })

      it('settings.categories 应包含 9 个设置分类', () => {
        const cats = resources.common.explorer.settings.categories
        const requiredKeys = [
          'appearance',
          'language',
          'projectDefaults',
          'output',
          'keyboard',
          'deviceLibrary',
          'network',
          'data',
          'about',
        ]
        for (const key of requiredKeys) {
          expect(hasKey(cats, key), `${code} settings.categories 缺少 key: ${key}`).toBe(true)
        }
      })

      it('design 子命名空间应包含关键 key', () => {
        const design = resources.common.explorer.design
        const requiredKeys = ['title', 'generateTopology', 'validationPassed', 'validationFailed']
        for (const key of requiredKeys) {
          expect(hasKey(design, key), `${code} explorer.design 缺少 key: ${key}`).toBe(true)
        }
      })

      it('workbench 子命名空间应包含关键 key', () => {
        const wb = resources.common.explorer.workbench
        const requiredKeys = ['title', 'outputTypes', 'connectionTable', 'rackTable', 'topologyDiagram', 'deviceList']
        for (const key of requiredKeys) {
          expect(hasKey(wb, key), `${code} explorer.workbench 缺少 key: ${key}`).toBe(true)
        }
      })

      it('visualization 子命名空间应包含关键 key', () => {
        const viz = resources.common.explorer.visualization
        const requiredKeys = ['title', 'topologyOverview', 'totalNodes', 'totalConnections', 'cabinetList']
        for (const key of requiredKeys) {
          expect(hasKey(viz, key), `${code} explorer.visualization 缺少 key: ${key}`).toBe(true)
        }
      })
    })
  }
})

describe('i18n 插值变量一致性', () => {
  it('所有语言的 projectDeleted 应包含 {{name}} 变量', () => {
    for (const { resources } of LANGUAGES) {
      expect(resources.common.explorer.toast.projectDeleted).toContain('{{name}}')
    }
  })

  it('所有语言的 rackReady 应包含 {{count}} 变量', () => {
    for (const { resources } of LANGUAGES) {
      expect(resources.common.explorer.workbench.rackReady).toContain('{{count}}')
    }
  })

  it('所有语言的 rackPartial 应包含 {{placed}} 和 {{total}} 变量', () => {
    for (const { resources } of LANGUAGES) {
      const str = resources.common.explorer.workbench.rackPartial
      expect(str).toContain('{{placed}}')
      expect(str).toContain('{{total}}')
    }
  })

  it('所有语言的 batchExportSuccess 应包含 {{count}} 和 {{dir}} 变量', () => {
    for (const { resources } of LANGUAGES) {
      const str = resources.common.explorer.toast.batchExportSuccess
      expect(str).toContain('{{count}}')
      expect(str).toContain('{{dir}}')
    }
  })

  it('所有语言的 deviceCount 应包含 {{count}} 变量', () => {
    for (const { resources } of LANGUAGES) {
      expect(resources.common.explorer.deviceLibrary.deviceCount).toContain('{{count}}')
    }
  })
})

/**
 * v2.8.3-T2: key 完整性测试
 * 以 zh-CN 为基准,断言其余 4 语言不缺失任何 key(允许多余 key),防止编程 ID 回归
 */
describe('i18n key 完整性(以 zh-CN 为基准)', () => {
  /** 递归展开对象为扁平 key 列表(如 common.menu.visualization) */
  function flattenKeys(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return []
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) => {
      const full = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return flattenKeys(value, full)
      }
      return [full]
    })
  }

  const base = LANGUAGES.find((l) => l.code === 'zh-CN')!
  const baseKeys = flattenKeys(base.resources as unknown as Record<string, unknown>)

  it('zh-CN 基准应有非空 key 集合', () => {
    expect(baseKeys.length).toBeGreaterThan(50)
  })

  for (const { code, resources } of LANGUAGES) {
    if (code === 'zh-CN') continue
    it(`${code} 不应缺失 zh-CN 中的任何 key`, () => {
      const langKeys = new Set(flattenKeys(resources as unknown as Record<string, unknown>))
      const missing = baseKeys.filter((k) => !langKeys.has(k))
      expect(missing, `${code} 缺少 key(会导致界面显示编程 ID): ${missing.join(', ')}`).toEqual([])
    })
  }

  it('menu.visualization 应存在于所有语言(ActivityBar 悬浮提示)', () => {
    for (const { code, resources } of LANGUAGES) {
      const key = 'common.menu.visualization'
      const langKeys = new Set(flattenKeys(resources as unknown as Record<string, unknown>))
      expect(langKeys.has(key), `${code} 缺少 ${key}`).toBe(true)
    }
  })

  /** 按点路径取值 */
  function getAt(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
      return undefined
    }, obj)
  }

  it('zh-CN 翻译值不应等于 key 本身(编程 ID 风格的占位)', () => {
    const suspicious = baseKeys.filter((k) => getAt(base.resources, k) === k)
    expect(suspicious).toEqual([])
  })
})
