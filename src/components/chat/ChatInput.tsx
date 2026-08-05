/**
 * V3.1.1-T5-5: AI 对话输入框（附件 + textarea + 发送）
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip, Send, Loader2, X } from 'lucide-react'
import { useChatStore } from '@/stores/chat.store'

interface Props {
  onSend: (content: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: Props) {
  const { t } = useTranslation()
  const inputValue = useChatStore((s) => s.inputValue)
  const setInputValue = useChatStore((s) => s.setInputValue)
  const isSending = useChatStore((s) => s.isSending)
  const pendingAttachments = useChatStore((s) => s.pendingAttachments)
  const addAttachment = useChatStore((s) => s.addAttachment)
  const removeAttachment = useChatStore((s) => s.removeAttachment)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (inputValue.trim() && !isSending) {
        onSend(inputValue.trim())
      }
    }
  }

  return (
    <div className="border-t border-edge-subtle p-3 bg-white dark:bg-app">
      {/* 附件预览 */}
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pendingAttachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-gray-100 dark:bg-app-hover text-gray-600 dark:text-gray-300 border border-edge-subtle"
            >
              {a.name}
              <button
                className="hover:text-danger-500"
                onClick={() => removeAttachment(a.id)}
                aria-label="remove"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-app-hover rounded transition-colors"
          title={t('chat:input.attach')}
          disabled={disabled || isSending}
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept=".xlsx,.xls,.yaml,.yml,.json,.toml,.md,.txt,.pdf,.csv,.cfg,.ini,.conf"
          onChange={(e) => {
            Array.from(e.target.files || []).forEach((f) => addAttachment(f))
            e.target.value = ''
          }}
        />
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat:input.placeholder')}
          rows={1}
          className="flex-1 resize-none rounded-md border border-edge-subtle bg-gray-50 dark:bg-app-hover px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary-400 max-h-[120px] min-h-[36px]"
        />
        <button
          onClick={() => inputValue.trim() && onSend(inputValue.trim())}
          disabled={disabled || isSending || !inputValue.trim()}
          className="p-2 rounded-md bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={t('chat:input.send')}
        >
          {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  )
}
