/**
 * AL-N1（PRD v3.2）：设计入口归属调整 —— 中栏拆「机房设计」「机柜设计」两个独立入口（替换坏链 rack）
 * - N-1：中栏两入口渲染（FileExplorer WORKBENCH_SUBVIEWS 含 roomdesign/rackdesign）
 * - N-2：点开对应子视图（setWorkbenchSubview 分别设为 roomdesign/rackdesign）
 * - N-3：main（组网渲染）内不再渲染设计入口（「设计步骤」行已移除）
 * - N-4：二级页签标签 i18n 生效（5 语言 workbench.json 含 subview.roomdesign/rackdesign）
 * 组件级重断言（FileExplorer / WorkbenchTab 渲染）+ i18n 资源断言；WorkbenchTab 需 Electron 桥接 mock。
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { FileExplorer } from '@/components/layout/FileExplorer'
import { WorkbenchTab } from '@/components/workspace/tabs/WorkbenchTab'
import { useUIStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
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

beforeEach(() => {
  localStorage.clear()
  useUIStore.setState({ activeActivity: 'workbench', workbenchSubview: 'main' })
  useProjectStore.setState({
    projects: [{ id: 1, name: 'projA', index: 0, updatedAt: '2026-08-01' }],
    selectedProjectName: 'projA',
  })
  // setup.ts 的 electron mock 未覆盖 aidc 桥接 / app.getPath / project.getFile（WorkbenchTab 渲染需要）
  ;(window as unknown as { electron: { app: { getPath: ReturnType<typeof vi.fn> } } }).electron.app.getPath =
    vi.fn().mockResolvedValue('/workspace')
  ;(window as unknown as { electron: { aidc?: { project: { list: ReturnType<typeof vi.fn> } } } }).electron.aidc = {
    project: { list: vi.fn().mockResolvedValue({ ok: true, projects: [] }) },
  }
  ;(window as unknown as { electron: { project: { getFile: ReturnType<typeof vi.fn> } } }).electron.project.getFile.mockResolvedValue(null)
})

describe('AL-N1 设计入口归属调整', () => {
  it('N-1 中栏「组网设计」组下渲染「机房设计」「机柜设计」两个独立入口', () => {
    render(<FileExplorer />)
    expect(screen.getByText('机房设计')).toBeInTheDocument()
    expect(screen.getByText('机柜设计')).toBeInTheDocument()
  })

  it('N-2 点击「机房设计」→ workbenchSubview=roomdesign', () => {
    render(<FileExplorer />)
    fireEvent.click(screen.getByText('机房设计'))
    expect(useUIStore.getState().workbenchSubview).toBe('roomdesign')
  })

  it('N-2 点击「机柜设计」→ workbenchSubview=rackdesign（修复旧 rack 坏链）', () => {
    render(<FileExplorer />)
    fireEvent.click(screen.getByText('机柜设计'))
    expect(useUIStore.getState().workbenchSubview).toBe('rackdesign')
  })

  it('N-3 main（组网渲染）内不再渲染设计入口（无「设计步骤」行）', async () => {
    render(<WorkbenchTab />)
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
    expect(screen.queryByText(/设计步骤/)).not.toBeInTheDocument()
  })

  it('N-4 二级页签标签 i18n 生效：5 语言 workbench.json 均含 subview.roomdesign/rackdesign', () => {
    // workbench.json 为扁平 key（"subview.roomdesign"），i18next 按点号路径解析
    for (const { code, resources } of LANGUAGES) {
      expect(resources.workbench['subview.roomdesign'], `${code} 缺少 subview.roomdesign`).toBeTruthy()
      expect(resources.workbench['subview.rackdesign'], `${code} 缺少 subview.rackdesign`).toBeTruthy()
    }
  })

  it('N-4 切到 roomdesign/rackdesign 后二级页签渲染对应 i18n 标签（zh-CN：机房设计/机柜设计）', async () => {
    render(<WorkbenchTab />)
    await waitFor(() => expect(useUIStore.getState().workbenchSubview).toBe('main'))
    act(() => useUIStore.getState().setWorkbenchSubview('roomdesign'))
    await waitFor(() => expect(screen.getAllByText('机房设计').length).toBeGreaterThan(0))
    act(() => useUIStore.getState().setWorkbenchSubview('rackdesign'))
    await waitFor(() => expect(screen.getAllByText('机柜设计').length).toBeGreaterThan(0))
  })
})
