/**
 * V3.1.1-T5-5: AI 消息气泡（用户/助手 + markdown + 计划块 + 附件预览）
 */
import { Bot, User, FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMemo } from 'react'
import type { ChatMessage } from '@/types/chat'
import { PlanDisplay, parsePlanSteps } from './PlanDisplay'

interface Props {
  message: ChatMessage
}

export function ChatMessageBubble({ message }: Props) {
  const isUser = message.role === 'user'
  const planSteps = useMemo(() => (isUser ? [] : parsePlanSteps(message.content)), [message.content, isUser])
  const showPlan = !isUser && planSteps.length > 0

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isUser
            ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
            : 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400'
        }`}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* 附件预览 */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1.5">
            {message.attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-gray-100 dark:bg-app-hover text-gray-600 dark:text-gray-300 border border-edge-subtle"
              >
                <FileText size={11} />
                {a.name}
              </span>
            ))}
          </div>
        )}

        <div
          className={`px-3 py-2 rounded-lg text-sm leading-relaxed break-words whitespace-pre-wrap ${
            isUser
              ? 'bg-primary-500 text-white rounded-tr-sm'
              : 'bg-white dark:bg-app-hover border border-edge-subtle rounded-tl-sm text-gray-800 dark:text-gray-200'
          }`}
        >
          {isUser ? (
            message.content
          ) : (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* 执行计划 */}
        {showPlan && <PlanDisplay steps={planSteps} />}
      </div>
    </div>
  )
}
