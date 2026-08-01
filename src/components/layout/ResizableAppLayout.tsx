import { useState, useCallback, type ReactNode } from 'react'

interface Props {
  isDark: boolean
  sidebarVisible: boolean
  panelVisible: boolean
  sidebar: ReactNode
  editor: ReactNode
  bottomPanel: ReactNode
}

export function ResizableAppLayout({ sidebarVisible, panelVisible, sidebar, editor, bottomPanel }: Props) {
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [panelHeight, setPanelHeight] = useState(250)

  const startResizeSidebar = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = sidebarWidth
      const onMove = (ev: MouseEvent) => {
        setSidebarWidth(Math.max(200, Math.min(500, startWidth + ev.clientX - startX)))
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [sidebarWidth],
  )

  const startResizePanel = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startY = e.clientY
      const startHeight = panelHeight
      const onMove = (ev: MouseEvent) => {
        setPanelHeight(Math.max(100, Math.min(500, startHeight + startY - ev.clientY)))
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [panelHeight],
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {sidebarVisible && (
        <>
          <div style={{ width: sidebarWidth }} className="shrink-0 overflow-auto border-e border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-surface">
            {sidebar}
          </div>
          <div
            onMouseDown={startResizeSidebar}
            className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 dark:bg-edge-default hover:bg-primary-400 hover:w-2 transition-all"
          />
        </>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">{editor}</div>
        {panelVisible && (
          <>
            <div
              onMouseDown={startResizePanel}
              className="h-1.5 shrink-0 cursor-row-resize bg-gray-200 dark:bg-edge-default hover:bg-primary-400 hover:h-2 transition-all"
            />
            <div style={{ height: panelHeight }} className="shrink-0 overflow-auto border-t border-gray-200 dark:border-edge-subtle bg-white dark:bg-app-surface">
              {bottomPanel}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
