import { useCallback, useId, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'

export interface TabItem {
  /** 唯一 key */
  value: string
  /** 显示标签 */
  label: ReactNode
  /** 图标(可选) */
  icon?: ReactNode
  /** 禁用 */
  disabled?: boolean
  /** 右侧附加内容(如关闭按钮) */
  extra?: ReactNode
}

interface TabsProps {
  items: TabItem[]
  /** 受控:当前激活 value */
  value?: string
  /** 非受控:默认激活 value */
  defaultValue?: string
  onChange?: (value: string) => void
  /** 选项卡下方内容渲染函数 */
  children?: (activeValue: string) => ReactNode
  className?: string
  /** 选项卡尺寸,默认 'md' */
  size?: 'sm' | 'md'
  /** 下划线样式,默认 true;false 则用分段样式 */
  underline?: boolean
}

/**
 * v2.7.3-T10: Tabs 组件
 * 支持受控(value + onChange)与非受控(defaultValue)双模式。
 * 键盘导航:ArrowLeft/Right 切换,Home/End 跳首尾。
 * a11y: role="tablist"/"tab"/"tabpanel", aria-selected, aria-controls。
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  children,
  className,
  size = 'md',
  underline = true,
}: TabsProps) {
  const idBase = useId()
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.value ?? '')
  const isControlled = value !== undefined
  const activeValue = isControlled ? value : internalValue

  const enabledItems = useMemo(() => items.filter((i) => !i.disabled), [items])
  const activeIndex = useMemo(
    () => enabledItems.findIndex((i) => i.value === activeValue),
    [enabledItems, activeValue],
  )

  const select = useCallback((v: string) => {
    if (!isControlled) setInternalValue(v)
    onChange?.(v)
  }, [isControlled, onChange])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = enabledItems[(activeIndex + 1) % enabledItems.length]
      if (next) select(next.value)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = enabledItems[(activeIndex - 1 + enabledItems.length) % enabledItems.length]
      if (prev) select(prev.value)
    } else if (e.key === 'Home') {
      e.preventDefault()
      if (enabledItems[0]) select(enabledItems[0].value)
    } else if (e.key === 'End') {
      e.preventDefault()
      if (enabledItems[enabledItems.length - 1]) select(enabledItems[enabledItems.length - 1].value)
    }
  }

  const padding = size === 'sm' ? 'px-2.5 py-1 text-2xs' : 'px-3 py-1.5 text-xs'

  return (
    <div className={clsx('flex flex-col', className)}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className={clsx(
          'flex items-center shrink-0',
          underline
            ? 'border-b border-edge-subtle gap-4'
            : 'gap-1 p-0.5 bg-app-hover rounded-lg',
        )}
      >
        {items.map((item) => {
          const isActive = item.value === activeValue
          const tabId = `${idBase}-tab-${item.value}`
          const panelId = `${idBase}-panel-${item.value}`
          return (
            <button
              key={item.value}
              id={tabId}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.value)}
              className={clsx(
                'flex items-center gap-1.5 font-medium transition-colors',
                padding,
                underline
                  ? clsx(
                      'border-b-2 -mb-px',
                      isActive
                        ? 'border-primary text-primary'
                        : 'border-transparent text-text-secondary hover:text-text-primary',
                    )
                  : clsx(
                      'rounded-md',
                      isActive
                        ? 'bg-app text-primary shadow-sm'
                        : 'text-text-secondary hover:bg-app-hover',
                    ),
                item.disabled && 'opacity-40 cursor-not-allowed',
              )}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.extra}
            </button>
          )
        })}
      </div>
      {children && (
        <div
          role="tabpanel"
          id={`${idBase}-panel-${activeValue}`}
          aria-labelledby={`${idBase}-tab-${activeValue}`}
          className="flex-1 min-h-0"
        >
          {children(activeValue)}
        </div>
      )}
    </div>
  )
}
