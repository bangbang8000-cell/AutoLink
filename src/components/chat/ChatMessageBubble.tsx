/**
 * V3.1.1-T5-5: AI 消息气泡（用户/助手 + markdown + 计划块 + 附件预览）
 * 4.3 F3-2: 确认卡片交互细化（解析 ---CONFIRM:<tool>--- 标记 → 确认/取消按钮回灌）
 */
import { Bot, User, FileText, Check, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import type { ChatMessage } from '@/types/chat'
import { useChatStore, parseConfirmationMarker, sendConfirmationReply, parseHermesInstallMarker } from '@/stores/chat.store'
import { useProjectStore } from '@/stores/project.store'
import { PlanDisplay, parsePlanSteps } from './PlanDisplay'
import { ProjectConfigPreview, parseProjectConfigBlock } from './ProjectConfigPreview'

interface Props {
  message: ChatMessage
}

export function ChatMessageBubble({ message }: Props) {
  const { t } = useTranslation()
  const [confirmationResolved, setConfirmationResolved] = useState(false)
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const planSteps = useMemo(() => (isUser || isSystem ? [] : parsePlanSteps(message.content)), [message.content, isUser, isSystem])
  const showPlan = !isUser && !isSystem && planSteps.length > 0
  // V3.1.3-T7-2: 需求生成预览卡片（project-config 块 / 工具结果 json 块）
  const projectPreview = useMemo(
    () => (isUser || isSystem ? null : parseProjectConfigBlock(message.content)),
    [message.content, isUser, isSystem],
  )
  // 4.3 F3-2: 解析确认标记（assistant 消息），渲染时剥离标记行
  const confirmation = useMemo(
    () => (isUser || isSystem ? null : parseConfirmationMarker(message.content)),
    [message.content, isUser, isSystem],
  )
  // 5.0.2-502-c: 解析 Hermes 安装指引标记（渲染提示卡片时剥离标记行）
  const hermesHint = useMemo(
    () => (isUser || isSystem ? null : parseHermesInstallMarker(message.content)),
    [message.content, isUser, isSystem],
  )
  const displayContent = confirmation ? confirmation.displayContent : hermesHint ? hermesHint.displayContent : message.content
  const isSending = useChatStore((s) => s.isSending)

  // 4.3 F3-2: 确认/取消按钮回灌；空闲时才发送，发送后卡片立即消失
  const handleConfirmation = (reply: '确认' | '取消') => {
    if (isSending || confirmationResolved) return
    setConfirmationResolved(true)
    const projectName = useProjectStore.getState().selectedProjectName
    sendConfirmationReply(reply, projectName ?? undefined)
  }

  if (isSystem) {
    return (
      <div className="px-4 py-2 text-xs text-center italic text-gray-400 dark:text-gray-500 whitespace-pre-wrap">
        {message.content}
      </div>
    )
  }

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
            /* M7c（对齐 MC）：prose 排版行式 */
            <div className="prose max-w-none dark:prose-invert prose-pre:rounded-lg prose-pre:text-xs prose-code:text-xs prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-table:text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* 执行计划 */}
        {showPlan && <PlanDisplay steps={planSteps} />}

        {/* V3.1.3-T7-2: 需求生成预览卡片 */}
        {projectPreview && <ProjectConfigPreview preview={projectPreview} />}

        {/* 4.3 F3-2: 工具确认卡片（点确认/取消以用户消息回灌，发送后卡片消失） */}
        {confirmation && !confirmationResolved && (
          <div
            className={clsx(
              'mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs w-full',
              'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20',
            )}
          >
            <span className="flex-1 text-amber-800 dark:text-amber-200">
              {t('chat:tool.confirmCard', { tool: confirmation.tool })}
            </span>
            <button
              onClick={() => handleConfirmation('确认')}
              disabled={isSending}
              className="flex items-center gap-0.5 px-2.5 py-1 rounded text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
            >
              <Check size={12} />
              {t('common:confirm')}
            </button>
            <button
              onClick={() => handleConfirmation('取消')}
              disabled={isSending}
              className="flex items-center gap-0.5 px-2.5 py-1 rounded text-xs font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 disabled:opacity-50"
            >
              <X size={12} />
              {t('common:cancel')}
            </button>
          </div>
        )}

        {/* 5.0.2-502-c: Hermes 未安装安装指引卡片 */}
        {hermesHint && (
          <div
            className={clsx(
              'mt-2 w-full px-3 py-2.5 rounded-lg border text-xs',
              'border-fuchsia-300 dark:border-fuchsia-700 bg-fuchsia-50 dark:bg-fuchsia-900/20',
            )}
          >
            <div className="flex items-center gap-1.5 font-medium text-fuchsia-800 dark:text-fuchsia-200">
              <Bot size={12} />
              {t('chat:aihub.hint.hermesTitle')}
            </div>
            <div className="mt-1.5 whitespace-pre-wrap text-fuchsia-700 dark:text-fuchsia-300">
              {t('chat:aihub.hint.hermesInstallGuide')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
