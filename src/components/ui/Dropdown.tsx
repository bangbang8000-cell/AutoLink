import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronDown, Check } from 'lucide-react'

export interface DropdownItem {
  value: string
  label: string
  icon?: ReactNode
  disabled?: boolean
}

interface DropdownProps {
  items: DropdownItem[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** 宽度,默认 'w-48' */
  menuClassName?: string
}

/**
 * v2.7.3-T10: Dropdown 组件
 * 支持受控(value + onChange)与非受控(defaultValue)双模式。
 * 键盘导航:ArrowUp/Down 选择,Enter 确认,Esc 关闭。
 */
export function Dropdown({
  items,
  value,
  defaultValue,
  onChange,
  placeholder = '请选择',
  disabled,
  className,
  menuClassName = 'w-48',
}: DropdownProps) {
  const id = useId()
  const [internalValue, setInternalValue] = useState(defaultValue ?? '')
  const isControlled = value !== undefined
  const currentValue = isControlled ? value : internalValue

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selectedItem = useMemo(() => items.find((i) => i.value === currentValue), [items, currentValue])

  const handleSelect = useCallback((item: DropdownItem) => {
    if (item.disabled) return
    if (!isControlled) setInternalValue(item.value)
    onChange?.(item.value)
    setOpen(false)
  }, [isControlled, onChange])

  // 外部点击关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // 键盘导航
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (!open) {
          setOpen(true)
          setActiveIndex(items.findIndex((i) => !i.disabled))
        } else if (activeIndex >= 0) {
          // v2.7.3-T10: 已打开时 Enter/Space 确认选择
          handleSelect(items[activeIndex])
        }
        break
      case 'ArrowDown':
        e.preventDefault()
        if (!open) {
          setOpen(true)
          setActiveIndex(items.findIndex((i) => !i.disabled))
        } else {
          setActiveIndex((prev) => {
            for (let i = prev + 1; i < items.length; i++) {
              if (!items[i].disabled) return i
            }
            return prev
          })
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!open) {
          setOpen(true)
          // 选中最后一个未禁用项
          let last = items.length - 1
          while (last >= 0 && items[last].disabled) last--
          setActiveIndex(last)
        } else {
          setActiveIndex((prev) => {
            for (let i = prev - 1; i >= 0; i--) {
              if (!items[i].disabled) return i
            }
            return prev
          })
        }
        break
      case 'Escape':
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  // activeIndex 滚动入视
  useEffect(() => {
    if (!open || activeIndex < 0) return
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null
    // jsdom 无 scrollIntoView,运行时检查
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  return (
    <div ref={rootRef} className={clsx('relative inline-block', className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          'flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-xs rounded-md border',
          'border-gray-300 dark:border-gray-600 bg-white dark:bg-app-surface text-gray-900 dark:text-gray-100',
          'hover:border-gray-400 dark:hover:border-gray-500',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          menuClassName,
        )}
      >
        <span className="flex items-center gap-1.5 truncate">
          {selectedItem?.icon}
          <span className={clsx('truncate', !selectedItem && 'text-gray-400 dark:text-gray-500')}>
            {selectedItem ? selectedItem.label : placeholder}
          </span>
        </span>
        <ChevronDown size={14} className={clsx('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-labelledby={id}
          className={clsx(
            'absolute z-[80] mt-0.5 max-h-60 overflow-auto py-1',
            'bg-white dark:bg-app-surface border border-gray-200 dark:border-edge-subtle rounded-lg shadow-lg',
            'animate-dropdown-in',
            menuClassName,
          )}
        >
          {items.map((item, idx) => {
            const isActive = idx === activeIndex
            const isSelected = item.value === currentValue
            return (
              <li
                key={item.value}
                data-idx={idx}
                role="option"
                aria-selected={isSelected}
                aria-disabled={item.disabled}
                onMouseEnter={() => !item.disabled && setActiveIndex(idx)}
                onClick={() => handleSelect(item)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none',
                  'text-gray-700 dark:text-gray-300',
                  item.disabled && 'opacity-40 cursor-not-allowed',
                  !item.disabled && isActive && 'bg-gray-100 dark:bg-app-hover',
                  !item.disabled && !isActive && 'hover:bg-gray-50 dark:hover:bg-app-hover/60',
                )}
              >
                {item.icon}
                <span className="flex-1 truncate">{item.label}</span>
                {isSelected && <Check size={12} className="text-primary-500 shrink-0" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
