/**
 * 4.3 F3-1a: 命令面板命令注册表（集中管理 + 本地化）
 *
 * buildCommandPaletteCommands(t) 生成命令列表（含动态项目/模板子命令），
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
  view: 'aidc' | 'design' | 'main' | 'visualization' | 'roomdesign' | 'rackdesign' | 'results' | 'export',
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
      toast.addToast('error', t('common:commandPalette.commands.exportFailed', {
        error: e instanceof Error ? e.message : String(e),
      }))
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

  // ============ 常用操作 ============
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
      useWorkspaceStore.getState().openTab({ type: 'deviceLibrary', title: '设备库', closable: true })
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
    action: () => useUIStore.getState().toggleTheme(),
  })
  commands.push({
    id: 'common.shortcuts',
    label: t('common:commandPalette.commands.shortcuts'),
    category: catCommon,
    action: () => useUIStore.getState().setShowShortcutsDialog(true),
  })

  return commands
}
