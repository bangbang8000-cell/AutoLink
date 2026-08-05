/**
 * V3.1.1-T5-5: AI 对话面板（会话管理 + 消息流 + 输入）
 */
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Eraser, Wifi, WifiOff, Bot } from 'lucide-react'
import clsx from 'clsx'
import { useChatStore, sendMessage } from '@/stores/chat.store'
import { useUIStore } from '@/stores/ui.store'
import { ChatMessageBubble } from './ChatMessageBubble'
import { ChatInput } from './ChatInput'

export function ChatPanel() {
  const { t } = useTranslation()
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const isSending = useChatStore((s) => s.isSending)
  const aiConfig = useUIStore((s) => s.aiConfig)
  const scrollRef = useRef<HTMLDivElement>(null)

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId],
  )

  // 无会话时自动创建
  useEffect(() => {
    const store = useChatStore.getState()
    if (!store.hasHydrated) return
    if (!store.activeSessionId || !store.sessions.length) {
      store.createSession()
    }
  }, [])

  // 新消息自动滚动到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [activeSession?.messages.length, activeSession?.messages[activeSession.messages.length - 1]?.content])

  const hasProvider = Boolean(aiConfig.defaultProvider && aiConfig.providers[aiConfig.defaultProvider]?.apiKey)

  const handleSend = (content: string) => {
    const store = useChatStore.getState()
    const mode = store.currentMode
    const attachments = [...store.pendingAttachments]
    sendMessage(store, content, mode, attachments)
  }

  return (
    <div className="flex h-full flex-col bg-gray-50 dark:bg-app">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-edge-subtle bg-white dark:bg-app">
        <Bot size={16} className="text-purple-500" />
        <span className="text-sm font-medium">{t('common:menu.ai')}</span>
        <span
          className={clsx(
            'ml-1 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full',
            hasProvider
              ? 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-400'
              : 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-400',
          )}
        >
          {hasProvider ? <Wifi size={11} /> : <WifiOff size={11} />}
          {hasProvider ? t('chat:aihub.status.ready') : t('chat:aihub.status.noProvider')}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => useChatStore.getState().createSession()}
          className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-app-hover rounded"
          title={t('chat:session.newChat')}
        >
          <Plus size={15} />
        </button>
        <button
          onClick={() => useChatStore.getState().clearCurrentSession()}
          className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-app-hover rounded"
          title={t('chat:session.clear')}
        >
          <Eraser size={15} />
        </button>
        <button
          onClick={() => activeSessionId && useChatStore.getState().deleteSession(activeSessionId)}
          className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-danger-500 hover:bg-gray-100 dark:hover:bg-app-hover rounded"
          title={t('chat:session.delete')}
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* 会话标签栏 */}
      {sessions.length > 1 && (
        <div className="flex items-center gap-1 px-2 pt-1.5 overflow-x-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => useChatStore.getState().setActiveSession(s.id)}
              className={clsx(
                'shrink-0 text-xs px-2 py-1 rounded-t border-b-2 transition-colors max-w-[140px] truncate',
                s.id === activeSessionId
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700',
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {!activeSession || activeSession.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 gap-2">
            <Bot size={32} />
            <p className="text-sm">{t('chat:mock.general')}</p>
          </div>
        ) : (
          activeSession.messages.map((m) => <ChatMessageBubble key={m.id} message={m} />)
        )}
      </div>

      {/* 输入 */}
      <ChatInput onSend={handleSend} disabled={isSending} />
    </div>
  )
}
