import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { PerformancePanel } from '@/components/layout/PerformancePanel'
import { ValidationReportPanel } from '@/components/validation/ValidationReportPanel'
// 4.6.0（F6-4）：质量仪表盘 tab
import { QualityDashboard } from '@/components/quality/QualityDashboard'

interface LogEntry {
  timestamp: string
  message: string
  level: 'info' | 'warn' | 'error'
}

type PanelTab = 'log' | 'performance' | 'validation' | 'quality'

export function LogPanel() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<PanelTab>('log')
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  useEffect(() => {
    // Listen for log events from main process
    if (!window.electron) return
    
    const unsub = window.electron.onLogOutput?.((data: { message: string; level?: string }) => {
      setLogs((prev) => {
        const entry: LogEntry = {
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: data.message,
          level: (data.level as LogEntry['level']) || 'info',
        }
        const next = [...prev, entry]
        // Keep max 500 entries
        if (next.length > 500) return next.slice(-500)
        return next
      })
    })
    
    return () => { unsub?.() }
  }, [])

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 30
  }, [])

  const handleClear = useCallback(() => {
    setLogs([])
  }, [])

  if (collapsed) {
    return (
      <div className="h-7 flex items-center justify-between px-3 border-t border-gray-200 dark:border-edge-subtle bg-gray-50 dark:bg-app-surface shrink-0">
        <span className="text-2xs text-gray-500">{t('common:logPanel.title')} ({logs.length})</span>
        <button onClick={() => setCollapsed(false)} className="p-0.5 hover:bg-gray-200 dark:hover:bg-app-hover rounded">
          <ChevronUp size={12} className="text-gray-400" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-2 py-0.5 border-t border-b border-gray-200 dark:border-edge-subtle bg-gray-50 dark:bg-app-surface shrink-0">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setTab('log')}
            className={clsx(
              'px-2 py-0.5 rounded text-2xs transition-colors',
              tab === 'log'
                ? 'bg-white dark:bg-app text-gray-700 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            {t('common:logPanel.tabs.log')}
          </button>
          <button
            onClick={() => setTab('performance')}
            className={clsx(
              'px-2 py-0.5 rounded text-2xs transition-colors',
              tab === 'performance'
                ? 'bg-white dark:bg-app text-gray-700 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            {t('common:logPanel.tabs.performance')}
          </button>
          {/* 4.5（F5-5）：数据校验 tab（一键校验 + 报告导出） */}
          <button
            onClick={() => setTab('validation')}
            className={clsx(
              'px-2 py-0.5 rounded text-2xs transition-colors',
              tab === 'validation'
                ? 'bg-white dark:bg-app text-gray-700 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            {t('common:logPanel.tabs.validation', '校验')}
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          {tab === 'log' && (
            <button onClick={handleClear} className="p-0.5 hover:bg-gray-200 dark:hover:bg-app-hover rounded" title={t('common:logPanel.clear')}>
              <Trash2 size={11} className="text-gray-400" />
            </button>
          )}
          <button onClick={() => setCollapsed(true)} className="p-0.5 hover:bg-gray-200 dark:hover:bg-app-hover rounded" title={t('common:logPanel.collapse')}>
            <ChevronDown size={12} className="text-gray-400" />
          </button>
        </div>
      </div>
      {/* Content */}
      {tab === 'performance' ? (
        <div className="flex-1 overflow-hidden">
          <PerformancePanel />
        </div>
      ) : tab === 'validation' ? (
        <div className="flex-1 overflow-hidden">
          <ValidationReportPanel />
        </div>
      ) : tab === 'quality' ? (
        <div className="flex-1 overflow-hidden">
          <QualityDashboard />
        </div>
      ) : (
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-gray-900 text-gray-200 font-mono text-2xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <div className="p-3 text-gray-500 select-none">{t('common:logPanel.waiting')}</div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className="px-3 py-0.5 flex items-start gap-2 hover:bg-gray-800">
              <span className="text-gray-500 shrink-0 select-none">{entry.timestamp}</span>
              <span className={
                entry.level === 'error' ? 'text-error-400' :
                entry.level === 'warn' ? 'text-yellow-400' :
                'text-gray-300'
              }>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
      )}
    </div>
  )
}
