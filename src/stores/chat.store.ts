/**
 * V3.1.1-T5-5: AI 对话状态（移植 MC chat.store，autolink 化）
 *
 * 差异：AutoLink 无独立 AI Hub 进程（复用 engine 惰性进程），
 * 无 status/start；Provider 配置同步经 aihub.config 逐条下发。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import i18n from '@/i18n'
import type { ChatMessage, ChatSession, ChatAttachment, ChatMode, AttachmentType } from '@/types/chat'
import { generateId } from '@/types/chat'

export type AIHubStatus = 'ready' | 'no_provider' | 'error'

// T6-6: 会话 id 递增序号（配合 Date.now 保证唯一）
let sessionSeq = 0

interface ChatState {
  // 会话管理
  sessions: ChatSession[]
  activeSessionId: string | null
  hasHydrated: boolean
  setActiveSession: (id: string) => void
  createSession: (mode?: ChatMode) => string
  updateSessionMode: (mode: ChatMode) => void
  deleteSession: (id: string) => void
  clearCurrentSession: () => void
  // 4.3 F3-2: 会话管理增强（重命名 / 前端+后端联动清理）
  renameSession: (id: string, title: string) => void
  clearSessionContext: (sessionId?: string) => Promise<void>

  // 消息管理
  addMessage: (message: Partial<ChatMessage> & { role: 'user' | 'assistant'; content: string }) => void

  // 模式管理
  currentMode: ChatMode
  setMode: (mode: ChatMode) => void

  // 附件管理
  pendingAttachments: ChatAttachment[]
  addAttachment: (file: File) => Promise<void>
  removeAttachment: (id: string) => void
  clearAttachments: () => void

  // 输入状态
  inputValue: string
  setInputValue: (value: string) => void

  // 发送状态
  isSending: boolean
  setIsSending: (v: boolean) => void

  // AI Hub 状态
  aiHubStatus: AIHubStatus
  setAIHubStatus: (status: AIHubStatus) => void

  // 当前会话
  getActiveSession: () => ChatSession | null

  // 4.3 F3-2: 上下文摘要衔接（摘要后继续，keepFull=false 默认以摘要替换历史）
  summarizeSession: (
    sessionId: string | undefined,
    opts?: { keepFull?: boolean },
  ) => Promise<{ ok: boolean; summary?: string; error?: string }>
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      hasHydrated: false,
      currentMode: 'general',
      pendingAttachments: [],
      inputValue: '',
      isSending: false,
      aiHubStatus: 'no_provider',

      setActiveSession: (id) => set({ activeSessionId: id }),

      createSession: (mode?: ChatMode) => {
        const m = mode || get().currentMode
        // T6-6: id 加递增序号，避免同毫秒创建会话 id 冲突（误删/覆盖）
        const id = `session_${Date.now()}_${(sessionSeq += 1)}`
        const session: ChatSession = {
          id,
          title: i18n.t('chat:session.newChat'),
          messages: [],
          mode: m,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set((s) => ({
          sessions: [...s.sessions, session],
          activeSessionId: id,
          currentMode: m,
        }))
        return id
      },

      updateSessionMode: (mode) => {
        const activeId = get().activeSessionId
        if (!activeId) return
        set((s) => ({
          currentMode: mode,
          sessions: s.sessions.map((ses) =>
            ses.id === activeId ? { ...ses, mode, updatedAt: Date.now() } : ses,
          ),
        }))
      },

      deleteSession: (id) => {
        set((s) => {
          const filtered = s.sessions.filter((ses) => ses.id !== id)
          const newActiveId = s.activeSessionId === id ? (filtered[0]?.id || null) : s.activeSessionId
          return { sessions: filtered, activeSessionId: newActiveId }
        })
      },

      clearCurrentSession: () => {
        const activeId = get().activeSessionId
        if (!activeId) return
        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === activeId ? { ...ses, messages: [], updatedAt: Date.now() } : ses,
          ),
        }))
      },

      // 4.3 F3-2: 会话重命名（空标题忽略）
      renameSession: (id, title) => {
        const trimmed = title.trim()
        if (!trimmed) return
        set((s) => ({
          sessions: s.sessions.map((ses) => (ses.id === id ? { ...ses, title: trimmed, updatedAt: Date.now() } : ses)),
        }))
      },

      // 4.3 F3-2: 清空会话上下文 = 前端消息 + 后端会话历史（复用既有 aihub.clear IPC）
      // 后端不可用/失败时仅完成前端清空，不阻断
      clearSessionContext: async (sessionId) => {
        const id = sessionId || get().activeSessionId
        if (!id) return
        set((s) => ({
          sessions: s.sessions.map((ses) => (ses.id === id ? { ...ses, messages: [], updatedAt: Date.now() } : ses)),
        }))
        try {
          const aiHub = window.electron?.aihub
          if (aiHub?.clear) await aiHub.clear(id)
        } catch {
          /* 后端不可用时仅完成前端清空 */
        }
      },

      addMessage: (message) => {
        const activeId = get().activeSessionId
        if (!activeId) {
          get().createSession(message.mode)
        }
        const sessionId = get().activeSessionId
        if (!sessionId) return

        const newMsg: ChatMessage = {
          ...message,
          id: message.id || generateId(),
          timestamp: Date.now(),
          mode: message.mode || get().currentMode,
        }

        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === sessionId
              ? {
                  ...ses,
                  messages: [...ses.messages, newMsg],
                  // 首条用户消息自动设置会话标题
                  title: ses.messages.length === 0 && message.role === 'user'
                    ? (message.content || '').slice(0, 20) || ses.title
                    : ses.title,
                  updatedAt: Date.now(),
                }
              : ses,
          ),
        }))
      },

      setMode: (mode) => set({ currentMode: mode }),

      addAttachment: async (file: File) => {
        const path = (file as File & { path?: string }).path || file.name
        const attachment: ChatAttachment = {
          id: generateId(),
          name: file.name,
          type: getAttachmentTypeByExt(file.name),
          path,
          size: file.size,
        }
        set((s) => ({
          pendingAttachments: [...s.pendingAttachments, attachment],
        }))
      },

      removeAttachment: (id) => {
        set((s) => ({
          pendingAttachments: s.pendingAttachments.filter((a) => a.id !== id),
        }))
      },

      clearAttachments: () => set({ pendingAttachments: [] }),

      setInputValue: (value) => set({ inputValue: value }),
      setIsSending: (v) => set({ isSending: v }),
      setAIHubStatus: (status) => set({ aiHubStatus: status }),

      getActiveSession: () => {
        const { sessions, activeSessionId } = get()
        return sessions.find((s) => s.id === activeSessionId) || null
      },

      // ===== 4.3 F3-2: 会话内手动摘要（上下文摘要衔接，摘要后继续）=====
      // 用独立临时会话调用 AI 生成摘要；默认以摘要替换会话历史（新对话语义），
      // keepFull=true 保留完整历史、仅在会话顶部标记摘要。
      summarizeSession: async (sessionId, opts) => {
        const id = sessionId || get().activeSessionId
        if (!id) return { ok: false, error: i18n.t('chat:session.noSession') }
        const session = get().sessions.find((s) => s.id === id)
        if (!session || session.messages.length === 0) return { ok: false, error: i18n.t('chat:session.noSession') }
        const aiHub = window.electron?.aihub
        if (!aiHub) return { ok: false, error: i18n.t('chat:aihub.error.hubFailed') }
        try {
          const { useUIStore } = await import('@/stores/ui.store')
          const aiConfig = useUIStore.getState().aiConfig
          const provider = aiConfig.defaultProvider
          if (!provider) return { ok: false, error: i18n.t('chat:aihub.error.noModel') }
          // 构建历史文本（跳过 system 摘要标记，避免把摘要本身再摘要）
          const historyText = session.messages
            .filter((m) => m.role !== 'system')
            .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${(m.content || '').trim()}`)
            .join('\n')
          if (!historyText.trim()) return { ok: false, error: i18n.t('chat:session.noSession') }
          // 临时会话避免污染对话历史；成功后清理后端临时会话
          const tmpId = `summarize_${id}_${Date.now()}`
          const result = await aiHub.chat({
            sessionId: tmpId,
            message: `${i18n.t('chat:session.summarizePrompt')}\n\n${historyText}`,
            mode: 'general',
            provider,
            autonomyMode: aiConfig.autonomyMode,
          })
          const summary = ((result as { reply?: string | null }).reply || '').trim()
          if (!summary || /^(错误|Error)/.test(summary.trim())) {
            return { ok: false, error: summary || i18n.t('chat:session.summarizeFailed') }
          }
          const keepFull = opts?.keepFull ?? false
          const markerLabel = keepFull ? i18n.t('chat:session.summarizeMarker') : i18n.t('chat:session.summarizeReplaced')
          set((s) => ({
            sessions: s.sessions.map((ses) => {
              if (ses.id !== id) return ses
              const marker: ChatMessage = {
                id: generateId(),
                role: 'system',
                content: `${markerLabel}\n\n${summary}`,
                timestamp: Date.now(),
                mode: ses.mode,
              }
              return {
                ...ses,
                messages: keepFull ? [marker, ...ses.messages] : [marker],
                updatedAt: Date.now(),
              }
            }),
          }))
          try {
            if (aiHub.clear) await aiHub.clear(tmpId)
          } catch {
            /* 清理临时会话失败不阻塞 */
          }
          return { ok: true, summary }
        } catch (e) {
          // 失败保持原历史 + 返回错误（不破坏会话）
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      },
    }),
    {
      name: 'autolink-chat-state',
      partialize: (state) => ({
        sessions: state.sessions.slice(-20),
        activeSessionId: state.activeSessionId,
        currentMode: state.currentMode,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hasHydrated = true
      },
    },
  ),
)

/** 根据文件扩展名判断附件类型 */
function getAttachmentTypeByExt(fileName: string): AttachmentType {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'xlsx':
    case 'xls':
      return 'excel'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'j2':
    case 'jinja2':
      return 'template'
    case 'json':
    case 'toml':
    case 'ini':
    case 'cfg':
    case 'conf':
      return 'config'
    case 'md':
    case 'txt':
    case 'pdf':
      return 'document'
    default:
      return 'other'
  }
}

/**
 * 发送消息（真实 AI 流式响应；无 Provider 配置时降级 mock 回复）
 */

// T6-1: 已同步的 Provider 配置指纹（provider → 配置指纹）与默认 Provider。
// 连续对话仅首次/配置变更时下发到后端，避免每次对话全量重建。
const syncedProviderFingerprints: Record<string, string> = {}
let syncedDefaultProvider = ''

/** T6-1: 计算 Provider 配置指纹（apiKey/model/baseUrl 任一变化即重新同步） */
function providerFingerprint(cfg: { apiKey?: string; model?: string; baseUrl?: string }): string {
  return [cfg.apiKey || '', cfg.model || '', cfg.baseUrl || ''].join('|')
}

/** T6-1: 重置同步指纹（测试用，模拟应用重启） */
export function resetSyncedProviderConfigs(): void {
  for (const k of Object.keys(syncedProviderFingerprints)) {
    delete syncedProviderFingerprints[k]
  }
  syncedDefaultProvider = ''
}

export async function sendMessage(
  store: ReturnType<typeof useChatStore.getState>,
  content: string,
  mode: ChatMode,
  attachments: ChatAttachment[],
  projectName?: string,
) {
  const sessionId = store.activeSessionId
  if (!sessionId) return

  // 添加用户消息
  store.addMessage({
    role: 'user',
    content,
    mode,
    attachments: attachments.length > 0 ? [...attachments] : undefined,
  })

  store.setIsSending(true)
  store.setInputValue('')
  store.clearAttachments()

  // 创建 AI 消息占位
  const aiMsgId = generateId()
  store.addMessage({ id: aiMsgId, role: 'assistant', content: '', mode })

  // 尝试真实 AI
  try {
    const aiHub = window.electron?.aihub
    if (!aiHub) throw new Error('AI API not available')

    const { useUIStore } = await import('@/stores/ui.store')
    const aiConfig = useUIStore.getState().aiConfig

    // T6-1: Provider 配置去重同步（仅首次/变更时下发，避免每次对话全量重建）
    for (const [key, cfg] of Object.entries(aiConfig.providers)) {
      if (!cfg.apiKey) continue
      const fp = providerFingerprint(cfg)
      if (syncedProviderFingerprints[key] === fp) continue
      await aiHub.config({ provider: key, apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl })
      syncedProviderFingerprints[key] = fp
    }
    if (aiConfig.defaultProvider && aiConfig.defaultProvider !== syncedDefaultProvider) {
      await aiHub.configDefault(aiConfig.defaultProvider)
      syncedDefaultProvider = aiConfig.defaultProvider
    }

    const provider = aiConfig.defaultProvider
    if (!provider) {
      throw new Error(i18n.t('chat:aihub.error.noModel'))
    }

    // 监听流式响应（按 sessionId 过滤）
    let fullContent = ''
    // T6-6: 流式渲染节流——rAF 合并 chunk 批量更新，仅更新目标消息，
    // 避免每 token 全量 sessions/messages map 重建导致的长会话卡顿
    let pendingContent = ''
    let rafId = 0
    const flushStream = () => {
      rafId = 0
      if (!pendingContent) return
      const content = pendingContent
      pendingContent = ''
      useChatStore.setState((s) => {
        const sesIdx = s.sessions.findIndex((ses) => ses.id === sessionId)
        if (sesIdx < 0) return {}
        const ses = s.sessions[sesIdx]
        const msgIdx = ses.messages.findIndex((m) => m.id === aiMsgId)
        if (msgIdx < 0) return {}
        const newMessages = [...ses.messages]
        newMessages[msgIdx] = { ...newMessages[msgIdx], content }
        const newSessions = [...s.sessions]
        newSessions[sesIdx] = { ...ses, messages: newMessages }
        return { sessions: newSessions }
      })
    }
    const unsub = aiHub.onStream(({ sessionId: sid, chunk }) => {
      if (sid !== sessionId) return
      fullContent += chunk
      pendingContent = fullContent
      // T6-7: 活跃超时——有输出则重置计时（长工具链不因 60s 硬超时中断）
      scheduleTimeout()
      if (!rafId) {
        rafId = requestAnimationFrame(flushStream)
      }
    })

    // T6-7: 60s 硬超时改为活跃超时：最后一次 chunk 起算 60s 无输出才超时
    const timeoutMs = 60000
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let rejectActiveTimeout: (reason?: unknown) => void = () => {}
    const scheduleTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        timeoutId = null
        rejectActiveTimeout(new Error(i18n.t('chat:aihub.error.timeout')))
      }, timeoutMs)
    }
    const timeoutPromise = new Promise<unknown>((_, reject) => {
      rejectActiveTimeout = reject
    })
    scheduleTimeout()

    // 发送请求（带超时）
    const chatPromise = aiHub.chat({
      sessionId,
      message: content,
      mode,
      provider,
      autonomyMode: aiConfig.autonomyMode,
      projectName,
      attachments: attachments.length > 0
        ? attachments.map((a) => ({ id: a.id, name: a.name, type: a.type, path: a.path, size: a.size }))
        : undefined,
    })

    await Promise.race([chatPromise, timeoutPromise])
    if (timeoutId) clearTimeout(timeoutId)
    // T6-6: 同步冲刷残留 chunk（取消未执行的帧，保证返回时内容完整）
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    flushStream()
    unsub()
    store.setIsSending(false)
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : i18n.t('chat:aihub.error.unknown')

    const currentMsg = useChatStore.getState().sessions
      .find((s) => s.id === sessionId)
      ?.messages.find((m) => m.id === aiMsgId)

    const existingContent = currentMsg?.content || ''

    if (existingContent) {
      // 已有部分流式内容，追加中断提示
      useChatStore.setState((s) => ({
        sessions: s.sessions.map((ses) =>
          ses.id === sessionId
            ? {
                ...ses,
                messages: ses.messages.map((m) =>
                  m.id === aiMsgId ? { ...m, content: existingContent + `\n\n> ${errorMsg}` } : m,
                ),
              }
            : ses,
        ),
      }))
    } else if (!currentMsg) {
      // 会话已删除等情况，忽略
    } else {
      // 完全没有响应，降级为 mock 回复
      useChatStore.setState((s) => ({
        sessions: s.sessions.map((ses) =>
          ses.id === sessionId
            ? {
                ...ses,
                messages: ses.messages.map((m) =>
                  m.id === aiMsgId ? { ...m, content: getMockResponse(mode) } : m,
                ),
              }
            : ses,
        ),
      }))
    }

    store.setIsSending(false)
  }
}

/** 无网络/无 Provider 时的降级回复 */
export function getMockResponse(mode: ChatMode): string {
  const key = mode === 'template' ? 'mock.template' : mode === 'config' ? 'mock.config' : 'mock.general'
  return i18n.t(`chat:${key}`)
}

// ===== 4.3 F3-2: 确认卡片（确认流完善）的可测纯函数与回灌入口 =====

/**
 * 从 assistant 消息内容解析确认标记（后端 run_stream CONFIRM 分支 yield 的独立行
 * `---CONFIRM:<tool>---`）。返回工具名与剥离标记后的展示内容；无标记返回 null。
 * 向后兼容：无标记时前端不渲染卡片，用户仍可手动输入"确认"/"取消"。
 */
export function parseConfirmationMarker(content: string): { tool: string; displayContent: string } | null {
  const rx = /(^|\n)---CONFIRM:([^\s-]+)---(\n|$)/
  const m = content.match(rx)
  if (!m) return null
  const tool = m[2]
  const displayContent = content.replace(rx, '\n').trim()
  return { tool, displayContent }
}

/**
 * 4.3 F3-2: 确认/取消按钮回灌。
 * 以用户身份发送「确认」/「取消」消息（复用 sendMessage 路径），
 * 仅在空闲（非 isSending）时发起，避免与进行中的流并发；fire-and-forget，不阻塞按钮交互。
 * @param projectName 当前项目名（由调用方传入，避免后端 set_mode 重置项目上下文）
 * 返回是否已发起（isSending 期间的点击将被忽略并返回 false）。
 */
export function sendConfirmationReply(reply: '确认' | '取消', projectName?: string): boolean {
  const store = useChatStore.getState()
  if (store.isSending) return false
  const session = store.getActiveSession()
  const mode = session?.mode || store.currentMode
  void (async () => {
    try {
      await sendMessage(store, reply, mode, [], projectName)
    } catch (e) {
      console.error('[chat.store] 确认/取消回复发送失败', e)
    }
  })()
  return true
}
