/**
 * 4.3 F3-1a: 命令面板命令注册表（集中管理 + 本地化）
 * 4.4 F4-5（测试计划 E-5）：命令全集——项目/设计/渲染导出/批量/一键管线/最近收藏/模板/设置/快捷键全集
 *
 * buildCommandPaletteCommands(t) 生成命令列表（含动态项目/模板/最近子命令），
 * CommandPalette 据此渲染搜索/执行；命令动作统一走既有 store action，
 * 并给出 toast 反馈（命令执行有反馈）。
 */
import type { TFunction } from 'i18next'
import { useUIStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useChatStore } from '@/stores/chat.store'
import { useToastStore } from '@/stores/toast.store'
import { useSnapshotStore } from '@/stores/snapshot.store'
import { usePipelineStore } from '@/stores/pipeline.store'
import { exportDeliveryZip } from '@/utils/aidcDelivery'

export interface CommandItem {
  id: string
  label: string
  category: string
  shortcut?: string
  action: () => void
}

/** 打开 AI 对话标签页（复用 App.handleActivityClick 语义） */
function openAIChat(): void {
  useUIStore.getState().setActiveActivity('ai')
  useWorkspaceStore.getState().openTab({ type: 'chat', title: 'AI 助手', closable: true })
}

/** 打开工作台并聚焦子视图 */
function openWorkbenchSubview(
  view:
    | 'aidc'
    | 'design'
    | 'main'
    | 'visualization'
    | 'roomdesign'
    | 'rackdesign'
    | 'results'
    | 'export',
): void {
  useUIStore.getState().setActiveActivity('workbench')
  useUIStore.getState().setWorkbenchSubview(view)
  useWorkspaceStore.getState().openTab({ type: 'workbench', title: '工作台', closable: false })
}

export function buildCommandPaletteCommands(t: TFunction): CommandItem[] {
  const catProject = t('common:commandPalette.categories.project')
  const catDesign = t('common:commandPalette.categories.design')
  const catTemplate = t('common:commandPalette.categories.template')
  const catCommon = t('common:commandPalette.categories.common')
  // 4.4 F4-5：命令全集新增分类
  const catRender = t('common:commandPalette.categories.render')
  const catBatch = t('common:commandPalette.categories.batch')
  const catPipeline = t('common:commandPalette.categories.pipeline')
  const catRecent = t('common:commandPalette.categories.recent')

  const projectStore = useProjectStore.getState()
  const toast = useToastStore.getState()

  const commands: CommandItem[] = []

  /** 渲染当前项目：切到工作台并提示一键渲染（与 MenuBar.handleRender 一致） */
  const renderCurrentProject = (): void => {
    const projectName = useProjectStore.getState().selectedProjectName
    if (!projectName) {
      toast.addToast('warning', t('common:commandPalette.commands.noProject'))
      return
    }
    openWorkbenchSubview('main')
    toast.addToast('info', t('common:commandPalette.commands.renderHint'))
  }

  /** 导出当前项目为交付包 zip */
  const exportCurrentProject = async (): Promise<void> => {
    const projectName = useProjectStore.getState().selectedProjectName
    if (!projectName) {
      toast.addToast('warning', t('common:commandPalette.commands.noProject'))
      return
    }
    try {
      const r = await useProjectStore.getState().exportProject(projectName)
      toast.addToast('success', t('common:commandPalette.commands.exported', { path: r.zipPath }))
    } catch (e) {
      toast.addToast(
        'error',
        t('common:commandPalette.commands.exportFailed', {
          error: e instanceof Error ? e.message : String(e),
        }),
      )
    }
  }

  /** 保存设计快照（命令执行反馈） */
  const saveDesignSnapshot = (): void => {
    const r = useSnapshotStore.getState().saveSnapshot()
    if (r.ok) {
      toast.addToast('success', t('common:commandPalette.commands.snapshotSaved'))
    } else if (r.reason === 'no_data') {
      toast.addToast('warning', t('common:commandPalette.commands.snapshotNoData'))
    } else if (r.reason === 'too_large') {
      toast.addToast('warning', t('common:commandPalette.commands.snapshotTooLarge'))
    }
  }

  // ============ 项目 ============
  commands.push({
    id: 'project.new',
    label: t('common:commandPalette.commands.newProject'),
    category: catProject,
    shortcut: 'Ctrl+N',
    action: () => useUIStore.getState().setShowCreateProjectWizard(true),
  })
  commands.push({
    id: 'project.import',
    label: t('common:commandPalette.commands.importProject'),
    category: catProject,
    action: () => {
      void useProjectStore
        .getState()
        .importProject()
        .then((r) => {
          if (!r.canceled && r.projectName) {
            toast.addToast(
              'success',
              t('common:commandPalette.commands.imported', { name: r.projectName }),
            )
          }
        })
    },
  })
  commands.push({
    id: 'project.render',
    label: t('common:commandPalette.commands.renderProject'),
    category: catProject,
    action: renderCurrentProject,
  })
  commands.push({
    id: 'project.export',
    label: t('common:commandPalette.commands.exportProject'),
    category: catProject,
    action: () => void exportCurrentProject(),
  })
  commands.push({
    id: 'project.favorite',
    label: (() => {
      const name = useProjectStore.getState().selectedProjectName
      const fav = name ? useProjectStore.getState().favoriteProjects.includes(name) : false
      return fav
        ? t('common:commandPalette.commands.unfavoriteCurrent')
        : t('common:commandPalette.commands.favoriteCurrent')
    })(),
    category: catProject,
    action: () => {
      const name = useProjectStore.getState().selectedProjectName
      if (!name) {
        toast.addToast('warning', t('common:commandPalette.commands.noProject'))
        return
      }
      const fav = useProjectStore.getState().favoriteProjects.includes(name)
      useProjectStore.getState().toggleFavorite(name)
      toast.addToast(
        'success',
        fav
          ? t('common:commandPalette.commands.unfavorited', { name })
          : t('common:commandPalette.commands.favorited', { name }),
      )
    },
  })
  // 动态：每个项目一个「打开项目」子命令
  for (const p of projectStore.projects) {
    commands.push({
      id: `project.open.${p.name}`,
      label: `${t('common:commandPalette.commands.openProject')}: ${p.name}`,
      category: catProject,
      action: () => {
        const st = useProjectStore.getState()
        st.selectProject(p)
        st.trackRecent(p.name)
        toast.addToast('success', `${t('common:commandPalette.commands.openedProject')}: ${p.name}`)
      },
    })
  }

  // ============ 设计 ============
  commands.push({
    id: 'design.room',
    label: t('common:commandPalette.commands.roomDesign'),
    category: catDesign,
    action: () => openWorkbenchSubview('roomdesign'),
  })
  commands.push({
    id: 'design.rack',
    label: t('common:commandPalette.commands.rackDesign'),
    category: catDesign,
    action: () => openWorkbenchSubview('rackdesign'),
  })
  commands.push({
    id: 'design.generate',
    label: t('common:commandPalette.commands.generateTopology'),
    category: catDesign,
    action: () => {
      const name = useProjectStore.getState().selectedProjectName
      if (!name) {
        toast.addToast('warning', t('common:commandPalette.commands.noProject'))
        return
      }
      openWorkbenchSubview('design')
      void designGenerate(name)
        .then(() =>
          toast.addToast('success', t('common:commandPalette.commands.topologyGenerated')),
        )
        .catch((e) => toast.addToast('error', String(e instanceof Error ? e.message : e)))
    },
  })
  commands.push({
    id: 'design.saveConfig',
    label: t('common:commandPalette.commands.saveConfig'),
    category: catDesign,
    action: () => {
      const name = useProjectStore.getState().selectedProjectName
      if (!name) {
        toast.addToast('warning', t('common:commandPalette.commands.noProject'))
        return
      }
      void designSaveConfig(name)
        .then(() => toast.addToast('success', t('common:commandPalette.commands.configSaved')))
        .catch((e) => toast.addToast('error', String(e instanceof Error ? e.message : e)))
    },
  })
  commands.push({
    id: 'design.snapshot',
    label: t('common:commandPalette.commands.snapshot'),
    category: catDesign,
    action: saveDesignSnapshot,
  })
  commands.push({
    id: 'design.aidcPlan',
    label: t('common:commandPalette.commands.aidcPlan'),
    category: catDesign,
    action: () => openWorkbenchSubview('aidc'),
  })

  // ============ 渲染/导出 ============
  commands.push({
    id: 'render.current',
    label: t('common:commandPalette.commands.renderCurrent'),
    category: catRender,
    shortcut: 'Ctrl+Enter',
    action: renderCurrentProject,
  })
  commands.push({
    id: 'export.delivery',
    label: t('common:commandPalette.commands.exportDelivery'),
    category: catRender,
    action: () => {
      const name = useProjectStore.getState().selectedProjectName
      if (!name) {
        toast.addToast('warning', t('common:commandPalette.commands.noProject'))
        return
      }
      void exportDeliveryZip(name)
        .then((r) => {
          if (r.noPlan) {
            toast.addToast('warning', t('common:commandPalette.commands.deliveryNoPlan'))
          } else if (r.error) {
            toast.addToast(
              'error',
              t('common:commandPalette.commands.deliveryFailed', { error: r.error }),
            )
          } else {
            toast.addToast(
              'success',
              t('common:commandPalette.commands.deliveryExported', { path: r.path ?? '' }),
            )
          }
        })
        .catch((e) => {
          toast.addToast(
            'error',
            t('common:commandPalette.commands.deliveryFailed', {
              error: e instanceof Error ? e.message : String(e),
            }),
          )
        })
    },
  })
  commands.push({
    id: 'export.output',
    label: t('common:commandPalette.commands.exportOutput'),
    category: catRender,
    action: () => {
      const name = useProjectStore.getState().selectedProjectName
      if (!name) {
        toast.addToast('warning', t('common:commandPalette.commands.noProject'))
        return
      }
      void window.electron.render
        .exportOutput(name)
        .then((r) => {
          if (r?.canceled) return
          if (r?.ok) {
            toast.addToast(
              'success',
              t('common:commandPalette.commands.outputExported', { path: r.path ?? '' }),
            )
          }
        })
        .catch((e) => {
          toast.addToast(
            'error',
            t('common:commandPalette.commands.exportFailed', {
              error: e instanceof Error ? e.message : String(e),
            }),
          )
        })
    },
  })

  // ============ 批量 ============
  commands.push({
    id: 'batch.render',
    label: t('common:commandPalette.commands.batchRender'),
    category: catBatch,
    action: () => {
      openWorkbenchSubview('main')
      toast.addToast('info', t('common:commandPalette.commands.batchRenderHint'))
    },
  })
  commands.push({
    id: 'batch.export',
    label: t('common:commandPalette.commands.batchExport'),
    category: catBatch,
    action: () => {
      const all = useProjectStore.getState().projects.map((p) => p.name)
      if (all.length === 0) {
        toast.addToast('warning', t('common:commandPalette.commands.noProject'))
        return
      }
      void useProjectStore
        .getState()
        .batchExportProjects(all)
        .then((r) => {
          if (!r.canceled && r.result) {
            const { successes, failures } = r.result
            if (failures.length === 0) {
              toast.addToast(
                'success',
                t('common:commandPalette.commands.batchExported', { count: successes.length }),
              )
            } else {
              toast.addToast(
                'warning',
                t('common:commandPalette.commands.batchExportPartial', {
                  success: successes.length,
                  fail: failures.length,
                }),
              )
            }
          }
        })
        .catch((e) => {
          toast.addToast(
            'error',
            t('common:commandPalette.commands.exportFailed', {
              error: e instanceof Error ? e.message : String(e),
            }),
          )
        })
    },
  })

  // ============ 一键管线 ============
  commands.push({
    id: 'pipeline.run',
    label: t('common:commandPalette.commands.pipelineRun'),
    category: catPipeline,
    action: () => {
      const name = useProjectStore.getState().selectedProjectName
      if (!name) {
        toast.addToast('warning', t('common:commandPalette.commands.noProject'))
        return
      }
      openWorkbenchSubview('main')
      void usePipelineStore.getState().runProjectPipeline(name)
    },
  })
  commands.push({
    id: 'pipeline.template',
    label: t('common:commandPalette.commands.pipelineTemplate'),
    category: catPipeline,
    action: () => {
      openWorkbenchSubview('main')
      toast.addToast('info', t('common:commandPalette.commands.pipelineTemplateHint'))
    },
  })

  // ============ 最近/收藏 ============
  // 动态：最近使用项目
  for (const name of projectStore.recentProjects) {
    if (!projectStore.projects.some((p) => p.name === name)) continue
    commands.push({
      id: `recent.open.${name}`,
      label: `${t('common:commandPalette.commands.openRecent')}: ${name}`,
      category: catRecent,
      action: () => {
        const st = useProjectStore.getState()
        const p = st.projects.find((x) => x.name === name)
        if (p) st.selectProject(p)
        toast.addToast('success', `${t('common:commandPalette.commands.openedRecent')}: ${name}`)
      },
    })
  }
  // 动态：收藏项目
  for (const name of projectStore.favoriteProjects) {
    if (!projectStore.projects.some((p) => p.name === name)) continue
    commands.push({
      id: `favorite.open.${name}`,
      label: `${t('common:commandPalette.commands.openFavorite')}: ${name}`,
      category: catRecent,
      action: () => {
        const st = useProjectStore.getState()
        const p = st.projects.find((x) => x.name === name)
        if (p) st.selectProject(p)
        toast.addToast('success', `${t('common:commandPalette.commands.openedFavorite')}: ${name}`)
      },
    })
  }
  if (projectStore.favoriteProjects.length === 0) {
    commands.push({
      id: 'recent.favoriteEmpty',
      label: t('common:commandPalette.commands.favoriteEmpty'),
      category: catRecent,
      action: () => {
        useUIStore.getState().setActiveActivity('project')
        toast.addToast('info', t('common:commandPalette.commands.favoriteEmptyHint'))
      },
    })
  }

  // ============ 模板 ============
  commands.push({
    id: 'template.center',
    label: t('common:commandPalette.commands.templateCenter'),
    category: catTemplate,
    action: () => {
      useUIStore.getState().setActiveActivity('project')
      toast.addToast('info', t('common:commandPalette.commands.templateCenterHint'))
    },
  })
  // 动态：每个模板「预览」+「基于模板创建」
  for (const tpl of projectStore.templates) {
    commands.push({
      id: `template.preview.${tpl.name}`,
      label: `${t('common:commandPalette.commands.previewTemplate')}: ${tpl.name}`,
      category: catTemplate,
      action: () => useUIStore.getState().setTemplatePreviewName(tpl.name),
    })
    commands.push({
      id: `template.create.${tpl.name}`,
      label: `${t('common:commandPalette.commands.createFromTemplate')}: ${tpl.name}`,
      category: catTemplate,
      action: () => useUIStore.getState().openWizardFromTemplate(tpl.name),
    })
  }

  // ============ 常用操作（设置/快捷键全集） ============
  commands.push({
    id: 'common.ai',
    label: t('common:commandPalette.commands.ai'),
    category: catCommon,
    action: openAIChat,
  })
  commands.push({
    id: 'common.deviceLibrary',
    label: t('common:commandPalette.commands.deviceLibrary'),
    category: catCommon,
    action: () => {
      useUIStore.getState().setActiveActivity('device_library')
      useWorkspaceStore
        .getState()
        .openTab({ type: 'deviceLibrary', title: '设备库', closable: true })
    },
  })
  commands.push({
    id: 'common.search',
    label: t('common:commandPalette.commands.search'),
    category: catCommon,
    action: () => useUIStore.getState().setActiveActivity('search'),
  })
  commands.push({
    id: 'common.cloud',
    label: t('common:commandPalette.commands.cloud'),
    category: catCommon,
    action: () => useUIStore.getState().setActiveActivity('cloud'),
  })
  commands.push({
    id: 'common.settings',
    label: t('common:commandPalette.commands.settings'),
    category: catCommon,
    shortcut: 'Ctrl+,',
    action: () => useUIStore.getState().setActiveActivity('settings'),
  })
  commands.push({
    id: 'common.newChat',
    label: t('common:commandPalette.commands.newChat'),
    category: catCommon,
    action: () => {
      useChatStore.getState().createSession()
      openAIChat()
    },
  })
  commands.push({
    id: 'common.toggleSidebar',
    label: t('common:commandPalette.commands.toggleSidebar'),
    category: catCommon,
    shortcut: 'Ctrl+B',
    action: () => useUIStore.getState().toggleSidebar(),
  })
  commands.push({
    id: 'common.toggleTheme',
    label: t('common:commandPalette.commands.toggleTheme'),
    category: catCommon,
    action: () => {
      useUIStore.getState().toggleTheme()
      toast.addToast('info', t('common:commandPalette.commands.themeToggled'))
    },
  })
  commands.push({
    id: 'common.shortcuts',
    label: t('common:commandPalette.commands.shortcuts'),
    category: catCommon,
    shortcut: 'F1',
    action: () => useUIStore.getState().setShowShortcutsDialog(true),
  })

  return commands
}

/** 惰性加载设计 store 的 generate（避免顶层依赖循环） */
async function designGenerate(projectName: string): Promise<void> {
  const { useDesignStore } = await import('@/stores/design.store')
  await useDesignStore.getState().generate(projectName)
}

/** 惰性加载设计 store 的 saveConfig */
async function designSaveConfig(projectName: string): Promise<void> {
  const { useDesignStore } = await import('@/stores/design.store')
  await useDesignStore.getState().saveConfig(projectName)
}
