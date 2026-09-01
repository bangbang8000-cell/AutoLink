/**
 * 4.3 F3-1a: 命令面板（Ctrl+K 打开，搜索/执行，命令注册本地化）
 *
 * 复用 MC CommandPalette 交互：搜索过滤（label/category）、键盘导航（↑/↓/Enter/Esc）、
 * 命令执行即关闭；命令由 src/utils/commands.ts 注册表提供。
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, CornerDownLeft } from 'lucide-react'
import clsx from 'clsx'
import { useUIStore } from '@/stores/ui.store'
import type { CommandItem } from '@/utils/commands'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  commands: CommandItem[]
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const { t } = useTranslation()
  const isDark = useUIStore((s) => s.isDark)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = query
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.category.toLowerCase().includes(query.toLowerCase()),
      )
    : commands

  // 打开时重置状态并聚焦
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // 越界收敛
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, selectedIndex])

  const execute = useCallback(
    (index: number) => {
      const item = filtered[index]
      if (item) {
        item.action()
        onClose()
      }
    },
    [filtered, onClose],
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        execute(selectedIndex)
        break
      case 'Escape':
        onClose()
        break
    }
  }

  // 选中项滚动可见（jsdom 无 scrollIntoView，防御性判断）
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined
      if (selected && typeof selected.scrollIntoView === 'function') {
        selected.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className={clsx(
          'w-[560px] max-w-[92vw] max-h-[420px] rounded-lg shadow-2xl border overflow-hidden flex flex-col',
          isDark ? 'bg-app-elevated border-edge-subtle' : 'bg-white border-gray-200',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={clsx(
            'flex items-center gap-2 px-4 py-3 border-b',
            isDark ? 'border-edge-subtle' : 'border-gray-200',
          )}
        >
          <Search size={15} className={clsx(isDark ? 'text-gray-400' : 'text-gray-500')} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('common:commandPalette.placeholder')}
            className={clsx(
              'w-full bg-transparent text-sm outline-none',
              isDark ? 'text-gray-100 placeholder:text-gray-500' : 'text-gray-900 placeholder:text-gray-400',
            )}
          />
          <CornerDownLeft size={14} className={clsx(isDark ? 'text-gray-500' : 'text-gray-400')} />
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div
              className={clsx(
                'px-4 py-8 text-center text-sm',
                isDark ? 'text-gray-500' : 'text-gray-400',
              )}
            >
              {t('common:commandPalette.noResults')}
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                onClick={() => execute(i)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors',
                  i === selectedIndex
                    ? isDark
                      ? 'bg-primary-900/30 text-primary-300'
                      : 'bg-primary-50 text-primary-700'
                    : isDark
                      ? 'text-gray-200 hover:bg-app-hover'
                      : 'text-gray-700 hover:bg-gray-100',
                )}
              >
                <span className="flex-1 truncate">{item.label}</span>
                <span
                  className={clsx(
                    'text-xs shrink-0',
                    isDark ? 'text-gray-500' : 'text-gray-400',
                  )}
                >
                  {item.category}
                </span>
                {item.shortcut && (
                  <kbd
                    className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded border shrink-0',
                      isDark ? 'border-gray-600 text-gray-400' : 'border-gray-300 text-gray-500',
                    )}
                  >
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
