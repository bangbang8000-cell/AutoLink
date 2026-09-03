/**
 * V3.1.1-T5-5: AI 消息气泡（用户/助手 + markdown + 计划块 + 附件预览）
 * 4.3 F3-2: 确认卡片交互细化（解析 ---CONFIRM:<tool>--- 标记 → 确认/取消按钮回灌）
 */
import { Bot, User, FileText, Check, X, ListChecks } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import type { ChatMessage } from '@/types/chat'
import { useChatStore, parseConfirmationMarker, sendConfirmationReply, parseHermesInstallMarker, parseWorkflowMarker, parseStepConfirmMarker, sendStepConfirmationReply } from '@/stores/chat.store'
import { useProjectStore } from '@/stores/project.store'
import { PlanDisplay, parsePlanSteps } from './PlanDisplay'
import { ProjectConfigPreview, parseProjectConfigBlock } from './ProjectConfigPreview'

interface Props {
  message: ChatMessage
}

/** 剥离工作流标记行（---WORKFLOW:...--- / ---STEP_CONFIRM:...---），只留展示内容 */
function stripWorkflowMarkers(content: string): string {
  return content
    .replace(/(^|\n)---WORKFLOW:.*?---(\n|$)/g, '\n')
    .replace(/(^|\n)---STEP_CONFIRM:[^\n]+---(\n|$)/g, '\n')
    .trim()
}

/** 任务状态中文映射 */
function workflowStatusLabel(status: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    planning: t('chat:workflow.status.planning'),
    executing: t('chat:workflow.status.executing'),
    awaiting_step: t('chat:workflow.status.awaitingStep'),
    verifying: t('chat:workflow.status.verifying'),
    completed: t('chat:workflow.status.completed'),
    failed: t('chat:workflow.status.failed'),
    cancelled: t('chat:workflow.status.cancelled'),
  }
  return map[status] || status
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
  // 5.0.3-503-a: 解析多步任务进度标记 + 步骤审批标记
  const workflowTask = useMemo(
    () => (isUser || isSystem ? null : parseWorkflowMarker(message.content)),
    [message.content, isUser, isSystem],
  )
  const stepConfirm = useMemo(
    () => (isUser || isSystem ? null : parseStepConfirmMarker(message.content)),
    [message.content, isUser, isSystem],
  )
  const displayContent = stripWorkflowMarkers(
    confirmation ? confirmation.displayContent : hermesHint ? hermesHint.displayContent : message.content,
  )
  const isSending = useChatStore((s) => s.isSending)

  // 4.3 F3-2: 确认/取消按钮回灌；空闲时才发送，发送后卡片立即消失
  const handleConfirmation = (reply: '确认' | '取消') => {
    if (isSending || confirmationResolved) return
    setConfirmationResolved(true)
    const projectName = useProjectStore.getState().selectedProjectName
    sendConfirmationReply(reply, projectName ?? undefined)
  }

  // 5.0.3-503-a: 步骤审批回灌；空闲时才发送，发送后卡片立即消失
  const [stepResolved, setStepResolved] = useState(false)
  const handleStepConfirmation = (reply: '确认' | '取消') => {
    if (isSending || stepResolved) return
    setStepResolved(true)
    const projectName = useProjectStore.getState().selectedProjectName
    sendStepConfirmationReply(reply, projectName ?? undefined)
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

        {/* 5.0.3-503-a: 多步任务进度卡片（Plan→Execute→Verify 状态 + 步骤列表） */}
        {workflowTask && (
          <div className="mt-2 w-full rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-900/20 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-primary-800 dark:text-primary-200">
              <ListChecks size={12} />
              {t('chat:workflow.progressTitle')}
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
                {workflowStatusLabel(String(workflowTask.status || ''), t)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded bg-primary-100 dark:bg-primary-900/40 overflow-hidden">
                <div
                  className="h-full rounded bg-primary-500 transition-all"
                  style={{
                    width: `${Math.min(100, Math.round(((Number(workflowTask.current_step) || 0) / Math.max(1, Number(workflowTask.total_steps) || 1)) * 100))}%`,
                  }}
                />
              </div>
              <span className="shrink-0 text-primary-700 dark:text-primary-300">
                {t('chat:workflow.stepOf', {
                  step: Math.min((Number(workflowTask.current_step) || 0) + 1, Number(workflowTask.total_steps) || 1),
                  total: workflowTask.total_steps || 0,
                })}
              </span>
            </div>
            {Array.isArray(workflowTask.plan) && workflowTask.plan.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {(workflowTask.plan as Array<{ step: number; description: string; tool: string; status: string }>).map((s) => (
                  <li key={s.step} className="flex items-center gap-1.5 text-primary-700 dark:text-primary-300">
                    {s.status === 'completed' && <Check size={11} className="text-success-500" />}
                    {s.status === 'failed' && <X size={11} className="text-danger-500" />}
                    {(s.status === 'pending' || s.status === 'running') && (
                      <span className="inline-block w-[11px] h-[11px] rounded-full border border-primary-300 dark:border-primary-700" />
                    )}
                    <span className="truncate">{s.step}. {s.description}</span>
                    {s.tool && <code className="ml-auto shrink-0 text-[10px] text-primary-500">{s.tool}</code>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 5.0.3-503-a: 步骤审批确认卡片（多步任务） */}
        {stepConfirm && !stepResolved && (
          <div
            className={clsx(
              'mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs w-full',
              'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20',
            )}
          >
            <span className="flex-1 text-amber-800 dark:text-amber-200">
              {t('chat:workflow.confirmCard', { step: stepConfirm.step })}
            </span>
            <button
              onClick={() => handleStepConfirmation('确认')}
              disabled={isSending}
              className="flex items-center gap-0.5 px-2.5 py-1 rounded text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
            >
              <Check size={12} />
              {t('common:confirm')}
            </button>
            <button
              onClick={() => handleStepConfirmation('取消')}
              disabled={isSending}
              className="flex items-center gap-0.5 px-2.5 py-1 rounded text-xs font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 disabled:opacity-50"
            >
              <X size={12} />
              {t('common:cancel')}
            </button>
          </div>
        )}

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
