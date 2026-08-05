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

      addMessage: (message) => {
        const activeId = get().activeSessionId
        if (!activeId) {
          get().createSession(message.mode)
        }
        const sessionId = get().activeSessionId
        if (!sessionId) return

        const newMsg: ChatMessage = {
          ...message,
          id: (message as any).id || generateId(),
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
        const path = (file as any).path || file.name
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
  store.addMessage({ id: aiMsgId, role: 'assistant', content: '', mode } as any)

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
  } catch (err: any) {
    const errorMsg = err?.message || i18n.t('chat:aihub.error.unknown')

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
