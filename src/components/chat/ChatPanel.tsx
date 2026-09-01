/**
 * V3.1.1-T5-5: AI 对话面板（会话管理 + 消息流 + 输入）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Eraser, Wifi, WifiOff, Bot, ListChecks, Wrench, Pencil, Check, X, FileText } from 'lucide-react'
import clsx from 'clsx'
import { useChatStore, sendMessage } from '@/stores/chat.store'
import { useUIStore } from '@/stores/ui.store'
import { useToastStore } from '@/stores/toast.store'
import { ChatMessageBubble } from './ChatMessageBubble'
import { ChatInput } from './ChatInput'
import { BatchOptimizePanel } from './BatchOptimizePanel'
import { RepairPanel } from './RepairPanel'

export function ChatPanel() {
  const { t } = useTranslation()
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const isSending = useChatStore((s) => s.isSending)
  const aiConfig = useUIStore((s) => s.aiConfig)
  const aiKeyConfigured = useUIStore((s) => s.aiKeyConfigured)
  const scrollRef = useRef<HTMLDivElement>(null)
  // V3.2.0-T9-3: 批量优化面板
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  // V3.2.0-T9-4: 智能修复面板
  const [repairOpen, setRepairOpen] = useState(false)
  // 4.3 F3-2: 会话重命名（内联输入）与摘要生成中
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [summarizing, setSummarizing] = useState(false)

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

  // AL-S3: 会话可用性 = 内存 key 或后端已配置标记（重启后 localStorage 不再存明文 key）
  const hasProvider = Boolean(
    aiConfig.defaultProvider &&
      (aiConfig.providers[aiConfig.defaultProvider]?.apiKey || aiKeyConfigured[aiConfig.defaultProvider]),
  )

  const handleSend = (content: string) => {
    const store = useChatStore.getState()
    const mode = store.currentMode
    const attachments = [...store.pendingAttachments]
    sendMessage(store, content, mode, attachments)
  }

  // 4.3 F3-2: 会话重命名提交
  const submitRename = () => {
    if (renamingId && renameValue.trim()) {
      useChatStore.getState().renameSession(renamingId, renameValue)
    }
    setRenamingId(null)
    setRenameValue('')
  }

  // 4.3 F3-2: 会话内手动摘要（上下文摘要衔接，摘要后继续）
  const handleSummarize = async () => {
    if (summarizing) return
    setSummarizing(true)
    const toast = useToastStore.getState()
    try {
      const r = await useChatStore.getState().summarizeSession(undefined)
      if (r.ok) {
        toast.addToast('success', t('chat:session.summarize'))
      } else {
        toast.addToast('warning', r.error || t('chat:session.summarizeFailed'))
      }
    } finally {
      setSummarizing(false)
    }
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
        {/* V3.2.0-T9-3: 批量优化（收敛比/成本/散热建议批量应用） */}
        <button
          onClick={() => setOptimizeOpen(true)}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40"
          title="批量优化：生成收敛比/成本/散热建议并批量应用"
        >
          <ListChecks size={12} />批量优化
        </button>
        {/* V3.2.0-T9-4: 智能修复（校验错误 → 一键修复闭环） */}
        <button
          onClick={() => setRepairOpen(true)}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/20 text-success-600 dark:text-success-400 hover:bg-success-100 dark:hover:bg-success-900/40"
          title="智能修复：校验配置错误并一键应用修复，复核剩余问题"
        >
          <Wrench size={12} />智能修复
        </button>
        <button
          onClick={() => useChatStore.getState().createSession()}
          className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-app-hover rounded"
          title={t('chat:session.newChat')}
        >
          <Plus size={15} />
        </button>
        {/* 4.3 F3-2: 会话内手动摘要（摘要后继续） */}
        <button
          onClick={() => void handleSummarize()}
          disabled={summarizing || !activeSession || activeSession.messages.length === 0}
          className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-app-hover rounded disabled:opacity-40"
          title={t('chat:session.summarize')}
        >
          <FileText size={15} />
        </button>
        {/* 4.3 F3-2: 清空会话上下文（前端 + 后端联动） */}
        <button
          onClick={() => useChatStore.getState().clearSessionContext()}
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

      {/* 会话标签栏（4.3 F3-2: 支持重命名） */}
      {sessions.length > 1 && (
        <div className="flex items-center gap-1 px-2 pt-1.5 overflow-x-auto">
          {sessions.map((s) =>
            renamingId === s.id ? (
              <div
                key={s.id}
                className="shrink-0 flex items-center gap-0.5 text-xs px-1 py-0.5 rounded-t border-b-2 border-primary-500 bg-gray-100 dark:bg-app-hover"
              >
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  placeholder={t('chat:session.renamePlaceholder')}
                  className="w-[110px] bg-transparent outline-none text-primary-600 dark:text-primary-400"
                />
                <button onClick={submitRename} className="p-0.5 text-success-500 hover:bg-gray-200 dark:hover:bg-app-hover rounded">
                  <Check size={12} />
                </button>
                <button onClick={() => setRenamingId(null)} className="p-0.5 text-gray-400 hover:bg-gray-200 dark:hover:bg-app-hover rounded">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => useChatStore.getState().setActiveSession(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    useChatStore.getState().setActiveSession(s.id)
                  }
                }}
                className={clsx(
                  'shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-t border-b-2 transition-colors max-w-[140px] cursor-pointer',
                  s.id === activeSessionId
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700',
                )}
                title={s.title}
              >
                <span className="truncate">{s.title}</span>
                {s.id === activeSessionId && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenamingId(s.id)
                      setRenameValue(s.title)
                    }}
                    className="p-0.5 text-gray-400 hover:text-primary-500 rounded"
                    title={t('chat:session.rename')}
                  >
                    <Pencil size={10} />
                  </button>
                )}
              </div>
            ),
          )}
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

      {/* V3.2.0-T9-3: 批量优化面板 */}
      <BatchOptimizePanel open={optimizeOpen} onClose={() => setOptimizeOpen(false)} />
      {/* V3.2.0-T9-4: 智能修复面板 */}
      <RepairPanel open={repairOpen} onClose={() => setRepairOpen(false)} />
    </div>
  )
}
