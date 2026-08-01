import React, { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'

export interface TreeNodeProps {
  /** 节点文本(可传 string 或 JSX) */
  label: React.ReactNode
  /** 缩进深度(0=根,1=一级,以此类推) */
  depth: number
  /** 前置图标 */
  leading?: React.ReactNode
  /** 后置元素(如徽章、按钮) */
  trailing?: React.ReactNode
  /** 右键菜单项 */
  contextMenu?: ContextMenuItem[]
  /** 主体点击(打开/切换) */
  onClick?: () => void
  /** 箭头点击(展开/折叠),不传则不显示箭头 */
  onArrowClick?: () => void
  /** 当前展开状态 */
  isExpanded?: boolean
  /** 是否有子节点(影响箭头显示) */
  hasChildren?: boolean
  /** 是否高亮 */
  isActive?: boolean
  /** 额外样式 */
  className?: string
}

/**
 * T7: 通用树节点组件
 *
 * 统一替代 TreeItem 和 ExpandableTreeItem。
 * - 缩进: depth * 12 + 4 px (padding-left)
 * - 箭头: ChevronRight 旋转 90deg (transition-transform)
 * - 无子节点时箭头位置保留空白(保持对齐)
 * - 右键菜单通过 ContextMenu 组件实现
 * - 暗色模式适配
 * - 点击箭头 stopPropagation 避免触发 onClick
 */
export function TreeNode({
  label,
  depth,
  leading,
  trailing,
  contextMenu,
  onClick,
  onArrowClick,
  isExpanded,
  hasChildren,
  isActive,
  className,
}: TreeNodeProps) {
  const [showContext, setShowContext] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!contextMenu) return
    e.preventDefault()
    setPos({ x: e.clientX, y: e.clientY })
    setShowContext(true)
  }

  const showArrow = onArrowClick && hasChildren

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={clsx(
          'group flex items-center gap-1.5 pr-3 py-1 text-xs cursor-pointer select-none transition-colors border-l-2',
          isActive
            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-l-primary-500'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover/50 border-l-transparent',
          className,
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {/* 箭头插槽:始终保留 12px 宽度以保持对齐 */}
        <span className="shrink-0 w-3 h-3 flex items-center justify-center">
          {showArrow && (
            <span
              onClick={(e) => {
                e.stopPropagation()
                onArrowClick?.()
              }}
              className="text-gray-400 dark:text-gray-500"
            >
              <ChevronRight
                size={12}
                className={clsx('transition-transform', isExpanded && 'rotate-90')}
              />
            </span>
          )}
        </span>
        {leading && <span className="shrink-0">{leading}</span>}
        <span className="truncate flex-1">{label}</span>
        {trailing && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {trailing}
          </span>
        )}
      </div>
      {showContext && contextMenu && (
        <ContextMenu
          items={contextMenu}
          x={pos.x}
          y={pos.y}
          onClose={() => setShowContext(false)}
        />
      )}
    </>
  )
}
