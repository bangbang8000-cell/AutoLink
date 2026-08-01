import { type ReactNode } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'

interface Props {
  isDark?: boolean
  sidebarVisible: boolean
  panelVisible: boolean
  sidebar: ReactNode
  editor: ReactNode
  bottomPanel: ReactNode
}

// v2.7.3-T4: 迁移到 react-resizable-panels v4
// - useDefaultLayout 自动持久化到 localStorage,重启后恢复
// - 内置 a11y + 键盘支持(F6 聚焦 Separator,方向键调整)
// - 库内部处理 user-select:none,拖拽时无文字选中
// 注意:v4 数字值表示像素,字符串无单位表示百分比(如 "20" = 20%)
export function ResizableAppLayout({ sidebarVisible, panelVisible, sidebar, editor, bottomPanel }: Props) {
  const hLayout = useDefaultLayout({
    id: 'autolink-layout-h',
    panelIds: ['sidebar', 'main'],
  })
  const vLayout = useDefaultLayout({
    id: 'autolink-layout-v',
    panelIds: ['editor', 'panel'],
  })

  return (
    <Group
      orientation="horizontal"
      className="flex-1 flex"
      defaultLayout={hLayout.defaultLayout}
      onLayoutChanged={hLayout.onLayoutChanged}
    >
      {sidebarVisible && (
        <>
          <Panel
            id="sidebar"
            defaultSize="20%"
            minSize="14%"
            maxSize="36%"
            className="overflow-auto border-e border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-surface"
          >
            {sidebar}
          </Panel>
          <Separator className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 dark:bg-edge hover:bg-primary-400 transition-colors" />
        </>
      )}
      <Panel id="main" className="flex flex-col overflow-hidden">
        <Group
          orientation="vertical"
          className="flex-1 flex flex-col"
          defaultLayout={vLayout.defaultLayout}
          onLayoutChanged={vLayout.onLayoutChanged}
        >
          <Panel id="editor" defaultSize="72%" minSize="30%" className="overflow-auto">
            {editor}
          </Panel>
          {panelVisible && (
            <>
              <Separator className="h-1.5 shrink-0 cursor-row-resize bg-gray-200 dark:bg-edge hover:bg-primary-400 transition-colors" />
              <Panel
                id="panel"
                defaultSize="28%"
                minSize="10%"
                maxSize="70%"
                className="overflow-auto border-t border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-surface"
              >
                {bottomPanel}
              </Panel>
            </>
          )}
        </Group>
      </Panel>
    </Group>
  )
}
